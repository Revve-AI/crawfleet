import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { sseResponse, type SSESend } from "@/lib/sse";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const provider = await getProvider(tenant);

    await provider.start(tenant, (s) => send("status", { step: s }));
    await prisma.tenant.update({ where: { slug }, data: { containerStatus: "running" } });

    // For Docker: persist containerId if it was created during start
    if (tenant.provider === "docker" && tenant.containerId) {
      await prisma.tenant.update({ where: { slug }, data: { containerId: tenant.containerId } });
    }

    send("status", { step: "Waiting for health check" });
    const healthy = await provider.waitForHealthy(tenant, 120_000, (s) => send("status", { step: s }));

    if (!healthy) {
      throw new Error("Started but failed health check");
    }

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, action: "tenant.started" },
    });

    send("done", { containerId: tenant.containerId });
  });
}
