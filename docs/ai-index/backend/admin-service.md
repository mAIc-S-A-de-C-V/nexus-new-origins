# admin-service (port 8022)

**Purpose:** Platform-level administration. Tenant CRUD, plans, token usage aggregation, Bedrock model gating.
**Stack:** Python FastAPI, asyncpg.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/admin_service/`

## Files

```
admin_service/
├── main.py            FastAPI; lifespan get_pool/close_pool
├── database.py        asyncpg pool (Postgres + optional TimescaleDB pool with graceful fallback)
└── routers/
    └── admin.py       Tenants CRUD + token-usage aggregation + Bedrock catalog
```

## Tables

```
tenants:
  id PK (e.g. tenant-001 or tenant-{uuid8}), name, slug UNIQUE,
  plan (free|pro|enterprise), status (active|suspended|trial),
  allowed_modules TEXT[], settings JSONB, bucket_tier (S|M|L|XL|XXL),
  created_at, updated_at

token_usage:
  id, tenant_id, service, model, input_tokens, output_tokens, user_id, created_at

tenant_bedrock_models:
  tenant_id, model_id, enabled_at, enabled_by   PRIMARY KEY (tenant_id, model_id)
```

## Endpoints

### `/admin/tenants` (superadmin)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/tenants` | List all. |
| POST | `/admin/tenants` | Create (`tenant-{uuid8}`); slug must be unique. |
| PATCH | `/admin/tenants/{id}` | Update name/plan/status/allowed_modules. |
| DELETE | `/admin/tenants/{id}` | 204. **Cannot delete `tenant-001`.** |

### `/admin/tenants/{id}/usage`

Comprehensive aggregation:
```
{
  total_input_tokens, total_output_tokens,
  month_input_tokens, month_output_tokens,
  connectors_count, pipelines_count, agents_active_count,
  pipelines_running_count, events_count,
  llm_cost_this_month_usd
}
```

Cost computed from `token_usage` × `shared/pricing.py:MODEL_PRICES_PER_M`.

### `/admin/token-usage` (internal)

`POST /admin/token-usage` requires header `x-internal: nexus-internal`. Body `{tenant_id, service, model, input_tokens, output_tokens, user_id?}`. INSERT.

This is what `shared/token_tracker.py` calls fire-and-forget from every LLM-using service.

## Env

`DATABASE_URL`, `AUTH_SERVICE_URL`, `EVENT_LOG_URL`, `SKIP_AUTH`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add tenant attribute | `database.py:INIT_SQL` + `_row_to_dict()` + relevant routers. |
| Token quota enforcement | `routers/admin.py:POST /token-usage` — check before insert. |
| Cost forecasting | `routers/admin.py:GET .../usage` — extend with linear regression. |
| Tenant suspension flow | `routers/admin.py:PATCH .../tenants/{id}` — gate other services on `tenants.status`. |
| Usage export | `GET /admin/tenants/{id}/usage/export?format=csv`. |
