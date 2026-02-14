export const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || "openclaw/openclaw:latest";
export const FLEET_NETWORK = "fleet-proxy";
export const FLEET_LABEL = "fleet.managed";
export const CONTAINER_PORT = 18789;
export const BASE_DOMAIN = process.env.BASE_DOMAIN || "openclaw.example.com";
export const DATA_DIR = process.env.DATA_DIR || "./data";
// Host-side path to DATA_DIR for Docker bind mounts (since the dashboard runs
// inside a container, DATA_DIR resolves to /app/data which is not a valid host path)
export const HOST_DATA_DIR = process.env.HOST_DATA_DIR || DATA_DIR;
export const FLEET_TLS = process.env.FLEET_TLS !== "false";
