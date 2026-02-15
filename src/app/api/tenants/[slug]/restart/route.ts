import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/tenant-access";
import { restartContainer } from "@/lib/docker";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    if (!tenant.containerId) {
      return NextResponse.json({ error: "No container" }, { status: 404 });
    }

    await restartContainer(tenant.containerId);
    await prisma.tenant.update({ where: { slug }, data: { containerStatus: "running" } });

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.restarted" },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
