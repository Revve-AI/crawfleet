import { prisma } from "@/lib/db";
import NavShell from "@/components/NavShell";
import FleetStats from "@/components/FleetStats";
import TenantCard from "@/components/TenantCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {

  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" } });

  const stats = {
    total: tenants.length,
    running: tenants.filter((t) => t.containerStatus === "running").length,
    stopped: tenants.filter((t) => t.containerStatus === "stopped").length,
    healthy: tenants.filter((t) => t.lastHealthStatus === "healthy").length,
    unhealthy: tenants.filter((t) => t.lastHealthStatus === "unhealthy").length,
  };

  return (
    <NavShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Fleet Overview</h1>
          <p className="text-gray-500 mt-1">Manage your OpenClaw instances</p>
        </div>

        <FleetStats stats={stats} />

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Tenants</h2>
            <a
              href="/tenants/new"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + New Tenant
            </a>
          </div>
          {tenants.length === 0 ? (
            <p className="text-gray-500 text-center py-12">No tenants yet. Create one to get started.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tenants.slice(0, 6).map((t) => (
                <TenantCard key={t.id} tenant={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </NavShell>
  );
}
