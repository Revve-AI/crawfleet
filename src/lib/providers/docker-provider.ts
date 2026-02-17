import { Duplex } from "stream";
import {
  createTenantContainer,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  deployContainer,
  getContainerStatus,
  getContainerHealth,
  waitForHealthy as dockerWaitForHealthy,
  getContainerLogs,
  execShell as dockerExecShell,
  removeTenantData as dockerRemoveTenantData,
} from "../docker";
import type { TenantProvider, TenantWithVps, ShellHandle, StatusCallback } from "./types";

export class DockerProvider implements TenantProvider {
  async create(tenant: TenantWithVps): Promise<string> {
    const containerId = await createTenantContainer(tenant);
    await startContainer(containerId);
    return containerId;
  }

  async start(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void> {
    if (!tenant.containerId) {
      onStatus?.("Creating container");
      const containerId = await createTenantContainer(tenant);
      // containerId gets saved by the caller
      tenant.containerId = containerId;
    }
    onStatus?.("Starting container");
    await startContainer(tenant.containerId!);
  }

  async stop(tenant: TenantWithVps): Promise<void> {
    if (!tenant.containerId) throw new Error("No container");
    await stopContainer(tenant.containerId);
  }

  async restart(tenant: TenantWithVps): Promise<void> {
    if (!tenant.containerId) throw new Error("No container");
    await restartContainer(tenant.containerId);
  }

  async remove(tenant: TenantWithVps): Promise<void> {
    if (tenant.containerId) {
      await removeContainer(tenant.containerId).catch(() => {});
    }
  }

  async deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    if (!tenant.containerId) throw new Error("No container");
    return deployContainer(tenant, onStatus);
  }

  async getStatus(tenant: TenantWithVps): Promise<string> {
    if (!tenant.containerId) return "stopped";
    return getContainerStatus(tenant.containerId);
  }

  async getHealth(tenant: TenantWithVps): Promise<string> {
    if (!tenant.containerId) return "unknown";
    return getContainerHealth(tenant.containerId);
  }

  async waitForHealthy(tenant: TenantWithVps, timeoutMs: number, onStatus?: StatusCallback): Promise<boolean> {
    if (!tenant.containerId) return false;
    return dockerWaitForHealthy(tenant.containerId, timeoutMs, onStatus);
  }

  async getLogs(tenant: TenantWithVps, tail: number): Promise<NodeJS.ReadableStream> {
    if (!tenant.containerId) throw new Error("No container");
    return getContainerLogs(tenant.containerId, tail);
  }

  async execShell(tenant: TenantWithVps): Promise<ShellHandle> {
    if (!tenant.containerId) throw new Error("No container");
    const { exec, stream } = await dockerExecShell(tenant.containerId);
    return {
      stream: stream as unknown as Duplex,
      async resize(cols: number, rows: number) {
        await exec.resize({ h: rows, w: cols }).catch(() => {});
      },
      destroy() {
        stream.destroy();
      },
    };
  }

  async removeTenantData(tenant: TenantWithVps): Promise<void> {
    await dockerRemoveTenantData(tenant.slug, tenant.containerId);
  }
}
