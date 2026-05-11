#!/usr/bin/env bash
# Boot the apps-service, run the smoke test, surface failures.
#
# Usage:
#   scripts/apps_e2e.sh
#
# Assumes Postgres is reachable on localhost:5432 and the apps-service container
# is already up (or you've started it manually with `docker compose up apps-service`).
set -euo pipefail

APPS_URL="${NEXUS_APPS_URL:-http://localhost:8028}"

echo "→ health check $APPS_URL/health"
for i in {1..30}; do
  if curl -fsS "$APPS_URL/health" >/dev/null 2>&1; then
    echo "  service up"
    break
  fi
  echo "  not ready yet ($i/30)"
  sleep 1
done

cd "$(dirname "$0")/.."
python3 backend/apps_service/smoke_test.py "$APPS_URL"
