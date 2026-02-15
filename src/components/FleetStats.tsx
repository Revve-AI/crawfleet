"use client";

import { FleetStats as Stats } from "@/types";

const cards: { key: keyof Stats; label: string; accent: string; valueColor: string }[] = [
  { key: "total", label: "Total Instances", accent: "border-l-brand", valueColor: "text-zinc-100" },
  { key: "running", label: "Running", accent: "border-l-emerald-500", valueColor: "text-emerald-400" },
  { key: "stopped", label: "Stopped", accent: "border-l-zinc-600", valueColor: "text-zinc-400" },
  { key: "healthy", label: "Healthy", accent: "border-l-emerald-500", valueColor: "text-emerald-400" },
  { key: "unhealthy", label: "Unhealthy", accent: "border-l-amber-500", valueColor: "text-amber-400" },
];

export default function FleetStats({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`bg-zinc-900/80 border border-zinc-800/60 ${c.accent} border-l-[3px] rounded-xl p-4`}
        >
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">{c.label}</p>
          <p className={`text-2xl font-semibold mt-1.5 tabular-nums ${c.valueColor}`}>{stats[c.key]}</p>
        </div>
      ))}
    </div>
  );
}
