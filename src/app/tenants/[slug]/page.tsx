import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BASE_DOMAIN, FLEET_TLS } from "@/lib/constants";
import NavShell from "@/components/NavShell";
import TenantForm from "@/components/TenantForm";
import TenantActions from "./TenantActions";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {

  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) notFound();

  const scheme = FLEET_TLS ? "https" : "http";
  const instanceUrl = `${scheme}://${tenant.slug}.${BASE_DOMAIN}`;
  const openUrl = `${instanceUrl}/?token=${tenant.gatewayToken}`;

  return (
    <NavShell>
      <div className="space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{tenant.displayName}</h1>
            <p className="text-gray-500 mt-1">{tenant.slug}</p>
          </div>
          <TenantActions slug={tenant.slug} status={tenant.containerStatus} />
        </div>

        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <InfoCard label="Status" value={tenant.containerStatus} />
          <InfoCard label="Health" value={tenant.lastHealthStatus || "unknown"} />
          <InfoCard label="Model" value={tenant.defaultModel.split(":").pop() || tenant.defaultModel} />
          <InfoCard label="Exec" value={tenant.execSecurity} />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Instance Access</h2>
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Open Instance
            </a>
          </div>
          <div className="text-sm space-y-1.5">
            <div>
              <span className="text-gray-500">URL: </span>
              <span className="text-gray-200 font-mono">{instanceUrl}</span>
            </div>
            <div>
              <span className="text-gray-500">Token: </span>
              <span className="text-gray-200 font-mono text-xs break-all">{tenant.gatewayToken}</span>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Edit Configuration</h2>
          <TenantForm mode="edit" initial={{
            ...tenant,
            email: tenant.email ?? undefined,
            envOverrideKeys: Object.keys(tenant.envOverrides ? JSON.parse(tenant.envOverrides) : {}),
          }} />
        </div>
      </div>
    </NavShell>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium mt-1 truncate">{value}</p>
    </div>
  );
}
