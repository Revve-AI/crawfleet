import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/tenant-access";
import { startContainer, createTenantContainer, waitForHealthy } from "@/lib/docker";
import { sseResponse, type SSESend } from "@/lib/sse";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    let containerId = tenant.containerId;
    if (!containerId) {
      send("status", { step: "Creating container" });
      containerId = await createTenantContainer(tenant);
      await prisma.tenant.update({ where: { slug }, data: { containerId } });
    }

    send("status", { step: "Starting container" });
    await startContainer(containerId);
    await prisma.tenant.update({ where: { slug }, data: { containerStatus: "running" } });

    send("status", { step: "Waiting for health check" });
    const healthy = await waitForHealthy(containerId, 120_000, (s) => send("status", { step: s }));

    if (!healthy) {
      throw new Error("Container started but failed health check");
    }

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.started" },
    });

    send("done", { containerId });
  });
}
