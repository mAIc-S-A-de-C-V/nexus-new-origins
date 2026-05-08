# Demo: Live Procure-to-Pay Control Tower (BPIC 2019)

> **Purpose:** Sales- and teaching-grade demo showing Nexus ingesting procure-to-pay events from multiple "source systems," modeling them as a linked ontology, mining the process, alerting on deviations, and automating triage — all configured through the UI. Includes a tiny bash replay script that injects "live" events on cue during a sales call.
>
> **Persona / tenant:** `carlos@procurement.demo` / `Procure2024!demo` / `tenant-procurement`
**Volume:** 100,000 cases / **589,463 events** (generator default bumped from 5K → 100K). To go to 200K, see "Reality checks" below — needs more Docker Desktop memory.
> **Sibling doc:** `DEMO_WALKTHROUGH.md` (which has the static single-connector version)

---

## Reality checks (read first)

| Constraint | Why it matters | What we do |
|---|---|---|
| Generator now emits 100,000 cases × ~5.89 events ≈ **589K events** (`generators.py:190`). | Demo-service holds the full dataset in an `lru_cache` heap. | `mem_limit` raised from 384m → 1500m in `docker-compose.yml`. Peak ~400 MiB, plenty of headroom. First call after rebuild takes ~1-2s while the generator runs; subsequent calls are instant. |
| Docker Desktop on this host has only ~3.8 GB total — 32 containers already use ~2.6 GB at idle. | Single container can't realistically grow past ~1 GB without OOM. We tried 200K cases and got OOMKilled (ExitCode 137) twice, even with `mem_limit: 3g`. | If you want 200K cases (~1.17M events): Docker Desktop → Settings → Resources → Memory → bump to ≥8 GB → restart Docker → set `n_cases=200000` in `generators.py:190` and `mem_limit: 2g` for demo-service in `docker-compose.yml` → `docker-compose up -d --build demo-service`. |
| Generator timestamps start 2018-01-01. | `stuck_case` and `case_volume_anomaly` rules use `NOW() - timestamp`. Static historical data either all looks stuck or has no recent baseline. | Replay script stamps `timestamp = now()` so live events fire alerts cleanly while historical data sits frozen. |
| Alert engine has 4 rule types only: `stuck_case`, `slow_transition`, `rework_spike`, `case_volume_anomaly`. | No native "off-golden-path" rule. | Off-path detection lives in Logic Studio (`ontology_query` + `action` block) — surfaces as in-app Human Action. |
| Webhook `target_type` options: `pipeline`, `action`, `event_log`. | Live events need to land in the right object type. | Use `event_log` target — events flow into the event log and the existing pipeline picks them up. |

---

## Phase 0 — Pre-flight (5 min)

```bash
# From repo root
docker-compose up -d --build

# Wait for healthy
docker-compose ps | grep -v healthy   # should show only the postgres-init job, if anything
```

1. Open `http://localhost:3000`
2. Sign in as **`carlos@procurement.demo`** / `Procure2024!demo`
3. Confirm demo service: `http://localhost:8024/datasets/bpic2019-purchase-orders` should return the dataset metadata
4. **Settings → System Health** — every service green
5. **Settings → AI Models** — confirm at least one provider marked "Default for tenant" (Claude Sonnet 4.6 recommended)

---

## Phase 1 — Bulk historical load (15 min)

Tells the customer: *"This is your existing SAP ECC PO history — we bulk-loaded the last few years."*

### 1.1 Create the master REST connector

1. Left nav → **Connectors** → **+ Add Connector**
2. Pick **REST API**
3. Fill in:
   - **Name:** `SAP ECC — PO Master (Historical)`
   - **Description:** `Bulk extract of PO/GR/Invoice events from SAP ECC. One-time historical backfill.`
   - **Base URL:** `http://demo-service:8024`
   - **Auth Type:** None
4. Click **Add Connector**
5. In the detail panel → **Configuration** tab:
   - **Endpoint Path:** `/datasets/bpic2019-purchase-orders/records`
   - **Pagination:** offset-based (auto)
   - Click **Test** → expect ~14 fields including `case_id`, `activity`, `timestamp`, `vendor`, `company`, `cumulative_net_worth_eur`

### 1.2 Schema inference

1. **Schema** tab → **Run Inference**
2. Verify Claude's labels (semantic types):
   - `case_id` → IDENTIFIER (~98%)
   - `activity` → CATEGORY
   - `timestamp` → DATETIME
   - `vendor` → IDENTIFIER
   - `cumulative_net_worth_eur` → CURRENCY
   - `item_category`, `document_type`, `company`, `spend_area` → CATEGORY
   - `goods_receipt` → BOOLEAN
