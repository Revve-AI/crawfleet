import { Tenant } from "@prisma/client";
import { BASE_DOMAIN, FLEET_TLS } from "./constants";

export function generateConfig(tenant: Tenant): object {
  const scheme = FLEET_TLS ? "https" : "http";
  return {
    gateway: {
      mode: "local",
      port: 18789,
      bind: "lan",
      auth: {
        mode: "token",
        token: tenant.gatewayToken,
      },
      controlUi: {
        enabled: true,
        allowedOrigins: [`${scheme}://${tenant.slug}.${BASE_DOMAIN}`],
        allowInsecureAuth: true,
      },
      trustedProxies: ["172.16.0.0/12", "10.0.0.0/8", "192.168.0.0/16"],
    },
    agents: {
      defaults: {
        model: {
          primary: "anthropic/claude-sonnet-4-5",
        },
        workspace: "/home/node/.openclaw/workspace",
        skipBootstrap: true,
      },
    },
    logging: { level: "info" },
    wizard: {
      lastRunAt: new Date().toISOString(),
      lastRunCommand: "fleet-provision",
      lastRunMode: "local",
    },
  };
}
