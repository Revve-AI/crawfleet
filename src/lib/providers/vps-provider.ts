import { Duplex } from "stream";
import { getCloudProvider } from "../clouds";
import { connectWithRetry, execSSH, shellSSH } from "./ssh";
import {
  generateSetupScript,
  generateInstallCloudflaredScript,
  generateDeployScript,
  generateWriteConfigScript,
} from "./vps-setup-script";
import {
  createTunnel,
  configureTunnelIngress,
  createTunnelDNS,
  deleteTunnel,
} from "../cloudflare-tunnel";
import { resolveAllEnv } from "../key-resolver";
import { prisma } from "../db";
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
    const vps = tenant.vpsInstance;
    if (!vps) throw new Error("No VPS instance config");

    const cloud = getCloudProvider(vps.cloud);
    const gitTag = vps.gitTag || OPENCLAW_DEFAULT_GIT_TAG;

    // 1. Create VM
    onStatus?.("Creating VM instance");
    const instanceId = await cloud.createVm({
      name: `fleet-${tenant.slug}`,
      machineType: vps.machineType,
      region: vps.region,
      sshPublicKey: VPS_SSH_PUBLIC_KEY,
    });

    try {
      // Update DB with instanceId
      await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: { instanceId, vmStatus: "creating" },
      });

      // 2. Wait for VM to be SSH-accessible
      onStatus?.("Waiting for VM to boot");
      const ip = await cloud.waitForReady(instanceId, vps.region);

      await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: { externalIp: ip },
      });

      // 3. SSH in, run hardening + setup
      // GCP injects the SSH key for user "openclaw", so connect as that user
      // and use sudo for root operations.
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
        gatewayToken: tenant.gatewayToken,
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

      await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: { tunnelId, tunnelToken },
      });

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

      // 7. Update status
      await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: { vmStatus: "running" },
      });

      // 8. Wait for health (OpenClaw takes ~3 min to start on small VMs)
      onStatus?.("Waiting for health check");
      await this.waitForHealthy(tenant, 300_000, onStatus);

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
    const vps = tenant.vpsInstance;

    // Delete tunnel if created
    if (vps?.tunnelId) {
      await deleteTunnel(vps.tunnelId).catch(() => {});
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
      await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: { vmStatus: "error" },
      }).catch(() => {});
    }
  }

  async start(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void> {
    const vps = tenant.vpsInstance;
    if (!vps) throw new Error("No VPS instance");

    const cloud = getCloudProvider(vps.cloud);

    // Start VM if stopped
    const info = await cloud.getVmInfo(vps.instanceId, vps.region);
    if (info.status === "stopped") {
      onStatus?.("Starting VM");
      await cloud.startVm(vps.instanceId, vps.region);
      onStatus?.("Waiting for VM to boot");
      await cloud.waitForReady(vps.instanceId, vps.region);
    }

    // Start the OpenClaw service
    onStatus?.("Starting OpenClaw service");
    const ip = vps.externalIp || (await cloud.getVmInfo(vps.instanceId, vps.region)).externalIp;
    if (!ip) throw new Error("No external IP for VM");

    const conn = await connectWithRetry({ host: ip, username: vps.sshUser });
    await execSSH(conn, "sudo systemctl start openclaw", 30_000);
    conn.end();

    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: { vmStatus: "running", externalIp: ip },
    });
  }

  async stop(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vpsInstance;
    if (!vps) throw new Error("No VPS instance");

    // Stop the OpenClaw service (keep VM running to preserve tunnel)
    if (vps.externalIp) {
      try {
        const conn = await connectWithRetry({
          host: vps.externalIp,
          username: vps.sshUser,
        });
        await execSSH(conn, "sudo systemctl stop openclaw", 30_000);
        conn.end();
      } catch {
        // VM may be unreachable
      }
    }

    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: { vmStatus: "stopped" },
    });
  }

  async restart(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vpsInstance;
    if (!vps?.externalIp) throw new Error("No VPS instance or IP");

    const conn = await connectWithRetry({
      host: vps.externalIp,
      username: vps.sshUser,
    });
    await execSSH(conn, "sudo systemctl restart openclaw", 30_000);
    conn.end();
  }

  async remove(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vpsInstance;
    if (!vps) return;

    // 1. Delete Cloudflare Tunnel
    if (vps.tunnelId) {
      await deleteTunnel(vps.tunnelId).catch((e) =>
        console.error("[vps] Failed to delete tunnel:", e),
      );
    }

    // 2. Delete VM (Access app deletion is handled by the route handler)
    try {
      const cloud = getCloudProvider(vps.cloud);
      await cloud.deleteVm(vps.instanceId, vps.region);
    } catch (e) {
      console.error("[vps] Failed to delete VM:", e);
    }
  }

  async deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    const vps = tenant.vpsInstance;
    if (!vps?.externalIp) throw new Error("No VPS instance or IP");

    const gitTag = vps.gitTag || OPENCLAW_DEFAULT_GIT_TAG;

    onStatus?.("Connecting to VM");
    const conn = await connectWithRetry({
      host: vps.externalIp,
      username: vps.sshUser,
    });

    // Update env vars
    onStatus?.("Updating configuration");
    const envVars = await resolveAllEnv(tenant);
    const configScript = generateWriteConfigScript(envVars, tenant.gatewayToken);
    await execSSH(
      conn,
      `sudo bash -c ${escapeForBash(configScript)}`,
      30_000,
    );

    // Deploy new version
    onStatus?.("Deploying new version");
    const deployScript = generateDeployScript(gitTag);
    const result = await execSSH(
      conn,
      `sudo bash -c ${escapeForBash(deployScript)}`,
      300_000,
    );
    conn.end();

    if (result.code !== 0) {
      throw new Error(`Deploy failed: ${result.stderr}`);
    }

    onStatus?.("Waiting for health check");
    await this.waitForHealthy(tenant, 120_000, onStatus);

    return vps.instanceId;
  }

  async getStatus(tenant: TenantWithVps): Promise<string> {
    const vps = tenant.vpsInstance;
    if (!vps) return "stopped";

    try {
      const cloud = getCloudProvider(vps.cloud);
      const info = await cloud.getVmInfo(vps.instanceId, vps.region);
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
    const vps = tenant.vpsInstance;
    if (!vps?.externalIp) throw new Error("No VPS instance or IP");

    const conn = await connectWithRetry({
      host: vps.externalIp,
      username: vps.sshUser,
    });

    // Uses ssh2 Client.exec() — remote command over SSH, not local shell
    return new Promise((resolve, reject) => {
      conn.exec(
        `sudo journalctl -u openclaw -f -n ${Number(tail)} --no-pager`,
        (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }
          stream.on("close", () => conn.end());
          stream.on("error", () => conn.end());
          resolve(stream as unknown as NodeJS.ReadableStream);
        },
      );
    });
  }

  async execShell(tenant: TenantWithVps): Promise<ShellHandle> {
    const vps = tenant.vpsInstance;
    if (!vps?.externalIp) throw new Error("No VPS instance or IP");

    const conn = await connectWithRetry({
      host: vps.externalIp,
      username: vps.sshUser,
    });

    const channel = await shellSSH(conn);

    return {
      stream: channel as unknown as Duplex,
      async resize(cols: number, rows: number) {
        channel.setWindow(rows, cols, 0, 0);
      },
      destroy() {
        channel.close();
        conn.end();
      },
    };
  }

  async removeTenantData(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vpsInstance;
    if (!vps?.externalIp) return;

    try {
      const conn = await connectWithRetry({
        host: vps.externalIp,
        username: vps.sshUser,
      });
      await execSSH(conn, "sudo rm -rf /opt/openclaw /etc/openclaw.env", 30_000);
      conn.end();
    } catch {
      // VM may be unreachable
    }
  }
}
