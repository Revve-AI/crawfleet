import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import NavShell from "@/components/NavShell";
import FleetStats from "@/components/FleetStats";
import TenantCard from "@/components/TenantCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {

  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);

  let query = supabaseAdmin
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });
  if (!admin) query = query.eq("email", email);
  const { data: tenants } = await query;
  const list = tenants || [];

  const stats = {
    total: list.length,
    running: list.filter((t) => t.container_status === "running").length,
    stopped: list.filter((t) => t.container_status === "stopped").length,
    healthy: list.filter((t) => t.last_health_status === "healthy").length,
    unhealthy: list.filter((t) => t.last_health_status === "unhealthy").length,
  };

  return (
    <NavShell isAdmin={admin}>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fleet Overview</h1>
          <p className="text-zinc-500 mt-1 text-sm">Manage your OpenClaw instances</p>
        </div>

        <FleetStats stats={stats} />

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Recent Tenants</h2>
            {admin && (
              <a
                href="/tenants/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-light text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Tenant
              </a>
            )}
          </div>
          {list.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-zinc-500">No tenants yet.</p>
              <p className="text-zinc-600 text-sm mt-1">Create one to get started.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.slice(0, 6).map((t) => (
                <TenantCard key={t.id} tenant={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </NavShell>
  );
}