3. PII levels — all NONE (no personal data here, point this out as a sanity check)

### 1.3 Create the object type

1. Click **Create Object Type: PurchaseOrder** (rename if Claude suggests something else)
2. Confirm — Nexus auto-generates a pipeline `SAP ECC — PO Master → PurchaseOrder`

### 1.4 Run the pipeline

1. Left nav → **Pipelines**
2. Find the auto-generated pipeline
3. Click **Run** → watch DRAFT → RUNNING → IDLE. **This will take a few minutes** at 100K cases / 589K events through paginated REST sync (page size 200 = ~2,950 page calls). Grab coffee.
4. KPI banner: ~589K rows synced (100,000 cases)

### 1.5 Show the spaghetti

1. Left nav → **Data → Process Mining**
2. Select **PurchaseOrder**
3. **Settings tab:** Case ID = `case_id`, Activity = `activity`, Timestamp = `timestamp`
4. **Process Map tab** — let the customer see the unfiltered process. Point out the `Delete Purchase Order Item` outlier and the `Set/Remove Payment Block` loop.

---

## Phase 2 — Ontology modeling (15 min)

Tells the customer: *"A flat event log is fine for analysts. To run automations against business objects, we model them properly."*

### 2.1 Add Vendor object type

1. Left nav → **Ontology**
2. **+ Add Object Type** → name `Vendor`
3. Add properties manually:
   - `vendor_id` (IDENTIFIER, primary key)
   - `vendor_name` (TEXT) — optional
4. Save

### 2.2 Add GoodsReceipt and Invoice object types

Two ways: add a derived pipeline that filters by activity, or split via the connector. Easiest path uses pipelines:

1. **Pipelines → + New Pipeline** → name `Filter — GoodsReceipt events`
2. Drag nodes:
   - **SOURCE:** SAP ECC — PO Master
   - **FILTER:** `activity == "Record Goods Receipt"`
   - **SINK_OBJECT:** create new object type `GoodsReceipt` on save
3. Map fields → run
4. Repeat for **`Invoice`** with filter:
   - `activity in ("Record Invoice Receipt", "Vendor creates invoice", "Vendor creates debit memo", "Clear Invoice")`

### 2.3 Link the ontology

1. **Ontology** graph → click **PurchaseOrder** node → **Links** tab
2. Add:
   - `PurchaseOrder` → `Vendor` (BELONGS_TO, join `vendor` ↔ `vendor_id`)
   - `PurchaseOrder` → `GoodsReceipt` (HAS_MANY, join `case_id` ↔ `case_id`)
   - `PurchaseOrder` → `Invoice` (HAS_MANY, join `case_id` ↔ `case_id`)
3. Confirm edges visible in graph

> **Talking point:** "Now any automation or alert can reference 'POs whose Vendor is in the top 10 by spend' — that wasn't expressible against a flat event log."

---

## Phase 3 — Live connectors + replay script (25 min)

Tells the customer: *"Three more source systems push events as they happen — two ERP entities and a vendor portal."*

### 3.1 Live REST connector — Company 1000

1. **Connectors → + Add Connector → REST API**
2. **Name:** `SAP ECC — Company 1000 (EU)`
3. **Description:** `Incremental delta from the EU ERP entity.`
4. **Base URL:** `http://demo-service:8024`
5. Save → Configuration tab:
   - **Endpoint Path:** `/datasets/bpic2019-purchase-orders/records`
   - **Query params:** `filter_field=company`, `filter_value=Company_1000`
   - **Page size (limit):** `200`
   - **Test** → confirm only Company_1000 rows return

### 3.2 Schedule it

1. Left nav → **Schedules → + New Schedule**
2. Target the pipeline that syncs this connector → **PurchaseOrder**
3. Cron: `*/5 * * * *` (every 5 min)
4. Save & enable

### 3.3 Repeat for Company 2000

Same as 3.1–3.2 but `filter_value=Company_2000`, name `SAP ECC — Company 2000 (US)`.

### 3.4 Webhook connector — SRM approval events

