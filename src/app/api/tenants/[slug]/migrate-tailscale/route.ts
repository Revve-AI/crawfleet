import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireFleetAdmin } from "@/lib/auth";
import { requireTenantAccess } from "@/lib/tenant-access";
import { sseResponse, type SSESend } from "@/lib/sse";
import { startCloudflaredProxy } from "@/lib/providers/cloudflared-proxy";
import { connectWithRetry, execSSH, escapeForBash } from "@/lib/providers/ssh";
import { generateInstallTailscaleScript } from "@/lib/providers/vps-setup-script";
import { resolveTailscaleCredentials, createAuthKey, findDeviceByHostname } from "@/lib/tailscale";
import { deleteTunnel } from "@/lib/cloudflare-tunnel";

export const maxDuration = 300;
import { deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { CLOUDFLARE_DOMAIN } from "@/lib/constants";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    await requireFleetAdmin();
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    const vps = tenant.vps_instances;

    // Step 1: Validate
    send("status", { step: "Validating tenant state..." });

    if (!vps.tunnel_id) {
      throw new Error("Tenant has no Cloudflare Tunnel — nothing to migrate");
    }
    if (vps.tailscale_device_id) {
      throw new Error("Tenant already has Tailscale configured");
    }

    // Step 2: SSH through the existing Cloudflare Tunnel
    send("status", { step: "Connecting through Cloudflare Tunnel..." });
    const sshHostname = `ssh-${slug}.${CLOUDFLARE_DOMAIN}`;
    const proxy = await startCloudflaredProxy(sshHostname);

    let tunnelConn;
    try {
      tunnelConn = await connectWithRetry({
        host: "127.0.0.1",
        port: proxy.localPort,
        username: vps.ssh_user,
      });
    } catch (err) {
      proxy.kill();
      throw new Error(`Failed to SSH through tunnel: ${err}`);
    }

    let tailscaleDeviceId: string;
    try {
      // Step 3: Install Tailscale
      send("status", { step: "Installing Tailscale on VM..." });
      const tsCreds = await resolveTailscaleCredentials(tenant);
      const authKey = await createAuthKey(tsCreds, slug);
      const tsHostname = `fleet-${slug}`;
      const installScript = generateInstallTailscaleScript(authKey, tsHostname);
      const installResult = await execSSH(tunnelConn, `sudo bash -c ${escapeForBash(installScript)}`, 120_000);
      if (installResult.code !== 0) {
        throw new Error(`Tailscale install failed: ${installResult.stderr}`);
      }

      // Step 4: Discover Tailscale device
      send("status", { step: "Discovering Tailscale device..." });
      let deviceInfo: { deviceId: string; ip: string; fqdn: string } | null = null;
      for (let i = 0; i < 15; i++) {
        deviceInfo = await findDeviceByHostname(tsCreds, tsHostname);
        if (deviceInfo) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      if (!deviceInfo) {
        throw new Error("Tailscale device not found after install — check tailnet");
      }
      tailscaleDeviceId = deviceInfo.deviceId;

      // Save Tailscale info to DB immediately
      await supabaseAdmin
        .from("vps_instances")
        .update({
          tailscale_device_id: deviceInfo.deviceId,
          tailscale_ip: deviceInfo.ip,
          tailscale_hostname: deviceInfo.fqdn,
        })
        .eq("id", vps.id);
      send("status", { step: `Tailscale device found: ${deviceInfo.ip}` });

      // Step 5: Update firewall — remove old deny rules, ensure SSH is open, add Tailscale range
      send("status", { step: "Updating firewall rules..." });
      const fwCmds = [
        "ufw delete deny 22/tcp 2>/dev/null || true",
        "ufw delete deny 53 2>/dev/null || true",
        "ufw allow ssh",
        "ufw allow from 100.64.0.0/10 to any port 22 comment 'tailscale'",
        "ufw reload",
      ].join(" && ");
      const fwResult = await execSSH(tunnelConn, `sudo bash -c ${escapeForBash(fwCmds)}`, 30_000);
      if (fwResult.code !== 0) {
        throw new Error(`Firewall update failed: ${fwResult.stderr}`);
      }

      // Step 6: Disable cloudflared
      send("status", { step: "Disabling cloudflared service..." });
      const disableResult = await execSSH(
        tunnelConn,
        "sudo systemctl stop cloudflared && sudo systemctl disable cloudflared",
        30_000,
      );
      if (disableResult.code !== 0) {
        throw new Error(`Failed to disable cloudflared: ${disableResult.stderr}`);
      }
    } finally {
      tunnelConn.end();
      proxy.kill();
    }

    // Step 7: Verify direct SSH
    send("status", { step: "Verifying direct SSH access..." });
    if (!vps.external_ip) {
      throw new Error("No external IP on VPS — cannot verify direct SSH");
    }
    let directConn;
    try {
      directConn = await connectWithRetry(
        { host: vps.external_ip, username: vps.ssh_user },
        5,
      );
      directConn.end();
    } catch (err) {
      throw new Error(`Direct SSH verification failed: ${err}`);
    }

    // Step 8: Clean up Cloudflare infrastructure
    send("status", { step: "Deleting Cloudflare Tunnel..." });
    try {
      await deleteTunnel(vps.tunnel_id!);
    } catch (err) {
      console.warn(`[migrate] tunnel cleanup failed for ${slug}:`, err);
      // Non-fatal — tunnel may already be inactive
    }

    if (tenant.access_app_id) {
      send("status", { step: "Deleting Cloudflare Access app..." });
      try {
        await deleteTenantAccessApp(tenant.access_app_id);
      } catch (err) {
        console.warn(`[migrate] access app cleanup failed for ${slug}:`, err);
      }
    }

    // Step 9: Update DB — clear Cloudflare fields
    send("status", { step: "Updating database..." });
    await supabaseAdmin
      .from("vps_instances")
      .update({
        tunnel_id: null,
        tunnel_token: null,
      })
      .eq("id", vps.id);

    await supabaseAdmin
      .from("tenants")
      .update({
        access_app_id: null,
      })
      .eq("id", tenant.id);

    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenant.id,
      action: "tenant.migrated_to_tailscale",
      details: {
        old_tunnel_id: vps.tunnel_id,
        tailscale_device_id: tailscaleDeviceId,
      },
    });

    send("done", { slug });
  });
}
