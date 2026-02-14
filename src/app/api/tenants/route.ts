import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createTenantContainer, startContainer, removeContainer } from "@/lib/docker";
import { createTenantAccessApp, deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { TenantCreateInput } from "@/types";

export async function GET() {
  try {
    await requireAdmin();
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: tenants });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body: TenantCreateInput = await req.json();

    if (!body.email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(body.slug)) {
      return NextResponse.json(
        { error: "Slug must be 3-20 chars, lowercase alphanumeric and hyphens" },
        { status: 400 }
      );
    }

    const existing = await prisma.tenant.findUnique({ where: { slug: body.slug } });
    if (existing) {
      return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
    }

    // 1. Create Cloudflare Access app FIRST — subdomain must be protected
    //    before any container becomes routable
    const accessAppId = await createTenantAccessApp(body.slug, body.email);

    const tenant = await prisma.tenant.create({
      data: {
        slug: body.slug,
        displayName: body.displayName,
        email: body.email,
        allowAnthropic: body.allowAnthropic ?? true,
        allowOpenAI: body.allowOpenAI ?? false,
        allowGemini: body.allowGemini ?? false,
        allowBrave: body.allowBrave ?? false,
        allowElevenLabs: body.allowElevenLabs ?? false,
        defaultModel: body.defaultModel ?? "anthropic/claude-sonnet-4-5",
        execSecurity: body.execSecurity ?? "deny",
        browserEnabled: body.browserEnabled ?? false,
        envOverrides: body.envOverrides ? JSON.stringify(body.envOverrides) : null,
        gatewayToken: generateToken(),
        accessAppId,
      },
    });

    // 2. Create and start container — now safe since Access app is in place
    let containerId: string;
    try {
      containerId = await createTenantContainer(tenant);
      await startContainer(containerId);
    } catch (dockerErr) {
      // Rollback: remove Access app + tenant record
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
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
