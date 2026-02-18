"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readSSE } from "@/lib/sse";

export default function TenantActions({
  slug,
  status,
  isAdmin,
  currentImage,
  defaultImage,
  provider,
  currentGitTag,
}: {
  slug: string;
  status: string;
  isAdmin: boolean;
  currentImage: string | null;
  defaultImage: string;
  provider: string;
  currentGitTag?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [showDeploy, setShowDeploy] = useState(false);
  const [image, setImage] = useState(currentImage || "");
  const [gitTag, setGitTag] = useState(currentGitTag || "");

  async function streamAction(
    act: string,
    url: string,
    opts?: RequestInit,
  ): Promise<boolean> {
    setLoading(act);
    setActionStatus("Connecting...");
    let failed = false;
    let completed = false;
    try {
      const res = await fetch(url, { method: "POST", ...opts });
      await readSSE(res, ({ event, data }) => {
        if (event === "status") {
          setActionStatus(data.step as string);
        } else if (event === "error") {
          setActionStatus(`Failed: ${data.error}`);
          failed = true;
        } else if (event === "done") {
          completed = true;
          setActionStatus("Complete");
        }
      });
      if (failed) return false;
      if (!completed) {
        // Stream ended without done/error — server may still be working
        setActionStatus("Connection lost — operation may still be in progress. Refresh to check.");
        router.refresh();
        return true;
      }
      router.refresh();
      return true;
    } catch {
      // SSE stream dropped (Cloudflare timeout, network issue)
      setActionStatus("Connection lost — operation may still be in progress. Refresh to check.");
      router.refresh();
      return true;
    } finally {
      setLoading("");
    }
  }

  async function handleStart() {
    await streamAction("start", `/api/tenants/${slug}/start`);
  }

  async function handleDeploy() {
    const body: Record<string, unknown> = {};
    if (provider === "docker") {
      const trimmed = image.trim();
      if (trimmed && trimmed !== currentImage) {
        body.image = trimmed;
      }
    } else {
      const trimmed = gitTag.trim();
      if (trimmed) {
        body.gitTag = trimmed;
      }
    }
    const ok = await streamAction("deploy", `/api/tenants/${slug}/deploy`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (ok) setShowDeploy(false);
  }

  async function action(act: string) {
    setLoading(act);
    setActionStatus("");
    try {
      await fetch(`/api/tenants/${slug}/${act}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  async function handleDelete() {
    const msg = provider === "vps"
      ? `Delete tenant "${slug}"? This destroys the VM, tunnel, and all data.`
      : `Delete tenant "${slug}"? This removes the container and all data.`;
    if (!confirm(msg)) return;
    setLoading("delete");
    await fetch(`/api/tenants/${slug}`, { method: "DELETE" });
    router.push("/tenants");
    router.refresh();
  }

  const isStreaming = loading === "start" || loading === "deploy";

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mr-2">Controls</span>

        {status === "running" ? (
          <button
            onClick={() => action("stop")}
            disabled={!!loading}
            className="px-3.5 py-2 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors disabled:opacity-50 font-medium"
          >
            {loading === "stop" ? "Stopping..." : "Stop"}
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!!loading}
            className="px-3.5 py-2 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50 font-medium"
          >
            {loading === "start" ? "Starting..." : "Start"}
          </button>
        )}

        <button
          onClick={() => action("restart")}
          disabled={!!loading}
          className="px-3.5 py-2 text-sm bg-zinc-800 text-zinc-300 border border-zinc-700/60 rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50 font-medium"
        >
          {loading === "restart" ? "Restarting..." : "Restart"}
        </button>

        {isAdmin && (
          <button
            onClick={() => setShowDeploy(!showDeploy)}
            disabled={!!loading}
            className="px-3.5 py-2 text-sm bg-brand/10 text-brand-light border border-brand/20 rounded-lg hover:bg-brand/20 transition-colors disabled:opacity-50 font-medium"
          >
            Deploy
          </button>
        )}

        <div className="flex-1" />

        {isAdmin && (
          <button
            onClick={handleDelete}
            disabled={!!loading}
            className="px-3.5 py-2 text-sm text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-lg transition-all disabled:opacity-50"
          >
            {loading === "delete" ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>

      {isStreaming && actionStatus && (
        <div className="flex items-center gap-2 px-3 py-2 bg-brand/5 border border-brand/10 rounded-lg">
          <span className="inline-block w-3 h-3 border-2 border-brand/40 border-t-brand rounded-full animate-spin" />
          <span className="text-sm text-brand-light">{actionStatus}</span>
        </div>
      )}

      {!loading && actionStatus.startsWith("Failed") && (
        <div className="px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-lg text-sm text-red-400">
          {actionStatus}
        </div>
      )}

      {showDeploy && (
        <div className="border-t border-zinc-800/60 pt-3 space-y-3">
          {provider === "docker" ? (
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium block mb-1.5">
                Docker Image
              </label>
              <input
                type="text"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder={defaultImage}
                className="w-full px-3 py-2 text-sm font-mono bg-zinc-950 border border-zinc-700/60 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-brand/50"
              />
              <p className="text-[11px] text-zinc-600 mt-1">
                Leave empty to use default: {defaultImage}
              </p>
            </div>
          ) : (
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium block mb-1.5">
                Git Tag
              </label>
              <input
                type="text"
                value={gitTag}
                onChange={(e) => setGitTag(e.target.value)}
                placeholder="latest"
                className="w-full px-3 py-2 text-sm font-mono bg-zinc-950 border border-zinc-700/60 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-brand/50"
              />
              <p className="text-[11px] text-zinc-600 mt-1">
                OpenClaw version to deploy. Leave empty for latest.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDeploy}
              disabled={!!loading}
              className="px-4 py-2 text-sm bg-brand hover:bg-brand-light text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading === "deploy" ? "Deploying..." : "Deploy"}
            </button>
            <button
              onClick={() => { setShowDeploy(false); setActionStatus(""); }}
              disabled={!!loading}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
