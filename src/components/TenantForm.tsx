"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProviderToggles from "./ProviderToggles";
import EnvOverridesEditor from "./EnvOverridesEditor";

interface Props {
  initial?: {
    slug?: string;
    displayName?: string;
    email?: string;
    defaultModel?: string;
    execSecurity?: string;
    browserEnabled?: boolean;
    allowAnthropic?: boolean;
    allowOpenAI?: boolean;
    allowGemini?: boolean;
    allowBrave?: boolean;
    allowElevenLabs?: boolean;
    envOverrideKeys?: string[];
  };
  mode: "create" | "edit";
}

export default function TenantForm({ initial, mode }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ slug: string; gatewayToken: string; url: string } | null>(null);

  const [slug, setSlug] = useState(initial?.slug || "");
  const [displayName, setDisplayName] = useState(initial?.displayName || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel || "anthropic/claude-sonnet-4-5");
  const [execSecurity, setExecSecurity] = useState(initial?.execSecurity || "deny");
  const [browserEnabled, setBrowserEnabled] = useState(initial?.browserEnabled || false);
  const [providers, setProviders] = useState({
    allowAnthropic: initial?.allowAnthropic ?? true,
    allowOpenAI: initial?.allowOpenAI ?? false,
    allowGemini: initial?.allowGemini ?? false,
    allowBrave: initial?.allowBrave ?? false,
    allowElevenLabs: initial?.allowElevenLabs ?? false,
  });
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Only include envOverrides if there are entries
    const hasOverrides = Object.keys(envOverrides).length > 0;

    const body = {
      ...(mode === "create" ? { slug, email } : {}),
      displayName,
      defaultModel,
      execSecurity,
      browserEnabled,
      ...providers,
      ...(hasOverrides ? { envOverrides } : {}),
    };

    try {
      const url = mode === "create" ? "/api/tenants" : `/api/tenants/${slug}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      if (mode === "create" && data.data) {
        const tenant = data.data;
        const scheme = window.location.protocol.replace(":", "");
        const baseDomain = window.location.hostname.replace(/^[^.]+\./, "");
        const url = `${scheme}://${tenant.slug}.${baseDomain}`;
        setCreated({ slug: tenant.slug, gatewayToken: tenant.gatewayToken, url });
        return;
      }

      router.push("/tenants");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    const openUrl = `${created.url}/?token=${created.gatewayToken}`;
    return (
      <div className="space-y-6 max-w-lg">
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6 space-y-4">
          <p className="text-green-400 font-medium text-lg">Tenant created successfully</p>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">Instance URL: </span>
              <span className="text-gray-100 font-mono">{created.url}</span>
            </div>
            <div>
              <span className="text-gray-400">Gateway Token: </span>
              <span className="text-gray-100 font-mono text-xs break-all">{created.gatewayToken}</span>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Open Instance
            </a>
            <a
              href={`/tenants/${created.slug}`}
              className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-lg transition-colors text-sm"
            >
              View Details
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {mode === "create" && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Slug (subdomain)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="alice"
            required
            pattern="^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">3-20 chars, lowercase + hyphens. Will become {slug || "___"}.domain.com</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alice Smith"
          required
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Email{mode === "create" ? "" : " (read-only)"}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alice@company.com"
          required={mode === "create"}
          readOnly={mode === "edit"}
          className={`w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500${mode === "edit" ? " opacity-60 cursor-not-allowed" : ""}`}
        />
        {mode === "edit" && (
          <p className="text-xs text-gray-500 mt-1">Email cannot be changed after creation</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Default Model</label>
        <select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
        >
          <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</option>
          <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5</option>
          <option value="openai:gpt-4o">GPT-4o</option>
          <option value="openai:gpt-4o-mini">GPT-4o Mini</option>
          <option value="google:gemini-2.0-flash">Gemini 2.0 Flash</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Shell/Exec Security</label>
        <select
          value={execSecurity}
          onChange={(e) => setExecSecurity(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
        >
          <option value="deny">Deny (no shell access)</option>
          <option value="allowlist">Allowlist (restricted)</option>
          <option value="full">Full (unrestricted)</option>
        </select>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={browserEnabled}
          onChange={(e) => setBrowserEnabled(e.target.checked)}
          className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
        />
        <span className="text-sm text-gray-200">Enable Browser Access</span>
      </label>

      <ProviderToggles
        values={providers}
        onChange={(key, val) => setProviders((prev) => ({ ...prev, [key]: val }))}
      />

      <EnvOverridesEditor
        existingKeys={initial?.envOverrideKeys ?? []}
        overrides={envOverrides}
        onChange={setEnvOverrides}
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-medium rounded-lg transition-colors"
      >
        {loading ? "Working..." : mode === "create" ? "Create Tenant" : "Save Changes"}
      </button>
    </form>
  );
}
