#!/usr/bin/env bash
# Replay BPIC 2019 purchase-order events into Nexus webhook connectors.
#
# Stamps timestamp = now() so live alert rules (stuck_case, slow_transition,
# rework_spike, case_volume_anomaly) fire on the replayed events while the
# historical bulk-loaded data sits frozen in 2018.
#
# Usage:
#   ./replay-po-events.sh <mode> <count> [delay_seconds]
#
# Modes:
#   srm       Replay SRM approval events (SRM:* activities)
#   invoice   Replay vendor portal invoice events (Vendor creates *)
#   maverick  Replay Goods Receipt events with no upstream SRM approval
#   stuck     Replay Set Payment Block events (cases sit and trip stuck_case)
#
# Examples:
#   ./replay-po-events.sh srm 20 1        # 20 SRM events, 1s apart
#   ./replay-po-events.sh invoice 10 0.5  # 10 vendor invoices, 0.5s apart
#   ./replay-po-events.sh maverick 5 2    # 5 maverick POs, 2s apart
#   ./replay-po-events.sh stuck 3 1       # 3 stuck cases, 1s apart

set -euo pipefail

# ── EDIT THESE FOUR LINES AFTER CREATING THE WEBHOOK CONNECTORS IN THE UI ──
SRM_SLUG="paste-srm-slug-here"
SRM_SECRET="paste-srm-secret-here"
INVOICE_SLUG="paste-invoice-slug-here"
INVOICE_SECRET="paste-invoice-secret-here"
# ────────────────────────────────────────────────────────────────────────────

DEMO_BASE="${DEMO_BASE:-http://localhost:8024}"
NEXUS_BASE="${NEXUS_BASE:-http://localhost:8001}"
DATASET="bpic2019-purchase-orders"

mode="${1:-}"
count="${2:-10}"
delay="${3:-1}"

if [[ -z "$mode" ]]; then
  echo "usage: $0 <srm|invoice|maverick|stuck> <count> [delay_seconds]"
  exit 1
fi

# Sanity: required CLI tools
for tool in curl jq openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required but not installed" >&2
    exit 1
  fi
done

case "$mode" in
  srm)
    SLUG="$SRM_SLUG"; SECRET="$SRM_SECRET"
    ACTIVITY_FILTER="SRM:"
    ;;
  invoice)
    SLUG="$INVOICE_SLUG"; SECRET="$INVOICE_SECRET"
    ACTIVITY_FILTER="Vendor creates"
    ;;
  maverick)
    SLUG="$SRM_SLUG"; SECRET="$SRM_SECRET"
    ACTIVITY_FILTER="Record Goods Receipt"
    ;;
  stuck)
    SLUG="$SRM_SLUG"; SECRET="$SRM_SECRET"
    ACTIVITY_FILTER="Set Payment Block"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 1
    ;;
esac

if [[ "$SLUG" == paste-* || "$SECRET" == paste-* ]]; then
  echo "error: edit the script and replace the paste-*-here placeholders with your real webhook slug + secret" >&2
  exit 1
fi

# Pull a page of records matching the activity filter.
# filter_op=contains so "SRM:" matches all SRM:* activities.
records=$(curl -fsS "$DEMO_BASE/datasets/$DATASET/records?limit=$count&filter_field=activity&filter_value=$ACTIVITY_FILTER&filter_op=contains" \
  | jq -c '.records[]')

if [[ -z "$records" ]]; then
  echo "no records matched filter '$ACTIVITY_FILTER' — is demo-service up at $DEMO_BASE?" >&2
  exit 1
fi

i=0
while IFS= read -r row; do
  i=$((i+1))

  # Stamp timestamp = now (UTC, ISO-8601 with Z suffix)
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  payload=$(echo "$row" | jq --arg now "$now" '.timestamp = $now')

  # HMAC SHA-256 signature (matches webhook receiver verification)
  sig=$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

  resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$NEXUS_BASE/connectors/webhooks/receive/$SLUG" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$sig" \
    --data "$payload")

  case_id=$(echo "$payload" | jq -r '.case_id')
  activity=$(echo "$payload" | jq -r '.activity')
  printf "[%2d/%d] HTTP %s  %s  %s\n" "$i" "$count" "$resp" "$case_id" "$activity"

  sleep "$delay"
done <<< "$records"

echo "Done — replayed $i $mode event(s)."
