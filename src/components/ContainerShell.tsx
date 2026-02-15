"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 2000;

export default function ContainerShell({ slug }: { slug: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(async (isRetry = false) => {
    if (!termRef.current || !mountedRef.current) return;

    // Lazy-init terminal once
    if (!terminalRef.current) {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
        theme: {
          background: "#09090b",
          foreground: "#d4d4d8",
          cursor: "#E8600A",
          cursorAccent: "#09090b",
          selectionBackground: "#27272a",
          black: "#09090b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#d4d4d8",
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current!);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data }));
        }
      });
    }

    const terminal = terminalRef.current!;
    const fitAddon = fitAddonRef.current!;

    // Clear terminal on retry to avoid confusion
    if (isRetry) {
      terminal.clear();
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/tenants/${slug}/shell`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setReconnecting(false);
      setFailed(false);
      reconnectAttemptsRef.current = 0;
      fitAddon.fit();
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
        } else if (msg.type === "exit") {
          terminal.write("\r\n\x1b[90m[shell exited]\x1b[0m\r\n");
          setConnected(false);
        } else if (msg.type === "error") {
          terminal.write(
            `\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`
          );
          setConnected(false);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);

      // Check if we've exceeded max reconnection attempts
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setReconnecting(false);
        setFailed(true);
        terminal.write(
          `\r\n\x1b[31m[connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts]\x1b[0m\r\n`
        );
        return;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
      reconnectAttemptsRef.current++;

      setReconnecting(true);
      terminal.write(
        `\r\n\x1b[90m[disconnected — reconnecting in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...]\x1b[0m\r\n`
      );

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect(true);
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, which handles reconnect
    };
  }, [slug]);

  const manualReconnect = useCallback(() => {
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Reset state
    reconnectAttemptsRef.current = 0;
    setFailed(false);
    setReconnecting(false);
    setConnected(false);
    // Clear and reconnect
    if (terminalRef.current) {
      terminalRef.current.clear();
    }
    connect(false);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const resizeHandler = () => {
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      const ws = wsRef.current;
      if (fitAddon && terminal) {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
      }
    };
    window.addEventListener("resize", resizeHandler);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("resize", resizeHandler);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      if (terminalRef.current) terminalRef.current.dispose();
    };
  }, [connect]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-1.5 shrink-0">
        <span
          className={`inline-flex items-center gap-1.5 text-xs ${
            connected
              ? "text-emerald-400"
              : reconnecting
                ? "text-amber-400"
                : failed
                  ? "text-red-400"
                  : "text-zinc-500"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected
                ? "bg-emerald-400"
                : reconnecting
                  ? "bg-amber-400 animate-pulse"
                  : failed
                    ? "bg-red-400"
                    : "bg-zinc-600"
            }`}
          />
          {connected
            ? "connected"
            : reconnecting
              ? `reconnecting (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
              : failed
                ? "connection failed"
                : "disconnected"}
        </span>
        {(failed || !connected) && !reconnecting && (
          <button
            onClick={manualReconnect}
            className="px-2.5 py-1 text-xs bg-brand/80 text-white border border-brand rounded hover:bg-brand transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>
      <div ref={termRef} className="flex-1 min-h-0 px-2 pb-2" />
    </div>
  );
}
