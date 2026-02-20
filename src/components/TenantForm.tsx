"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import EnvOverridesEditor from "./EnvOverridesEditor";
import { readSSE } from "@/lib/sse";

interface CloudInfo {
  id: string;
  name: string;
  regions: Array<{ id: string; description: string }>;
  machineTypes: Array<{ id: string; description: string }>;
}

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
  | { phase: "provisioning"; slug: string; steps: string[] }
  | { phase: "ready"; slug: string };

export default function TenantForm({ initial, mode }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [envWarning, setEnvWarning] = useState(false);
  const [provision, setProvision] = useState<ProvisionState>({ phase: "form" });
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [slug, setSlug] = useState(initial?.slug || "");
  const [displayName, setDisplayName] = useState(initial?.displayName || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({});

  // VPS fields
  const [clouds, setClouds] = useState<CloudInfo[]>([]);
  const [cloud, setCloud] = useState("");
  const [region, setRegion] = useState("");
  const [machineType, setMachineType] = useState("");
  const [gitTag, setGitTag] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [cloudsLoaded, setCloudsLoaded] = useState(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Load cloud metadata eagerly on create
  useEffect(() => {
    if (mode !== "create" || cloudsLoaded) return;
    fetch("/api/clouds")
      .then((r) => r.json())
      .then((data) => {
        if (data.data?.length) {
          setClouds(data.data);
          const first = data.data[0];
          setCloud(first.id);
          if (first.regions.length) setRegion(first.regions[0].id);
          if (first.machineTypes.length) setMachineType(first.machineTypes[0].id);
        }
        setCloudsLoaded(true);
      })
      .catch(() => setCloudsLoaded(true));
  }, [mode, cloudsLoaded]);

  const selectedCloud = clouds.find((c) => c.id === cloud);

  async function handleCreate() {
    setLoading(true);
    setError("");
    setProvision({ phase: "provisioning", slug, steps: [] });

    try {
      const body = {
        slug,
        displayName,
        email,
        cloud,
        region,
        machineType,
        gitTag: gitTag || undefined,
        sshPublicKey: sshPublicKey.trim() || undefined,
        ...(Object.keys(envOverrides).length > 0 ? { envOverrides } : {}),
      };

      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let completed = false;
      let failed = false;
      await readSSE(res, ({ event, data }) => {
        if (event === "status") {
          setProvision((prev) =>
            prev.phase === "provisioning"
              ? { ...prev, steps: [...prev.steps, data.step as string] }
              : prev,
          );
        } else if (event === "error") {
          setError(data.error as string);
          setProvision({ phase: "form" });
          failed = true;
        } else if (event === "done") {
          completed = true;
          setProvision({ phase: "ready", slug: (data.slug as string) || slug });
        }
      });

      if (failed) return;
      // Stream ended cleanly without done/error — server may still be working
      if (!completed) {
        pollForCompletion(slug);
        return;
      }
    } catch {
      // SSE stream dropped (Cloudflare timeout, network issue) — poll to check
      pollForCompletion(slug);
      return;
    } finally {
      setLoading(false);
    }
  }

  function pollForCompletion(tenantSlug: string) {
    setLoading(false);
    setProvision((prev) =>
      prev.phase === "provisioning"
        ? { ...prev, steps: [...prev.steps, "Connection lost — checking status..."] }
        : prev,
    );

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantSlug}`);
        if (!res.ok) return; // tenant may not exist yet (still creating)
        const data = await res.json();
        const tenant = data.data;
        if (!tenant) return;

        if (tenant.status === "running") {
          clearInterval(pollRef.current!);
          setProvision({ phase: "ready", slug: tenantSlug });
        }
      } catch {
        // keep polling
      }
    }, 5000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSaved(false);
    setEnvWarning(false);

    if (mode === "create") {
      await handleCreate();
      return;
    }

    const hasOverrides = Object.keys(envOverrides).length > 0;

    const body = {
      displayName,
      ...(hasOverrides ? { envOverrides } : {}),
    };

    try {
      const res = await fetch(`/api/tenants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      setSaved(true);
      setEnvWarning(!!data.envChanged);
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
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <div>
              <p className="text-zinc-200 font-medium">Provisioning VPS</p>
              <p className="text-sm text-zinc-500 mt-0.5">This usually takes 2-5 minutes</p>
            </div>
          </div>
          {provision.steps.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
              {provision.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {i === provision.steps.length - 1 ? (
                    <span className="inline-block w-3 h-3 border-2 border-brand/40 border-t-brand rounded-full animate-spin" />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  <span className={i === provision.steps.length - 1 ? "text-brand-light" : "text-zinc-500"}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          )}
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
              href={`/tenants/${provision.slug}/ssh`}
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors text-sm border border-zinc-700/60"
            >
              SSH Setup
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

      {saved && !error && (
        <div className={`px-4 py-3 rounded-lg text-sm ${envWarning ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"}`}>
          {envWarning
            ? "Environment variables updated. Redeploy to apply changes."
            : "Changes saved."}
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

          {/* VPS Configuration */}
          <div className="space-y-4 p-4 bg-zinc-950/50 border border-zinc-800/40 rounded-lg">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">VPS Configuration</p>

            {clouds.length === 0 && cloudsLoaded && (
              <p className="text-sm text-amber-400">No cloud providers configured. Set GCP_PROJECT, HETZNER_API_TOKEN, or AWS_ACCESS_KEY_ID.</p>
            )}

            {clouds.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Cloud Provider</label>
                  <select
                    value={cloud}
                    onChange={(e) => {
                      setCloud(e.target.value);
                      const c = clouds.find((cl) => cl.id === e.target.value);
                      if (c?.regions.length) setRegion(c.regions[0].id);
                      if (c?.machineTypes.length) setMachineType(c.machineTypes[0].id);
                    }}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50"
                  >
                    {clouds.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Region</label>
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50"
                  >
                    {selectedCloud?.regions.map((r) => (
                      <option key={r.id} value={r.id}>{r.description} ({r.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Machine Type</label>
                  <select
                    value={machineType}
                    onChange={(e) => setMachineType(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50"
                  >
                    {selectedCloud?.machineTypes.map((m) => (
                      <option key={m.id} value={m.id}>{m.description}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Git Tag</label>
                  <input
                    type="text"
                    value={gitTag}
                    onChange={(e) => setGitTag(e.target.value)}
                    placeholder="latest"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors font-mono text-sm"
                  />
                  <p className="text-xs text-zinc-500 mt-1.5">OpenClaw version to deploy. Leave empty for latest.</p>
                </div>
              </>
            )}
          </div>

          {/* SSH Public Key */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">SSH Public Key <span className="text-zinc-500 font-normal">(optional)</span></label>
            <textarea
              value={sshPublicKey}
              onChange={(e) => setSshPublicKey(e.target.value)}
              placeholder="ssh-ed25519 AAAA... you@example.com"
              rows={3}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 transition-colors font-mono text-xs resize-none"
            />
            <p className="text-xs text-zinc-500 mt-1.5">Enables SSH access to the VM via cloudflared. You can also add this later from the SSH tab.</p>
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
        disabled={loading || (mode === "create" && clouds.length === 0)}
        className="w-full py-2.5 px-4 bg-brand hover:bg-brand-light disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
      >
        {loading ? "Working..." : mode === "create" ? "Create Tenant" : "Save Changes"}
      </button>
    </form>
  );
}
