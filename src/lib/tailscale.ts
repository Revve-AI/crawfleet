import type { Tenant } from "./supabase/types";
import { resolveEnv } from "./key-resolver";

export interface TailscaleCredentials {
  apiKey: string;
  tailnet: string;
}

/**
 * Resolve Tailscale credentials through the standard three-tier chain:
 *   1. Tenant-level columns (tailscale_api_key / tailscale_tailnet)
 *   2. global_settings DB table (TAILSCALE_API_KEY / TAILSCALE_TAILNET)
 *   3. process.env fallback
 */
export async function resolveTailscaleCredentials(tenant: Tenant): Promise<TailscaleCredentials> {
  const apiKey = tenant.tailscale_api_key || await resolveEnv(tenant, "TAILSCALE_API_KEY") || "";
  const tailnet = tenant.tailscale_tailnet || await resolveEnv(tenant, "TAILSCALE_TAILNET") || "";
  if (!apiKey || !tailnet) {
    throw new Error("No Tailscale credentials configured (tenant or global)");
  }
  return { apiKey, tailnet };
}

const TS_API = "https://api.tailscale.com/api/v2";

async function tsFetch(creds: TailscaleCredentials, path: string, init?: RequestInit): Promise<Response> {
  const url = `${TS_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tailscale API ${res.status}: ${body}`);
  }
  return res;
}

/**
 * Create a pre-auth key for a new device.
 * - ephemeral=false (device persists)
 * - reusable=false (single use)
 * - preauthorized=true (no manual approval)
 * - tags=["tag:fleet"]
 * - expiry=300s (5 minutes — only needs to last until `tailscale up`)
 */
export async function createAuthKey(
  creds: TailscaleCredentials,
  slug: string,
): Promise<string> {
  const res = await tsFetch(creds, `/tailnet/${creds.tailnet}/keys`, {
    method: "POST",
    body: JSON.stringify({
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: false,
            preauthorized: true,
          },
        },
      },
      expirySeconds: 300,
      description: `fleet-${slug}`,
    }),
  });
  const data = await res.json();
  return data.key;
}

/**
 * Delete a device from the tailnet (used on tenant deletion).
 */
export async function deleteDevice(
  creds: TailscaleCredentials,
  deviceId: string,
): Promise<void> {
  await tsFetch(creds, `/device/${deviceId}`, { method: "DELETE" });
}

interface TailscaleDevice {
  id: string;
  addresses: string[];
  hostname: string;
  name: string;
}

/**
 * Find a device by its hostname in the tailnet.
 * Used after Tailscale install to discover device ID and IP.
 */
export async function findDeviceByHostname(
  creds: TailscaleCredentials,
  hostname: string,
): Promise<{ deviceId: string; ip: string; fqdn: string } | null> {
  const res = await tsFetch(creds, `/tailnet/${creds.tailnet}/devices`);
  const data = await res.json();
  const devices: TailscaleDevice[] = data.devices || [];

  const device = devices.find(
    (d) => d.hostname === hostname || d.name.startsWith(`${hostname}.`),
  );
  if (!device) return null;

  const ipv4 = device.addresses.find((a) => !a.includes(":")) || device.addresses[0];
  return {
    deviceId: device.id,
    ip: ipv4,
    fqdn: device.name,
  };
}
