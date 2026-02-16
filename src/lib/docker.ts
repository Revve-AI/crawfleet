import Docker from "dockerode";
import { Tenant } from "@prisma/client";
import path from "path";
import fs from "fs/promises";
import { generateConfig } from "./config-template";
import { resolveEnvBatch } from "./key-resolver";
import {
  OPENCLAW_IMAGE,
  FLEET_NETWORK,
  FLEET_LABEL,
  CONTAINER_PORT,
  BASE_DOMAIN,
  DATA_DIR,
  HOST_DATA_DIR,
  FLEET_TLS,
} from "./constants";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export { docker };

function containerName(slug: string): string {
  return `fleet-${slug}`;
}

function tenantDataDir(slug: string): string {
  return path.resolve(DATA_DIR, "tenants", slug, ".openclaw");
}

function tenantHostDir(slug: string): string {
  return path.resolve(HOST_DATA_DIR, "tenants", slug, ".openclaw");
}

async function buildEnvVars(tenant: Tenant): Promise<string[]> {
  const resolved = await resolveEnvBatch(tenant, ["BRAVE_API_KEY", "ELEVENLABS_API_KEY"]);

  const envs: string[] = [
    "HOME=/home/node",
    "TERM=xterm-256color",
    "NODE_OPTIONS=--max-old-space-size=1024",
    `OPENCLAW_GATEWAY_TOKEN=${tenant.gatewayToken}`,
  ];

  if (resolved.BRAVE_API_KEY) {
    envs.push(`BRAVE_API_KEY=${resolved.BRAVE_API_KEY}`);
  }
  if (resolved.ELEVENLABS_API_KEY) {
    envs.push(`ELEVENLABS_API_KEY=${resolved.ELEVENLABS_API_KEY}`);
  }

  return envs;
}

function buildLabels(slug: string): Record<string, string> {
  const labels: Record<string, string> = {
    [FLEET_LABEL]: "true",
    "traefik.enable": "true",
    [`traefik.http.routers.${slug}.rule`]: `Host(\`${slug}.${BASE_DOMAIN}\`)`,
    [`traefik.http.services.${slug}.loadbalancer.server.port`]: String(CONTAINER_PORT),
  };

  if (FLEET_TLS) {
    labels[`traefik.http.routers.${slug}.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${slug}.tls.certresolver`] = "le";
  } else {
    labels[`traefik.http.routers.${slug}.entrypoints`] = "web";
  }

  return labels;
}

async function writeAuthProfiles(tenant: Tenant, dir: string): Promise<void> {
  const profileDir = path.join(dir, "agents", "main", "agent");
  await fs.mkdir(profileDir, { recursive: true });

  const resolved = await resolveEnvBatch(tenant, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]);
  const profiles: Record<string, { type: string; provider: string; key: string }> = {};

  if (resolved.ANTHROPIC_API_KEY) {
    profiles["anthropic:default"] = { type: "api_key", provider: "anthropic", key: resolved.ANTHROPIC_API_KEY };
  }
  if (resolved.OPENAI_API_KEY) {
    profiles["openai:default"] = { type: "api_key", provider: "openai", key: resolved.OPENAI_API_KEY };
  }
  if (resolved.GEMINI_API_KEY) {
    profiles["google:default"] = { type: "api_key", provider: "google", key: resolved.GEMINI_API_KEY };
  }

  await fs.writeFile(
    path.join(profileDir, "auth-profiles.json"),
    JSON.stringify({ version: 1, profiles }, null, 2),
  );
}

export async function writeConfig(tenant: Tenant): Promise<void> {
  const dir = tenantDataDir(tenant.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "workspace"), { recursive: true });
  await fs.mkdir(path.join(dir, "sessions"), { recursive: true });

  const config = generateConfig(tenant);
  await fs.writeFile(path.join(dir, "openclaw.json"), JSON.stringify(config, null, 2));
  await writeAuthProfiles(tenant, dir);
}

export async function createTenantContainer(tenant: Tenant): Promise<string> {
  await writeConfig(tenant);

  const hostDir = tenantHostDir(tenant.slug);

  const container = await docker.createContainer({
    name: containerName(tenant.slug),
    Image: tenant.image || OPENCLAW_IMAGE,
    Cmd: ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan"],
    Env: await buildEnvVars(tenant),
    Labels: buildLabels(tenant.slug),
    HostConfig: {
      Init: true,
      Memory: 2048 * 1024 * 1024,
      MemoryReservation: 1024 * 1024 * 1024,
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      Binds: [`${hostDir}:/home/node/.openclaw`],
      NetworkMode: FLEET_NETWORK,
    },
    Healthcheck: {
      Test: [
        "CMD",
        "node",
        "-e",
        `fetch('http://localhost:${CONTAINER_PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      Interval: 30_000_000_000, // 30s in nanoseconds
      Timeout: 5_000_000_000,
      Retries: 3,
    },
  });

  return container.id;
}

export async function startContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.start();
}

export async function stopContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.stop({ t: 10 });
}

export async function removeContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: 5 });
  } catch {
    // already stopped
  }
  await container.remove({ force: true });
}

export async function restartContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.restart({ t: 10 });
}

export async function getContainerStatus(containerId: string): Promise<string> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return info.State.Running ? "running" : "stopped";
  } catch {
    return "error";
  }
}

export async function getContainerHealth(containerId: string): Promise<string> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return info.State.Health?.Status || "unknown";
  } catch {
    return "unknown";
  }
}

export async function getContainerLogs(
  containerId: string,
  tail: number = 100
): Promise<NodeJS.ReadableStream> {
  const container = docker.getContainer(containerId);
  return container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  }) as unknown as NodeJS.ReadableStream;
}

export async function recreateContainer(tenant: Tenant): Promise<string> {
  if (tenant.containerId) {
    await removeContainer(tenant.containerId);
  }
  const newId = await createTenantContainer(tenant);
  await startContainer(newId);
  return newId;
}

export async function execShell(containerId: string) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: ["bash"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  return { exec, stream };
}

export async function removeTenantData(slug: string): Promise<void> {
  const dir = path.resolve(DATA_DIR, "tenants", slug);
  await fs.rm(dir, { recursive: true, force: true });
}
