"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TenantActions({ slug, status, isAdmin }: { slug: string; status: string; isAdmin: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState("");

  async function action(act: string) {
    setLoading(act);
    try {
      await fetch(`/api/tenants/${slug}/${act}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete tenant "${slug}"? This removes the container and all data.`)) return;
    setLoading("delete");
    await fetch(`/api/tenants/${slug}`, { method: "DELETE" });
    router.push("/tenants");
    router.refresh();
  }

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
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
            onClick={() => action("start")}
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
    </div>
  );
}
