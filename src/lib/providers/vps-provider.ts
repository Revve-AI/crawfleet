import { getCloudProvider } from "../clouds";
import { connectWithRetry, execSSH, escapeForBash } from "./ssh";
import {
  generateSetupScript,
  generateInstallTailscaleScript,
  generateDeployScript,
  generateWriteConfigScript,
} from "./vps-setup-script";
import { deleteTunnel } from "../cloudflare-tunnel";
import { resolveAllEnv } from "../key-resolver";
import { resolveTailscaleCredentials, createAuthKey, deleteDevice, findDeviceByHostname } from "../tailscale";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  VPS_SSH_PUBLIC_KEY,
  OPENCLAW_DEFAULT_GIT_TAG,
} from "../constants";
import type { TenantProvider, TenantWithVps, StatusCallback, ProvisionStage } from "./types";
import { PartialProvisioningError } from "./types";

// Note: This file uses ssh2's Client.exec() method for remote command execution
// over SSH, NOT child_process.exec(). There is no local shell injection risk.

/** Prefix for systemctl --user commands (ensure XDG_RUNTIME_DIR is set for SSH sessions) */
const SYSTEMCTL_USER = "export XDG_RUNTIME_DIR=/run/user/$(id -u) && systemctl --user";
const SVC = "openclaw-gateway";



export class VpsProvider implements TenantProvider {
  private async setProvisionStage(vpsId: string, stage: ProvisionStage): Promise<void> {
    await supabaseAdmin
      .from("vps_instances")
      .update({ provision_stage: stage })
      .eq("id", vpsId);
  }

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
      await this.setProvisionStage(vps.id, "vm_created");

      // 2. Wait for VM to be SSH-accessible
      onStatus?.("Waiting for VM to boot");
      const ip = await cloud.waitForReady(instanceId, vps.region);

      await supabaseAdmin
        .from("vps_instances")
        .update({ external_ip: ip })
        .eq("id", vps.id);
      await this.setProvisionStage(vps.id, "vm_ready");

      // 3. SSH in, run hardening + setup
      onStatus?.("Hardening OS and installing dependencies");
      const envVars = await resolveAllEnv(tenant);
      const conn = await connectWithRetry({
        host: ip,
        username: "openclaw",
      });

      const setupScript = generateSetupScript({
        sshPublicKey: VPS_SSH_PUBLIC_KEY,
        gitTag,
        envVars,
        gatewayToken: tenant.gateway_token,
        accessMode: tenant.access_mode,
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
      conn.end();
      await this.setProvisionStage(vps.id, "vm_setup");

      // --- NO-ROLLBACK BOUNDARY ---
      // VM is set up and valuable from this point. Failures preserve the VM
      // and set provisioning_failed status so the user can resume.
      await this.runPostSetupStages(tenant, vps.id, ip, onStatus);

      return instanceId;
    } catch (err) {
      // Partial failures: VM is valuable, don't rollback
      if (err instanceof PartialProvisioningError) {
        console.error(`[vps] Partial provisioning failure for ${tenant.slug}:`, err.message);
        await supabaseAdmin
          .from("vps_instances")
          .update({ vm_status: "provisioning_failed" })
          .eq("id", vps.id);
        throw err;
      }

      console.error(`[vps] Creation failed for ${tenant.slug}:`, err);
      // Full rollback — VM has no value yet (pre-setup)
      await this.rollbackCreate(tenant, instanceId, vps.region, vps.cloud).catch((e) =>
        console.error("[vps] Rollback error:", e),
      );
      throw err;
    }
  }

