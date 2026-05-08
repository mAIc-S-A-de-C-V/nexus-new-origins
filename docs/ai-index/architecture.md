# Architecture

Cross-cutting infra: how the 27 services compose, how requests reach them, how tenants stay isolated, and which infra components are shared.

## High-level

```
                                ┌──────────────┐
                  HTTPS 443/UDP │  Caddy / nginx │  TLS termination, rate-limit zones,
                                └──────┬─────────┘  prefix-strip routing
                                       │
                       ┌───────────────┼───────────────┐
                       ▼               ▼               ▼
                ┌────────────┐  ┌────────────┐  ┌────────────┐
                │  frontend  │  │  /api/*    │  │  /auth/*   │
                │ React SPA  │  │  27 svcs   │  │ auth-svc   │
                │ port 3000  │  │ 8001-8027  │  │ port 8011  │
                └────────────┘  └─────┬──────┘  └─────┬──────┘
                                      │               │
                                      ▼               ▼
              ┌──────────────────────────────────────────────────┐
              │   Internal docker network: nexus-net (bridge)    │
              └──────────────────────────────────────────────────┘
                              │           │           │
                              ▼           ▼           ▼
                       ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
                       │ Postgres │ │TimescaleDB│ │  Redis   │ │  MinIO   │
                       │ 16 (5432)│ │  (5434)  │ │ 7 (6379) │ │ S3 9100  │
                       └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

## Networking

- All inter-service URLs go through the `nexus-net` docker bridge by service hostname (e.g. `http://ontology-service:8004`).
- External clients hit Caddy (`caddy/Caddyfile`) or nginx (`nginx/nginx.conf`) which path-routes:
  - `/` → frontend:3000
  - `/auth/*` → auth-service:8011
  - `/api/{servicename}/*` → corresponding backend (Caddy strips the `/api/{servicename}` prefix)
- Caddy issues + auto-renews Let's Encrypt certs as long as port 80/443 are open and `${DOMAIN}` resolves to the host.

## Persistence

| Store | Image | Purpose | Used by |
|-------|-------|---------|---------|
| Postgres 16 | `postgres:16-alpine` | Main relational DB (users, tenants, ontology, pipelines, agents, …) | most services |
| TimescaleDB | `timescale/timescaledb:latest-pg16` | `events` hypertable (process mining) | event-log, process-engine, alert-engine |
| Redis 7 | `redis:7-alpine` | Cache (query results, rollups, OIDC state) + pub/sub | ontology, analytics, auth, api-gateway |
| MinIO | `minio/minio:latest` | S3-compatible object storage for documents | ontology (`nexus-documents` bucket) |
| Backups | `postgres:16-alpine` cron | Daily encrypted dumps of both DBs | `scripts/backup.sh` |

Postgres is sized intentionally (`shared_buffers=384MB`, `work_mem=16MB`, `mem_limit: 2g`) to absorb concurrent `/aggregate` HashAggregates without OOM. TimescaleDB has its own tuning at 2g — auto-tuned shared_buffers against host RAM was getting OOM-killed under load.

## Multi-tenancy

- Every row in every shared table has a `tenant_id` column.
- The `Authorization: Bearer <JWT>` header carries `tenant_id` in the JWT payload.
- Service-to-service calls also accept `x-tenant-id` header for read flows where a JWT isn't appropriate.
- Cross-tenant access is restricted to role `superadmin`. The auth service models impersonation by adding `impersonated_by` to the JWT.
- Demo tenants are seeded via `scripts/seed_demo_tenants.py` (ITSM, finance, healthcare, gov, manufacturing, travel, demo).
- MJSP prod tenant id is `tenant-2e382f99` (not the slug-style `tenant-mjsp-sv`).

## Auth flow (RS256 JWT + JWKS)

1. User logs in (`POST /auth/login` with email + password) or completes OIDC (`GET /auth/oidc/{provider}/callback`).
2. `auth-service` signs a 15-min access token with its RSA private key (PEM via `JWT_PRIVATE_KEY_PEM` env, or ephemeral 2048-bit key in dev).
3. A 7-day refresh token is set as an `httponly` cookie (`nexus_refresh`) with hash stored in `auth_refresh_tokens`.
4. Every other service calls `GET {AUTH_SERVICE_URL}/.well-known/jwks.json` once on first request, caches the public key in memory, and validates incoming JWTs locally with `python-jose`. See `backend/shared/auth_middleware.py`.
5. `SKIP_AUTH=true` (default in compose) bypasses validation in dev — production override `docker-compose.prod.yml` sets it to `false` and `JWT_PRIVATE_KEY_PEM` is required.

JWT claims actually issued: `sub` (user_id), `email`, `name`, `role` (superadmin/admin/analyst/viewer), `tenant_id`, `modules` (allowed_modules list), `impersonated_by` (optional), plus standard `iss`/`iat`/`exp`.

Account lockout: 5 failed password attempts → 15-minute lockout (in `auth_users.locked_until`).

## LLM provider routing

