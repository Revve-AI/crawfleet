import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { sseResponse, type SSESend } from "@/lib/sse";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const provider = await getProvider(tenant);

    await provider.start(tenant, (s) => send("status", { step: s }));
    await supabaseAdmin
      .from("tenants")
      .update({ container_status: "running" })
      .eq("slug", slug);

    // For Docker: persist container_id if it was created during start
    if (tenant.provider === "docker" && tenant.container_id) {
      await supabaseAdmin
        .from("tenants")
        .update({ container_id: tenant.container_id })
        .eq("slug", slug);
    }

    send("status", { step: "Waiting for health check" });
    const healthy = await provider.waitForHealthy(tenant, 120_000, (s) => send("status", { step: s }));

    if (!healthy) {
      throw new Error("Started but failed health check");
    }

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.started",
    });

    send("done", { containerId: tenant.container_id });
  });
}
