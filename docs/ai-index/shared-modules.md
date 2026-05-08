# `backend/shared/` — Cross-service libraries

Every backend service imports from here. **Do not duplicate** — fix it here once.

Path: `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/shared/`

## Files

```
shared/
├── auth_middleware.py      JWT validation FastAPI dependency (require_auth, require_role)
├── llm_router.py           Per-tenant LLM provider resolution (model_providers table reader)
├── models.py               Shared Pydantic schemas (Pipeline, ObjectType, FieldInference, …)
├── enums.py                SemanticType, PiiLevel, NodeType, Role, Permission, PipelineStatus
├── token_tracker.py        Fire-and-forget POST to admin-service for token usage
├── pricing.py              MODEL_PRICES_PER_M + compute_cost_usd(...)
├── query_cache.py          Redis cache + single-flight + invalidation
├── rollup_promoter.py      Hot-query promotion + background refresher
├── index_advisor.py        Auto CREATE INDEX CONCURRENTLY for slow JSONB queries
└── nexus_logging.py        Structured JSON logger (configure_logging, get_logger)
```

---

## auth_middleware.py

Used by **every** protected endpoint. RS256 JWT validation with cached JWKS public key.

**Exports:**
- `require_auth(authorization, x_tenant_id) -> AuthUser` — FastAPI dependency.
- `require_role(*roles)` — factory dependency that checks `user.role in roles`.
- `require_superadmin()` — convenience for `require_role("superadmin")`.
- `AuthUser(id, email, role, tenant_id, impersonated_by=None)` with `.is_admin()`, `.is_at_least_analyst()`.

**Mechanism:**
- Fetches `{AUTH_SERVICE_URL}/.well-known/jwks.json` once, caches in module-global `_cached_public_key`.
- Decodes JWT with `python-jose`, validates issuer (`JWT_ISSUER`).
- Bypasses entirely when `SKIP_AUTH=true` (default in dev), returning a synthetic dev user.
- Raises `HTTPException(503)` when auth-service is unreachable; key cache cleared on JWT errors so a rotation recovers.

**Env:** `AUTH_SERVICE_URL`, `JWT_ISSUER`, `SKIP_AUTH`.

**When to edit:**
- Add new role → also add to `auth_service/routers/users.py` validation.
- Add JWT claim → also update `auth_service/jwt_utils.py:create_access_token`.
- Add per-method scope check → write a new `require_*` factory.

---

## llm_router.py

**The** decision point for every LLM call. Resolves which provider/key/model to use for a tenant.

**Exports:**
- `resolve_provider(tenant_id, provider_id=None, model=None) -> ProviderConfig`
- `resolve_provider_for_model(tenant_id, model_id) -> ProviderConfig`
- `ProviderConfig(provider_type, api_key, base_url, model, provider_id, provider_name)`

**Resolution order:**
1. Explicit `provider_id` → exact row from `model_providers` if `enabled=True`.
2. Tenant default → row with `is_default=True AND enabled=True`.
3. First enabled provider for tenant.
4. **Env fallback** → `ANTHROPIC_API_KEY` + `claude-haiku-4-5-20251001`.

**Database:** Reads `model_providers` table (managed by **agent-service**). Has both async and sync engines (sync used in non-async contexts like APScheduler jobs).

**When to edit:**
- Add new provider type → extend `_default_model_for()` mapping; update agent-service `routers/model_providers.py:VALID_TYPES`.
- Change fallback model → `DEFAULT_ANTHROPIC_MODEL` constant.
- Add API key encryption at rest → `model_providers.api_key_encrypted` column + decrypt here.

---

## models.py

Shared Pydantic schemas. **Don't duplicate** these in service-local `models.py` — import from here.

Key classes:
- `FieldInference`, `InferenceResult`, `InferenceField` — schema inference.
- `Pipeline`, `PipelineNode`, `PipelineEdge` — DAG model.
- `ObjectType`, `ObjectProperty`, `ObjectTypeVersion`, `OntologyLink` — ontology.
- `EnrichmentProposal`, `FieldConflict`, `ConflictResolutionRecord` — schema mapping.
- `SimilarityScore`, `CorrelationMatch` — correlation_engine output.
- `Event` — process mining event.
- `Process` — multi-object process definition.
- `AuditEvent` — audit trail row.

---

## enums.py

```
SemanticType:    TEXT, EMAIL, IDENTIFIER, PERSON_NAME, PHONE, DATE, DATETIME,
                 QUANTITY, STATUS, CATEGORY, URL, CURRENCY, BOOLEAN
PiiLevel:        NONE, LOW, MEDIUM, HIGH
DataType:        string, integer, float, boolean, datetime, json, array
ConflictType:    field_type_mismatch, missing_in_source, extra_in_source
ConflictResolution: ignore, override, merge, manual_review
Role:            ADMIN, DATA_ENGINEER, ANALYST, VIEWER, SERVICE_ACCOUNT, AUDITOR
Permission:      READ_CONNECTORS, WRITE_PIPELINES, READ_AUDIT, ADMIN_ALL, …
NodeType:        SOURCE, FILTER, MAP, ENRICH, FLATTEN, PIVOT, LLM_CLASSIFY, DEDUPE,
                 CAST, VALIDATE, SINK_OBJECT, SINK_EVENT, AGENT_RUN
PipelineStatus:  DRAFT, RUNNING, COMPLETED, FAILED, PAUSED, IDLE
```

**When to edit:**
- Add semantic type → also update `inference-service/claude_client.py` prompts and `correlation-engine/scorer.py` join suggestions.
- Add PII level → also update `ontology-service/routers/records.py:_mask_pii()`.
- Add NodeType → implement executor in `pipeline-service/dag_executor.py`.