`backend/shared/llm_router.py` is the single source of truth for which API key + base URL to use for any tenant LLM call:

- It queries `model_providers` (the table `agent-service` owns) for `tenant_id` with `enabled=true`.
- Resolution order: explicit `provider_id` → `is_default=True` → first enabled → env fallback.
- Env fallback uses `ANTHROPIC_API_KEY` with `claude-haiku-4-5-20251001` as default model.
- Returns a `ProviderConfig(provider_type, api_key, base_url, model)`.
- Token cost: `backend/shared/pricing.py` defines `MODEL_PRICES_PER_M` and `compute_cost_usd(...)` (cache-creation 1.25x, cache-read 0.10x).
- Token tracking: `backend/shared/token_tracker.py` POSTs fire-and-forget to `admin-service:8022/admin/token-usage` with a 2s timeout. Never blocks.

## Caching layer (ontology + analytics)

Three coordinated modules in `backend/shared/`:

- `query_cache.py` — Redis-backed result cache with single-flight (`get_or_compute`). Key format: `agg:{tenant}:{ot}:{sha256(canonical_query)}`. Default TTL 60s.
- `rollup_promoter.py` — When a key is hit ≥ 20 times in 600s, promote it: TTL bumps to 3600s and a background refresher recomputes every 120s. Pruned after 1800s idle.
- `index_advisor.py` — When an `/aggregate` query exceeds 500ms, schedule `CREATE INDEX CONCURRENTLY` on the slow JSONB fields. Idempotent via in-memory `_attempted` set + `IF NOT EXISTS`.

All three are gated by env vars (`AGGREGATE_AUTO_INDEX`, `AGGREGATE_SLOW_THRESHOLD_MS`, `ROLLUP_PROMOTE_THRESHOLD`, `ROLLUP_REFRESH_INTERVAL_SECONDS`, …) — see `docker-compose.yml` ontology-service block.

## Background jobs

| Service | Job | Cadence | Source |
|---------|-----|---------|--------|
| ontology-service | record retention loop | 24h | `main.py` |
| ontology-service | SLA escalation loop | 60s | `workflow_sla.py` |
| event-log-service | event retention loop (90d default) | 24h | `main.py` |
| audit-service | audit retention loop (365d default) | 24h | `main.py` |
| pipeline-service | poll-frequency scheduler | 60s | `scheduler.py` |
| pipeline-service | cron scheduler | 60s (offset 15s) | `cron_scheduler.py` |
| agent-service | APScheduler for agent schedules | per cron | `scheduler.py` |
| logic-service | APScheduler for function schedules | per cron | `scheduler.py` |
| alert-engine | APScheduler rule evaluator | per rule cooldown | `scheduler.py` |
| process-engine | implicit process discovery | startup-only | `database_pg.py` |
| backup-service | daily Postgres + Timescale dumps | `0 2 * * *` | `scripts/backup.sh` |
| shared/rollup_promoter | hot-query refresher | 120s | spawned lazily |

Pipeline orphan detection: any run still `RUNNING` for > `PIPELINE_STUCK_TIMEOUT_S` (default 1800s) is forcibly marked `FAILED` on next scheduler tick.

## Docker Compose

`docker-compose.yml` is the canonical orchestration. Each service uses `mem_limit` (most 384m, ontology + pipeline 1g, demo 1.5g, kernel 1g, postgres + timescale 2g) and a shared `&default-logging` block (json-file, 50m × 5 files).

Production override is `docker-compose.prod.yml` (`SKIP_AUTH=false`, secure cookies, JWT key required). HTTPS deploy override is `docker-compose.deploy.yml`.

## CI/CD

`.github/workflows/build-and-deploy.yml` runs on push to `main`:

1. **security-scan** — pip-audit + Trivy (HIGH/CRITICAL).
2. **python-syntax-check** — `python -m py_compile` over backend + nexus-apps.
3. **build-backend** — matrix of 27 services, 8 in parallel, push to `ghcr.io`.
4. **build-frontend** — Vite build with `VITE_*_URL` from secrets, push.
5. **deploy** — SSH to EC2, prune images, `docker-compose pull && up -d`.

Required secrets: `APP_DOMAIN`, `ANTHROPIC_API_KEY`, `ADMIN_SEED_PASSWORD`, EC2 SSH credentials.

## Where to look when…

- **A request 401s** — `backend/shared/auth_middleware.py`, then auth-service routers/auth.py.
- **An LLM call fails** — `backend/shared/llm_router.py`, then the calling service's tool/runner.
- **An aggregate query is slow** — check `query_cache`, `rollup_promoter`, `index_advisor` env vars and ontology-service `/aggregate` SQL builder.
- **A pipeline run is stuck** — `pipeline-service/scheduler.py` orphan detection + `dag_executor.py` step.
- **CORS rejected** — check `ALLOWED_ORIGINS` env on the target service in `docker-compose.yml`.
- **Cross-tenant data leaked** — search for missing `tenant_id` filter in the offending query. This is the #1 thing to audit on every PR.
