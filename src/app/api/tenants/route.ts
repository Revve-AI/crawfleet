import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin, requireFleetAdmin } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createTenantAccessApp, deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { getProvider } from "@/lib/providers";
import { PartialProvisioningError } from "@/lib/providers/types";
import { connectSSHThroughTunnel, execSSH, escapeForBash } from "@/lib/providers/ssh";
import { generateAddUserSshKeyScript } from "@/lib/providers/vps-setup-script";
import { TenantCreateInput } from "@/types";
import { apiError } from "@/lib/api-error";
import { sseResponse, type SSESend } from "@/lib/sse";
import type { TenantWithVps } from "@/lib/supabase/types";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

function validateCreate(body: TenantCreateInput): string | null {
  if (!body.email) return "Email is required";
  if (!SLUG_RE.test(body.slug)) return "Slug must be 3-20 chars, lowercase alphanumeric and hyphens";
  if (!body.cloud) return "Cloud provider is required";
  if (!body.region) return "Region is required";
  if (!body.machineType) return "Machine type is required";
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
        user_ssh_public_key: body.sshPublicKey || null,
        gateway_token: generateToken(),
        access_app_id: accessAppId,
      })
      .select()
      .single();
    if (tenantError || !tenant) throw tenantError || new Error("Failed to create tenant");

    // Create VPS instance
    const { data: vpsInstance, error: vpsError } = await supabaseAdmin
      .from("vps_instances")
      .insert({
        tenant_id: tenant.id,
        cloud: body.cloud,
        region: body.region,
        machine_type: body.machineType,
        instance_id: "",
        git_tag: body.gitTag || null,
      })
      .select()
      .single();
    if (vpsError || !vpsInstance) throw vpsError || new Error("Failed to create VPS instance");

    const tenantWithVps: TenantWithVps = { ...tenant, vps_instances: vpsInstance };

    try {
      const provider = await getProvider();
      const instanceId = await provider.create(tenantWithVps, (step) => {
        send("status", { step });
      });

      await supabaseAdmin
        .from("tenants")
        .update({ status: "running" })
        .eq("slug", body.slug);

      // Install user SSH key if provided
      if (body.sshPublicKey) {
        send("status", { step: "Installing SSH key" });
        try {
          const tunnel = await connectSSHThroughTunnel(body.slug, "openclaw");
          try {
            const script = generateAddUserSshKeyScript(body.sshPublicKey);
            await execSSH(
              tunnel.conn,
              `sudo bash -c ${escapeForBash(script)}`,
              30_000,
            );
          } finally {
            tunnel.close();
          }
        } catch (err) {
          // Non-fatal — user can add key later from the SSH tab
          console.warn(`[tenant] Failed to install SSH key for ${body.slug}:`, err);
        }
      }

      await supabaseAdmin.from("audit_logs").insert({
        tenant_id: tenant.id,
        action: "tenant.created",
        details: {
          slug: body.slug,
          cloud: body.cloud,
          region: body.region,
          instanceId,
        },
      });

      send("done", { slug: tenant.slug });
    } catch (err) {
      if (err instanceof PartialProvisioningError) {
        // VM is set up — preserve tenant, VPS record, and access app
        await supabaseAdmin
          .from("tenants")
          .update({ status: "provisioning_failed" })
          .eq("id", tenant.id);
        await supabaseAdmin.from("audit_logs").insert({
          tenant_id: tenant.id,
          action: "tenant.provisioning_failed",
          details: {
            slug: body.slug,
            completedStage: err.completedStage,
            failedStep: err.failedStep,
            error: err.cause.message,
          },
        });
        send("partial_failure", {
          slug: tenant.slug,
          completedStage: err.completedStage,
          failedStep: err.failedStep,
          error: err.cause.message,
        });
        return;
      }

      // Full failure — rollback tenant record (cascade deletes VpsInstance)
      if (accessAppId) {
        await deleteTenantAccessApp(accessAppId).catch(() => {});
      }
      await supabaseAdmin.from("audit_logs").delete().eq("tenant_id", tenant.id);
      await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
      throw err;
    }
  });
}
