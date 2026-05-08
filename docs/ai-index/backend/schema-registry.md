# schema-registry (port 8007)

**Purpose:** Versioned connector schema storage. Hash-deduplicates by canonical JSON.
**Stack:** Python FastAPI. **Currently in-memory** — data is lost on restart. Production-ready upgrade path: switch to Postgres-backed.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/schema_registry/`

## Files

```
schema_registry/
├── main.py             FastAPI; mounts schemas router
├── routers/
│   └── schemas.py      Register + retrieve schema versions
├── requirements.txt
└── Dockerfile
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/schemas/{connector_id}` | List all versions for a connector (tenant-scoped). |
| POST | `/schemas` | Register version. Body `{connector_id, schema}`. Hash = `sha256` of sorted canonical JSON, truncated to 16 chars (`sha256:...`). Dedupe → returns existing if hash matches. Otherwise auto-increments version. |
| GET | `/schemas/{connector_id}/latest` | Most recent version. |

## Models

`SchemaVersion`: id (UUID), connector_id, hash, schema (dict), version (int, 1-based), registered_at (ISO 8601), tenant_id.

## Storage

`_store: dict[str, list[dict]]` — keyed by connector_id, list of versions. **In-memory.** Restart = wipe.

## When to edit

| Intent | File |
|--------|------|
| Persist to Postgres (recommended) | `main.py` + new `database.py` with `SchemaVersionRow` + asyncpg. |
| Schema diff endpoint | `routers/schemas.py` — implement `GET /schemas/{connector_id}/diff?from=X&to=Y`. |
| Schema validation endpoint | `routers/schemas.py` — implement `POST /schemas/{connector_id}/validate`. |
| Change hash truncation | `routers/schemas.py:_hash()`. |
