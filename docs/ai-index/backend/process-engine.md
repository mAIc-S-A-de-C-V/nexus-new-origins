# process-engine (port 8009)

**Purpose:** Process mining over the event log. Variants, transitions, bottlenecks, conformance. Both single-object-type (legacy) and multi-object processes (Phase 1).
**Stack:** Python FastAPI, SQLAlchemy async. **Dual database**: TimescaleDB for events (read-only), Postgres for process definitions + conformance models.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/process_engine/`

## Files

```
process_engine/
├── main.py                FastAPI; mounts 5 routers; init_db (TS hypertable noop) + init_pg_db + discover_implicit_processes
├── database.py            TimescaleDB connection (read events)
├── database_pg.py         Postgres: conformance_models + processes DDL; discover_implicit_processes()
├── conformance_engine.py  Subsequence-pointer fitness scoring; deviation classification
├── rollup.py              Materialize summary stats
├── routers/
│   ├── process.py         Single-object-type endpoints (LEGACY)
│   ├── processes.py       Multi-object processes (PHASE 1) + auto-discover + backfill
│   ├── by_process.py      Process-scoped mining (variants, bottlenecks, …)
│   ├── conformance.py     Conformance models CRUD + check execution
│   └── rollups.py         POST /run, /run-recent
├── requirements.txt
└── Dockerfile
```

## Tables (Postgres)

```
processes:           id, tenant_id, name UNIQUE, case_key_attribute, included_object_type_ids TEXT[],
                     included_activities, excluded_activities, is_implicit BOOL, status
conformance_models:  id, tenant_id, object_type_id, process_id (nullable), name, activities TEXT[], is_active
```

Events live in TimescaleDB `events` table (managed by event-log-service).

## Endpoints

### `/process` (legacy single-OT, `routers/process.py`)

GET `/process/{cases|variants|transitions|bottlenecks|stats|overview|attribute-values|benchmark|pivot}/{object_type_id}`,
POST `/process/{root-cause|insights}/{object_type_id}`,
GET `/process/cases/{ot_id}/{case_id}/timeline`.

### `/process/processes` (Phase 1 multi-object, `routers/processes.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/process/processes` | List explicit + implicit. |
| POST | `/process/processes` | Create explicit. |
| PATCH | `/process/processes/{id}` | Update. |
| DELETE | `/process/processes/{id}` | Delete (implicit auto-recreated on startup). |
| POST | `/process/processes/auto-discover` | Suggest case_key from attribute frequencies. |
| POST | `/process/processes/{id}/backfill` | Populate `case_key` in events from record_snapshot (calls ontology). |
| GET | `/process/processes/{id}` | Detail. |

### `/process/by-process/...` (process-scoped, `routers/by_process.py`)

Same metrics as legacy but filtered by `object_type_id IN (process.included_object_type_ids)` and case key from `process.case_key_attribute`. Plus `GET /process/by-process/by-object-instance/{ot_id}/{object_id}/touchpoints` to find which processes touched a given record.

### `/process/conformance` (`routers/conformance.py`)

Models keyed by either `process_id` (Phase 1) or `object_type_id` (legacy). `GET /check/.../{model_id}` runs `conformance_engine.check_conformance()`.

### `/process/rollups` (`routers/rollups.py`)

`POST /run`, `POST /run-recent` — pre-compute summary tables.

## Conformance algorithm (`conformance_engine.py`)

Subsequence-pointer walk:
- For each actual activity:
  - Matches `model[pointer]` → matched, advance.
  - Appears later → `skip` activities between.
  - Doesn't appear → `unauthorized`.
  - Already passed → `wrong_order`.
- Consecutive duplicates → `rework`.
- `fitness = matched / len(model)`.

Deviation types: `skip`, `wrong_order`, `unauthorized`, `rework`.

## Startup

`discover_implicit_processes()` scans `events` for distinct `(tenant_id, object_type_id)` pairs and creates a `Process` per pair if missing (UNIQUE constraint dedupes).

## Env

`TIMESCALE_URL`, `DATABASE_URL`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add a metric | `routers/process.py` or `routers/by_process.py` (new GET endpoint + SQL builder). |
| Change fitness formula | `conformance_engine.py:check_conformance()` math. |
| Add deviation type | `Deviation.type` union + detection logic. |
| Add a process attribute | `database_pg.py` DDL + `Process` model in `routers/processes.py`. |
| Tune discovery heuristic | `database_pg.py:discover_implicit_processes()` query + confidence calc. |
| Add rollup dimension | `rollup.py` summary table DDL + compute. |
