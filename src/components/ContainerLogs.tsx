"use client";

import { useEffect, useRef, useState } from "react";

export default function ContainerLogs({ slug }: { slug: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/tenants/${slug}/logs?tail=200`);

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const text = JSON.parse(event.data);
        setLines((prev) => [...prev.slice(-500), text]);
      } catch {
        setLines((prev) => [...prev.slice(-500), event.data]);
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => es.close();
  }, [slug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="bg-zinc-950 border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800/60">
        <span className="text-xs font-medium text-zinc-400">Container Logs</span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-emerald-400" : "text-zinc-500"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
          {connected ? "streaming" : "disconnected"}
        </span>
      </div>
      <div className="p-4 h-96 overflow-y-auto font-mono text-xs text-zinc-300 leading-relaxed">
        {lines.length === 0 && <p className="text-zinc-600">Waiting for logs...</p>}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all hover:bg-zinc-900/50">{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
