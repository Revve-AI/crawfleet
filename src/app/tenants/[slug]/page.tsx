import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import { BASE_DOMAIN, FLEET_TLS, CLOUD_NAMES } from "@/lib/constants";
import NavShell from "@/components/NavShell";
import StatusBadge from "@/components/StatusBadge";
import TenantForm from "@/components/TenantForm";
import TenantActions from "./TenantActions";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ slug: string }> }) {

  const { slug } = await params;
  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("*, vps_instances(*)")
    .eq("slug", slug)
    .single();
  if (!tenant) notFound();
  if (!admin && tenant.email !== email) notFound();

  const scheme = FLEET_TLS ? "https" : "http";
  const instanceUrl = `${scheme}://${tenant.slug}.${BASE_DOMAIN}`;
  const openUrl = `${instanceUrl}/?token=${tenant.gateway_token}`;

  const vps = tenant.vps_instances;
  const cloudLabel = vps?.cloud ? (CLOUD_NAMES[vps.cloud] || vps.cloud) : "VPS";

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
              <h1 className="text-2xl font-bold tracking-tight">{tenant.display_name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-zinc-500 text-sm font-mono">{tenant.slug}</p>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-violet-500/10 text-violet-400 text-[10px] font-medium rounded border border-violet-500/20">
                  {cloudLabel}
                </span>
              </div>
            </div>
            <StatusBadge status={tenant.status} />
          </div>
        </div>

        {/* Provisioning failed banner */}
        {tenant.status === "provisioning_failed" && vps && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="text-amber-400 font-medium text-sm">Provisioning incomplete</p>
              <p className="text-zinc-400 text-sm mt-0.5">
                VM is set up but provisioning stopped at stage: <span className="font-mono text-amber-300">{vps.provision_stage || "unknown"}</span>.
                Use the Resume Provisioning button below to continue.
              </p>
            </div>
          </div>
        )}

        {/* Status strip */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <InfoCard label="VM" value={tenant.status} />
          <InfoCard label="Health" value={tenant.last_health_status || "unknown"} />
          {vps && (
            <>
              <InfoCard label="Region" value={vps.region} />
              <InfoCard label="Machine" value={vps.machine_type} />
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
                <code className="text-zinc-200 font-mono text-xs">{vps.instance_id || "—"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">IP</span>
                <code className="text-zinc-200 font-mono text-xs">{vps.external_ip || "—"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Git Tag</span>
                <code className="text-zinc-200 font-mono text-xs">{vps.git_tag || "latest"}</code>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">Tunnel</span>
                <span className="text-zinc-200 text-xs">{vps.tunnel_id ? "Connected" : "—"}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-zinc-500 text-xs w-16 shrink-0">VM Status</span>
                <span className="text-zinc-200 text-xs">{vps.vm_status}</span>
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
              <code className="text-zinc-200 font-mono text-xs break-all">{tenant.gateway_token}</code>
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
            <a
              href={`/tenants/${tenant.slug}/ssh`}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors border border-zinc-700/60"
            >
              SSH
            </a>
          </div>
        </div>

        {/* Lifecycle controls */}
        <TenantActions
          slug={tenant.slug}
          status={tenant.status}
          isAdmin={admin}
          currentGitTag={vps?.git_tag}
        />

        {/* Configuration (admin only) */}
        {admin && (
          <div>
            <h2 className="text-lg font-semibold mb-4 tracking-tight">Configuration</h2>
            <TenantForm mode="edit" initial={{
              ...tenant,
              displayName: tenant.display_name,
              email: tenant.email ?? undefined,
              envOverrideKeys: Object.keys(tenant.env_overrides || {}),
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
