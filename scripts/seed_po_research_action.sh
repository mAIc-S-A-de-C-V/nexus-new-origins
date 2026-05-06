#!/usr/bin/env bash
# Seeds the `po_research_memo` action template — the structured "memo to a
# human" the po_researcher agent will propose for each new purchase order.
#
# Run after the scraping_service + agent_service tools are deployed.
#
#   TENANT=tenant-e31788fd ./scripts/seed_po_research_action.sh
#
# Idempotent: posts to /actions, ignores 409 conflict (action already exists).
set -euo pipefail

TENANT="${TENANT:?TENANT env var required (e.g. tenant-e31788fd)}"
ONTOLOGY_URL="${ONTOLOGY_URL:-http://localhost:8004}"

read -r -d '' BODY <<'JSON' || true
{
  "name": "po_research_memo",
  "description": "Researched-PO memo proposed by the agent: which suppliers were found for this part, at what price/lead time, and a recommendation for the buyer. Lands in the Human Actions queue with requires_confirmation=true so a human approves before any further automation.",
  "requires_confirmation": true,
  "enabled": true,
  "input_schema": {
    "pr_number": "string",
    "mfg_part_number": "string",
    "part_desc": "string",
    "requested_qty": "string",
    "requested_priority": "string",
    "sources": "array",
    "recommendation": "string",
    "confidence": "string",
    "reasoning": "string"
  }
}
JSON

echo "Seeding action po_research_memo for tenant=$TENANT…"
HTTP_CODE=$(curl -s -o /tmp/seed_action.out -w "%{http_code}" \
  -X POST "$ONTOLOGY_URL/actions" \
  -H "x-tenant-id: $TENANT" \
  -H "Content-Type: application/json" \
  -d "$BODY")

case "$HTTP_CODE" in
  20*) echo "  created (HTTP $HTTP_CODE)";;
  409) echo "  already exists (HTTP 409) — leaving it alone";;
  *)   echo "  FAILED HTTP $HTTP_CODE"; cat /tmp/seed_action.out; exit 1;;
esac

echo "Done. Verify with:"
echo "  curl -s -H 'x-tenant-id: $TENANT' $ONTOLOGY_URL/actions/po_research_memo | python3 -m json.tool"
