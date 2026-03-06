import type { TenantProvider } from "./types";

let vpsProvider: TenantProvider | null = null;

export async function getProvider(): Promise<TenantProvider> {
  if (!vpsProvider) {
    const { VpsProvider } = await import("./vps-provider");
    vpsProvider = new VpsProvider();
  }
  return vpsProvider;
}

export type { TenantProvider, TenantWithVps, StatusCallback } from "./types";
