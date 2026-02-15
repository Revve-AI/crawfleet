"use client";

const styles: Record<string, { bg: string; text: string; dot: string }> = {
  running: { bg: "bg-emerald-500/15 border-emerald-500/25", text: "text-emerald-400", dot: "bg-emerald-400" },
  stopped: { bg: "bg-zinc-500/15 border-zinc-500/25", text: "text-zinc-400", dot: "bg-zinc-500" },
  error: { bg: "bg-red-500/15 border-red-500/25", text: "text-red-400", dot: "bg-red-400" },
  healthy: { bg: "bg-emerald-500/15 border-emerald-500/25", text: "text-emerald-400", dot: "bg-emerald-400" },
  unhealthy: { bg: "bg-amber-500/15 border-amber-500/25", text: "text-amber-400", dot: "bg-amber-400" },
  unknown: { bg: "bg-zinc-500/15 border-zinc-500/25", text: "text-zinc-500", dot: "bg-zinc-500" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = styles[status] || styles.unknown;
  const pulse = status === "running" || status === "healthy";

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.bg} ${s.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className={`absolute inset-0 rounded-full ${s.dot} animate-ping opacity-40`} />}
        <span className={`relative rounded-full h-1.5 w-1.5 ${s.dot}`} />
      </span>
      {status}
    </span>
  );
}
