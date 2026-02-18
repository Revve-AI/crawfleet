import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const provider = await getProvider(tenant);
    await provider.restart(tenant);
    await supabaseAdmin
      .from("tenants")
      .update({ container_status: "running" })
      .eq("slug", slug);

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.restarted",
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
