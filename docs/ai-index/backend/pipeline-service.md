# pipeline-service (port 8002)

**Purpose:** DAG-based pipeline orchestration. Stores pipelines, runs them on poll-frequency or cron schedules, executes 11 node types, persists per-run audits/logs/progress.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, httpx, croniter, anthropic.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/pipeline_service/`

## Files

```
pipeline_service/
├── main.py                FastAPI; mounts pipelines + schedules routers; spawns scheduler_loop + cron_scheduler_loop on startup
├── database.py            ORM: PipelineRow, PipelineRunRow, PipelineScheduleRow + init_db
├── dag_executor.py        DagExecutor.execute() — walks DAG topologically, executes each node type
├── scheduler.py           Poll-frequency scheduler (15m/1h/6h/1d/30s); orphan detection; stuck-run reset
├── cron_scheduler.py      Cron-based scheduler (croniter); first-run bootstrap
├── routers/
│   ├── pipelines.py       Pipeline CRUD + POST /run (background task)
│   └── schedules.py       Schedule CRUD + POST /run-now
├── requirements.txt
└── Dockerfile
```

## Endpoints

### `/pipelines`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/pipelines` | List, optional `status` filter. |
| POST | `/pipelines` | Create. Auto-id, version=1. |
| GET | `/pipelines/{id}` | Fetch. |
| PUT | `/pipelines/{id}` | Update; merges + increments version. |
| DELETE | `/pipelines/{id}` | 204. |
| POST | `/pipelines/{id}/run` | 202; creates `PipelineRunRow`, returns `{run_id, status: "RUNNING"}`. Executes in `asyncio.create_task`. |
| GET | `/pipelines/{id}/schedules` | List cron schedules. |
| POST | `/pipelines/{id}/schedules` | Create cron schedule. |
| PUT | `/pipelines/{id}/schedules/{schedule_id}` | Update. |
| DELETE | `/pipelines/{id}/schedules/{schedule_id}` | 204. |
| POST | `/pipelines/{id}/schedules/{schedule_id}/run-now` | Manual fire. |

## Database

**`pipelines`** (`PipelineRow`): id, tenant_id, name, status (`IDLE`/`RUNNING`/`COMPLETED`/`FAILED`), version, data JSONB (full Pipeline serialized), created_at, updated_at.

**`pipeline_runs`** (`PipelineRunRow`):
- Core: id, pipeline_id (idx), tenant_id (idx), status, triggered_by (api/scheduler/webhook), rows_in, rows_out, error_message, started_at, finished_at.
- Audit: `node_audits` JSON, `logs` JSON (`[{ts, level, node_id, msg, extra}, …]`).
- Live progress: `current_node_id`, `current_node_label`, `current_step_index` (1-based), `total_steps`, `current_node_processed`, `current_node_total`, `current_model`, `current_node_meta` (telemetry: batches_done/total, batch_size, concurrency, input_tokens, output_tokens, cost_usd, dropped_prefilter).
- Watermark: `watermark_value` for incremental syncs.

**`pipeline_schedules`** (`PipelineScheduleRow`): id, pipeline_id (idx), tenant_id, name, cron_expression, enabled, last_run_at, created_at, updated_at.

## Node types (`dag_executor.py`)

| Type | Purpose |
|------|---------|
| `SOURCE` | Fetch from a connector (`connector_id`, `poll_frequency`). Captures `_watermark_value` for incremental. |
| `FILTER` | Drop rows by expression (`condition`). |
| `MAP` | Field renames + computed expressions (`mappings`, `expressions`). |
| `FLATTEN` | Explode an array field. |
| `DEDUPE` | By `key_field`. |
| `CAST` | Type coercion via `mappings`. |
| `VALIDATE` | Drop rows missing `required_fields`. |
| `ENRICH` | Per-row detail lookup → `connector-service /fetch-row`. |
| `SINK_OBJECT` | Write rows to ontology object type via `ontology-service /object-types/{id}/ingest`. |
| `SINK_EVENT` | Write process events via `event-log-service /events`. |
| `AGENT_RUN` | Call agent via `agent-service /agents/{id}/run` with batch context. |

