/**
 * Provision Cloudflare Access apps for OpenClaw Fleet Manager.
 *
 * Prerequisites:
 *   - Google Workspace IdP configured in Cloudflare Access dashboard
 *     (requires Google OAuth client ID/secret — can't be fully automated)
 *   - Environment variables: CLOUDFLARE_API_KEY, CF_API_EMAIL,
 *     CLOUDFLARE_TEAM_DOMAIN, BASE_DOMAIN, and the account ID below.
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=<id> tsx scripts/setup-cloudflare-access.ts
 */

import "dotenv/config";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_KEY;
const TEAM_DOMAIN = process.env.CLOUDFLARE_TEAM_DOMAIN;
const BASE_DOMAIN = process.env.BASE_DOMAIN;

if (!ACCOUNT_ID || !API_TOKEN || !TEAM_DOMAIN || !BASE_DOMAIN) {
  console.error(
    "Missing required env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_KEY, CLOUDFLARE_TEAM_DOMAIN, BASE_DOMAIN"
  );
  process.exit(1);
}

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access`;

async function cf(path: string, method: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    console.error(`API error on ${method} ${path}:`, JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.result;
}

async function createApp(name: string, domain: string) {
  console.log(`Creating Access app: ${name} (${domain})`);
  const app = await cf("/apps", "POST", {
    name,
    domain,
    type: "self_hosted",
    session_duration: "24h",
    auto_redirect_to_identity: true,
  });
  console.log(`  App ID: ${app.id}`);
  console.log(`  AUD:    ${app.aud}`);
  return app;
}

async function addEmailDomainPolicy(appId: string, appName: string) {
  console.log(`Adding @revve.ai email domain policy to ${appName}`);
  await cf(`/apps/${appId}/policies`, "POST", {
    name: "Allow @revve.ai (Google Workspace)",
    decision: "allow",
    include: [{ email_domain: { domain: "revve.ai" } }],
  });
}

async function main() {
  // Fleet manager dashboard only — tenant apps are created per-tenant at provisioning time
  const fleetApp = await createApp("OpenClaw Fleet Dashboard", `fleet.${BASE_DOMAIN}`);
  await addEmailDomainPolicy(fleetApp.id, "Fleet Dashboard");

  console.log("\n=== Done ===");
  console.log("Add these to your .env:\n");
  console.log(`CLOUDFLARE_TEAM_DOMAIN="${TEAM_DOMAIN}"`);
  console.log(`CF_ACCESS_AUD="${fleetApp.aud}"`);
  console.log(`CLOUDFLARE_ACCOUNT_ID="${ACCOUNT_ID}"`);
  console.log(
    "\nNote: Per-tenant Access apps are created automatically when tenants are provisioned."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
