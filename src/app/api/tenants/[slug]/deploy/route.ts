import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireFleetAdmin } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { sseResponse, type SSESend } from "@/lib/sse";
import type { TenantWithVps } from "@/lib/supabase/types";

type Params = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    await requireFleetAdmin();
    const { slug } = await params;

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("*, vps_instances(*)")
      .eq("slug", slug)
      .single();
    if (!tenant) throw new Error("Not found");

    const body = await req.json().catch(() => ({}));
    const dbData: Record<string, unknown> = {};

    if (tenant.provider === "docker") {
      if (!tenant.container_id) throw new Error("No container");
      if (body.image && typeof body.image === "string") {
        dbData.image = body.image.trim();
      }
    } else {
      if (body.gitTag && typeof body.gitTag === "string" && tenant.vps_instances) {
        await supabaseAdmin
          .from("vps_instances")
          .update({ git_tag: body.gitTag.trim() })
          .eq("id", tenant.vps_instances.id);
        tenant.vps_instances.git_tag = body.gitTag.trim();
      }
    }

    if (body.envOverrides && typeof body.envOverrides === "object") {
      const existing: Record<string, string> = tenant.env_overrides || {};
      for (const [k, v] of Object.entries(body.envOverrides as Record<string, string>)) {
        if (!v || String(v).trim() === "") {
          delete existing[k];
        } else {
          existing[k] = String(v).trim();
        }
      }
      dbData.env_overrides = Object.keys(existing).length > 0 ? existing : null;
    }

    let updated: TenantWithVps;
    if (Object.keys(dbData).length > 0) {
      const { data } = await supabaseAdmin
        .from("tenants")
        .update(dbData)
        .eq("slug", slug)
        .select("*, vps_instances(*)")
        .single();
      updated = data as TenantWithVps;
    } else {
      updated = tenant as TenantWithVps;
    }

    send("status", { step: "Starting deploy" });

    const provider = await getProvider(updated);
    const newId = await provider.deploy(updated, (step) => {
      send("status", { step });
    });

    if (tenant.provider === "docker") {
      await supabaseAdmin
        .from("tenants")
        .update({ container_id: newId, container_status: "running" })
        .eq("slug", slug);
    } else {
      await supabaseAdmin
        .from("tenants")
        .update({ container_status: "running" })
        .eq("slug", slug);
    }

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.deployed",
      details: {
        provider: tenant.provider,
        ...(dbData.image ? { image: dbData.image } : {}),
        ...(body.gitTag ? { gitTag: body.gitTag } : {}),
        ...(body.envOverrides ? { envOverrides: Object.keys(body.envOverrides) } : {}),
      },
    });

    send("done", { containerId: newId });
  });
}
