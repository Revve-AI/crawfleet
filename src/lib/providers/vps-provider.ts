import { Duplex } from "stream";
import { getCloudProvider } from "../clouds";
import { connectWithRetry, connectSSHThroughTunnel, execSSH, shellSSH } from "./ssh";
import {
  generateSetupScript,
  generateInstallCloudflaredScript,
  generateDeployScript,
  generateWriteConfigScript,
  generateLockdownScript,
} from "./vps-setup-script";
import {
  createTunnel,
  configureTunnelIngress,
  createTunnelDNS,
  createTunnelSSHDNS,
  deleteTunnel,
} from "../cloudflare-tunnel";
import { resolveAllEnv } from "../key-resolver";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  VPS_SSH_PUBLIC_KEY,
  CLOUDFLARE_DOMAIN,
  FLEET_TLS,
  OPENCLAW_DEFAULT_GIT_TAG,
} from "../constants";
import type { TenantProvider, TenantWithVps, ShellHandle, StatusCallback } from "./types";

// Note: This file uses ssh2's Client.exec() method for remote command execution
// over SSH, NOT child_process.exec(). There is no local shell injection risk.

/** Escape a script so it can be passed as: sudo bash -c '<escaped>' */
function escapeForBash(script: string): string {
  return "'" + script.replace(/'/g, "'\"'\"'") + "'";
}

export class VpsProvider implements TenantProvider {
  async create(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    const vps = tenant.vps_instances;
    if (!vps) throw new Error("No VPS instance config");

    const cloud = getCloudProvider(vps.cloud);
    const gitTag = vps.git_tag || OPENCLAW_DEFAULT_GIT_TAG;

    // 1. Create VM
    onStatus?.("Creating VM instance");
    const instanceId = await cloud.createVm({
      name: `fleet-${tenant.slug}`,
      machineType: vps.machine_type,
      region: vps.region,
      sshPublicKey: VPS_SSH_PUBLIC_KEY,
    });

    try {
      // Update DB with instanceId
      await supabaseAdmin
        .from("vps_instances")
        .update({ instance_id: instanceId, vm_status: "creating" })
        .eq("id", vps.id);

      // 2. Wait for VM to be SSH-accessible
      onStatus?.("Waiting for VM to boot");
      const ip = await cloud.waitForReady(instanceId, vps.region);

      await supabaseAdmin
        .from("vps_instances")
        .update({ external_ip: ip })
        .eq("id", vps.id);

      // 3. SSH in, run hardening + setup
      // GCP injects the SSH key for user "openclaw", so connect as that user
      // and use sudo for root operations.
      // Note: execSSH uses ssh2 Client.exec() — remote SSH command, not local shell
      onStatus?.("Hardening OS and installing dependencies");
      const envVars = await resolveAllEnv(tenant);
      const conn = await connectWithRetry({
        host: ip,
        username: "openclaw",
      });

      const setupScript = generateSetupScript({
        sshPublicKey: VPS_SSH_PUBLIC_KEY,
        gitTag,
        tunnelToken: "",
        envVars,
        gatewayToken: tenant.gateway_token,
      });
      const setupResult = await execSSH(
        conn,
        `sudo bash -c ${escapeForBash(setupScript)}`,
        600_000, // 10 min timeout for setup (npm install + build is slow)
      );
      console.log(`[vps] Setup stdout for ${tenant.slug}:\n${setupResult.stdout}`);
      if (setupResult.stderr) console.error(`[vps] Setup stderr for ${tenant.slug}:\n${setupResult.stderr}`);
      if (setupResult.code !== 0) {
        throw new Error(`Setup script failed (exit ${setupResult.code}):\nSTDOUT: ${setupResult.stdout.slice(-2000)}\nSTDERR: ${setupResult.stderr.slice(-2000)}`);
      }

      // 4. Create Cloudflare Tunnel
      onStatus?.("Creating Cloudflare Tunnel");
      const { tunnelId, tunnelToken } = await createTunnel(tenant.slug);
      await configureTunnelIngress(tunnelId, tenant.slug, CLOUDFLARE_DOMAIN);
      await createTunnelDNS(tenant.slug, tunnelId, CLOUDFLARE_DOMAIN);
      await createTunnelSSHDNS(tenant.slug, tunnelId, CLOUDFLARE_DOMAIN);

      await supabaseAdmin
        .from("vps_instances")
        .update({ tunnel_id: tunnelId, tunnel_token: tunnelToken })
        .eq("id", vps.id);

      // 5. Install cloudflared on VM
      onStatus?.("Installing tunnel connector");
      const cfScript = generateInstallCloudflaredScript(tunnelToken);
      const cfResult = await execSSH(
        conn,
        `sudo bash -c ${escapeForBash(cfScript)}`,
        120_000,
      );
      if (cfResult.code !== 0) {
        throw new Error(`cloudflared install failed (exit ${cfResult.code}):\nSTDOUT: ${cfResult.stdout.slice(-2000)}\nSTDERR: ${cfResult.stderr.slice(-2000)}`);
      }

      // 6. Start OpenClaw
      onStatus?.("Starting OpenClaw");
      await execSSH(conn, "sudo systemctl start openclaw", 30_000);
      conn.end();

      // 7. Wait for health (OpenClaw takes ~3 min to start on small VMs)
      onStatus?.("Waiting for health check");
      const healthy = await this.waitForHealthy(tenant, 300_000, onStatus);

      if (!healthy) {
        // Service didn't come up — leave SSH open for debugging, don't lock down
        console.error(`[vps] Health check failed for ${tenant.slug} — skipping firewall lockdown`);
        await supabaseAdmin
          .from("vps_instances")
          .update({ vm_status: "error" })
          .eq("id", vps.id);
        onStatus?.("VM created but OpenClaw failed to start — SSH left open for debugging");
        return instanceId;
      }

      // 8. Update status
      await supabaseAdmin
        .from("vps_instances")
        .update({ vm_status: "running" })
        .eq("id", vps.id);

      // 9. Lock down firewall — close ports 22 and 53 (last direct SSH)
      onStatus?.("Locking down firewall");
      const lockdownConn = await connectWithRetry({ host: ip, username: "openclaw" });
      const lockdownScript = generateLockdownScript();
      const lockdownResult = await execSSH(
        lockdownConn,
        `sudo bash -c ${escapeForBash(lockdownScript)}`,
        30_000,
      );
      lockdownConn.end();
      if (lockdownResult.code !== 0) {
        console.warn(`[vps] Firewall lockdown warning for ${tenant.slug}: ${lockdownResult.stderr}`);
      }

      return instanceId;
    } catch (err) {
      console.error(`[vps] Creation failed for ${tenant.slug}:`, err);
      // Rollback on failure
      await this.rollbackCreate(tenant, instanceId, vps.region, vps.cloud).catch((e) =>
        console.error("[vps] Rollback error:", e),
      );
      throw err;
    }
  }