  /**
   * Runs provisioning stages after VM setup (tailscale, service, health, lockdown).
   * On failure, throws PartialProvisioningError with the last completed stage.
   */
  private async runPostSetupStages(
    tenant: TenantWithVps,
    vpsId: string,
    ip: string,
    onStatus?: StatusCallback,
    startAfter?: ProvisionStage,
  ): Promise<void> {
    const postSetupStages: ProvisionStage[] = [
      "tailscale_installed",
      "service_started",
      "health_checked",
    ];
    const startIdx = startAfter
      ? postSetupStages.indexOf(startAfter) + 1
      : 0;
    let lastCompleted: ProvisionStage = startAfter || "vm_setup";

    for (let i = startIdx; i < postSetupStages.length; i++) {
      const stage = postSetupStages[i];
      try {
        switch (stage) {
          case "tailscale_installed": {
            onStatus?.("Installing Tailscale");
            const creds = await resolveTailscaleCredentials(tenant);
            const tsHostname = `fleet-${tenant.slug}`;
            const authKey = await createAuthKey(creds, tenant.slug);

            const tsConn = await connectWithRetry({ host: ip, username: "openclaw" });
            const tsScript = generateInstallTailscaleScript(authKey, tsHostname);
            const tsResult = await execSSH(
              tsConn,
              `sudo bash -c ${escapeForBash(tsScript)}`,
              300_000,
            );
            tsConn.end();
            if (tsResult.code !== 0) {
              throw new Error(`Tailscale install failed (exit ${tsResult.code}):\nSTDOUT: ${tsResult.stdout.slice(-2000)}\nSTDERR: ${tsResult.stderr.slice(-2000)}`);
            }

            // Discover device in tailnet
            onStatus?.("Discovering Tailscale device");
            let device = null;
            for (let attempt = 0; attempt < 10; attempt++) {
              device = await findDeviceByHostname(creds, tsHostname);
              if (device) break;
              await new Promise((r) => setTimeout(r, 3_000));
            }

            if (device) {
              await supabaseAdmin
                .from("vps_instances")
                .update({
                  tailscale_device_id: device.deviceId,
                  tailscale_ip: device.ip,
                  tailscale_hostname: tsHostname,
                })
                .eq("id", vpsId);
            } else {
              // Parse IP from script output as fallback
              const ipMatch = tsResult.stdout.match(/TAILSCALE_IP=(\S+)/);
              await supabaseAdmin
                .from("vps_instances")
                .update({
                  tailscale_ip: ipMatch?.[1] || null,
                  tailscale_hostname: tsHostname,
                })
                .eq("id", vpsId);
              console.warn(`[vps] Could not discover Tailscale device for ${tenant.slug} — saved IP from script output`);
            }
            break;
          }
          case "service_started": {
            onStatus?.("Starting OpenClaw");
            const svcConn = await connectWithRetry({ host: ip, username: "openclaw" });
            await execSSH(svcConn, `${SYSTEMCTL_USER} start ${SVC}`, 30_000);
            svcConn.end();
            break;
          }
          case "health_checked": {
            onStatus?.("Waiting for health check");
            const healthy = await this.waitForHealthy(tenant, 300_000, onStatus);
            if (!healthy) {
              throw new Error("Health check timed out — OpenClaw failed to start");
            }
            break;
          }
        }
        lastCompleted = stage;
        await this.setProvisionStage(vpsId, stage);
      } catch (err) {
        await this.setProvisionStage(vpsId, lastCompleted);
        throw new PartialProvisioningError(
          lastCompleted,
          stage,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // All stages done — mark as running
    await supabaseAdmin
      .from("vps_instances")
      .update({ vm_status: "running" })
      .eq("id", vpsId);
  }

  async resume(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) throw new Error("No VPS instance config");
    if (vps.vm_status !== "provisioning_failed") {
      throw new Error("Tenant is not in provisioning_failed state");
    }
    if (!vps.provision_stage) {
      throw new Error("No provision_stage recorded — cannot resume");
    }
    if (!vps.external_ip) {
      throw new Error("No external IP recorded — cannot resume");
    }

    const lastStage = vps.provision_stage as ProvisionStage;

    onStatus?.(`Resuming from stage: ${lastStage}`);
    await this.runPostSetupStages(tenant, vps.id, vps.external_ip, onStatus, lastStage);
  }

  private async rollbackCreate(
    tenant: TenantWithVps,
    instanceId: string,
    region: string,
    cloud: string,
  ): Promise<void> {
    console.log(`[vps] Rolling back creation of ${tenant.slug}`);
    const vps = tenant.vps_instances;

    // Check for Tailscale device or legacy tunnel to clean up
    if (vps) {
      const { data } = await supabaseAdmin
        .from("vps_instances")
        .select("tunnel_id, tailscale_device_id")
        .eq("id", vps.id)
        .single();

      // Clean up Tailscale device if created
      if (data?.tailscale_device_id) {
        try {
          const creds = await resolveTailscaleCredentials(tenant);
          await deleteDevice(creds, data.tailscale_device_id);
        } catch { /* device may not exist */ }
      }

      // Clean up legacy tunnel if present
      if (data?.tunnel_id) {
        await deleteTunnel(data.tunnel_id).catch(() => {});
      }
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
      const newIp = await cloud.waitForReady(vps.instance_id, vps.region);

      // GCP ephemeral IPs can change on stop/start — update DB
      if (newIp !== vps.external_ip) {
        await supabaseAdmin
          .from("vps_instances")
          .update({ external_ip: newIp })
          .eq("id", vps.id);
        vps.external_ip = newIp;
      }
    }

    if (!vps.external_ip) throw new Error("No external IP for VPS");

    // Start the OpenClaw service via direct SSH
    onStatus?.("Connecting to VM");
    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user }, 6);
    try {
      onStatus?.("Starting OpenClaw service");
      await execSSH(conn, `${SYSTEMCTL_USER} start ${SVC}`, 30_000);
    } finally {
      conn.end();
    }

    await supabaseAdmin
      .from("vps_instances")
      .update({ vm_status: "running" })
      .eq("id", vps.id);
  }

