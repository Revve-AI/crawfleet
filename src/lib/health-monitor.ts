import { prisma } from "./db";
import { getContainerHealth, getContainerStatus } from "./docker";

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function checkAllHealth(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { containerId: { not: null } },
  });

  for (const tenant of tenants) {
    if (!tenant.containerId) continue;

    const status = await getContainerStatus(tenant.containerId);
    const health = status === "running"
      ? await getContainerHealth(tenant.containerId)
      : "unknown";

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        containerStatus: status,
        lastHealthCheck: new Date(),
        lastHealthStatus: health,
      },
    });
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
