"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";

interface Tenant {
  slug: string;
  displayName: string;
  containerStatus: string;
  lastHealthStatus: string | null;
  defaultModel: string;
  allowAnthropic: boolean;
  allowOpenAI: boolean;
  allowGemini: boolean;
}

export default function TenantCard({ tenant }: { tenant: Tenant }) {
  const providers = [
    tenant.allowAnthropic && "Anthropic",
    tenant.allowOpenAI && "OpenAI",
    tenant.allowGemini && "Gemini",
  ].filter(Boolean);

  return (
    <Link
      href={`/tenants/${tenant.slug}`}
      className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-lg">{tenant.displayName}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{tenant.slug}</p>
        </div>
        <StatusBadge status={tenant.containerStatus} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {providers.map((p) => (
          <span key={p as string} className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-400">
            {p}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-600 font-mono truncate">{tenant.defaultModel}</p>
    </Link>
  );
}
