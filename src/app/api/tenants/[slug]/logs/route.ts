import { NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const tail = parseInt(req.nextUrl.searchParams.get("tail") || "100", 10);
    const provider = await getProvider(tenant);
    const stream = await provider.getLogs(tenant, tail);

    const isDocker = tenant.provider === "docker";
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => {
          // Docker multiplexed stream: skip first 8 header bytes per frame
          // VPS (journalctl): plain text, no header
          const text = isDocker && chunk.length > 8
            ? chunk.subarray(8).toString("utf-8")
            : chunk.toString("utf-8");
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`));
        });
        stream.on("end", () => controller.close());
        stream.on("error", () => controller.close());
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return new Response(msg, { status });
  }
}
