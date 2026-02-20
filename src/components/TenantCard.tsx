"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { CLOUD_SHORT_NAMES } from "@/lib/constants";

interface Tenant {
  slug: string;
  display_name: string;
  email?: string | null;
  status: string;
  last_health_status: string | null;
  vps_instances?: { cloud: string } | null;
}

const accentMap: Record<string, string> = {
  running: "group-hover:border-l-emerald-500",
  stopped: "group-hover:border-l-zinc-600",
  error: "group-hover:border-l-red-500",
  provisioning_failed: "group-hover:border-l-amber-500",
};

export default function TenantCard({ tenant }: { tenant: Tenant }) {
  const accent = accentMap[tenant.status] || accentMap.stopped;

  return (
    <Link
      href={`/tenants/${tenant.slug}`}
      className={`group block bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 hover:border-zinc-700/80 hover:bg-zinc-900 transition-all border-l-[3px] border-l-transparent ${accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-100 truncate">{tenant.display_name}</h3>
            <span className="inline-flex items-center px-1.5 py-0.5 bg-violet-500/10 text-violet-400 text-[10px] font-medium rounded border border-violet-500/20 shrink-0">
              {(tenant.vps_instances?.cloud && CLOUD_SHORT_NAMES[tenant.vps_instances.cloud]) || "VPS"}
            </span>
          </div>
          <p className="text-sm text-zinc-500 mt-0.5 truncate">
            <span className="font-mono text-xs">{tenant.slug}</span>
            {tenant.email && <span className="text-zinc-600"> &middot; {tenant.email}</span>}
          </p>
        </div>
        <StatusBadge status={tenant.status} />
      </div>
    </Link>
  );
}
