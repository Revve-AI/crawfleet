import { Storage, Bucket } from "@google-cloud/storage";
import { readdirSync, statSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import path from "path";
import { DATA_DIR, BACKUP_BUCKET, BACKUP_INTERVAL_MS } from "./constants";

let intervalId: ReturnType<typeof setInterval> | null = null;

const SKIP_EXTENSIONS = new Set([".lock", ".tmp"]);
const SKIP_DIRS = new Set(["media"]);
const SQLITE_EXTENSIONS = new Set([".sqlite", ".sqlite-wal", ".sqlite-shm"]);
const TMP_SQLITE_DIR = "/tmp/sqlite-backup";

function getStorage(): Storage {
  return new Storage();
}

function walkDir(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      results.push(...walkDir(fullPath, base));
    } else {
      const ext = path.extname(entry).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) continue;
      // Skip live SQLite files — they get backed up separately via sqlite3 .backup
      if (SQLITE_EXTENSIONS.has(ext)) continue;
      results.push(fullPath);
    }
  }
  return results;
}

function discoverSqliteDbs(openclawDir: string): string[] {
  const memoryDir = path.join(openclawDir, "memory");
  const dbs: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(memoryDir);
  } catch {
    return dbs;
  }
  for (const entry of entries) {
    if (entry.endsWith(".sqlite")) {
      dbs.push(path.join(memoryDir, entry));
    }
  }
  return dbs;
}

function safeSqliteBackup(srcDb: string, destPath: string): void {
  mkdirSync(path.dirname(destPath), { recursive: true });
  execFileSync("sqlite3", [srcDb, `.backup '${destPath}'`], {
    timeout: 30_000,
  });
}

interface GcsObjectMeta {
  name: string;
  size: number;
  mtimeMs: number;
}

async function listRemoteObjects(
  bucket: Bucket,
  prefix: string
): Promise<Map<string, GcsObjectMeta>> {
  const map = new Map<string, GcsObjectMeta>();
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) {
    const meta = file.metadata;
    map.set(file.name, {
      name: file.name,
      size: parseInt(meta.size as string, 10) || 0,
      mtimeMs: meta.metadata?.["local-mtime"]
        ? parseInt(meta.metadata["local-mtime"] as string, 10)
        : 0,
    });
  }
  return map;
}

async function syncToGcs(
  bucket: Bucket,
  localFiles: string[],
  localBase: string,
  remotePrefix: string
): Promise<{ uploaded: number; skipped: number; deleted: number }> {
  const stats = { uploaded: 0, skipped: 0, deleted: 0 };
  const remoteObjects = await listRemoteObjects(bucket, remotePrefix);
  const localRemoteKeys = new Set<string>();

  for (const localPath of localFiles) {
    const relativePath = path.relative(localBase, localPath);
    const remoteKey = `${remotePrefix}${relativePath}`;
    localRemoteKeys.add(remoteKey);

    const localStat = statSync(localPath);
    const remote = remoteObjects.get(remoteKey);

    // Skip if remote exists with same size and mtime
    if (
      remote &&
      remote.size === localStat.size &&
      remote.mtimeMs === Math.floor(localStat.mtimeMs)
    ) {
      stats.skipped++;
      continue;
    }

    await bucket.upload(localPath, {
      destination: remoteKey,
      metadata: {
        metadata: {
          "local-mtime": String(Math.floor(localStat.mtimeMs)),
        },
      },
    });
    stats.uploaded++;
  }

  // Delete stale remote objects that no longer exist locally
  for (const [remoteKey] of remoteObjects) {
    if (!localRemoteKeys.has(remoteKey)) {
      await bucket.file(remoteKey).delete().catch(() => {});
      stats.deleted++;
    }
  }

  return stats;
}

async function backupTenant(
  bucket: Bucket,
  slug: string,
  openclawDir: string
): Promise<void> {
  const prefix = `${slug}/`;

  // 1. Walk non-SQLite files
  const files = walkDir(openclawDir);

  // 2. Safe-copy SQLite databases
  const sqliteDbs = discoverSqliteDbs(openclawDir);
  const tmpSlugDir = path.join(TMP_SQLITE_DIR, slug);
  const sqliteBackupFiles: string[] = [];

  for (const db of sqliteDbs) {
    const relPath = path.relative(openclawDir, db);
    const destPath = path.join(tmpSlugDir, relPath);
    try {
      safeSqliteBackup(db, destPath);
      sqliteBackupFiles.push(destPath);
    } catch (err) {
      console.error(
        `[backup] SQLite backup failed for ${slug}/${relPath}:`,
        err
      );
    }
  }

  // 3. Sync regular files
  const fileStats = await syncToGcs(bucket, files, openclawDir, `${prefix}files/`);

  // 4. Sync SQLite backup copies
  let sqliteStats = { uploaded: 0, skipped: 0, deleted: 0 };
  if (sqliteBackupFiles.length > 0) {
    sqliteStats = await syncToGcs(
      bucket,
      sqliteBackupFiles,
      tmpSlugDir,
      `${prefix}sqlite/`
    );
  }

  // 5. Write backup marker
  const marker = JSON.stringify({
    last_backup: new Date().toISOString(),
    slug,
    files: fileStats,
    sqlite: sqliteStats,
  });
  await bucket.file(`${prefix}backup-marker.json`).save(marker, {
    contentType: "application/json",
  });

  // 6. Clean up temp SQLite copies
  try {
    rmSync(tmpSlugDir, { recursive: true, force: true });
  } catch {}

  console.log(
    `[backup] ${slug}: ${fileStats.uploaded + sqliteStats.uploaded} uploaded, ` +
      `${fileStats.skipped + sqliteStats.skipped} skipped, ` +
      `${fileStats.deleted + sqliteStats.deleted} deleted`
  );
}

export async function backupAllTenants(): Promise<void> {
  if (!BACKUP_BUCKET) return;

  const tenantsDir = path.resolve(DATA_DIR, "tenants");
  let slugs: string[];
  try {
    slugs = readdirSync(tenantsDir).filter((entry) => {
      try {
        return statSync(path.join(tenantsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (err) {
    console.error("[backup] Cannot read tenants directory:", err);
    return;
  }

  if (slugs.length === 0) {
    console.log("[backup] No tenants found, skipping");
    return;
  }

  console.log(`[backup] Starting backup for ${slugs.length} tenant(s)`);
  const storage = getStorage();
  const bucket = storage.bucket(BACKUP_BUCKET);

  for (const slug of slugs) {
    const openclawDir = path.join(tenantsDir, slug, ".openclaw");
    try {
      statSync(openclawDir);
    } catch {
      continue; // No .openclaw dir for this tenant
    }

    try {
      await backupTenant(bucket, slug, openclawDir);
    } catch (err) {
      console.error(`[backup] Failed for tenant ${slug}:`, err);
    }
  }

  console.log("[backup] Backup run complete");
}

export function startBackupMonitor(
  intervalMs: number = BACKUP_INTERVAL_MS
): void {
  if (intervalId) return;
  // Run first backup after a short delay to let the server settle
  setTimeout(() => backupAllTenants().catch(console.error), 10_000);
  intervalId = setInterval(
    () => backupAllTenants().catch(console.error),
    intervalMs
  );
}

export function stopBackupMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
