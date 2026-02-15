import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getContainerHealth, getContainerStatus } from "@/lib/docker";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    if (!tenant.containerId) {
      return NextResponse.json({ error: "No container" }, { status: 404 });
    }

    const status = await getContainerStatus(tenant.containerId);
    const health = status === "running" ? await getContainerHealth(tenant.containerId) : "unknown";

    await prisma.tenant.update({
      where: { slug },
      data: { containerStatus: status, lastHealthCheck: new Date(), lastHealthStatus: health },
    });

    return NextResponse.json({ success: true, data: { status, health } });
  } catch (e) {
    return apiError(e);
  }
}
