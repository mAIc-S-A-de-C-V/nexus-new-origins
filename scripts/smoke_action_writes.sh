#!/usr/bin/env bash
# Smoke-test the action write-execution path in ontology_service.
#
# Exercises the three real paths that backend/ontology_service/routers/actions.py
# now supports:
#
#   1. requires_confirmation=false + writes_to_object_type + also_writes
#      → primary record + secondary event-log row both written in one call,
#        with `$inputs.id` resolved in the secondary's payload_template.
#   2. requires_confirmation=false + op=delete  → record removed.
#   3. requires_confirmation=true + confirm    → no record on propose;
#      record materializes only after /confirm.
#
# Run against a running stack (docker-compose up or local uvicorn):
#
#   TENANT=tenant-001 ./scripts/smoke_action_writes.sh
#
# If ontology_service is started with SKIP_AUTH=1 (the local-dev default)
# no token is needed. Otherwise pass AUTH_TOKEN=<jwt>.

set -euo pipefail

TENANT="${TENANT:-tenant-001}"
ONTOLOGY_URL="${ONTOLOGY_URL:-http://localhost:8004}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

# Suffix lets us re-run without colliding on the unique action name.
SUFFIX="$(date +%s)-$$"

DEAL_OT_NAME="smoke_deal_${SUFFIX}"
EVT_OT_NAME="smoke_event_${SUFFIX}"
ACTION_CREATE="smoke_create_deal_${SUFFIX}"
ACTION_DELETE="smoke_delete_deal_${SUFFIX}"
ACTION_PENDING="smoke_create_deal_pending_${SUFFIX}"

# Captured ids — populated as we go, used on cleanup.
DEAL_OT_ID=""
EVT_OT_ID=""
CREATED_DEAL_ID=""

# ── helpers ─────────────────────────────────────────────────────────────────

hdrs=(-H "x-tenant-id: ${TENANT}" -H "Content-Type: application/json")
if [[ -n "${AUTH_TOKEN}" ]]; then
  hdrs+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

req() {
  # req METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "${method}" "${hdrs[@]}" "${ONTOLOGY_URL}${path}")
  if [[ -n "${body}" ]]; then
    args+=(-d "${body}")
  fi
  curl "${args[@]}"
}

req_code() {
  # req_code METHOD PATH [BODY]  → prints just the HTTP status, leaves body in /tmp/sw.out
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -o /tmp/sw.out -w "%{http_code}" -X "${method}" "${hdrs[@]}" "${ONTOLOGY_URL}${path}")
  if [[ -n "${body}" ]]; then
    args+=(-d "${body}")
  fi
  curl "${args[@]}"
}

# Pull a top-level JSON field (string) from /tmp/sw.out without needing jq.
json_field() {
  python3 -c "import json,sys; print(json.load(open('/tmp/sw.out')).get('$1',''))"
}

# Pull from arbitrary captured body.
json_from() {
  python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('$1',''))"
}

step() { printf "\n▎ %s\n" "$*"; }
fail() { printf "  ✗ %s\n" "$*" >&2; exit 1; }
ok()   { printf "  ✓ %s\n" "$*"; }

cleanup() {
  set +e
  step "Cleanup"
  req DELETE "/actions/${ACTION_CREATE}"  >/dev/null 2>&1 && ok "deleted action ${ACTION_CREATE}"  || true
  req DELETE "/actions/${ACTION_DELETE}"  >/dev/null 2>&1 && ok "deleted action ${ACTION_DELETE}"  || true
  req DELETE "/actions/${ACTION_PENDING}" >/dev/null 2>&1 && ok "deleted action ${ACTION_PENDING}" || true
  if [[ -n "${DEAL_OT_ID}" ]]; then
    req DELETE "/object-types/${DEAL_OT_ID}" >/dev/null 2>&1 && ok "deleted ot ${DEAL_OT_NAME}" || true
  fi
  if [[ -n "${EVT_OT_ID}" ]]; then
    req DELETE "/object-types/${EVT_OT_ID}" >/dev/null 2>&1 && ok "deleted ot ${EVT_OT_NAME}" || true
  fi
}
trap cleanup EXIT

# ── 0. seed object types ────────────────────────────────────────────────────

step "Seeding object types"

