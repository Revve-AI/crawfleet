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
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <span className="text-sm font-medium text-gray-400">Container Logs</span>
        <span className={`text-xs ${connected ? "text-emerald-400" : "text-gray-500"}`}>
          {connected ? "streaming" : "disconnected"}
        </span>
      </div>
      <div className="p-4 h-96 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed">
        {lines.length === 0 && <p className="text-gray-600">Waiting for logs...</p>}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
