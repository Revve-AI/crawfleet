"use client";

const colors: Record<string, string> = {
  running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  stopped: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  unhealthy: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  unknown: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] || colors.unknown;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${status === "running" || status === "healthy" ? "bg-emerald-400" : status === "error" || status === "unhealthy" ? "bg-red-400" : "bg-gray-400"}`} />
      {status}
    </span>
  );
}