CODE=$(req_code POST "/object-types" "{\"name\":\"${DEAL_OT_NAME}\",\"display_name\":\"Smoke Deal\"}")
[[ "${CODE}" == "201" ]] || { cat /tmp/sw.out; fail "create deal ot HTTP ${CODE}"; }
DEAL_OT_ID=$(json_field id)
ok "deal ot ${DEAL_OT_ID}"

CODE=$(req_code POST "/object-types" "{\"name\":\"${EVT_OT_NAME}\",\"display_name\":\"Smoke Event Log\"}")
[[ "${CODE}" == "201" ]] || { cat /tmp/sw.out; fail "create event ot HTTP ${CODE}"; }
EVT_OT_ID=$(json_field id)
ok "event ot ${EVT_OT_ID}"

# ── 1. seed action defs ─────────────────────────────────────────────────────

step "Seeding action definitions"

cat >/tmp/sw.body <<JSON
{
  "name": "${ACTION_CREATE}",
  "requires_confirmation": false,
  "enabled": true,
  "writes_to_object_type": "${DEAL_OT_ID}",
  "input_schema": {"name":"string","amount":"number"},
  "also_writes": [{
    "object_type": "${EVT_OT_ID}",
    "payload_template": {
      "kind": "deal_created",
      "deal_id": "\$inputs.id",
      "label": "created \$inputs.name"
    },
    "payload_static": {"source": "smoke"}
  }]
}
JSON
CODE=$(req_code POST "/actions" "$(cat /tmp/sw.body)")
[[ "${CODE}" == "201" ]] || { cat /tmp/sw.out; fail "create action HTTP ${CODE}"; }
ok "action ${ACTION_CREATE}"

cat >/tmp/sw.body <<JSON
{
  "name": "${ACTION_DELETE}",
  "requires_confirmation": false,
  "enabled": true,
  "writes_to_object_type": "${DEAL_OT_ID}",
  "input_schema": {"id":"string"}
}
JSON
CODE=$(req_code POST "/actions" "$(cat /tmp/sw.body)")
[[ "${CODE}" == "201" ]] || { cat /tmp/sw.out; fail "create delete-action HTTP ${CODE}"; }
ok "action ${ACTION_DELETE}"

cat >/tmp/sw.body <<JSON
{
  "name": "${ACTION_PENDING}",
  "requires_confirmation": true,
  "enabled": true,
  "writes_to_object_type": "${DEAL_OT_ID}",
  "input_schema": {"name":"string"}
}
JSON
CODE=$(req_code POST "/actions" "$(cat /tmp/sw.body)")
[[ "${CODE}" == "201" ]] || { cat /tmp/sw.out; fail "create pending-action HTTP ${CODE}"; }
ok "action ${ACTION_PENDING}"

# ── 2. scenario A: immediate create + also_writes ───────────────────────────

step "A) Immediate execute with also_writes"

BODY='{"inputs":{"name":"Acme Corp","amount":12345}}'
CODE=$(req_code POST "/actions/${ACTION_CREATE}/execute" "${BODY}")
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "execute HTTP ${CODE}"; }

STATUS=$(json_field status)
[[ "${STATUS}" == "completed" ]] || { cat /tmp/sw.out; fail "expected status=completed, got ${STATUS}"; }
ok "execution completed"

# Inspect result: should have record_id + one secondary_write.
RESULT_REC_ID=$(python3 -c "import json; r=json.load(open('/tmp/sw.out')); print(r['result']['record_id'])")
SEC_COUNT=$(python3 -c "import json; r=json.load(open('/tmp/sw.out')); print(len(r['result'].get('secondary_writes',[])))")
[[ -n "${RESULT_REC_ID}" ]] || fail "no record_id in result"
[[ "${SEC_COUNT}" == "1" ]] || fail "expected 1 secondary write, got ${SEC_COUNT}"
CREATED_DEAL_ID="${RESULT_REC_ID}"
ok "primary record ${RESULT_REC_ID}, ${SEC_COUNT} secondary"

