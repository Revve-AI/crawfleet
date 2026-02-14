import { prisma } from "@/lib/db";
import NavShell from "@/components/NavShell";
import TenantCard from "@/components/TenantCard";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {

  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <NavShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tenants</h1>
            <p className="text-gray-500 mt-1">{tenants.length} total</p>
          </div>
          <a
            href="/tenants/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Tenant
          </a>
        </div>

        {tenants.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No tenants yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((t) => (
              <TenantCard key={t.id} tenant={t} />
            ))}
          </div>
        )}
      </div>
    </NavShell>
  );
}
