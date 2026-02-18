import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireFleetAdmin } from "@/lib/auth";
import { requireTenantAccess } from "@/lib/tenant-access";
import { deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { getProvider } from "@/lib/providers";
import { TenantUpdateInput } from "@/types";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

function overrideKeyNames(overrides: Record<string, string> | null): string[] {
  if (!overrides) return [];
  return Object.keys(overrides);
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);

    const { env_overrides, ...rest } = tenant;
    return NextResponse.json({
      success: true,
      data: { ...rest, envOverrideKeys: overrideKeyNames(env_overrides) },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireFleetAdmin();
    const { slug } = await params;
    const { email: _email, envOverrides: incomingOverrides, ...body }: TenantUpdateInput & { email?: string } = await req.json();

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .eq("slug", slug)
      .single();
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let envChanged = false;
    const dbData: Record<string, unknown> = {};
    if (body.displayName !== undefined) dbData.display_name = body.displayName;
    if (body.enabled !== undefined) dbData.enabled = body.enabled;

    if (incomingOverrides) {
      const existing: Record<string, string> = tenant.env_overrides || {};
      for (const [k, v] of Object.entries(incomingOverrides)) {
        if (!v || v.trim() === "") {
          if (k in existing) { delete existing[k]; envChanged = true; }
        } else {
          existing[k] = v.trim();
          envChanged = true;
        }
      }
      dbData.env_overrides = Object.keys(existing).length > 0 ? existing : null;
    }

    const { data: updated } = await supabaseAdmin
      .from("tenants")
      .update(dbData)
      .eq("slug", slug)
      .select()
      .single();

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: envChanged ? "tenant.env_changed" : "config.updated",
      details: { ...body, ...(incomingOverrides ? { envOverrides: Object.keys(incomingOverrides) } : {}) },
    });

    const { env_overrides: rawOverrides, ...safeData } = updated!;
    return NextResponse.json({
      success: true,
      data: { ...safeData, envOverrideKeys: overrideKeyNames(rawOverrides) },
      envChanged,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireFleetAdmin();
    const { slug } = await params;
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("*, vps_instances(*)")
      .eq("slug", slug)
      .single();
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const provider = await getProvider();

    await provider.removeTenantData(tenant);
    await provider.remove(tenant);

    // Delete Cloudflare Access app
    if (tenant.access_app_id) {
      try {
        await deleteTenantAccessApp(tenant.access_app_id);
      } catch (cfErr) {
        console.error("Failed to delete Cloudflare Access app:", cfErr);
      }
    }

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: null,
      action: "tenant.deleted",
      details: { slug },
    });

    await supabaseAdmin.from("tenants").delete().eq("slug", slug);

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
