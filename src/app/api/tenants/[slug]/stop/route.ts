import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { stopContainer } from "@/lib/docker";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || !tenant.containerId) {
      return NextResponse.json({ error: "Not found or no container" }, { status: 404 });
    }

    await stopContainer(tenant.containerId);
    await prisma.tenant.update({ where: { slug }, data: { containerStatus: "stopped" } });

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.stopped" },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
