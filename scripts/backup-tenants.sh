#!/bin/bash
# backup-tenants.sh — Sync each tenant's OpenClaw data to a GCS bucket.
#
# Usage:
#   ./scripts/backup-tenants.sh <bucket-name> [data-dir]
#
# Each tenant gets its own folder: gs://BUCKET/{slug}/
# Runs gsutil rsync with -d (mirror delete) so the bucket matches local state.
# Excludes lock files, tmp files, and live SQLite journals (WAL/SHM).
#
# Safe to run while containers are active — gsutil copies files atomically.
# For SQLite databases, the .sqlite file itself is copied (WAL is excluded).
#
# Install on the server via crontab:
#   crontab -e
#   */15 * * * * /home/USER/openclaw-fleet/scripts/backup-tenants.sh BUCKET_NAME >> /tmp/backup-tenants.log 2>&1

set -euo pipefail

BUCKET="${1:-}"
DATA_DIR="${2:-${HOME}/openclaw-fleet/data/tenants}"

if [ -z "$BUCKET" ]; then
  echo "Usage: $0 <bucket-name> [data-dir]"
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "[backup] No tenants dir at $DATA_DIR — nothing to back up"
  exit 0
fi

TENANT_COUNT=0
FAIL_COUNT=0

for dir in "$DATA_DIR"/*/; do
  [ -d "$dir" ] || continue
  slug=$(basename "$dir")
  openclaw_dir="$dir.openclaw"

  if [ ! -d "$openclaw_dir" ]; then
    continue
  fi

  TENANT_COUNT=$((TENANT_COUNT + 1))
  echo "[backup][$slug] Syncing to gs://$BUCKET/$slug/ ..."

  if gsutil -m rsync -r -d \
    -x '.*\.lock$|.*\.tmp$|.*\.sqlite-wal$|.*\.sqlite-shm$|media/.*' \
    "$openclaw_dir/" "gs://$BUCKET/$slug/" 2>&1; then
    echo "[backup][$slug] Done"
  else
    echo "[backup][$slug] FAILED"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo "[backup] Finished: $TENANT_COUNT tenant(s), $FAIL_COUNT failure(s)"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
