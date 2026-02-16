export type SSESend = (event: string, data: Record<string, unknown>) => void;

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
      const send: SSESend = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await handler(send);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        send("error", { error: message });
      } finally {
        controller.close();
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
