"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";

interface Tenant {
  slug: string;
  displayName: string;
  email?: string | null;
  containerStatus: string;
  lastHealthStatus: string | null;
}

const accentMap: Record<string, string> = {
  running: "group-hover:border-l-emerald-500",
  stopped: "group-hover:border-l-zinc-600",
  error: "group-hover:border-l-red-500",
};

export default function TenantCard({ tenant }: { tenant: Tenant }) {
  const accent = accentMap[tenant.containerStatus] || accentMap.stopped;

  return (
    <Link
      href={`/tenants/${tenant.slug}`}
      className={`group block bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 hover:border-zinc-700/80 hover:bg-zinc-900 transition-all border-l-[3px] border-l-transparent ${accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-100 truncate">{tenant.displayName}</h3>
          <p className="text-sm text-zinc-500 mt-0.5 truncate">
            <span className="font-mono text-xs">{tenant.slug}</span>
            {tenant.email && <span className="text-zinc-600"> &middot; {tenant.email}</span>}
          </p>
        </div>
        <StatusBadge status={tenant.containerStatus} />
      </div>
    </Link>
  );
}
