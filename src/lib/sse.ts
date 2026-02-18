export type SSESend = (event: string, data: Record<string, unknown>) => void;
export type SSEEvent = { event: string; data: Record<string, unknown> };

/** Client-side SSE reader: parses an SSE response stream, calling onEvent for each parsed event. */
export async function readSSE(
  res: Response,
  onEvent: (e: SSEEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error("No response stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const eventMatch = part.match(/^event: (\w+)/m);
      const dataMatch = part.match(/^data: (.+)/m);
      if (!eventMatch || !dataMatch) continue;
      onEvent({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
    }
  }
}

/**
 * Wraps an async handler in an SSE response. The handler receives a `send`
 * function to emit events. Errors are sent as `error` events automatically.
 */
export function sseResponse(
  handler: (send: SSESend) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send: SSESend = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      try {
        await handler(send);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        send("error", { error: message });
      } finally {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
