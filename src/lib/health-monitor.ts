import { prisma } from "./db";
import { getProvider } from "./providers";

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function checkAllHealth(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { containerId: { not: null } },
        { provider: "vps" },
      ],
    },
    include: { vpsInstance: true },
  });

  for (const tenant of tenants) {
    // Skip Docker tenants without containers
    if (tenant.provider === "docker" && !tenant.containerId) continue;
    // Skip VPS tenants without instances
    if (tenant.provider === "vps" && !tenant.vpsInstance) continue;

    try {
      const provider = await getProvider(tenant);
      const status = await provider.getStatus(tenant);
      const health = status === "running"
        ? await provider.getHealth(tenant)
        : "unknown";

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          containerStatus: status,
          lastHealthCheck: new Date(),
          lastHealthStatus: health,
        },
      });
    } catch {
      // Individual health check failure shouldn't stop the loop
    }
  }
}

export function startHealthMonitor(intervalMs: number = 30_000): void {
  if (intervalId) return;
  intervalId = setInterval(checkAllHealth, intervalMs);
}

export function stopHealthMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
