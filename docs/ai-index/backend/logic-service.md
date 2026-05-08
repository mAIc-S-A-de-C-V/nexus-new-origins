# logic-service (port 8012)

**Purpose:** Visual function builder + execution engine. Functions are sequential blocks (`ontology_query`, `llm_call`, `action`, `transform`, `email`, `conditional`) with variable resolution. Versioned + scheduled via cron.
**Stack:** Python FastAPI, SQLAlchemy async, APScheduler, anthropic SDK, smtplib.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/logic_service/`

## Files

```
logic_service/
├── main.py                 FastAPI; mounts 3 routers; APScheduler start/stop
├── database.py             ORM: LogicFunctionRow, LogicRunRow, LogicScheduleRow
├── runner.py               execute_function() — sequential block evaluator + _resolve() variable interpolation
├── scheduler.py            APScheduler instance + load_schedules_from_db
├── auth_middleware.py      Local copy
├── nexus_logging.py        Local copy
├── routers/
│   ├── functions.py        CRUD + publish + run (sync/async) + schedules
│   ├── runs.py             Run history (filter by function/status)
│   └── schedules.py        Schedule CRUD per function
├── requirements.txt
└── Dockerfile
```

## Tables

| Table | Purpose |
|-------|---------|
| `logic_functions` | id, tenant_id, name, description, input_schema (list of `{name, type, required}`), blocks (list of block dicts), output_block (id), version, status (`draft`/`published`), published_version |
| `logic_runs` | id, function_id, function_version, inputs JSON, status (pending/running/completed/failed), trace JSON (per-block results), output JSON, error, triggered_by (user_id or `agent:xxx`) |
| `logic_schedules` | function_id, cron, label, inputs (defaults), enabled, last_run_at |

## Endpoints

### `/logic/functions` (`routers/functions.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/logic/functions` | List. |
| POST | `/logic/functions` | Create draft. |
| GET/PUT/DELETE | `/logic/functions/{id}` | CRUD; PUT auto-versions. |
| POST | `/logic/functions/{id}/publish` | Mark version as production. |
| POST | `/logic/functions/{id}/run` | Async; returns run_id. |
| POST | `/logic/functions/{id}/run/sync` | Synchronous. |
| GET/POST | `/logic/functions/{id}/schedules` | Create/list schedules. |
| PUT/DELETE | `/logic/functions/{id}/schedules/{sid}` | Update/delete. |

### `/logic/runs` (`routers/runs.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/logic/runs` | Filter `function_id`, `status`. |
| GET | `/logic/runs/{id}` | Trace + output + error. |

## Block types (executed in `runner.py`)

| Type | Config |
|------|--------|
| `ontology_query` | `{object_type, filters: [{field, op, value}], aggregate?, limit?}` — calls ontology-service. |
| `llm_call` | `{prompt, model?, max_tokens?}` — Claude via shared/llm_router. |
| `action` | `{action_name, inputs}` — propose/execute via ontology actions. |
| `transform` | `{language: js|py, code}` — runs sandboxed transform. |
| `email` | `{to, subject, body}` — SMTP send. |
| `conditional` | `{expression, then_block, else_block}` — branch. |

Variable interpolation (`_resolve()`):
- `{inputs.field}` — input parameter.
- `{block_id.result}` — prior block output.
- `{block_id.result.nested.path}` — JSON path.
- `{records[0].name}` — array indexing.
- Recursive through strings, dicts, lists.

## Cross-service

- `ontology-service` `/object-types/{id}/records` (and `/aggregate`) for `ontology_query` blocks.
- `utility-service` for transforms / external calls.
- Anthropic API via `shared/llm_router.py`.
- SMTP via env vars.

## Env

`DATABASE_URL`, `ONTOLOGY_SERVICE_URL`, `UTILITY_SERVICE_URL`, `ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add new block type | `runner.py:_execute_block()` dispatcher + handler function. Document config schema in `routers/functions.py` validation. |
| Add new variable resolution syntax | `runner.py:_resolve()` regex + traversal. |
| Add block validation | `routers/functions.py:_validate_blocks()` before persisting. |
| Add transform language | extend `runner.py:_execute_transform()` (currently JS via mini-runner). |
| Customize LLM behavior | `runner.py:_execute_llm_call()` — model, context window, token limits. |
| Add scheduling trigger types beyond cron | `scheduler.py:load_schedules_from_db()`. |
| Persist additional run metadata | `runner.py` trace + `database.py:LogicRunRow` columns. |
