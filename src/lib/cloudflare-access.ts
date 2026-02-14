const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_KEY;
const BASE_DOMAIN = process.env.BASE_DOMAIN;
const IDP_ID = process.env.CLOUDFLARE_IDP_ID;

const isDev = process.env.NODE_ENV === "development" || !ACCOUNT_ID || !API_TOKEN;

async function cf(path: string, method: string, body?: unknown) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Cloudflare Access API error: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

export async function createTenantAccessApp(
  slug: string,
  email: string
): Promise<string | null> {
  if (isDev) {
    console.log(`[dev] Skipping Access app creation for ${slug} (${email})`);
    return null;
  }

  const domain = `${slug}.${BASE_DOMAIN}`;
  const app = await cf("/apps", "POST", {
    name: `OpenClaw Tenant: ${slug}`,
    domain,
    type: "self_hosted",
    session_duration: "24h",
    auto_redirect_to_identity: true,
    ...(IDP_ID ? { allowed_idps: [IDP_ID] } : {}),
  });

  await cf(`/apps/${app.id}/policies`, "POST", {
    name: `Allow ${email}`,
    decision: "allow",
    include: [{ email: { email } }],
  });

  return app.id as string;
}

export async function deleteTenantAccessApp(
  accessAppId: string
): Promise<void> {
  if (isDev) {
    console.log(`[dev] Skipping Access app deletion for ${accessAppId}`);
    return;
  }

  await cf(`/apps/${accessAppId}`, "DELETE");
}
