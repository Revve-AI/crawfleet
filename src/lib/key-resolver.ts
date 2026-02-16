import { Tenant } from "@prisma/client";
import { prisma } from "./db";

function parseTenantOverrides(tenant: Tenant): Record<string, string> {
  if (!tenant.envOverrides) return {};
  try {
    return JSON.parse(tenant.envOverrides);
  } catch {
    return {};
  }
}

/**
 * Resolve a single env key through the fallback chain:
 *   1. Tenant-level override (envOverrides JSON)
 *   2. Global DB setting (GlobalSetting table)
 *   3. process.env fallback
 */
export async function resolveEnv(tenant: Tenant, key: string): Promise<string | undefined> {
  const overrides = parseTenantOverrides(tenant);
  if (overrides[key]) return overrides[key];

  const global = await prisma.globalSetting.findUnique({ where: { key } });
  if (global) return global.value;

  return process.env[key] || undefined;
}

/**
 * Resolve a batch of env keys. Returns only keys that have a value.
 */
export async function resolveEnvBatch(tenant: Tenant, keys: string[]): Promise<Record<string, string>> {
  const overrides = parseTenantOverrides(tenant);

  // Only query DB for keys not already resolved by tenant overrides
  const missingFromOverrides = keys.filter((k) => !overrides[k]);
  const globals = missingFromOverrides.length > 0
    ? await prisma.globalSetting.findMany({ where: { key: { in: missingFromOverrides } } })
    : [];
  const globalMap = new Map(globals.map((g) => [g.key, g.value]));

  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = overrides[key] || globalMap.get(key) || process.env[key];
    if (value) result[key] = value;
  }
  return result;
}

/**
 * Resolve ALL env vars for a tenant: merges tenant overrides + all GlobalSettings.
 * Tenant overrides win over global settings.
 */
export async function resolveAllEnv(tenant: Tenant): Promise<Record<string, string>> {
  const overrides = parseTenantOverrides(tenant);
  const globals = await prisma.globalSetting.findMany();

  const result: Record<string, string> = {};
  for (const g of globals) {
    result[g.key] = g.value;
  }
  // Tenant overrides win
  for (const [k, v] of Object.entries(overrides)) {
    if (v) result[k] = v;
  }
  return result;
}
