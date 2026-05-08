# search-service (port 8018)

**Purpose:** Unified ILIKE search across object types, records, pipelines, connectors, agents.
**Stack:** Python FastAPI, asyncpg (raw SQL, no ORM).
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/search_service/`

## Files

```
search_service/
├── main.py             FastAPI; lifespan get_pool/close_pool
├── database.py         asyncpg pool (min_size=1, max_size=5)
├── routers/
│   └── search.py       Single GET /search endpoint, parallel queries via asyncio.gather
├── requirements.txt
└── Dockerfile
```

## Endpoint

`GET /search?q=<term>&limit=20` (max 50). Returns array of `{type, id, title, subtitle, path, score}`.

Type ∈ `{object_type, record, pipeline, connector, agent}`.

## Scoring (`_score(text, query)`)

- Exact = 1.0
- Prefix = 0.85
- Contains = 0.65
- Partial = 0.4

## Queries (all run in parallel via `asyncio.gather`)

| Entity | Tables | Match |
|--------|--------|-------|
| object_type | `object_types` | name, display_name, description ILIKE |
| record | `object_records` | `data::text ILIKE` + extract best matching field for subtitle |
| pipeline | `pipelines` | name |
| connector | `connectors` | name, type, category |
| agent | `agent_configs` | name, description |

Tenant-scoped via `x-tenant-id` header.

## Env

`DATABASE_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add searchable entity | new `async def search_<type>(...)` + add to `asyncio.gather` call. |
| Change scoring | `_score()` thresholds. |
| Field-level boost (name vs description) | per-entity score multipliers. |
| Postgres trigram search | swap ILIKE for `pg_trgm` similarity in queries. |
| Semantic vector search | add pgvector column on object_records + cosine query. |
