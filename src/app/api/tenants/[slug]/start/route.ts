import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { startContainer, createTenantContainer } from "@/lib/docker";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let containerId = tenant.containerId;
    if (!containerId) {
      containerId = await createTenantContainer(tenant);
      await prisma.tenant.update({ where: { slug }, data: { containerId } });
    }

    await startContainer(containerId);
    await prisma.tenant.update({ where: { slug }, data: { containerStatus: "running" } });

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.started" },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
