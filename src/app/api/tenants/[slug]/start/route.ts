import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { sseResponse, type SSESend } from "@/lib/sse";

export const maxDuration = 300;

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const provider = await getProvider();

    await provider.start(tenant, (s) => send("status", { step: s }));
    await supabaseAdmin
      .from("tenants")
      .update({ status: "running" })
      .eq("slug", slug);

    send("status", { step: "Waiting for health check" });
    const healthy = await provider.waitForHealthy(tenant, 120_000, (s) => send("status", { step: s }));

    if (!healthy) {
      throw new Error("Started but failed health check");
    }

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.started",
    });

    send("done", { slug });
  });
}