1. **Connectors → + Add Connector → Custom Webhook**
2. **Name:** `SAP SRM — Approval Events`
3. **Target type:** `event_log` (events land in the event log keyed to `PurchaseOrder`)
4. **Target object type:** `PurchaseOrder`
5. **Field mappings** — only fill if the inbound JSON keys differ from object property names. For our replay script keys match, so leave empty.
6. **Secret:** generate one (copy it — the replay script reads it)
7. Save → **copy the slug** from the connector detail panel. Inbound URL is:
   ```
   http://localhost:8001/connectors/webhooks/receive/<slug>
   ```
   *(Port may differ — check `docker-compose.yml` for `connector-service`.)*

### 3.5 Webhook connector — Vendor invoice portal

Same as 3.4 but **Name:** `Vendor Invoice Portal`, with a different slug + secret.

### 3.6 Save the replay script

Drop this at `scripts/replay-po-events.sh` (full content in **Appendix A**). Make it executable:

```bash
chmod +x scripts/replay-po-events.sh
```

Edit the top of the script and paste in:
- `SRM_SLUG`, `SRM_SECRET`
- `INVOICE_SLUG`, `INVOICE_SECRET`
- `BASE_URL` (default `http://localhost:8001` — verify connector-service port in your compose file)

### 3.7 Smoke test

```bash
# Push 5 SRM events
./scripts/replay-po-events.sh srm 5

# Push 3 vendor invoice events
./scripts/replay-po-events.sh invoice 3
```

In the UI:
- **Connectors** → SAP SRM card → **Last received** should tick to "a few seconds ago"
- **Process Mining → PurchaseOrder → Cases** → filter by current month → see the new cases

---

## Phase 4 — Conformance + alerts (20 min)

Tells the customer: *"Now we lock down what 'good' looks like and alert when reality drifts."*

### 4.1 Define the golden path (Conformance)

1. **Process Mining → PurchaseOrder → Conformance tab**
2. **+ Define Reference Path:**
   ```
   Create Purchase Order Item
   → SRM: Awaiting Approval
   → Record Goods Receipt
   → Record Invoice Receipt
   → Clear Invoice
   → Record Payment
   ```
3. Save → conformance score appears (expect ~25-35% — most paths skip SRM approval)

### 4.2 Alert rule 1 — Stuck case

1. **Alerts → + New Rule**
2. **Name:** `PO stuck — no progress in 48h`
3. **Type:** `stuck_case`
4. **Object type:** `PurchaseOrder`
5. **Config:**
   - `threshold_hours: 48`
6. **Cooldown:** 60 min
7. **Test** → fires immediately on historical data (everything is "stuck"). That's expected — the **live drip is what keeps this rule meaningful in the demo**.
8. **Save & Enable**

### 4.3 Alert rule 2 — Slow PO → Payment

1. **Alerts → + New Rule**
2. **Name:** `PO-to-Payment exceeds 30d`
3. **Type:** `slow_transition`
4. **Object type:** `PurchaseOrder`
5. **Config:**
   - `from_activity: Create Purchase Order Item`
   - `to_activity: Record Payment`
   - `threshold_hours: 720` (30d)
6. Save & Enable

### 4.4 Alert rule 3 — Rework spike

1. **Alerts → + New Rule**
2. **Name:** `PO rework rate above 15%`
3. **Type:** `rework_spike`
4. **Object type:** `PurchaseOrder`
5. **Config:**
   - `threshold_pct: 15`
6. Save & Enable

### 4.5 Alert rule 4 — Volume drop

1. **Name:** `PO volume drop >50% vs baseline`
2. **Type:** `case_volume_anomaly`
3. **Object type:** `PurchaseOrder`
4. **Config:**
   - `window_hours: 24`
   - `min_drop_pct: 50`
5. Save & Enable
   > **Note:** This rule needs ~7 days of data to establish a baseline. It won't fire on day 0 — that's fine, just don't promise it during the call.

### 4.6 Notification channel

1. **Alerts → Channels tab**
2. **In-app notifications** → ON (default)
3. **Email / Slack** → leave OFF (per your decision)
4. Test fire — open the bell icon top-right, see the notification appear

---

## Phase 5 — Logic Studio automations (25 min)

Tells the customer: *"Detection isn't enough — Nexus runs the response."*

### 5.1 Function A — Maverick PO triage (off-golden-path)

This is the **deviation detector** — it fills the gap left by the alert engine not having an off-path rule type.