GitHub records auto-flattened: nested `user`/`author`/`committer`/`assignee` promoted to scalar `login`, labels list-of-dict → comma-separated names.

Sink capture: `init_run_sink_capture()` installs a context-var accumulator. After pipeline completes, sink results drain to `agent-service /triggers/internal/pipeline-event` to fire pipeline-event triggers.

Templates resolved in node configs: `{{$today:YYYY-MM-DD}}`, `{{$daysAgo:N:FMT}}`, `{{$lastRun:FMT}}`.

## Schedulers

**`scheduler.py`** — every 60s:
- Reset orphans on boot (any `RUNNING` row with no live task → `FAILED` "Process restarted — run orphaned").
- For each pipeline, check first SOURCE node's `poll_frequency` (`15m`, `1h`, `6h`, `1d`, `30s` for dev). If `last_run + interval ≤ now` and not currently RUNNING → fire.
- Stuck-run detection: any RUNNING for > `PIPELINE_STUCK_TIMEOUT_S` (default 1800s) → forcibly mark FAILED.

**`cron_scheduler.py`** — every 60s, offset 15s:
- For each enabled `pipeline_schedules` row: if `last_run_at IS NULL` → bootstrap fire immediately. Else use `croniter(cron, last_run_at)` to compute next; if `next ≤ now` → fire.

Both schedulers call `_run_pipeline()` which dedupes against currently-running pipelines.

## Cross-service calls

| → | URL | Why |
|---|-----|-----|
| connector-service | `/connectors/{id}/internal` (x-internal) | Decrypted creds for SOURCE nodes. |
| connector-service | `/connectors/{id}/fetch-row` | ENRICH lookups. |
| connector-service | `/connectors/{id}/emails/fetch` | Email SOURCE. |
| ontology-service | `/object-types/{id}/ingest` | SINK_OBJECT. |
| ontology-service | `/object-types/{id}/set-pipeline` | Mark pipeline as authoritative source. |
| event-log-service | `/events` (fire-and-forget) | Pipeline lifecycle + SINK_EVENT. |
| agent-service | `/agents/{id}/run` | AGENT_RUN node. |
| agent-service | `/triggers/internal/pipeline-event` (x-internal) | Pipeline-event triggers (new IDs written). |

## Env

`DATABASE_URL`, `CONNECTOR_SERVICE_URL`, `ONTOLOGY_SERVICE_URL`, `EVENT_LOG_SERVICE_URL`, `AGENT_SERVICE_URL`, `WHATSAPP_SERVICE_URL`, `ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `PIPELINE_STUCK_TIMEOUT_S` (default 1800), `SKIP_AUTH`, `AUTH_SERVICE_URL`.

## When to edit

| Intent | File |
|--------|------|
| Add a new node type | `dag_executor.py` (handler) + `shared/enums.py:NodeType` + `frontend/src/modules/pipeline/pipelineTypes.ts:NODE_TYPE_DEFS` + `NodeConfigPanel.tsx` field schema. |
| Add a new poll-frequency unit (e.g. `1w`) | `scheduler.py:_parse_frequency`. |
| Add timezone support to cron | `cron_scheduler.py:_cron_tick()` (`croniter` accepts tz). |
| Stream live progress (SSE/WS) | `routers/pipelines.py` + add new GET endpoint reading `pipeline_runs.current_node_*`. |
| Pipeline clone/fork | `routers/pipelines.py` + new endpoint duplicating row. |
| Persist per-node telemetry differently | `dag_executor.py:_write_progress()` + add columns to `pipeline_runs`. |
| Pipeline run history endpoint | new endpoint in `routers/pipelines.py` querying `pipeline_runs`. |
