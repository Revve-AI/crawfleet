import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireTenantAccess } from "@/lib/tenant-access";
import { getProvider } from "@/lib/providers";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const provider = await getProvider();
    const status = await provider.getStatus(tenant);
    const health = status === "running" ? await provider.getHealth(tenant) : "unknown";

    await supabaseAdmin
      .from("tenants")
      .update({
        status,
        last_health_check: new Date().toISOString(),
        last_health_status: health,
      })
      .eq("slug", slug);

    return NextResponse.json({ success: true, data: { status, health } });
  } catch (e) {
    return apiError(e);
  }
}