---

## token_tracker.py

Non-blocking background reporter for LLM token usage.

**Usage:**
```python
from shared.token_tracker import track_token_usage

track_token_usage(
    tenant_id="tenant-001",
    service="agent-service",
    model="claude-haiku-4-5-20251001",
    input_tokens=1500,
    output_tokens=400,
    user_id="usr_123",  # optional
)
```

**Mechanism:** Creates `asyncio.Task` (or background thread if not in an event loop) → POST `{ADMIN_SERVICE_URL}/admin/token-usage` with `x-internal: nexus-internal` header. 2-second timeout. Failures silently logged.

**When to edit:**
- Add cache token reporting (cache_creation/read) → extend payload + admin-service `token_usage` table.
- Change endpoint → also update `admin-service/routers/admin.py`.

---

## pricing.py

Per-token pricing in USD per million tokens.

**`MODEL_PRICES_PER_M`** — dict keyed by model id. Includes Anthropic, Bedrock, OSS local models.

**`compute_cost_usd(model, input_tokens, output_tokens, cache_creation_tokens=0, cache_read_tokens=0) -> float`**
- Cache creation multiplier: 1.25× input
- Cache read multiplier: 0.10× input

**When to edit:**
- New model → add row with `{input, output}` USD/M.
- Update prices → just edit the dict; admin-service `/usage` endpoints recompute from raw token counts.

---

## query_cache.py

Redis-backed result cache for `/aggregate` queries.

**Exports:**
- `canonical_query_hash(payload) -> str` — sha256 of canonicalized JSON.
- `aggregate_cache_key(tenant_id, object_type_id, query_hash) -> str` — `agg:{tenant}:{ot}:{hash}`.
- `get_cached(key) -> dict | None`
- `set_cached(key, value, ttl_seconds)` — also adds key to invalidation index `agg-idx:{tenant}:{ot}`.
- `get_or_compute(key, compute, ttl_seconds) -> (value, from_cache)` — single-flight, dedupes concurrent callers.
- `invalidate_object_type(tenant_id, ot_id)` — wipes all cached aggregations for one OT (called after writes).

**TTL env vars:** `QUERY_CACHE_TTL_SECONDS` (default 60s), `QUERY_CACHE_ROLLUP_TTL_SECONDS` (default 3600s).

**When to edit:**
- Add new cache namespace → write `*_cache_key()` helper using same prefix-index pattern.
- Tighter invalidation → fire from more places (currently ontology records.py write paths).

---

## rollup_promoter.py

Materializes hot queries by promoting them to long TTL + background refresh.

**Mechanism:**
1. Every cache hit → `record_hit(key)` increments a counter in a sliding window.
2. When hits ≥ `ROLLUP_PROMOTE_THRESHOLD` (default 20) within `ROLLUP_PROMOTE_WINDOW_SECONDS` (600s), `maybe_promote(key, recompute_fn, index_key)` registers it.
3. A background `_refresher_loop()` (spawned lazily) recomputes every `ROLLUP_REFRESH_INTERVAL_SECONDS` (120s).
4. Idle queries pruned after `PRUNE_AFTER_S` (1800s).

**When to edit:**
- Tune thresholds via env vars in `docker-compose.yml` ontology-service block.
- Add metrics export → log promoted-key set size.

---

## index_advisor.py

Auto-creates indexes when aggregate queries cross the slow threshold.

**Exports:**
- `maybe_create_indexes_for(engine, fields, elapsed_ms)` — schedule index creation if `elapsed_ms > AGGREGATE_SLOW_THRESHOLD_MS` (500ms default).
- `maybe_create_timestamp_index(engine, field, elapsed_ms)` — special timestamptz expression index for time_bucket queries.

**SQL pattern:**
```sql
CREATE INDEX IF NOT EXISTS idx_or_data_<field> ON object_records ((data->>'<field>'));

CREATE INDEX IF NOT EXISTS idx_or_data_<field>_ts ON object_records (
  CASE WHEN data->>'<field>' ~ '^[[:digit:]]{4}-...'
  THEN NULLIF(data->>'<field>', '')::timestamptz
  ELSE NULL END
);
```

**Idempotency:** in-memory `_attempted` set + `IF NOT EXISTS` clause. Never re-creates within process lifetime.

**Disable:** `AGGREGATE_AUTO_INDEX=false`.

---

## nexus_logging.py

Stdout JSON logger for log shipping (CloudWatch / Elastic / Splunk).

**Usage:**
```python
from shared.nexus_logging import configure_logging, get_logger

configure_logging(level="INFO")  # call once on startup
log = get_logger(__name__)

log.info("pipeline.run.started", extra={"pipeline_id": pid, "tenant_id": tid})
```

Output line: `{"ts":"...","level":"INFO","logger":"pipeline_service.dag_executor","msg":"...","pipeline_id":"...","tenant_id":"..."}`

Used by `scripts/setup-log-shipping.sh` Filebeat / Fluentd shipping.

**When to edit:**
- Add new top-level fields (request_id, trace_id) → add to formatter.
- Add log sampling → wrap handler.

---

## When to add a new file to `shared/`

- The behavior is repeated in 3+ services (rule of three).
- It depends on cross-cutting infrastructure (Redis, Postgres, JWT) where the abstraction lives above any single service.
- It's policy (token tracking, audit, retention) that must be uniform across services.

Otherwise leave it in the calling service. `shared/` is **not** a junk drawer.
