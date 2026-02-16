import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireFleetAdmin } from "@/lib/auth";
import { requireTenantAccess } from "@/lib/tenant-access";
import { removeContainer, removeTenantData, tryRemoveByName } from "@/lib/docker";
import { deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { TenantUpdateInput } from "@/types";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

function safeParseOverrides(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Return override keys (names only, no values) for safe API response */
function overrideKeyNames(raw: string | null): string[] {
  return Object.keys(safeParseOverrides(raw));
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    // Strip raw override values, return key names only
    const { envOverrides, ...rest } = tenant;
    return NextResponse.json({
      success: true,
      data: { ...rest, envOverrideKeys: overrideKeyNames(envOverrides) },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireFleetAdmin();
    const { slug } = await params;
    const { email: _email, envOverrides: incomingOverrides, ...body }: TenantUpdateInput & { email?: string } = await req.json();

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Merge env overrides: existing + incoming. Empty string value = delete that key.
    let envChanged = false;
    const dbData: Record<string, unknown> = { ...body };
    if (incomingOverrides) {
      const existing = safeParseOverrides(tenant.envOverrides);
      for (const [k, v] of Object.entries(incomingOverrides)) {
        if (!v || v.trim() === "") {
          if (k in existing) { delete existing[k]; envChanged = true; }
        } else {
          existing[k] = v.trim();
          envChanged = true;
        }
      }
      dbData.envOverrides = Object.keys(existing).length > 0 ? JSON.stringify(existing) : null;
    }

    const updated = await prisma.tenant.update({
      where: { slug },
      data: dbData,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: envChanged ? "tenant.env_changed" : "config.updated",
        details: JSON.stringify({ ...body, ...(incomingOverrides ? { envOverrides: Object.keys(incomingOverrides) } : {}) }),
      },
    });

    const { envOverrides: rawOverrides, ...safeData } = updated;
    return NextResponse.json({
      success: true,
      data: { ...safeData, envOverrideKeys: overrideKeyNames(rawOverrides) },
      envChanged,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireFleetAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (tenant.accessAppId) {
      try {
        await deleteTenantAccessApp(tenant.accessAppId);
      } catch (cfErr) {
        console.error("Failed to delete Cloudflare Access app:", cfErr);
      }
    }

    // Wipe data while container is still running (has correct file permissions)
    await removeTenantData(slug, tenant.containerId);

    if (tenant.containerId) {
      try {
        await removeContainer(tenant.containerId);
      } catch {
        // Container may already be gone; fall through to by-name cleanup
      }
    }
    await tryRemoveByName(`fleet-${slug}`);

    await prisma.auditLog.create({
      data: { tenantId: null, action: "tenant.deleted", details: JSON.stringify({ slug }) },
    });

    await prisma.tenant.delete({ where: { slug } });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
