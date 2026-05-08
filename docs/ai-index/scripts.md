# `scripts/` — Operational scripts

11 files. Each one is described below with: what it does, when to run it, what to edit.

Path: `/Users/ishmontalvo/Desktop/nexus-new-origins/scripts/`

```
scripts/
├── backup.sh                   Daily encrypted Postgres + Timescale backup (cron in compose)
├── restore.sh                  Decrypt + pg_restore from a backup
├── replay-po-events.sh         Live demo event injection (BPIC2019)
├── seed_demo_tenants.py        Idempotent seeding of all 8 demo tenants + cross-object joins
├── seed_finance_ontology.py    Create Account/Counterparty/Transaction/Invoice/Bill/Loan OTs
├── seed_finance_apps.py        Create 11 finance dashboards/apps under tenant-001
├── seed_platform_ontology.py   Core system OTs (projects, users, …)
├── seed_po_research_action.sh  Procurement research action triggering (demo)
├── setup-mac-mini-bridge.sh    Install on-prem LLM bridge (Caddy + Cloudflare Tunnel)
├── setup-log-shipping.sh       Filebeat → Elasticsearch / CloudWatch / Splunk
└── grafana_to_nexus_backfill.py  Backfill Nexus event log from Grafana metrics
```

---

## `backup.sh`

**Purpose:** ISO 27001 A.8.13 compliance. Daily encrypted backup of `nexus` and `nexus_events` DBs.

**Mounted as cron** in `docker-compose.yml:backup-service` at `0 2 * * *` (2am daily). Logs to `/var/log/backup.log`.

Steps:
1. mkdir `BACKUP_DIR` (default `/var/backups/nexus`).
2. `pg_dump -Fc nexus → tmp file → openssl aes-256-cbc -k $BACKUP_ENCRYPTION_KEY` → final `*.pgdump.enc`.
3. Repeat for `nexus_events` (TimescaleDB on port 5434).
4. Verify non-empty.
5. Purge files older than `RETENTION_DAYS` (default 30).

**Env:** `BACKUP_DIR`, `RETENTION_DAYS`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `TIMESCALE_HOST`, `BACKUP_ENCRYPTION_KEY` (**required for prod** — without it, plaintext backup logged as warning).

**Edit:** retention, parallel pg_dump (`-j4`), aes-256-gcm upgrade, S3 sync, additional DBs.

## `restore.sh`

**Usage:** `./restore.sh <backup_file> [nexus|nexus_events] [port]`.

Steps:
1. If `.enc`, decrypt with `BACKUP_ENCRYPTION_KEY`.
2. `pg_restore` to specified DB on specified port.
3. Cleanup tmp.

**Edit:** add pre-restore checks (target empty / live backup), post-restore validation queries, selective `--include-table-data`.

## `replay-po-events.sh`

**Purpose:** During sales demos, stamp `timestamp = now()` on BPIC2019 records and POST to a webhook so process mining + alerts fire live.

**Modes:**
- `srm` — `activity contains "SRM:"`
- `invoice` — `activity contains "Vendor creates"`
- `maverick` — `activity == "Record Goods Receipt"` (no upstream SRM)
- `stuck` — `activity == "Set Payment Block"` (idle cases)

**Usage:** `./replay-po-events.sh srm 20 1` (mode, count, delay seconds).

**Pre-requisite:** create demo connectors in UI, paste their `slug` + `secret` into top of script:
```bash
SRM_SLUG="..."
SRM_SECRET="..."
INVOICE_SLUG="..."
INVOICE_SECRET="..."
```

The script computes HMAC-SHA256 with the secret and POSTs to `connector-service /webhooks/receive/{slug}`.

**Edit:** add new modes (`rework`), adjust default delays, add filter ops.

## `seed_demo_tenants.py`

**Purpose:** Idempotent multi-tenant seeding. Hits ontology + connector + event-log via HTTP.

