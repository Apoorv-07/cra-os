#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Nightly backup: database + evidence storage.
#
# The database is backed up with SQLite's own backup API, which is safe against
# an in-flight write. Copying cra.db with `cp` while the app is running is NOT
# safe — WAL files can change mid-copy.
#
#   sudo install -m 0755 infra/backup.sh /usr/local/bin/cra-backup
#   # cron, 03:15 every night:
#   15 3 * * * cra /usr/local/bin/cra-backup >> /var/log/cra-backup.log 2>&1
# ---------------------------------------------------------------------------
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/cra}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cra}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

DB="$DATA_DIR/cra.db"
if [ ! -f "$DB" ]; then
  echo "[$(date -u +%FT%TZ)] no database at $DB — nothing to back up" >&2
  exit 1
fi

# 1. Database, via the online backup API (safe while the app is running).
sqlite3 "$DB" ".backup '$BACKUP_DIR/cra-$STAMP.db'"

# 2. Evidence and SBOM storage. These are content-addressed and immutable, so a
#    tar is equivalent to a snapshot.
if [ -d "$DATA_DIR/storage" ]; then
  tar -czf "$BACKUP_DIR/cra-storage-$STAMP.tar.gz" -C "$DATA_DIR" storage
fi

# 3. Verify: a backup that cannot be read is not a backup.
sqlite3 "$BACKUP_DIR/cra-$STAMP.db" 'PRAGMA integrity_check;' | grep -q '^ok$' \
  || { echo "[$(date -u +%FT%TZ)] INTEGRITY CHECK FAILED for cra-$STAMP.db" >&2; exit 1; }

# 4. Retention.
find "$BACKUP_DIR" -name 'cra-*' -type f -mtime "+${KEEP_DAYS}" -delete

echo "[$(date -u +%FT%TZ)] backup complete: cra-$STAMP.db ($(du -h "$BACKUP_DIR/cra-$STAMP.db" | cut -f1))"
