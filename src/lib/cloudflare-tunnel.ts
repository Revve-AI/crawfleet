import { CLOUDFLARE_ZONE_ID } from "./constants";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_KEY;
const BASE_DOMAIN = process.env.BASE_DOMAIN;

async function cfApi(path: string, method: string, body?: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Cloudflare API error: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

export async function createTunnel(
  slug: string,
): Promise<{ tunnelId: string; tunnelToken: string }> {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_KEY are required for tunnel creation");
  }

  const tunnelSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

  const tunnel = await cfApi(
    `/accounts/${ACCOUNT_ID}/cfd_tunnel`,
    "POST",
    {
      name: `fleet-${slug}`,
      tunnel_secret: tunnelSecret,
    },
  );

  // Construct the token that cloudflared expects:
  // base64(JSON.stringify({a: accountTag, t: tunnelId, s: tunnelSecret}))
  const tunnelToken = Buffer.from(
    JSON.stringify({ a: ACCOUNT_ID, t: tunnel.id, s: tunnelSecret }),
  ).toString("base64");

  return {
    tunnelId: tunnel.id,
    tunnelToken,
  };
}

export async function configureTunnelIngress(
  tunnelId: string,
  slug: string,
  baseDomain: string,
): Promise<void> {
  await cfApi(
    `/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`,
    "PUT",
    {
      config: {
        ingress: [
          {
            hostname: `${slug}.${baseDomain}`,
            service: "http://localhost:18789",
          },
          {
            service: "http_status:404",
          },
        ],
      },
    },
  );
}

export async function createTunnelDNS(
  slug: string,
  tunnelId: string,
  baseDomain: string,
): Promise<void> {
  await cfApi(`/zones/${CLOUDFLARE_ZONE_ID}/dns_records`, "POST", {
    type: "CNAME",
    name: `${slug}.${baseDomain}`,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
  });
}

export async function deleteTunnel(tunnelId: string): Promise<void> {
  // Delete DNS records pointing to this tunnel
  try {
    const records = await cfApi(
      `/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&content=${tunnelId}.cfargotunnel.com`,
      "GET",
    );
    for (const record of records) {
      await cfApi(`/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`, "DELETE");
    }
  } catch {
    // DNS cleanup is best-effort
  }

  // Delete the tunnel itself
  await cfApi(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, "DELETE");
}
