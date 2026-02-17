import type { TenantProvider, TenantWithVps } from "./types";
import { DockerProvider } from "./docker-provider";

const dockerProvider = new DockerProvider();

// Lazy-load VPS provider to avoid importing SSH/cloud deps for Docker-only setups
let vpsProvider: TenantProvider | null = null;
async function getVpsProvider(): Promise<TenantProvider> {
  if (!vpsProvider) {
    const { VpsProvider } = await import("./vps-provider");
    vpsProvider = new VpsProvider();
  }
  return vpsProvider;
}

export async function getProvider(tenant: TenantWithVps): Promise<TenantProvider> {
  if (tenant.provider === "vps") {
    return getVpsProvider();
  }
  return dockerProvider;
}

export type { TenantProvider, TenantWithVps, ShellHandle, StatusCallback } from "./types";
