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
    if (!tenant.container_id) {
      onStatus?.("Creating container");
      const containerId = await createTenantContainer(tenant);
      // containerId gets saved by the caller
      tenant.container_id = containerId;
    }
    onStatus?.("Starting container");
    await startContainer(tenant.container_id!);
  }

  async stop(tenant: TenantWithVps): Promise<void> {
    if (!tenant.container_id) throw new Error("No container");
    await stopContainer(tenant.container_id);
  }

  async restart(tenant: TenantWithVps): Promise<void> {
    if (!tenant.container_id) throw new Error("No container");
    await restartContainer(tenant.container_id);
  }

  async remove(tenant: TenantWithVps): Promise<void> {
    if (tenant.container_id) {
      await removeContainer(tenant.container_id).catch(() => {});
    }
  }

  async deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string> {
    if (!tenant.container_id) throw new Error("No container");
    return deployContainer(tenant, onStatus);
  }

  async getStatus(tenant: TenantWithVps): Promise<string> {
    if (!tenant.container_id) return "stopped";
    return getContainerStatus(tenant.container_id);
  }

  async getHealth(tenant: TenantWithVps): Promise<string> {
    if (!tenant.container_id) return "unknown";
    return getContainerHealth(tenant.container_id);
  }

  async waitForHealthy(tenant: TenantWithVps, timeoutMs: number, onStatus?: StatusCallback): Promise<boolean> {
    if (!tenant.container_id) return false;
    return dockerWaitForHealthy(tenant.container_id, timeoutMs, onStatus);
  }

  async getLogs(tenant: TenantWithVps, tail: number): Promise<NodeJS.ReadableStream> {
    if (!tenant.container_id) throw new Error("No container");
    return getContainerLogs(tenant.container_id, tail);
  }

  async execShell(tenant: TenantWithVps): Promise<ShellHandle> {
    if (!tenant.container_id) throw new Error("No container");
    const { exec, stream } = await dockerExecShell(tenant.container_id);
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
    await dockerRemoveTenantData(tenant.slug, tenant.container_id);
  }
}
