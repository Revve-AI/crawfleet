"use client";

import { FleetStats as Stats } from "@/types";

export default function FleetStats({ stats }: { stats: Stats }) {
  const cards = [
    { label: "Total", value: stats.total, color: "text-blue-400" },
    { label: "Running", value: stats.running, color: "text-emerald-400" },
    { label: "Stopped", value: stats.stopped, color: "text-gray-400" },
    { label: "Healthy", value: stats.healthy, color: "text-emerald-400" },
    { label: "Unhealthy", value: stats.unhealthy, color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">{c.label}</p>
          <p className={`text-2xl font-semibold mt-1 ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