  async stop(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) throw new Error("No VPS instance");

    if (vps.external_ip) {
      try {
        const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });
        await execSSH(conn, `${SYSTEMCTL_USER} stop ${SVC}`, 30_000);
        conn.end();
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
    if (!vps?.external_ip) throw new Error("No external IP for VPS");

    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });
    try {
      await execSSH(conn, `${SYSTEMCTL_USER} restart ${SVC}`, 30_000);
    } finally {
      conn.end();
    }
  }

  async remove(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps) return;

    // 1. Delete Tailscale device from tailnet
    if (vps.tailscale_device_id) {
      try {
        const creds = await resolveTailscaleCredentials(tenant);
        await deleteDevice(creds, vps.tailscale_device_id);
      } catch (e) {
        console.error("[vps] Failed to delete Tailscale device:", e);
      }
    }

    // 2. Delete legacy Cloudflare Tunnel if present (backward compat)
    if (vps.tunnel_id) {
      await deleteTunnel(vps.tunnel_id).catch((e) =>
        console.error("[vps] Failed to delete tunnel:", e),
      );
    }

    // 3. Delete VM
    try {
      const cloud = getCloudProvider(vps.cloud);
      await cloud.deleteVm(vps.instance_id, vps.region);
    } catch (e) {
      console.error("[vps] Failed to delete VM:", e);
    }
  }

  async deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    const vps = tenant.vps_instances;
    if (!vps?.external_ip) throw new Error("No external IP for VPS");

    const gitTag = vps.git_tag || OPENCLAW_DEFAULT_GIT_TAG;

    onStatus?.("Connecting to VM");
    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });

    try {
      // Update env vars
      onStatus?.("Updating configuration");
      const envVars = await resolveAllEnv(tenant);
      const configScript = generateWriteConfigScript(envVars, tenant.gateway_token, tenant.access_mode);
      await execSSH(
        conn,
        `bash -c ${escapeForBash(configScript)}`,
        30_000,
      );

      // Deploy new version
      onStatus?.("Deploying new version");
      const deployScript = generateDeployScript(gitTag);
      const result = await execSSH(
        conn,
        `bash -c ${escapeForBash(deployScript)}`,
        300_000,
      );

      if (result.code !== 0) {
        throw new Error(`Deploy failed: ${result.stderr}`);
      }
    } finally {
      conn.end();
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
    const vps = tenant.vps_instances;

    // Funnel mode: HTTP health check via Tailscale Funnel URL
    if (tenant.access_mode === "funnel" && vps?.tailscale_hostname) {
      try {
        const creds = await resolveTailscaleCredentials(tenant);
        const url = `https://${vps.tailscale_hostname}.${creds.tailnet}.ts.net/`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return res.ok ? "healthy" : "unhealthy";
      } catch {
        return "unknown";
      }
    }

    // Private mode or fallback: SSH in and curl localhost
    if (vps?.external_ip) {
      try {
        const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user }, 1);
        const result = await execSSH(conn, "curl -sf http://localhost:18789/", 10_000);
        conn.end();
        return result.code === 0 ? "healthy" : "unhealthy";
      } catch {
        return "unknown";
      }
    }

    return "unknown";
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
    if (!vps?.external_ip) throw new Error("No external IP for VPS");

    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });

    // Uses ssh2 Client.exec() — remote command over SSH, not local shell
    return new Promise((resolve, reject) => {
      conn.exec(
        `journalctl --user -u ${SVC} -f -n ${Number(tail)} --no-pager`,
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

  async removeTenantData(tenant: TenantWithVps): Promise<void> {
    const vps = tenant.vps_instances;
    if (!vps?.external_ip) return;

    try {
      const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });
      await execSSH(conn, "rm -rf ~/.openclaw /opt/openclaw", 30_000);
      conn.end();
    } catch {
      // VM may be unreachable
    }
  }
}
