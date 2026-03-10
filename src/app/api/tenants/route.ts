import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin, requireFleetAdmin } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { PartialProvisioningError } from "@/lib/providers/types";
import { connectWithRetry, execSSH, escapeForBash } from "@/lib/providers/ssh";
import { generateAddUserSshKeyScript } from "@/lib/providers/vps-setup-script";
import { TenantCreateInput } from "@/types";
import { apiError } from "@/lib/api-error";
import { sseResponse, type SSESend } from "@/lib/sse";
import type { TenantWithVps } from "@/lib/supabase/types";

export const maxDuration = 300;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

function validateCreate(body: TenantCreateInput): string | null {
  if (!body.email) return "Email is required";
  if (!SLUG_RE.test(body.slug)) return "Slug must be 3-20 chars, lowercase alphanumeric and hyphens";
  if (!body.cloud) return "Cloud provider is required";
  if (!body.region) return "Region is required";
  if (!body.machineType) return "Machine type is required";
  if (body.accessMode && !["private", "funnel"].includes(body.accessMode)) {
    return "Access mode must be 'private' or 'funnel'";
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
        access_mode: body.accessMode || "private",
        tailscale_api_key: body.tailscaleApiKey || null,
        tailscale_tailnet: body.tailscaleTailnet || null,
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

      // Install user SSH key if provided — via direct SSH to external IP
      if (body.sshPublicKey) {
        send("status", { step: "Installing SSH key" });
        try {
          // Re-read VPS to get external_ip (set during provisioning)
          const { data: freshVps } = await supabaseAdmin
            .from("vps_instances")
            .select("external_ip")
            .eq("tenant_id", tenant.id)
            .single();

          if (freshVps?.external_ip) {
            const conn = await connectWithRetry({ host: freshVps.external_ip, username: "openclaw" });
            try {
              const script = generateAddUserSshKeyScript(body.sshPublicKey);
              await execSSH(
                conn,
                `sudo bash -c ${escapeForBash(script)}`,
                30_000,
              );
            } finally {
              conn.end();
            }
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
          accessMode: body.accessMode || "private",
        },
      });

      send("done", { slug: tenant.slug });
    } catch (err) {
      if (err instanceof PartialProvisioningError) {
        // VM is set up — preserve tenant and VPS record
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
      await supabaseAdmin.from("audit_logs").delete().eq("tenant_id", tenant.id);
      await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
      throw err;
    }
  });
}
