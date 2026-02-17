import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthEmail, isFleetAdmin, requireFleetAdmin } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createTenantContainer, startContainer } from "@/lib/docker";
import { createTenantAccessApp, deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { getProvider } from "@/lib/providers";
import { TenantCreateInput } from "@/types";
import { apiError } from "@/lib/api-error";
import { sseResponse, type SSESend } from "@/lib/sse";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

function validateCreate(body: TenantCreateInput): string | null {
  if (!body.email) return "Email is required";
  if (!SLUG_RE.test(body.slug)) return "Slug must be 3-20 chars, lowercase alphanumeric and hyphens";
  if (body.provider === "vps") {
    if (!body.cloud) return "Cloud provider is required";
    if (!body.region) return "Region is required";
    if (!body.machineType) return "Machine type is required";
  }
  return null;
}

export async function GET() {
  try {
    const email = await getAuthEmail();
    const where = isFleetAdmin(email) ? {} : { email };
    const tenants = await prisma.tenant.findMany({
      where,
      include: { vpsInstance: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: tenants });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  const body: TenantCreateInput = await req.json();

  // VPS tenants use SSE for long-running provisioning
  if (body.provider === "vps") {
    return sseResponse(async (send: SSESend) => {
      await requireFleetAdmin();

      const validationError = validateCreate(body);
      if (validationError) throw new Error(validationError);

      const existing = await prisma.tenant.findUnique({ where: { slug: body.slug } });
      if (existing) throw new Error("Slug already in use");

      send("status", { step: "Creating Cloudflare Access app" });
      const accessAppId = await createTenantAccessApp(body.slug, body.email);

      const tenant = await prisma.tenant.create({
        data: {
          slug: body.slug,
          displayName: body.displayName,
          email: body.email,
          envOverrides: body.envOverrides ? JSON.stringify(body.envOverrides) : null,
          gatewayToken: generateToken(),
          accessAppId,
          provider: "vps",
          vpsInstance: {
            create: {
              cloud: body.cloud!,
              region: body.region!,
              machineType: body.machineType!,
              instanceId: "", // will be set during provisioning
              gitTag: body.gitTag || null,
            },
          },
        },
        include: { vpsInstance: true },
      });

      try {
        const provider = await getProvider(tenant);
        const instanceId = await provider.create(tenant, (step) => {
          send("status", { step });
        });

        await prisma.tenant.update({
          where: { slug: body.slug },
          data: { containerStatus: "running" },
        });

        await prisma.auditLog.create({
          data: {
            tenantId: tenant.id,
            action: "tenant.created",
            details: JSON.stringify({
              slug: body.slug,
              provider: "vps",
              cloud: body.cloud,
              region: body.region,
              instanceId,
            }),
          },
        });

        send("done", { slug: tenant.slug });
      } catch (err) {
        // Rollback: delete tenant record (cascade deletes VpsInstance)
        if (accessAppId) {
          await deleteTenantAccessApp(accessAppId).catch(() => {});
        }
        await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.tenant.delete({ where: { id: tenant.id } });
        throw err;
      }
    });
  }

  // Docker tenants — original synchronous flow
  try {
    await requireFleetAdmin();

    const validationError = validateCreate(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const existing = await prisma.tenant.findUnique({ where: { slug: body.slug } });
    if (existing) {
      return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
    }

    const accessAppId = await createTenantAccessApp(body.slug, body.email);

    const tenant = await prisma.tenant.create({
      data: {
        slug: body.slug,
        displayName: body.displayName,
        email: body.email,
        envOverrides: body.envOverrides ? JSON.stringify(body.envOverrides) : null,
        gatewayToken: generateToken(),
        accessAppId,
        provider: "docker",
      },
    });

    let containerId: string;
    try {
      containerId = await createTenantContainer(tenant);
      await startContainer(containerId);
    } catch (dockerErr) {
      if (accessAppId) {
        await deleteTenantAccessApp(accessAppId).catch(() => {});
      }
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
      throw dockerErr;
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { containerId, containerStatus: "running" },
    });

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.created", details: JSON.stringify({ slug: body.slug }) },
    });

    return NextResponse.json({ success: true, data: updated }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
