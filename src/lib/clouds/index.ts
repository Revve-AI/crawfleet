import type { CloudProvider } from "./types";

const providerFactories: Record<string, () => CloudProvider> = {
  gcp: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GcpCloudProvider } = require("./gcp") as typeof import("./gcp");
    return new GcpCloudProvider();
  },
};

const cache: Record<string, CloudProvider> = {};

export function getCloudProvider(cloud: string): CloudProvider {
  if (cache[cloud]) return cache[cloud];
  const factory = providerFactories[cloud];
  if (!factory) throw new Error(`Unknown cloud provider: ${cloud}`);
  cache[cloud] = factory();
  return cache[cloud];
}

export function listAvailableClouds(): Array<{ id: string; name: string }> {
  const clouds: Array<{ id: string; name: string }> = [];
  if (process.env.GCP_PROJECT) clouds.push({ id: "gcp", name: "Google Cloud" });
  if (process.env.HETZNER_API_TOKEN) clouds.push({ id: "hetzner", name: "Hetzner Cloud" });
  if (process.env.AWS_ACCESS_KEY_ID) clouds.push({ id: "aws", name: "Amazon Web Services" });
  return clouds;
}

export type { CloudProvider } from "./types";
