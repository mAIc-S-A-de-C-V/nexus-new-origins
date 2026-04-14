#!/usr/bin/env bash
# Nexus database restore script — ISO 27001 Annex A.8.13
# Usage: ./restore.sh <backup_file> [nexus|nexus_events] [port]
set -euo pipefail

BACKUP_FILE="${1:-}"
DB_NAME="${2:-nexus}"
PG_USER="${POSTGRES_USER:-nexus}"
PG_PASS="${POSTGRES_PASSWORD:-nexus_pass}"
PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${3:-5432}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup_file> [nexus|nexus_events] [port]"
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

WORK_FILE="$BACKUP_FILE"

# Decrypt if encrypted (.enc extension)
if [[ "$BACKUP_FILE" == *.enc ]]; then
  if [[ -z "$BACKUP_ENCRYPTION_KEY" ]]; then
    echo "ERROR: Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set"
    exit 1
  fi
  WORK_FILE="${BACKUP_FILE%.enc}.dec.tmp"
  echo "Decrypting backup..."
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -d \
    -pass "pass:$BACKUP_ENCRYPTION_KEY" \
    -in "$BACKUP_FILE" -out "$WORK_FILE"
  echo "Decryption complete"
fi

echo "[$(date -u +%FT%TZ)] Restoring $DB_NAME from $BACKUP_FILE..."
PGPASSWORD="$PG_PASS" pg_restore \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" \
  --clean --if-exists -F c "$WORK_FILE"

# Clean up temp file
[[ "$WORK_FILE" == *.dec.tmp ]] && rm -f "$WORK_FILE"

echo "[$(date -u +%FT%TZ)] Restore complete."
