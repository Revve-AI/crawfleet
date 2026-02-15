import { NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getContainerLogs } from "@/lib/docker";

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    if (!tenant.containerId) {
      return new Response("No container", { status: 404 });
    }

    const tail = parseInt(req.nextUrl.searchParams.get("tail") || "100", 10);
    const stream = await getContainerLogs(tenant.containerId, tail);

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => {
          // Docker multiplexed stream: skip first 8 header bytes per frame
          const text = chunk.length > 8 ? chunk.subarray(8).toString("utf-8") : chunk.toString("utf-8");
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
