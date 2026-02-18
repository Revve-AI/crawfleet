import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin, requireFleetAdmin } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createTenantContainer, startContainer } from "@/lib/docker";
import { createTenantAccessApp, deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { getProvider } from "@/lib/providers";
import { TenantCreateInput } from "@/types";
import { apiError } from "@/lib/api-error";
import { sseResponse, type SSESend } from "@/lib/sse";
import type { TenantWithVps } from "@/lib/supabase/types";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

function validateCreate(body: TenantCreateInput): string | null {
  if (!body.email) return "Email is required";
  if (!SLUG_RE.test(body.slug)) return "Slug must be 3-20 chars, lowercase alphanumeric and hyphens";
  if (body.provider === "vps") {
    if (!body.cloud) return "Cloud provider is required";
    if (!body.region) return "Region is required";
    if (!body.machineType) return "Machine type is required";
  }
  return null;
}

export async function GET() {
  try {
    const email = await getAuthEmail();
    const admin = isFleetAdmin(email);

    let query = supabaseAdmin
      .from("tenants")
      .select("*, vps_instances(*)")
      .order("created_at", { ascending: false });

    if (!admin) {
      query = query.eq("email", email);
    }

    const { data: tenants, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: tenants });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  const body: TenantCreateInput = await req.json();

  // VPS tenants use SSE for long-running provisioning
  if (body.provider === "vps") {
    return sseResponse(async (send: SSESend) => {
      await requireFleetAdmin();

      const validationError = validateCreate(body);
      if (validationError) throw new Error(validationError);

      const { data: existing } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", body.slug)
        .single();
      if (existing) throw new Error("Slug already in use");

      send("status", { step: "Creating Cloudflare Access app" });
      const accessAppId = await createTenantAccessApp(body.slug, body.email);

      // Create tenant
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({
          slug: body.slug,
          display_name: body.displayName,
          email: body.email,
          env_overrides: body.envOverrides || null,
          gateway_token: generateToken(),
          access_app_id: accessAppId,
          provider: "vps",
        })
        .select()
        .single();
      if (tenantError || !tenant) throw tenantError || new Error("Failed to create tenant");

      // Create VPS instance
      const { data: vpsInstance, error: vpsError } = await supabaseAdmin
        .from("vps_instances")
        .insert({
          tenant_id: tenant.id,
          cloud: body.cloud!,
          region: body.region!,
          machine_type: body.machineType!,
          instance_id: "",
          git_tag: body.gitTag || null,
        })
        .select()
        .single();
      if (vpsError || !vpsInstance) throw vpsError || new Error("Failed to create VPS instance");

      const tenantWithVps: TenantWithVps = { ...tenant, vps_instances: vpsInstance };

      try {
        const provider = await getProvider(tenantWithVps);
        const instanceId = await provider.create(tenantWithVps, (step) => {
          send("status", { step });
        });

        await supabaseAdmin
          .from("tenants")
          .update({ container_status: "running" })
          .eq("slug", body.slug);

        await supabaseAdmin.from("audit_logs").insert({
          tenant_id: tenant.id,
          action: "tenant.created",
          details: {
            slug: body.slug,
            provider: "vps",
            cloud: body.cloud,
            region: body.region,
            instanceId,
          },
        });

        send("done", { slug: tenant.slug });
      } catch (err) {
        // Rollback: delete tenant record (cascade deletes VpsInstance)
        if (accessAppId) {
          await deleteTenantAccessApp(accessAppId).catch(() => {});
        }
        await supabaseAdmin.from("audit_logs").delete().eq("tenant_id", tenant.id);
        await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
        throw err;
      }
    });
  }

  // Docker tenants — original synchronous flow
  try {
    await requireFleetAdmin();

    const validationError = validateCreate(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", body.slug)
      .single();
    if (existing) {
      return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
    }

    const accessAppId = await createTenantAccessApp(body.slug, body.email);

    const { data: tenant, error: insertError } = await supabaseAdmin
      .from("tenants")
      .insert({
        slug: body.slug,
        display_name: body.displayName,
        email: body.email,
        env_overrides: body.envOverrides || null,
        gateway_token: generateToken(),
        access_app_id: accessAppId,
        provider: "docker",
      })
      .select()
      .single();
    if (insertError || !tenant) throw insertError || new Error("Failed to create tenant");

    let containerId: string;
    try {
      containerId = await createTenantContainer(tenant);
      await startContainer(containerId);
    } catch (dockerErr) {
      if (accessAppId) {
        await deleteTenantAccessApp(accessAppId).catch(() => {});
      }
      await supabaseAdmin.from("audit_logs").delete().eq("tenant_id", tenant.id);
      await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
      throw dockerErr;
    }

    const { data: updated } = await supabaseAdmin
      .from("tenants")
      .update({ container_id: containerId, container_status: "running" })
      .eq("id", tenant.id)
      .select()
      .single();

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.created",
      details: { slug: body.slug },
    });

    return NextResponse.json({ success: true, data: updated }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
