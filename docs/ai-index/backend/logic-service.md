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

The runner only knows these eight block types — **do NOT generate `llm`, `condition`, `http_request`, or `notification`** (the UI palette has `conditional` and `foreach` but they aren't wired into the runtime yet).

| Type | Config location | Fields |
|------|----------------|--------|
| `ontology_query` | nested in `block.config` | `object_type` (NAME), `filters: [{field, op, value}]`, `limit`, **`aggregate?: {group_by?, time_bucket?:{field,interval}, aggregations:[{method,field?,alias?}], limit?, sort_by?, sort_dir?}`** |
| `llm_call` | top-level on `block` | `prompt_template`, `system_prompt`, `model`, `max_tokens`, `output_schema?` |
| `action` | top-level | `action_name`, `params`, `reasoning` — calls `ontology /actions/{name}/execute` |
| `ontology_update` | nested in `block.config` | `object_type_id`, `match_field`, `match_value`, `fields: {...}` — upserts via `/records/ingest` |
| `transform` | top-level | `operation`, `source` (block ref), plus operation-specific fields. Operations: `pass` / `extract_field` (`field`) / `format_string` (`template`) / `filter_list` (`field`, `value`) / **`map_fields`** (`mappings: {out: tpl}`, `keep_unmapped?`) / `pluck` (`field`) / `first` / `last` / `length` / `to_json`. |
| `send_email` | top-level | `to`, `subject`, `body`, `from_name?`, `bcc?` — supports list-of-dicts in `to` for batches |
| `utility_call` | top-level | `utility_id`, `utility_params` — calls utility-service |
| `http_call` | nested in `block.config` | `url`, `method`, `headers?`, `body?`, `auth_type?`, `auth_config?`, `timeout_seconds?`. **Use ONLY for external services — never the platform's own ontology/aggregate endpoints.** |

### `ontology_query` aggregate mode

Set `config.aggregate` and the block calls `POST /object-types/{id}/aggregate` instead of listing records. The runner remaps positional `agg_N` keys to your aliases and `grp` / `series` to your `group_by` / `time_bucket.field` names — the result is immediately usable downstream:

```json
{
  "object_type": "DeviceTelemetry",
  "filters": [{"field": "time", "op": ">=", "value": "{now_minus_1d}"}],
  "aggregate": {
    "group_by": "device",
    "time_bucket": {"field": "time", "interval": "hour"},
    "aggregations": [
      {"method": "count",                            "alias": "sample_count"},
      {"method": "avg", "field": "temp",             "alias": "avg_temp"},
      {"method": "min", "field": "heap",             "alias": "min_heap"}
    ],
    "limit": 5000
  }
}
```

Returns `{"rows": [{"device": "Compactadora", "time": "2026-05-08T16:00:00Z", "sample_count": 22, "avg_temp": 53.3, "min_heap": 189100}, …], "total_groups": N}`.

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
| Add new block type | `runner.py:execute_function()` dispatcher + new `_run_<type>` handler. Add to `frontend/src/modules/logic/LogicStudio.tsx:BLOCK_TYPES`. Add a worked example to `backend/inference_service/claude_client.py:create_logic_function` prompt so the generator can produce it. |
| Add new variable resolution syntax | `runner.py:_resolve()` regex + traversal. |
| Extend ontology_query (e.g. semantic search, lateral joins) | `runner.py:_run_ontology_query()` — already supports list + aggregate modes. |
| Customize LLM behavior | `runner.py:_run_llm_call()` — model, context window, token limits. |
| Add scheduling trigger types beyond cron | `scheduler.py:load_schedules_from_db()`. |
| Improve generator output | `backend/inference_service/claude_client.py:create_logic_function` prompt — every block type's exact schema is documented there with worked examples. The generator MUST produce fully-runnable functions; if you find a config combination it gets wrong, add a counter-example to the prompt. |
| Wire generator into UI block editor | `frontend/src/modules/logic/LogicStudio.tsx` — add new fields next to the existing aggregate controls. |
