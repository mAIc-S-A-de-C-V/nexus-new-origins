# event-log-service (port 8005)

**Purpose:** Persist process-mining events in TimescaleDB hypertable. Batch ingest + time-series queries.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, TimescaleDB.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/event_log_service/`

## Files

```
event_log_service/
├── main.py                 FastAPI; init_db creates hypertable; spawns _event_retention_loop
├── database.py             EventRow, hypertable creation, GIN indexes for case_key + related_objects
├── routers/
│   ├── events.py           POST /events, POST /events/batch, GET /events, GET /events/profile
│   └── timeseries.py       GET /events/timeseries, /events/timeseries/{process_id}, POST /events/discovery
├── requirements.txt
└── Dockerfile
```

## `events` table (TimescaleDB hypertable on `timestamp`)

```
id PK, tenant_id (idx), case_id (idx), activity, timestamp (idx; HYPERTABLE KEY),
object_type_id (idx), object_id, pipeline_id (idx), connector_id (idx),
resource, cost (Float), attributes JSONB
```

Indexes (Phase 6 object-centric):
- `events_case_key_idx` on `attributes->>'case_key'` (explicit case key override).
- `events_related_objects_gin` on `attributes->'related_objects'` (multi-object touchpoints).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/events` | Ingest single event. |
| POST | `/events/batch` | Ingest array. |
| GET | `/events` | Filter: `case_id`, `object_type`, `pipeline_id`, `activity`, `from_time`, `to_time`, `limit≤1000`. |
| GET | `/events/profile` | Distinct activities + counts + first/last seen. |
| GET | `/events/timeseries` | Aggregate by time_bucket + activity. |
| GET | `/events/timeseries/{process_id}` | Same but process-scoped. |
| POST | `/events/discovery` | Heuristic process discovery from event log (repeated case_keys). |

`timeseries.py` builds dynamic SQL:
- `_resolved_activity_expr()` — CASE that remaps generic `RECORD_CREATED`/`UPDATED` to a field value (e.g. `record_snapshot.invoice_status`).
- `_resolved_case_id_expr()` — override case_id from `attributes.record_snapshot.{case_id_attr}`.
- `_resolved_timestamp_expr()` — override timestamp from `attributes.record_snapshot.{ts_attr}`.
- `_build_user_excl()` — parameterized NOT IN to exclude system activities.
- `_build_attribute_filters()` — JSONB attribute filtering.

Core query:
```sql
SELECT time_bucket(interval, timestamp) AS bucket, activity, COUNT(*) AS event_count, COUNT(DISTINCT case_id) AS case_count
FROM events WHERE <filters>
GROUP BY bucket, activity ORDER BY bucket DESC
```

## Background

Retention loop (`main.py`): every 24h deletes events with `timestamp < NOW() - EVENT_RETENTION_DAYS` (default 90).

## Cross-service callers

- ontology-service writes records → fires events here (fire-and-forget via `event_emit.py`).
- pipeline-service SINK_EVENT.
- connector-service webhook target_type=event_log routes to `/events/batch`.
- nexus-apps/project-management-service emits `project_created`/`stage_transitioned`/`task_commented`.
- alert-engine, process-engine read this table.

## Env

`TIMESCALE_URL`, `EVENT_RETENTION_DAYS` (90), `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add column | `database.py:EventRow` + raw `ALTER TABLE` in `init_db()`. |
| Add new index | `database.py:init_db()`. |
| Add filter to query | `routers/events.py` WHERE builder. |
| Add aggregation metric | `routers/timeseries.py` SELECT clause. |
| Add new resolved expression | new `_resolved_*_expr()` in `timeseries.py`. |
| Change retention | env `EVENT_RETENTION_DAYS`. |
