"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import EnvOverridesEditor from "./EnvOverridesEditor";

interface Props {
  initial?: {
    slug?: string;
    displayName?: string;
    email?: string;
    envOverrideKeys?: string[];
  };
  mode: "create" | "edit";
}

type ProvisionState =
  | { phase: "form" }
  | { phase: "provisioning"; slug: string }
  | { phase: "ready"; slug: string };

export default function TenantForm({ initial, mode }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [provision, setProvision] = useState<ProvisionState>({ phase: "form" });
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [slug, setSlug] = useState(initial?.slug || "");
  const [displayName, setDisplayName] = useState(initial?.displayName || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(tenantSlug: string) {
    setProvision({ phase: "provisioning", slug: tenantSlug });

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantSlug}/health`);
        const data = await res.json();
        if (data.data?.status === "running") {
          clearInterval(pollRef.current!);
          setProvision({ phase: "ready", slug: tenantSlug });
        }
      } catch {
        // keep polling
      }
    }, 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const hasOverrides = Object.keys(envOverrides).length > 0;

    const body = {
      ...(mode === "create" ? { slug, email } : {}),
      displayName,
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
        startPolling(data.data.slug);
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

  if (provision.phase === "provisioning") {
    return (
      <div className="max-w-lg">
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-8 flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-zinc-200 font-medium">Provisioning instance</p>
            <p className="text-sm text-zinc-500 mt-1">This usually takes 10-20 seconds</p>
          </div>
        </div>
      </div>
    );
  }

  if (provision.phase === "ready") {
    return (
      <div className="space-y-6 max-w-lg">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-emerald-400 font-semibold">Instance is ready</p>
          </div>
          <p className="text-sm text-zinc-300">
            Open the shell to continue setup with OpenClaw onboard.
          </p>
          <div className="flex gap-3 pt-1">
            <a
              href={`/tenants/${provision.slug}/shell`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-brand hover:bg-brand-light text-white font-medium rounded-lg transition-colors text-sm"
            >
              Open Shell
            </a>
            <a
              href={`/tenants/${provision.slug}`}
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors text-sm border border-zinc-700/60"
            >
              View Details
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {mode === "create" && (
        <>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Slug (subdomain)</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="alice"
              required
              pattern="^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
            />
            <p className="text-xs text-zinc-500 mt-1.5">3-20 chars, lowercase + hyphens. Will become <span className="font-mono text-zinc-400">{slug || "___"}.domain.com</span></p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@company.com"
              required
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alice Smith"
          required
          className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors"
        />
      </div>

      <EnvOverridesEditor
        existingKeys={initial?.envOverrideKeys ?? []}
        overrides={envOverrides}
        onChange={setEnvOverrides}
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-brand hover:bg-brand-light disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
      >
        {loading ? "Working..." : mode === "create" ? "Create Tenant" : "Save Changes"}
      </button>
    </form>
  );
}