1. Left nav → **Logic Studio → + New Function**
2. **Name:** `Maverick PO Triage`
3. **Description:** `Find POs that skipped SRM approval but had goods receipts. Propose a Human Action for compliance review.`
4. **Trigger:** Schedule (we'll set after build)
5. Build blocks (in order):

   **Block 1 — `ontology_query`**
   - Object type: `PurchaseOrder`
   - Filter (DSL):
     ```
     activities.contains("Record Goods Receipt")
     AND NOT activities.contains("SRM: Awaiting Approval")
     AND document_type == "Standard PO"
     AND created_at > now() - 24h
     ```
   - Output variable: `maverick_pos`

   **Block 2 — `transform`** (filter to only meaningful spend)
   - Input: `maverick_pos`
   - Expression: `items.filter(po => po.cumulative_net_worth_eur > 5000)`
   - Output: `high_value_mavericks`

   **Block 3 — `llm_call`**
   - Input: `high_value_mavericks`
   - Prompt:
     ```
     For each maverick PO below, write a 2-line summary covering:
     vendor, amount (€), spend area, why this is risky.
     Be concrete. No generic boilerplate.

     POs: {{high_value_mavericks}}
     ```
   - Output: `triage_summaries`

   **Block 4 — `action`**
   - Action: `propose`
   - Action type: `compliance_review`
   - Title: `Maverick PO detected: {{po.case_id}} — {{po.vendor}}`
   - Body: `{{triage_summaries[i]}}`
   - Severity: `warning`
   - Loop over: `high_value_mavericks`

6. **Test Run** with sample input → review proposed Human Actions
7. **Schedule:** every 15 min during demo (set to 1h for prod)
8. **Publish & Enable**

### 5.2 Function B — Daily vendor concentration check

1. **Logic Studio → + New Function**
2. **Name:** `Vendor Concentration Watch`
3. Blocks:

   **Block 1 — `ontology_query`**
   - Object type: `PurchaseOrder`
   - Aggregation: `SUM(cumulative_net_worth_eur) GROUP BY vendor`
   - Window: last 7 days
   - Output: `vendor_spend`

   **Block 2 — `transform`**
   - Compute total_spend, then flag any vendor where `share > 0.30`
   - Output: `concentrated_vendors`

   **Block 3 — `conditional`**
   - If `concentrated_vendors.length > 0` → continue, else exit

   **Block 4 — `llm_call`**
   - Prompt:
     ```
     Summarize vendor concentration risk in 3 bullets, naming the
     vendors and their share of last-7-day spend. Recommend whether
     to flag for sourcing review.

     Concentrated vendors: {{concentrated_vendors}}
     ```

   **Block 5 — `action`**
   - Action: `propose`
   - Action type: `sourcing_review`
   - Title: `Vendor concentration: {{vendor.vendor_id}} = {{vendor.share_pct}}%`
   - Body: `{{llm_call.output}}`

4. **Schedule:** weekdays 8am
5. **Publish & Enable**

> **In-app surface:** Both functions emit Human Action proposals. They appear in **Operations → Human Actions** with the procurement persona's queue and ring the bell icon. No email needed.

---

## Phase 6 — Procurement Compliance Agent (15 min)

Tells the customer: *"We can also let an AI agent investigate ad-hoc."*

1. Left nav → **Agent Studio → + New Agent**
2. **Name:** `Procurement Compliance Auditor`
3. **System prompt:**
   ```
   You are a procurement compliance auditor. Your job is to investigate
   purchase order patterns for compliance risks: maverick buying (goods
   received before SRM approval), duplicate invoices for the same PO,
   vendor concentration, and unusual payment-block sequences.

   Use the available tools to query the ontology. When you find concerning
   patterns, propose Human Actions via action_propose with clear severity
   and reasoning. Cite specific PO IDs and vendor IDs in every claim.
   ```
4. **Model:** Claude Sonnet 4.6
5. **Max iterations:** 8
6. **Tools enabled:**
   - `list_object_types`
   - `get_object_schema`
   - `query_records`
   - `count_records`
   - `process_mining` (if available in your build)
   - `action_propose`
7. **Knowledge scope:** check `PurchaseOrder`, `Vendor`, `GoodsReceipt`, `Invoice`
8. **Save**

### Test runs (during demo)

Three ready-made prompts:
- *"Find the top 5 vendors by maverick PO count last 30 days."*
- *"Are there any POs with two `Record Invoice Receipt` events for the same case_id?"*
- *"Compare cycle time for Standard PO vs Framework Order document types and flag anomalies."*

Watch tool calls appear live → propose actions → check **Operations → Human Actions** queue.

---

## Phase 7 — Control tower dashboard (15 min)

Tells the customer: *"Here's what procurement leadership sees every morning."*

### 7.1 Generate the layout

1. Left nav → **Dashboards → + New Dashboard → Generate with Claude**
2. **Prompt:**
   ```
   Procure-to-pay control tower. Six widgets:
   1. Metric card: Total POs (current month)
   2. Metric card: 3-way match compliance %
   3. Bar chart: Top 15 vendors by spend (last 30d)
   4. Line chart: PO volume by week (12 weeks)
   5. Pie chart: Spend by company (Company_1000, 2000, 3000, 4000)
   6. Histogram: PO cycle time (days, Create→Payment)
   7. Data table: Recent maverick POs (last 7d) with vendor, amount, spend area
   8. Chat widget bottom-right
   ```
3. **Data sources:** check `PurchaseOrder`, `Vendor`, `Invoice`
4. Review layout → **Create App**

### 7.2 Pin the version

> Per project memory: pin app versions for shared demos.

1. App detail → **Versions** → publish v1 → mark **Pinned**

### 7.3 Wire the chat widget

1. Edit mode → click the Chat widget → **Config**
2. **Data sources:** all 4 object types
3. **Sibling widgets:** check all 7 above
4. Save

### Demo questions to ask the chat:
- *"What share of last quarter's spend went to V-001023?"*
- *"Which company has the highest maverick rate?"*
- *"Plot PO cycle time for Framework Order vs Standard PO."*

---

## Phase 8 — Demo choreography (the call script)

Roughly 12-minute live walkthrough.

| Beat | What you do | What customer sees |
|---|---|---|
| 0:00 | Open dashboard | Control tower at rest |
| 0:30 | "Three source systems feed this." Point at the four connectors | Connectors page, three live + one historical |
| 1:30 | "Let me show you what 'live' means." Run `./scripts/replay-po-events.sh srm 20 1` in a terminal alongside the browser | Connector "Last received" ticks; new cases appear |
| 3:00 | Switch to **Process Mining → Process Map** | Map updates, new edges appear |
| 4:00 | Open **Conformance** | Score drops as off-path events arrive |
| 5:00 | Run `./scripts/replay-po-events.sh maverick 5 1` | Maverick PO injection |
| 5:30 | Bell icon → notification fires from `stuck_case` / `rework_spike` | In-app alert |
| 6:30 | **Operations → Human Actions** | Logic Studio's `Maverick PO Triage` posted action proposals |
| 8:00 | Click into one → show LLM-generated explanation, vendor link, recommended action | Audit trail |
| 9:00 | Approve the action | Status changes, audit entry appended |
| 10:00 | **Agent Studio → Procurement Compliance Auditor** → ask *"Top 5 vendors by maverick count last 30 days"* | Live tool calls |
| 11:30 | Back to dashboard, ask chat *"What was the impact of the last 24h of events?"* | Cross-widget answer |

### Pre-call checklist

- [ ] All services healthy
- [ ] Both Schedules enabled
- [ ] All 4 alert rules enabled
- [ ] Both Logic Studio functions published & enabled
- [ ] Agent saved with tools enabled
- [ ] Dashboard pinned at v1
- [ ] Replay script tested with `srm 5` and `invoice 3`
- [ ] Bell icon empty (clear old notifications)
- [ ] Human Actions queue cleared

---

## Appendix A — `scripts/replay-po-events.sh`

This script:
- Pulls records from the demo service for the last ~1,000 cases of `bpic2019-purchase-orders`
- Filters by activity to match the "source system" being simulated
- Re-stamps `timestamp = now()` (so alerts fire on live data)
- POSTs each record to the appropriate webhook with HMAC SHA-256 signature
- Sleeps `delay_seconds` between events (default 1s)

**Usage:**
```bash
./scripts/replay-po-events.sh srm 20 1        # 20 SRM events, 1s apart
./scripts/replay-po-events.sh invoice 10 0.5  # 10 vendor invoice events, 0.5s apart
./scripts/replay-po-events.sh maverick 5 2    # 5 maverick POs (GR with no SRM approval)
./scripts/replay-po-events.sh stuck 3 1       # 3 cases stuck at Set Payment Block
```

Full script — see the next section for the file contents to drop at `scripts/replay-po-events.sh`.

```bash
#!/usr/bin/env bash
# Replay BPIC 2019 purchase order events to Nexus webhook connectors.
# Stamps timestamps to "now" so live alert rules fire correctly.
#
# Usage: ./replay-po-events.sh <mode> <count> [delay_seconds]
#   mode: srm | invoice | maverick | stuck
#   count: number of events to send
#   delay_seconds: between events (default 1)

set -euo pipefail

# ── EDIT THESE FOUR LINES AFTER CREATING THE WEBHOOK CONNECTORS ──
SRM_SLUG="paste-srm-slug-here"
SRM_SECRET="paste-srm-secret-here"
INVOICE_SLUG="paste-invoice-slug-here"
INVOICE_SECRET="paste-invoice-secret-here"
# ──────────────────────────────────────────────────────────────────

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
    # Goods Receipt with no SRM approval upstream — Logic Studio "Maverick PO Triage" picks these up.
    SLUG="$SRM_SLUG"; SECRET="$SRM_SECRET"
    ACTIVITY_FILTER="Record Goods Receipt"
    ;;
  stuck)
    # Set Payment Block events — case sits idle, stuck_case rule fires after threshold.
    SLUG="$SRM_SLUG"; SECRET="$SRM_SECRET"
    ACTIVITY_FILTER="Set Payment Block"
    ;;
  *)
    echo "unknown mode: $mode"; exit 1 ;;
esac

# Pull a page of records matching the activity filter
records=$(curl -s "$DEMO_BASE/datasets/$DATASET/records?limit=$count&filter_field=activity&filter_value=$ACTIVITY_FILTER&filter_op=contains" \
  | jq -c '.records[]')

i=0
while IFS= read -r row; do
  i=$((i+1))
  # Stamp timestamp = now (UTC, ISO-8601)
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  payload=$(echo "$row" | jq --arg now "$now" '.timestamp = $now')

  # HMAC SHA-256 signature
  sig=$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

  resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$NEXUS_BASE/connectors/webhooks/receive/$SLUG" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$sig" \
    --data "$payload")

  case_id=$(echo "$payload" | jq -r '.case_id')
  activity=$(echo "$payload" | jq -r '.activity')
  echo "[$i/$count] $resp  $case_id  $activity"

  sleep "$delay"
done <<< "$records"

echo "Done — replayed $i events to $mode webhook."
```

### Tweaks you might want
- **Demo a volume spike:** drop `delay` to `0.1` and `count` to `100` — `case_volume_anomaly` rule (after baseline established) fires.
- **Demo a slow transition:** add a `--no-payment` mode that pushes `Create Purchase Order Item` only, leaving cases hanging in early-state for `slow_transition` rule.
- **Multi-source story:** open two terminals, run `srm` and `invoice` simultaneously — looks like two ERP systems pushing in parallel.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook returns 401 | HMAC secret mismatch | Re-copy the secret from the connector detail panel into the script |
| Webhook returns 404 | Wrong slug | Re-copy the slug; check the connector is **Enabled** |
| No alert notification fires | Generator timestamps too old; baseline issues | Confirm replay script is stamping `timestamp=now()`; check `Settings → System Health → alert-engine` is running |
| Logic Studio function doesn't propose actions | Filter DSL syntax | Check the function's **Last Run** for the exact error; activities filter syntax may need `events.any(activity == ...)` depending on your DSL version |
| Process Mining shows no recent events | Pipeline didn't ingest webhook payloads | Verify webhook target is `event_log` and `object_type_id` is set; check pipeline run history |
| Conformance score is 100% | Reference path matches everything (probably empty or single activity) | Re-define with the full 6-step golden path |

---

## What this demo proves to a buyer

| Capability | Phase | Where customer sees it |
|---|---|---|
| Multi-source ingestion | 1, 3 | 4 connectors of 2 types (REST + Webhook) on Connectors page |
| Ontology modeling | 2 | Linked graph: PurchaseOrder ↔ Vendor / GoodsReceipt / Invoice |
| Process discovery | 1, 4 | Process map, variants, conformance, bottlenecks |
| Real-time event ingestion | 3, 8 | Connector "last received" ticks live during the call |
| Deviation alerting | 4, 8 | In-app notifications fire from replay |
| AI-driven triage | 5, 8 | Logic Studio function generates LLM explanations |
| Human-in-the-loop | 5, 8 | Human Actions queue with approve/reject |
| Ad-hoc investigation | 6, 8 | Compliance agent with tool calls |
| Executive visibility | 7, 8 | Control tower dashboard with multi-source chat |

---

*Document author: built for sales + enablement. Update phases as platform features evolve. Regenerate with `/loop` review on each major release.*