**Tenants:**
- `tenant-finance` — BPIC 2012/2017
- `tenant-procurement` — BPIC 2019 (**main demo**)
- `tenant-healthcare` — BPIC 2011 + Sepsis
- `tenant-itsm` — BPIC 2014 (incidents + changes, cross-linked by `ci_name`)
- `tenant-government` — Traffic fines + permits
- `tenant-manufacturing` — Smart factory IoT
- `tenant-travel` — BPIC 2020 (5 variants linked by permit #)
- `tenant-demo` — Insurance (policies + claims linked by policy_id)

**Cross-object joins (`CROSS_OBJECT_REMAP`):** `tenant-itsm` (changes ci_name → incidents), `tenant-travel` (permits case_id → domestic/international), `tenant-demo` (policies policy_id → claims).

**Args:** `--tenant <id>` (one only) or none (all). `--cap <N>` to override `RECORD_CAP_PER_DATASET` (default 5000).

**Edit:** add tenant in `TENANTS` dict; add cross-link in `CROSS_OBJECT_REMAP`; field map in `CASE_KEY_FIELD_BY_DATASET`; non-event datasets in skip set.

## `seed_finance_ontology.py` and `seed_finance_apps.py`

Run order: ontology → apps. Creates Account, Counterparty, Transaction, Invoice, Bill, Loan OTs. Then 11 dashboards/apps under tenant-001.

**Apps created:** Finance Overview, Accounts, Accounts Receivable, Accounts Payable, Loans (5 dashboards) + Add Account, Add Counterparty, Add Transaction (multi-step wizard with validation), Add Invoice, Add Bill, Add Loan (6 input forms).

## `seed_platform_ontology.py`

System-wide ontology (projects, users, …). Idempotent.

## `seed_po_research_action.sh`

Demo helper for procurement research action (writes the action definition + sample executions).

## `setup-mac-mini-bridge.sh`

**Purpose:** Run a Mac Mini on-prem as an LLM bridge for off-island inference. Installs Caddy + Cloudflared via Homebrew, writes a Caddyfile with basic-auth, creates a named Cloudflare tunnel `nexus-llm`, installs launchd agents.

Topology:
```
Mac Mini (LAN) → Caddy (8787, basic-auth) → http://10.150.99.150:8000 (LLM)
                                        ↘
                                          Cloudflared tunnel → https://llm.maic.ai
```

**Configurable (lines 18–24):** `UPSTREAM`, `TUNNEL_HOSTNAME`, `USERNAME`, `PASSWORD`.

**Sanity:**
```
curl -u nexus:nexus-dev http://localhost:8787/v1/models
curl -u nexus:nexus-dev https://llm.maic.ai/v1/models
```

**Manual control:**
```
launchctl unload ~/Library/LaunchAgents/ai.maic.nexus-bridge-*.plist
launchctl load   ~/Library/LaunchAgents/ai.maic.nexus-bridge-*.plist
tail -f ~/.nexus-bridge/caddy.err.log
```

## `setup-log-shipping.sh`

ISO 27001 A.8.15. Three modes: `elasticsearch`, `cloudwatch`, `splunk`. Configures Filebeat to ship Docker container JSON logs to the chosen target.

Elasticsearch sample:
- Input: `/var/lib/docker/containers/*/*-json.log`
- Output: `${ELASTICSEARCH_URL:-http://localhost:9200}`
- Index: `nexus-logs-YYYY.MM.dd` (daily rotation)

**Edit:** retention via Elasticsearch ILM, redaction processors, batch tuning.

## `grafana_to_nexus_backfill.py`

Backfills Nexus event log from Grafana/Prometheus metrics for historical analysis. Configure metric → activity mapping; handle clock skew between systems.

---

## When to add a new script

- Fits one of the existing categories (backup/seed/setup/replay/backfill).
- Is **idempotent** (re-runnable). Seeds use `INSERT ... ON CONFLICT DO NOTHING`.
- Documents env vars at top.
- Logs to stdout in JSON when called from cron (`shared/nexus_logging`-compatible).
