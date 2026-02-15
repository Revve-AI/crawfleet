import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/tenant-access";
import { startContainer, createTenantContainer } from "@/lib/docker";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

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
    return apiError(e);
  }
}
