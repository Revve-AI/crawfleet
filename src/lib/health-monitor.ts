import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "./providers";
import type { TenantWithVps } from "@/lib/supabase/types";

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function checkAllHealth(): Promise<void> {
  const { data: tenants } = await supabaseAdmin
    .from("tenants")
    .select("*, vps_instances(*)");

  if (!tenants) return;

  for (const tenant of tenants as TenantWithVps[]) {
    // Skip tenants without VPS instances
    if (!tenant.vps_instances) continue;

    try {
      const provider = await getProvider();
      const status = await provider.getStatus(tenant);
      const health = status === "running"
        ? await provider.getHealth(tenant)
        : "unknown";

      await supabaseAdmin
        .from("tenants")
        .update({
          status,
          last_health_check: new Date().toISOString(),
          last_health_status: health,
        })
        .eq("id", tenant.id);
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
