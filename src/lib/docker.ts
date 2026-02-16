import Docker from "dockerode";
import { Tenant } from "@prisma/client";
import path from "path";
import fs from "fs/promises";
import { resolveAllEnv } from "./key-resolver";
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
  const resolved = await resolveAllEnv(tenant);

  const envs: string[] = [
    "HOME=/home/node",
    "TERM=xterm-256color",
    "NODE_OPTIONS=--max-old-space-size=1024",
    `OPENCLAW_GATEWAY_TOKEN=${tenant.gatewayToken}`,
  ];

  for (const [key, value] of Object.entries(resolved)) {
    envs.push(`${key}=${value}`);
  }

  return envs;
}

function buildLabels(slug: string): Record<string, string> {
  const labels: Record<string, string> = {
    [FLEET_LABEL]: "true",
    "traefik.enable": "true",
    [`traefik.http.routers.${slug}.rule`]: `Host(\`${slug}.${BASE_DOMAIN}\`)`,
    [`traefik.http.services.${slug}.loadbalancer.server.port`]: String(CONTAINER_PORT),
    [`traefik.http.services.${slug}.loadbalancer.healthCheck.path`]: "/",
    [`traefik.http.services.${slug}.loadbalancer.healthCheck.interval`]: "5s",
    [`traefik.http.services.${slug}.loadbalancer.healthCheck.timeout`]: "3s",
  };

  if (FLEET_TLS) {
    labels[`traefik.http.routers.${slug}.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${slug}.tls.certresolver`] = "le";
  } else {
    labels[`traefik.http.routers.${slug}.entrypoints`] = "web";
  }

  return labels;
}

export async function createTenantContainer(tenant: Tenant, name?: string): Promise<string> {
  const dataDir = tenantDataDir(tenant.slug);
  const hostDir = tenantHostDir(tenant.slug);
  const cName = name ?? containerName(tenant.slug);

  // Remove any leftover container with the same name (e.g. from incomplete delete)
  await tryRemoveByName(cName);

  // Create minimal directory structure (matching docker-setup.sh)
  // Use dataDir (inside dashboard container) for fs operations
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, "workspace"), { recursive: true });

  const container = await docker.createContainer({
    name: cName,
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

export async function waitForHealthy(
  containerId: string,
  timeoutMs = 120_000,
  onStatus?: (step: string) => void,
): Promise<boolean> {
  const interval = 3_000;
  const deadline = Date.now() + timeoutMs;
  let checks = 0;
  while (Date.now() < deadline) {
    const health = await getContainerHealth(containerId);
    checks++;
    if (health === "healthy") return true;
    if (health === "unhealthy") return false;
    const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
    onStatus?.(`Waiting for health check (${elapsed}s, status: ${health})`);
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

export async function tryRemoveByName(name: string): Promise<void> {
  try {
    const c = docker.getContainer(name);
    await c.stop({ t: 5 }).catch(() => {});
    await c.remove({ force: true });
  } catch {
    // doesn't exist — fine
  }
}

export async function deployContainer(
  tenant: Tenant,
  onStatus?: (step: string) => void,
): Promise<string> {
  const slug = tenant.slug;
  const nextName = `fleet-${slug}-next`;
  const canonicalName = containerName(slug);
  const report = onStatus ?? (() => {});

  // 1. Clean up any leftover staging container from a previous failed deploy
  report("Cleaning up previous staging container");
  await tryRemoveByName(nextName);

  // 2. Create and start the new container alongside the old one
  report("Creating new container");
  const newId = await createTenantContainer(tenant, nextName);
  report("Starting new container");
  await startContainer(newId);

  // 3. Wait for the new container to become healthy
  report("Waiting for health check");
  const healthy = await waitForHealthy(newId, 120_000, (s) => report(s));

  if (!healthy) {
    // Rollback: remove the new container, old one stays untouched
    report("Health check failed — rolling back");
    await tryRemoveByName(nextName);
    throw new Error(`Deploy failed: new container for ${slug} did not become healthy`);
  }

  // 4. Swap: remove old, rename new → canonical
  report("Swapping containers");
  if (tenant.containerId) {
    await removeContainer(tenant.containerId);
  }
  const newContainer = docker.getContainer(newId);
  await newContainer.rename({ name: canonicalName });

  report("Done");
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

export async function removeTenantData(slug: string, containerId?: string | null): Promise<void> {
  // Wipe data from inside the running container (it owns the files)
  if (containerId) {
    try {
      const c = docker.getContainer(containerId);
      const e = await c.exec({ Cmd: ["rm", "-rf", "/home/node/.openclaw"] });
      await e.start({ Detach: false });
    } catch {
      // container not running or already gone
    }
  }

  const dir = path.resolve(DATA_DIR, "tenants", slug);
  await fs.rm(dir, { recursive: true, force: true });
}
