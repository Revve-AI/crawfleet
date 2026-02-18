import type { Tenant } from "@/lib/supabase/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

function parseTenantOverrides(tenant: Tenant): Record<string, string> {
  if (!tenant.env_overrides) return {};
  // env_overrides is native jsonb — already an object
  if (typeof tenant.env_overrides === "object") return tenant.env_overrides;
  try {
    return JSON.parse(tenant.env_overrides as unknown as string);
  } catch {
    return {};
  }
}

/**
 * Resolve a single env key through the fallback chain:
 *   1. Tenant-level override (env_overrides jsonb)
 *   2. Global DB setting (global_settings table)
 *   3. process.env fallback
 */
export async function resolveEnv(tenant: Tenant, key: string): Promise<string | undefined> {
  const overrides = parseTenantOverrides(tenant);
  if (overrides[key]) return overrides[key];

  const { data } = await supabaseAdmin
    .from("global_settings")
    .select("value")
    .eq("key", key)
    .single();
  if (data) return data.value;

  return process.env[key] || undefined;
}

/**
 * Resolve a batch of env keys. Returns only keys that have a value.
 */
export async function resolveEnvBatch(tenant: Tenant, keys: string[]): Promise<Record<string, string>> {
  const overrides = parseTenantOverrides(tenant);

  const missingFromOverrides = keys.filter((k) => !overrides[k]);
  const { data: globals } = missingFromOverrides.length > 0
    ? await supabaseAdmin
        .from("global_settings")
        .select("key, value")
        .in("key", missingFromOverrides)
    : { data: [] };

  const globalMap = new Map((globals || []).map((g) => [g.key, g.value]));

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
  const { data: globals } = await supabaseAdmin
    .from("global_settings")
    .select("key, value");

  const result: Record<string, string> = {};
  for (const g of globals || []) {
    result[g.key] = g.value;
  }
  // Tenant overrides win
  for (const [k, v] of Object.entries(overrides)) {
    if (v) result[k] = v;
  }
  return result;
}
