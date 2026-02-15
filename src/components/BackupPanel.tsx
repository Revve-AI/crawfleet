"use client";

import { useState } from "react";

export default function BackupPanel({ bucket }: { bucket: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function triggerBackup() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error || "Backup failed" });
      } else {
        setResult({ ok: true, message: "Backup started — check logs for progress" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-200 font-mono">{bucket}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Backups run automatically on a timer. Use the button to trigger one now.</p>
        </div>
        <button
          onClick={triggerBackup}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-light disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {running ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Backup Now
            </>
          )}
        </button>
      </div>

      {result && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            result.ok
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border border-red-500/20 text-red-400"
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