# Verify the deal row exists.
CODE=$(req_code GET "/object-types/${DEAL_OT_ID}/records?limit=10")
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "list deal records HTTP ${CODE}"; }
COUNT=$(python3 -c "
import json
rows = json.load(open('/tmp/sw.out'))
if isinstance(rows, dict):
    rows = rows.get('records', [])
hits = [r for r in rows if r.get('source_id') == '${RESULT_REC_ID}']
print(len(hits))
")
[[ "${COUNT}" == "1" ]] || { cat /tmp/sw.out; fail "expected 1 matching deal row, got ${COUNT}"; }
ok "deal row materialized"

# Verify the event-log row references the deal_id. The /records endpoint
# flattens the stored `data` blob into the row itself, so deal_id lives at
# the top level of each record.
CODE=$(req_code GET "/object-types/${EVT_OT_ID}/records?limit=10")
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "list event records HTTP ${CODE}"; }
HIT=$(python3 -c "
import json
rows = json.load(open('/tmp/sw.out'))
if isinstance(rows, dict):
    rows = rows.get('records', [])
hits = [r for r in rows if r.get('deal_id') == '${RESULT_REC_ID}']
print(len(hits))
")
[[ "${HIT}" == "1" ]] || { cat /tmp/sw.out; fail "expected event row with deal_id=${RESULT_REC_ID}, got ${HIT}"; }
ok "event-log row references deal"

# ── 3. scenario B: delete ───────────────────────────────────────────────────

step "B) Delete via op=delete"

BODY="{\"inputs\":{\"id\":\"${CREATED_DEAL_ID}\",\"op\":\"delete\"}}"
CODE=$(req_code POST "/actions/${ACTION_DELETE}/execute" "${BODY}")
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "delete-execute HTTP ${CODE}"; }
STATUS=$(json_field status)
[[ "${STATUS}" == "completed" ]] || { cat /tmp/sw.out; fail "expected status=completed, got ${STATUS}"; }
ok "delete execution completed"

CODE=$(req_code GET "/object-types/${DEAL_OT_ID}/records?limit=10")
GONE=$(python3 -c "
import json
rows = json.load(open('/tmp/sw.out'))
if isinstance(rows, dict):
    rows = rows.get('records', [])
hits = [r for r in rows if r.get('source_id') == '${CREATED_DEAL_ID}']
print(len(hits))
")
[[ "${GONE}" == "0" ]] || { cat /tmp/sw.out; fail "deal row still present after delete"; }
ok "deal row removed"

# ── 4. scenario C: pending → confirm ────────────────────────────────────────

step "C) Pending confirmation → confirm → write"

BODY='{"inputs":{"name":"Pending Corp"},"executed_by":"smoke"}'
CODE=$(req_code POST "/actions/${ACTION_PENDING}/execute" "${BODY}")
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "propose HTTP ${CODE}"; }
PENDING_ID=$(json_field id)
STATUS=$(json_field status)
[[ "${STATUS}" == "pending_confirmation" ]] || { cat /tmp/sw.out; fail "expected pending_confirmation, got ${STATUS}"; }
ok "proposal id=${PENDING_ID}"

# Confirm the lack of write before approval — record count for this deal name = 0.
CODE=$(req_code GET "/object-types/${DEAL_OT_ID}/records?limit=50")
PRE=$(python3 -c "
import json
rows = json.load(open('/tmp/sw.out'))
if isinstance(rows, dict):
    rows = rows.get('records', [])
hits = [r for r in rows if r.get('name') == 'Pending Corp']
print(len(hits))
")
[[ "${PRE}" == "0" ]] || fail "row already exists before confirm — write must not run on propose"
ok "no row written on propose"

CODE=$(req_code POST "/actions/executions/${PENDING_ID}/confirm" '{"confirmed_by":"smoke-tester"}')
[[ "${CODE}" == "200" ]] || { cat /tmp/sw.out; fail "confirm HTTP ${CODE}"; }
STATUS=$(json_field status)
[[ "${STATUS}" == "completed" ]] || { cat /tmp/sw.out; fail "expected completed after confirm, got ${STATUS}"; }
ok "execution completed after confirm"

CODE=$(req_code GET "/object-types/${DEAL_OT_ID}/records?limit=50")
POST=$(python3 -c "
import json
rows = json.load(open('/tmp/sw.out'))
if isinstance(rows, dict):
    rows = rows.get('records', [])
hits = [r for r in rows if r.get('name') == 'Pending Corp']
print(len(hits))
")
[[ "${POST}" == "1" ]] || { cat /tmp/sw.out; fail "expected 1 row after confirm, got ${POST}"; }
ok "row materialized after confirm"

printf "\nAll smoke checks passed.\n"
