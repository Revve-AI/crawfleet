import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireFleetAdmin } from "@/lib/auth";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { PartialProvisioningError } from "@/lib/providers/types";
import { sseResponse, type SSESend } from "@/lib/sse";

export const maxDuration = 300;

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    await requireFleetAdmin();
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    if (tenant.status !== "provisioning_failed") {
      throw new Error("Tenant is not in provisioning_failed state");
    }

    const provider = await getProvider();

    try {
      await provider.resume(tenant, (s) => send("status", { step: s }));
    } catch (err) {
      if (err instanceof PartialProvisioningError) {
        // Still partially failed — update stage info but don't throw (send event instead)
        send("partial_failure", {
          slug,
          completedStage: err.completedStage,
          failedStep: err.failedStep,
          error: err.cause.message,
        });
        return;
      }
      throw err;
    }

    await supabaseAdmin
      .from("tenants")
      .update({ status: "running" })
      .eq("slug", slug);

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.provisioning_resumed",
      details: { slug },
    });

    send("done", { slug });
  });
}