  private async rollbackCreate(
    tenant: TenantWithVps,
    instanceId: string,
    region: string,
    cloud: string,
  ): Promise<void> {
    console.log(`[vps] Rolling back creation of ${tenant.slug}`);
    const vps = tenant.vps_instances;

    // Delete tunnel if created
    if (vps?.tunnel_id) {
      await deleteTunnel(vps.tunnel_id).catch(() => {});
    }

    // Delete VM
    try {
      const provider = getCloudProvider(cloud);
      await provider.deleteVm(instanceId, region);
    } catch {
      // VM may not exist yet
    }

    // Mark as error
    if (vps) {
      await supabaseAdmin
        .from("vps_instances")
        .update({ vm_status: "error" })
        .eq("id", vps.id)
        .then(() => {});
    }
  }

  async start(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) throw new Error("No VPS instance");

    const cloud = getCloudProvider(vps.cloud);

    // Start VM if stopped
    const info = await cloud.getVmInfo(vps.instance_id, vps.region);
    if (info.status === "stopped") {
      onStatus?.("Starting VM");
      await cloud.startVm(vps.instance_id, vps.region);
      onStatus?.("Waiting for VM to boot");
      await cloud.waitForReady(vps.instance_id, vps.region);
    }

    // Start the OpenClaw service via tunnel (more retries — cloudflared needs time after VM boot)
    onStatus?.("Waiting for tunnel to reconnect");
    if (!vps.tunnel_id) throw new Error("No tunnel configured for VPS");
    const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user, 6);
    try {
      onStatus?.("Starting OpenClaw service");
      await execSSH(tunnel.conn, "sudo systemctl start openclaw", 30_000);
    } finally {
      tunnel.close();
    }

    await supabaseAdmin
      .from("vps_instances")
      .update({ vm_status: "running" })
      .eq("id", vps.id);
  }

  async stop(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) throw new Error("No VPS instance");

    // Stop the OpenClaw service (keep VM running to preserve tunnel)
    if (vps.tunnel_id) {
      try {
        const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);
        await execSSH(tunnel.conn, "sudo systemctl stop openclaw", 30_000);
        tunnel.close();
      } catch {
        // VM may be unreachable
      }
    }

    await supabaseAdmin
      .from("vps_instances")
      .update({ vm_status: "stopped" })
      .eq("id", vps.id);
  }

  async restart(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) throw new Error("No tunnel configured for VPS");

    const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);
    try {
      await execSSH(tunnel.conn, "sudo systemctl restart openclaw", 30_000);
    } finally {
      tunnel.close();
    }
  }

  async remove(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) return;

    // 1. Delete Cloudflare Tunnel
    if (vps.tunnel_id) {
      await deleteTunnel(vps.tunnel_id).catch((e) =>
        console.error("[vps] Failed to delete tunnel:", e),
      );
    }

    // 2. Delete VM (Access app deletion is handled by the route handler)
    try {
      const cloud = getCloudProvider(vps.cloud);
      await cloud.deleteVm(vps.instance_id, vps.region);
    } catch (e) {
      console.error("[vps] Failed to delete VM:", e);
    }
  }

  async deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) throw new Error("No tunnel configured for VPS");

    const gitTag = vps.git_tag || OPENCLAW_DEFAULT_GIT_TAG;

    onStatus?.("Connecting to VM");
    const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);

    try {
      // Update env vars
      onStatus?.("Updating configuration");
      const envVars = await resolveAllEnv(tenant);
      const configScript = generateWriteConfigScript(envVars, tenant.gateway_token);
      await execSSH(
        tunnel.conn,
        `sudo bash -c ${escapeForBash(configScript)}`,
        30_000,
      );

      // Deploy new version
      onStatus?.("Deploying new version");
      const deployScript = generateDeployScript(gitTag);
      const result = await execSSH(
        tunnel.conn,
        `sudo bash -c ${escapeForBash(deployScript)}`,
        300_000,
      );

      if (result.code !== 0) {
        throw new Error(`Deploy failed: ${result.stderr}`);
      }
    } finally {
      tunnel.close();
    }

    onStatus?.("Waiting for health check");
    await this.waitForHealthy(tenant, 120_000, onStatus);

    return vps.instance_id;
  }

  async getStatus(tenant: TenantWithVps): Promise<string> {
    const vps = tenant.vps_instances;
    if (!vps) return "stopped";

    try {
      const cloud = getCloudProvider(vps.cloud);
      const info = await cloud.getVmInfo(vps.instance_id, vps.region);
      return info.status;
    } catch {
      return "unknown";
    }
  }

  async getHealth(tenant: TenantWithVps): Promise<string> {
    const scheme = FLEET_TLS ? "https" : "http";
    const url = `${scheme}://${tenant.slug}.${CLOUDFLARE_DOMAIN}/`;

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? "healthy" : "unhealthy";
    } catch {
      return "unknown";
    }
  }

  async waitForHealthy(
    tenant: TenantWithVps,
    timeoutMs: number,
    onStatus?: StatusCallback,
  ): Promise<boolean> {
    const interval = 5_000;
    const deadline = Date.now() + timeoutMs;
    const start = Date.now();

    while (Date.now() < deadline) {
      const health = await this.getHealth(tenant);
      if (health === "healthy") return true;

      const elapsed = Math.round((Date.now() - start) / 1000);
      onStatus?.(`Waiting for health check (${elapsed}s, status: ${health})`);
      await new Promise((r) => setTimeout(r, interval));
    }
    return false;
  }

  async getLogs(tenant: TenantWithVps, tail: number): Promise<NodeJS.ReadableStream> {
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) throw new Error("No tunnel configured for VPS");

    const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);

    // Uses ssh2 Client.exec() — remote command over SSH, not local shell
    return new Promise((resolve, reject) => {
      tunnel.conn.exec(
        `sudo journalctl -u openclaw -f -n ${Number(tail)} --no-pager`,
        (err, stream) => {
          if (err) {
            tunnel.close();
            reject(err);
            return;
          }
          stream.on("close", () => tunnel.close());
          stream.on("error", () => tunnel.close());
          resolve(stream as unknown as NodeJS.ReadableStream);
        },
      );
    });
  }

  async execShell(tenant: TenantWithVps): Promise<ShellHandle> {
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) throw new Error("No tunnel configured for VPS");

    const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);
    const channel = await shellSSH(tunnel.conn);

    return {
      stream: channel as unknown as Duplex,
      async resize(cols: number, rows: number) {
        channel.setWindow(rows, cols, 0, 0);
      },
      destroy() {
        channel.close();
        tunnel.close();
      },
    };
  }

  async removeTenantData(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps?.tunnel_id) return;

    try {
      const tunnel = await connectSSHThroughTunnel(tenant.slug, vps.ssh_user);
      await execSSH(tunnel.conn, "sudo rm -rf /opt/openclaw /etc/openclaw.env", 30_000);
      tunnel.close();
    } catch {
      // VM may be unreachable
    }
  }
}
