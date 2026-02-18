#!/usr/bin/env node
/**
 * Migrate data from SQLite (Prisma/camelCase) to Supabase Postgres (snake_case).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/migrate-sqlite-to-supabase.mjs [path/to/fleet.db]
 *
 * Defaults to data/fleet.db if no path given.
 * Requires: pg (already in deps), sqlite3 CLI on PATH.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { existsSync } from "node:fs";

const SQLITE_PATH = process.argv[2] || "data/fleet.db";
if (!existsSync(SQLITE_PATH)) {
  console.error(`SQLite file not found: ${SQLITE_PATH}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required (Supabase Postgres connection string)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a table from SQLite as JSON array */
function readTable(table) {
  const raw = execFileSync("sqlite3", ["-json", SQLITE_PATH, `SELECT * FROM ${table};`], {
    encoding: "utf-8",
  });
  return JSON.parse(raw || "[]");
}

/** Convert SQLite epoch-ms or ISO string to ISO 8601 timestamptz */
function toTimestamp(val) {
  if (val == null) return null;
  const d = typeof val === "number" ? new Date(val) : new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Try to parse a string as JSON; return null on failure */
function tryParseJson(val) {
  if (val == null) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read SQLite data
// ---------------------------------------------------------------------------

console.log(`Reading from ${SQLITE_PATH} ...`);

const oldTenants = readTable("Tenant");
const oldVps = readTable("VpsInstance");
const oldSettings = readTable("GlobalSetting");
const oldAudit = readTable("AuditLog");

console.log(
  `  Tenants: ${oldTenants.length}, VPS: ${oldVps.length}, Settings: ${oldSettings.length}, AuditLogs: ${oldAudit.length}`
);

// ---------------------------------------------------------------------------
// Build ID mapping  (old cuid → new uuid)
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} */
const tenantIdMap = new Map();
for (const t of oldTenants) {
  tenantIdMap.set(t.id, randomUUID());
}

/** @type {Map<string, string>} */
const vpsIdMap = new Map();
for (const v of oldVps) {
  vpsIdMap.set(v.id, randomUUID());
}

// ---------------------------------------------------------------------------
// Transform rows
// ---------------------------------------------------------------------------

const tenants = oldTenants.map((t) => ({
  id: tenantIdMap.get(t.id),
  user_id: null,
  slug: t.slug,
  display_name: t.displayName,
  email: t.email || null,
  enabled: Boolean(t.enabled),
  container_id: t.containerId || null,
  container_status: t.containerStatus || "stopped",
  access_app_id: t.accessAppId || null,
  image: t.image || null,
  env_overrides: tryParseJson(t.envOverrides),
  gateway_token: t.gatewayToken,
  provider: t.provider || "docker",
  last_health_check: toTimestamp(t.lastHealthCheck),
  last_health_status: t.lastHealthStatus || null,
  created_at: toTimestamp(t.createdAt),
  updated_at: toTimestamp(t.updatedAt),
}));

const vpsInstances = oldVps.map((v) => ({
  id: vpsIdMap.get(v.id),
  tenant_id: tenantIdMap.get(v.tenantId),
  cloud: v.cloud,
  region: v.region,
  instance_id: v.instanceId,
  machine_type: v.machineType,
  external_ip: v.externalIp || null,
  tunnel_id: v.tunnelId || null,
  tunnel_token: v.tunnelToken || null,
  git_tag: v.gitTag || null,
  ssh_user: v.sshUser || "openclaw",
  ssh_port: v.sshPort ?? 22,
  vm_status: v.vmStatus || "creating",
  created_at: toTimestamp(v.createdAt),
  updated_at: toTimestamp(v.updatedAt),
}));

const globalSettings = oldSettings.map((s) => ({
  key: s.key,
  value: s.value,
  updated_at: toTimestamp(s.updatedAt),
}));

const auditLogs = oldAudit.map((a) => ({
  id: randomUUID(),
  tenant_id: a.tenantId ? tenantIdMap.get(a.tenantId) || null : null,
  action: a.action,
  details: tryParseJson(a.details),
  created_at: toTimestamp(a.createdAt),
}));

// ---------------------------------------------------------------------------
// Insert into Supabase Postgres
// ---------------------------------------------------------------------------

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("Connected to Supabase Postgres.");

try {
  await client.query("BEGIN");

  // -- Tenants --
  for (const t of tenants) {
    await client.query(
      `INSERT INTO public.tenants
        (id, user_id, slug, display_name, email, enabled, container_id, container_status,
         access_app_id, image, env_overrides, gateway_token, provider,
         last_health_check, last_health_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (slug) DO NOTHING`,
      [
        t.id, t.user_id, t.slug, t.display_name, t.email, t.enabled,
        t.container_id, t.container_status, t.access_app_id, t.image,
        t.env_overrides ? JSON.stringify(t.env_overrides) : null,
        t.gateway_token, t.provider,
        t.last_health_check, t.last_health_status, t.created_at, t.updated_at,
      ]
    );
  }
  console.log(`  Inserted ${tenants.length} tenants`);

  // -- VPS Instances --
  for (const v of vpsInstances) {
    if (!v.tenant_id) {
      console.warn(`  Skipping VPS instance ${v.id} — tenant not found in mapping`);
      continue;
    }
    await client.query(
      `INSERT INTO public.vps_instances
        (id, tenant_id, cloud, region, instance_id, machine_type, external_ip,
         tunnel_id, tunnel_token, git_tag, ssh_user, ssh_port, vm_status,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [
        v.id, v.tenant_id, v.cloud, v.region, v.instance_id, v.machine_type,
        v.external_ip, v.tunnel_id, v.tunnel_token, v.git_tag,
        v.ssh_user, v.ssh_port, v.vm_status, v.created_at, v.updated_at,
      ]
    );
  }
  console.log(`  Inserted ${vpsInstances.length} vps_instances`);

  // -- Global Settings --
  for (const s of globalSettings) {
    await client.query(
      `INSERT INTO public.global_settings (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [s.key, s.value, s.updated_at]
    );
  }
  console.log(`  Inserted ${globalSettings.length} global_settings`);

  // -- Audit Logs --
  for (const a of auditLogs) {
    await client.query(
      `INSERT INTO public.audit_logs (id, tenant_id, action, details, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        a.id, a.tenant_id, a.action,
        a.details ? JSON.stringify(a.details) : null,
        a.created_at,
      ]
    );
  }
  console.log(`  Inserted ${auditLogs.length} audit_logs`);

  await client.query("COMMIT");
  console.log("\nMigration complete!");

  // Print ID mapping for reference
  console.log("\nTenant ID mapping (old cuid → new uuid):");
  for (const [old, newId] of tenantIdMap) {
    const slug = oldTenants.find((t) => t.id === old)?.slug;
    console.log(`  ${slug}: ${old} → ${newId}`);
  }
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed, rolled back:", err);
  process.exit(1);
} finally {
  await client.end();
}
