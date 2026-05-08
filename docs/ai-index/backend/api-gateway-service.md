# api-gateway-service (port 8021)

**Purpose:** External REST APIs over Nexus data. Customers create endpoints (`/v1/{slug}`) bound to ObjectTypes or Events, mint API keys, get usage analytics.
**Stack:** Python FastAPI, asyncpg, Redis (rate limit), httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/api_gateway_service/`

## Files

```
api_gateway_service/
├── main.py             FastAPI; usage_logger middleware on all /v1/* requests
├── database.py         asyncpg pool + DDL (api_keys, api_endpoints, api_key_usage_log)
├── rate_limit.py       In-memory token bucket per key
└── routers/
    ├── endpoints.py    /gateway/manage CRUD + /v1/{slug} (public read/write)
    ├── keys.py         /gateway/keys CRUD (admin)
    └── usage.py        /gateway/usage/summary
```

## Tables

```
api_keys:
  id, tenant_id, name, key_prefix (first 8 chars), key_hash UNIQUE (sha256),
  scopes TEXT[] (read:records|read:events|write:records|read:all|write:all),
  rate_limit_per_min (1000), ip_allowlist TEXT[], enabled, last_used_at, created_at

api_endpoints:
  id, tenant_id, object_type_id, object_type_name, slug UNIQUE,
  resource_type (records|events), enabled, created_at

api_key_usage_log:
  id, tenant_id, key_id, key_prefix, endpoint_slug, resource_type, method, path,
  status_code, bytes_out, duration_ms, client_ip, error, created_at
```

## Endpoints

### Management (auth — admin/analyst)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/gateway/manage` | List endpoints. |
| POST | `/gateway/manage` | Create (`slug` UNIQUE → 409 on conflict). |
| GET | `/gateway/keys` | List (no raw key values). |
| POST | `/gateway/keys` | Generate. Returns key prefix + full key **once** (key_hash stored). |
| DELETE | `/gateway/keys/{id}` | 204. |
| GET | `/gateway/usage/summary` | Stats by endpoint/status/IP, bandwidth, error rate. |

### Public APIs

`GET /v1/{slug}` and `POST /v1/{slug}` — Bearer auth, per-key rate limit (in-memory), scope check (read:records / read:all / write:records / write:all), optional IP allowlist. Query params: `filter` (JSON), `limit` (1–500), `offset`, `format` (json|csv).

## Middleware

`usage_logger` intercepts all `/v1/*`: captures start/end ts, status, response size, client IP → INSERT into `api_key_usage_log` (fire-and-forget).

## Env

`DATABASE_URL`, `REDIS_URL`, `EVENT_LOG_URL`, `API_PUBLIC_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add new scope | `routers/keys.py:RESOURCE_SCOPES` + scope check in `routers/endpoints.py`. |
| GraphQL endpoint | `routers/endpoints.py` — new `POST /v1/graphql`. |
| Field projection (`select=...`) | `routers/endpoints.py:GET /v1/{slug}` query parser + SQL builder. |
| Distributed rate limiting | `rate_limit.py` — replace in-memory with Redis. |
| Webhook secrets | extend `api_keys` with `webhook_secret`; auto-generate on POST. |
| OpenAPI spec generator | `main.py` — generate from `api_endpoints` table on startup. |
