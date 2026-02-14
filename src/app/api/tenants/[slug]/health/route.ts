import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getContainerHealth, getContainerStatus } from "@/lib/docker";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || !tenant.containerId) {
      return NextResponse.json({ error: "Not found or no container" }, { status: 404 });
    }

    const status = await getContainerStatus(tenant.containerId);
    const health = status === "running" ? await getContainerHealth(tenant.containerId) : "unknown";

    await prisma.tenant.update({
      where: { slug },
      data: { containerStatus: status, lastHealthCheck: new Date(), lastHealthStatus: health },
    });

    return NextResponse.json({ success: true, data: { status, health } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
