import { prisma } from "@/lib/db";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import NavShell from "@/components/NavShell";
import TenantCard from "@/components/TenantCard";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {

  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);
  const where = admin ? {} : { email };
  const tenants = await prisma.tenant.findMany({ where, orderBy: { createdAt: "desc" } });

  return (
    <NavShell isAdmin={admin}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>
            <p className="text-zinc-500 mt-1 text-sm">{tenants.length} instance{tenants.length !== 1 && "s"}</p>
          </div>
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

        {tenants.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500">No tenants yet.</p>
            <p className="text-zinc-600 text-sm mt-1">Create one to get started.</p>
          </div>
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
