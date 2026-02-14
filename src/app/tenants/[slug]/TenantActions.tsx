"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TenantActions({ slug, status }: { slug: string; status: string }) {
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
    <div className="flex gap-2">
      {status === "running" ? (
        <button
          onClick={() => action("stop")}
          disabled={!!loading}
          className="px-3 py-1.5 text-sm bg-amber-600/20 text-amber-400 border border-amber-600/30 rounded-lg hover:bg-amber-600/30 transition-colors disabled:opacity-50"
        >
          {loading === "stop" ? "..." : "Stop"}
        </button>
      ) : (
        <button
          onClick={() => action("start")}
          disabled={!!loading}
          className="px-3 py-1.5 text-sm bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-lg hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
        >
          {loading === "start" ? "..." : "Start"}
        </button>
      )}
      <button
        onClick={() => action("restart")}
        disabled={!!loading}
        className="px-3 py-1.5 text-sm bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded-lg hover:bg-blue-600/30 transition-colors disabled:opacity-50"
      >
        {loading === "restart" ? "..." : "Restart"}
      </button>
      <a
        href={`/tenants/${slug}/logs`}
        className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors"
      >
        Logs
      </a>
      <button
        onClick={handleDelete}
        disabled={!!loading}
        className="px-3 py-1.5 text-sm bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg hover:bg-red-600/30 transition-colors disabled:opacity-50"
      >
        {loading === "delete" ? "..." : "Delete"}
      </button>
    </div>
  );
}
