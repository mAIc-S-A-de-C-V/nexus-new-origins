#!/usr/bin/env bash
# Nexus database backup script — ISO 27001 Annex A.8.13
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexus}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PG_USER="${POSTGRES_USER:-nexus}"
PG_PASS="${POSTGRES_PASSWORD:-nexus_pass}"
PG_HOST="${POSTGRES_HOST:-localhost}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

encrypt_file() {
    local src="$1" dst="$2"
    if [[ -n "$BACKUP_ENCRYPTION_KEY" ]]; then
        openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
            -pass "pass:$BACKUP_ENCRYPTION_KEY" \
            -in "$src" -out "$dst"
        rm -f "$src"
        log "Encrypted: $(basename $dst)"
    else
        mv "$src" "$dst"
        log "WARNING: BACKUP_ENCRYPTION_KEY not set — backup NOT encrypted"
    fi
}

log "Starting Nexus backup (timestamp: $TIMESTAMP)..."

# Backup main postgres
PGPASSWORD="$PG_PASS" pg_dump \
  -h "$PG_HOST" -p 5432 -U "$PG_USER" -d nexus \
  -F c -f "${BACKUP_DIR}/nexus_${TIMESTAMP}.pgdump.tmp"

encrypt_file \
  "${BACKUP_DIR}/nexus_${TIMESTAMP}.pgdump.tmp" \
  "${BACKUP_DIR}/nexus_${TIMESTAMP}.pgdump$( [[ -n "$BACKUP_ENCRYPTION_KEY" ]] && echo ".enc" || echo "" )"

log "nexus db backed up"

# Backup timescale
PGPASSWORD="$PG_PASS" pg_dump \
  -h "${TIMESCALE_HOST:-localhost}" -p 5434 -U "$PG_USER" -d nexus_events \
  -F c -f "${BACKUP_DIR}/nexus_events_${TIMESTAMP}.pgdump.tmp"

encrypt_file \
  "${BACKUP_DIR}/nexus_events_${TIMESTAMP}.pgdump.tmp" \
  "${BACKUP_DIR}/nexus_events_${TIMESTAMP}.pgdump$( [[ -n "$BACKUP_ENCRYPTION_KEY" ]] && echo ".enc" || echo "" )"

log "nexus_events db backed up"

# Verify backup files exist and are non-empty
for f in "$BACKUP_DIR"/*"${TIMESTAMP}"*; do
    if [[ ! -s "$f" ]]; then
        log "ERROR: Backup file is empty or missing: $f"
        exit 1
    fi
    log "Verified: $(basename $f) ($(du -h $f | cut -f1))"
done

# Purge old backups
find "$BACKUP_DIR" -name "*.pgdump*" -mtime +"$RETENTION_DAYS" -delete
log "Purged backups older than ${RETENTION_DAYS} days"

log "Backup complete."
