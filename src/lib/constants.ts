export const BASE_DOMAIN = process.env.BASE_DOMAIN || "openclaw.example.com";
export const DATA_DIR = process.env.DATA_DIR || "./data";
export const FLEET_TLS = process.env.FLEET_TLS !== "false";
// Cloud display names
export const CLOUD_NAMES: Record<string, string> = {
  gcp: "Google Cloud",
  hetzner: "Hetzner Cloud",
  aws: "Amazon Web Services",
};
export const CLOUD_SHORT_NAMES: Record<string, string> = {
  gcp: "GCP",
  hetzner: "Hetzner",
  aws: "AWS",
};

// VPS / Cloud
export const VPS_SSH_KEY_PATH = process.env.VPS_SSH_KEY_PATH || "./data/.ssh/fleet_key";
export const VPS_SSH_PUBLIC_KEY = process.env.VPS_SSH_PUBLIC_KEY || "";
export const OPENCLAW_DEFAULT_GIT_TAG = process.env.OPENCLAW_DEFAULT_GIT_TAG || "latest";
export const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
// The actual domain used for Cloudflare Tunnel routing and DNS (may differ from BASE_DOMAIN in dev)
export const CLOUDFLARE_DOMAIN = process.env.CLOUDFLARE_DOMAIN || BASE_DOMAIN;

// GCP
export const GCP_PROJECT = process.env.GCP_PROJECT || "";

// Tailscale (global defaults — tenants can override with their own credentials)
export const TAILSCALE_API_KEY = process.env.TAILSCALE_API_KEY || "";
export const TAILSCALE_TAILNET = process.env.TAILSCALE_TAILNET || "";
export const DASHBOARD_PUBLIC_IP = process.env.DASHBOARD_PUBLIC_IP || "";
