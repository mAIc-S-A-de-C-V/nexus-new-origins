# analytics-service (port 8015)

**Purpose:** Data exploration + AIP Analyst (Claude-powered Q&A) + scenario modeling + value tracker.
**Stack:** Python FastAPI, SQLAlchemy async (Postgres), httpx, anthropic.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/analytics_service/`

## Files

```
analytics_service/
├── main.py                  FastAPI; mounts 4 routers
├── database.py              AsyncSession, connection pool
├── query_engine.py          build_aggregate_sql(), run_explore_query() — uses shared/query_cache + index_advisor
├── routers/
│   ├── explore.py           GET /explore/object-types/.../fields, /sample; POST /explore/query
│   ├── analyst.py           AIP Analyst (Claude conversational data Q&A)
│   ├── scenarios.py         What-if modeling
│   └── value_tracker.py     KPI + business value metrics
├── requirements.txt
└── Dockerfile
```

## Endpoints

### `/explore` (`routers/explore.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/explore/object-types/{ot_id}/fields` | Field list + record count. |
| GET | `/explore/object-types/{ot_id}/sample` | 5 raw records for schema preview. |
| POST | `/explore/query` | Aggregate/groupby/filter/order. Body `ExploreQueryRequest{object_type_id, filters: [{field, op, value}], aggregate: {function (COUNT/SUM/AVG/MIN/MAX/RUNTIME), field, ts_field?}, group_by, order_by, limit, offset, select_fields}`. Cached via `shared/query_cache`. |

### `/analyst` — AIP Analyst (Claude)

Conversational interface where the model generates queries from natural language and executes them via the shared query engine.

### `/scenarios` and `/value-tracker`

What-if modeling and KPI tracking. Stub-level implementations — extend as needed.

## Cross-service

- Reads `object_records` and `object_types` directly via Postgres (analytics, not via ontology HTTP).
- Calls `shared/llm_router` for Claude.
- Writes token usage via `shared/token_tracker`.

## Env

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `SKIP_AUTH`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add filter operator | `query_engine.py:build_aggregate_sql` + supported `op`s. |
| Add window function / subquery | `query_engine.py`. |
| Implement forecast | `routers/analyst.py` (Claude time-series prompt) or new `routers/forecast.py`. |
| Add CSV/Excel export | `routers/explore.py:POST /explore/export` with format param. |
| Cache hot dashboards | wrap aggregate calls with `shared/rollup_promoter.maybe_promote`. |
