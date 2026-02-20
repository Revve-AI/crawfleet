import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireTenantAccess } from "@/lib/tenant-access";
import { connectSSHThroughTunnel, execSSH, escapeForBash } from "@/lib/providers/ssh";
import {
  generateAddUserSshKeyScript,
  generateRemoveUserSshKeyScript,
} from "@/lib/providers/vps-setup-script";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) {
      return NextResponse.json({ error: "VM not provisioned" }, { status: 400 });
    }

    const { publicKey } = await req.json();
    if (!publicKey || typeof publicKey !== "string") {
      return NextResponse.json({ error: "publicKey is required" }, { status: 400 });
    }

    const trimmed = publicKey.trim();
    if (!trimmed.startsWith("ssh-") && !trimmed.startsWith("ecdsa-") && !trimmed.startsWith("sk-")) {
      return NextResponse.json({ error: "Invalid SSH public key format" }, { status: 400 });
    }

    // Push key to VM
    const tunnel = await connectSSHThroughTunnel(slug, vps.ssh_user);
    try {
      const script = generateAddUserSshKeyScript(trimmed);
      const result = await execSSH(
        tunnel.conn,
        `sudo bash -c ${escapeForBash(script)}`,
        30_000,
      );
      if (result.code !== 0) {
        throw new Error(`Failed to install SSH key: ${result.stderr}`);
      }
    } finally {
      tunnel.close();
    }

    // Save to DB
    await supabaseAdmin
      .from("tenants")
      .update({ user_ssh_public_key: trimmed })
      .eq("slug", slug);

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.ssh_key_updated",
      details: { slug },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) {
      return NextResponse.json({ error: "VM not provisioned" }, { status: 400 });
    }

    // Remove key from VM
    const tunnel = await connectSSHThroughTunnel(slug, vps.ssh_user);
    try {
      const script = generateRemoveUserSshKeyScript();
      await execSSH(
        tunnel.conn,
        `sudo bash -c ${escapeForBash(script)}`,
        30_000,
      );
    } finally {
      tunnel.close();
    }

    // Clear from DB
    await supabaseAdmin
      .from("tenants")
      .update({ user_ssh_public_key: null })
      .eq("slug", slug);

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.ssh_key_removed",
      details: { slug },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
