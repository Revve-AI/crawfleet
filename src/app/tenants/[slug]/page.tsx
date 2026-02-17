import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import { BASE_DOMAIN, FLEET_TLS, OPENCLAW_IMAGE, CLOUD_NAMES } from "@/lib/constants";
import NavShell from "@/components/NavShell";
import StatusBadge from "@/components/StatusBadge";
import TenantForm from "@/components/TenantForm";
import TenantActions from "./TenantActions";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {

  const { slug } = await params;
  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { vpsInstance: true },
  });
  if (!tenant) notFound();
  if (!admin && tenant.email !== email) notFound();

  const scheme = FLEET_TLS ? "https" : "http";
  const instanceUrl = `${scheme}://${tenant.slug}.${BASE_DOMAIN}`;
  const openUrl = `${instanceUrl}/?token=${tenant.gatewayToken}`;

  const vps = tenant.vpsInstance;

  return (
    <NavShell isAdmin={admin}>
      <div className="space-y-6">
        {/* Breadcrumb + Header */}
        <div>
          <a href="/tenants" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1 mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Tenants
          </a>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{tenant.displayName}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-zinc-500 text-sm font-mono">{tenant.slug}</p>
                <ProviderBadge provider={tenant.provider} cloud={vps?.cloud} />
              </div>
            </div>
            <StatusBadge status={tenant.containerStatus} />
          </div>
        </div>

        {/* Status strip */}
        <div className={`grid gap-3 ${vps ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
          <InfoCard label={tenant.provider === "docker" ? "Container" : "VM"} value={tenant.containerStatus} />
          <InfoCard label="Health" value={tenant.lastHealthStatus || "unknown"} />
          {vps && (
            <>
              <InfoCard label="Region" value={vps.region} />
              <InfoCard label="Machine" value={vps.machineType} />
            </>
          )}
        </div>

        {/* VPS Details */}
        {vps && (
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-3">
            <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">VPS Details</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Cloud</span>
                <span className="text-zinc-200">{CLOUD_NAMES[vps.cloud] || vps.cloud}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Instance</span>
                <code className="text-zinc-200 font-mono text-xs">{vps.instanceId || "—"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">IP</span>
                <code className="text-zinc-200 font-mono text-xs">{vps.externalIp || "—"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Git Tag</span>
                <code className="text-zinc-200 font-mono text-xs">{vps.gitTag || "latest"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Tunnel</span>
                <span className="text-zinc-200 text-xs">{vps.tunnelId ? "Connected" : "—"}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">VM Status</span>
                <span className="text-zinc-200 text-xs">{vps.vmStatus}</span>
              </div>
            </div>
          </div>
        )}

        {/* Instance Access */}
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-4">
          <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Instance Access</h2>
          <div className="space-y-2">
            <div className="flex items-baseline gap-3 text-sm">
              <span className="text-zinc-500 text-xs w-12 shrink-0">URL</span>
              <code className="text-zinc-200 font-mono text-xs">{instanceUrl}</code>
            </div>
            <div className="flex items-baseline gap-3 text-sm">
              <span className="text-zinc-500 text-xs w-12 shrink-0">Token</span>
              <code className="text-zinc-200 font-mono text-xs break-all">{tenant.gatewayToken}</code>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand-light text-white text-sm font-medium rounded-lg transition-colors"
            >
              Open Instance
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
            <a
              href={`/tenants/${tenant.slug}/shell`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors border border-zinc-700/60"
            >
              Shell
            </a>
            <a
              href={`/tenants/${tenant.slug}/logs`}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors border border-zinc-700/60"
            >
              Logs
            </a>
          </div>
        </div>

        {/* Lifecycle controls */}
        <TenantActions
          slug={tenant.slug}
          status={tenant.containerStatus}
          isAdmin={admin}
          currentImage={tenant.image}
          defaultImage={OPENCLAW_IMAGE}
          provider={tenant.provider}
          currentGitTag={vps?.gitTag}
        />

        {/* Configuration (admin only) */}
        {admin && (
          <div>
            <h2 className="text-lg font-semibold mb-4 tracking-tight">Configuration</h2>
            <TenantForm mode="edit" initial={{
              ...tenant,
              email: tenant.email ?? undefined,
              envOverrideKeys: Object.keys(tenant.envOverrides ? JSON.parse(tenant.envOverrides) : {}),
            }} />
          </div>
        )}
      </div>
    </NavShell>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-sm font-medium mt-1 truncate text-zinc-200">{value}</p>
    </div>
  );
}

function ProviderBadge({ provider, cloud }: { provider: string; cloud?: string | null }) {
  if (provider === "docker") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-medium rounded border border-blue-500/20">
        Docker
      </span>
    );
  }

  const cloudLabel = cloud ? (CLOUD_NAMES[cloud] || cloud) : "VPS";
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-violet-500/10 text-violet-400 text-[10px] font-medium rounded border border-violet-500/20">
      {cloudLabel}
    </span>
  );
}
