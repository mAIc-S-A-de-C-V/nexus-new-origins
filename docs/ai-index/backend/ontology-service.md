# ontology-service (port 8004)

**Purpose:** **The hub.** Object types, properties, relationships, schema versioning, record persistence (JSONB), aggregate queries, dashboards/apps, multi-stage approval workflows, document storage (MinIO), external app shares, scenario resolver.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, httpx, minio, passlib, python-jose. Largest backend service.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/ontology_service/`

## Files

```
ontology_service/
├── main.py                  FastAPI, all 9 routers, exception handlers w/ CORS, body-size limit, security headers, retention loop, SLA loop spawn
├── database.py              ORM: ObjectTypeRow, ObjectTypeVersionRow, OntologyLinkRow, ObjectRecordRow, AppRow, AppVersionRow, AppShareRow, ActionDefinitionRow, ActionExecutionRow, NotificationRow, NotebookRow
├── event_emit.py            Fire-and-forget event/audit emission (capped per-record events, semaphore-bounded)
├── scenario_resolver.py     3-scenario algorithm (enrich >0.85 / conflict 0.50–0.85 / new <0.50)
├── workflow.py              Workflow state machine: advance_stage(), JSONLogic _eval_when, normalize_assignee_spec, resolve_conditional_next
├── workflow_sla.py          Background SLA escalation loop (60s tick) — auto-approve/reject/reassign on timeout
├── share_utils.py           Token gen, bcrypt password hashing, JWT share sessions, scope merge
├── user_directory.py        HTTP to auth-service to resolve assignees
├── jsonlogic.py             JSONLogic evaluator for conditional stage entry
├── routers/
│   ├── ontology.py          Object types CRUD, versions, diffs, links, enrichment
│   ├── records.py           LARGEST. List, aggregate, sync, ingest, patch, delete, stream, indexes, array-append
│   ├── apps.py              Dashboards (ephemeral, system, slugged)
│   ├── actions.py           Action definitions + executions (multi-stage)
│   ├── workflow.py          Stage decisions, queue, notifications
│   ├── graph.py             Type-level + record-level graph traversal
│   ├── notebooks.py         Notebook CRUD
│   ├── documents.py         MinIO upload + extraction status
│   └── shares.py            Creator-side (auth) + public (no auth) share APIs
├── tests/                   query_cache, index_advisor, rollup_promoter, aggregate
├── requirements.txt
└── Dockerfile
```

## Database (Postgres, JSONB-heavy)

| Table | Notes |
|-------|-------|
| `object_types` | id, tenant_id, name, display_name, version, data JSONB (full ObjectType) |
| `object_type_versions` | per-version snapshot |
| `ontology_links` | source_object_type_id, target_object_type_id, data JSONB (relationship + join_keys + cardinality + confidence) |
| `object_records` | id, object_type_id, tenant_id, source_id, data JSONB, created_at, updated_at — **the hot table**, JSONB GIN-indexed for aggregates |
| `apps` | id, tenant_id, name, object_type_ids, components, settings, kind (`dashboard`/`app`), is_ephemeral, expires_at, is_system, slug |
| `app_versions` | snapshots pinned to external shares |
| `app_shares` | token UNIQUE, mode (`submit`/`view`), access_mode (`public`/`password`/`email_whitelist`/`nexus_user`), max_uses, expires_at |
| `action_definitions` | input_schema, requires_confirmation, workflow_stages |
| `action_executions` | status, current_stage, stage_state, stage_history |
| `notifications` | per-user kind/title/body/deep_link/read_at |
| `notebooks` | name, cells |

Pool sized for high concurrency: 20 + 40 overflow, 30s timeout, 1800s recycle. Aggregate queries hold connections during HashAggregate.

## Endpoints (categorized)

### `/object-types` (`routers/ontology.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/object-types` | List tenant OTs. |
| POST | `/object-types` | Create + snapshot v1. |
| GET | `/object-types/{ot_id}` | Get. |
| PUT | `/object-types/{ot_id}` | Update + auto-snapshot. |
| DELETE | `/object-types/{ot_id}` | Hard delete + versions. |
| GET | `/object-types/{ot_id}/versions` | All versions. |
| GET | `/object-types/{ot_id}/diff/{v1}/{v2}` | Field add/remove/type-change diff. |
| POST | `/object-types/{ot_id}/set-pipeline` | Assign authoritative pipeline. |
| POST | `/object-types/{ot_id}/enrich` | Apply enrichment proposal (add fields + links). |
| GET | `/object-types/links/all` | All links. |
| POST | `/object-types/links` | Create link. |
| DELETE | `/object-types/links/{link_id}` | Delete. |

### Records (`routers/records.py` — heavy)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/object-types/{ot_id}/records` | List with filters/sort/pagination. |
| POST | `/object-types/{ot_id}/aggregate` | **Heavy.** GROUP BY, time_bucket, filters, SUM/COUNT/AVG. Uses query_cache + rollup_promoter + index_advisor. |
| POST | `/object-types/{ot_id}/indexes` | Create JSONB index manually. |
| GET | `/object-types/{ot_id}/stream` | SSE stream of new records. |
| POST | `/object-types/{ot_id}/timescale-migrate` | (deprecated). |
| GET | `/object-types/{ot_id}/records/{rid}` | One record. |
| GET | `/object-types/{ot_id}/records/{rid}/links/{link_id}` | Traverse link. |
| PATCH | `/object-types/{ot_id}/records/{rid}` | Partial JSONB merge. |
| DELETE | `/object-types/{ot_id}/records` | Bulk filter delete. |
| DELETE | `/object-types/{ot_id}/records/{rid}` | Single. |
| POST | `/object-types/{ot_id}/records/sync` | Fetch from sources, merge nested arrays, upsert. |
| POST | `/object-types/{ot_id}/records/ingest` | Batch ingest pre-merged (called by pipeline SINK_OBJECT and inference). |
| POST | `/object-types/{ot_id}/records/array-append` | Append to nested array fields. |
| GET | `/_cache/stats` | Internal Redis cache stats. |

Aggregate cache key: `agg:{tenant}:{ot}:{sha256(query)}`. Filter ops: eq, neq, gt, gte, lt, lte, in, contains, is_null. Time bucket normalizes ISO date strings for timestamptz casting.

PII masking: `_mask_pii()` redacts HIGH-PII fields for `viewer` role users.

### Apps (`routers/apps.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/apps` | List (filter object_type, kind, include_ephemeral). |
| GET | `/apps/recent-generated` | Recently AI-generated ephemeral. |
| GET | `/apps/by-slug/{slug}` | System dashboards (e.g. `dashboards-home`). |
| POST | `/apps` | Create. Ephemeral apps expire 7 days unless saved. |
| GET/PUT/DELETE | `/apps/{id}` | CRUD. |

### Actions (`routers/actions.py`) + Workflow (`routers/workflow.py`)

Multi-stage approval engine. Stage types: `approval`, `option_review`, `option_select`, `parallel_group`. SLA timer per stage; `workflow_sla.py` background loop auto-approves/rejects/reassigns on timeout.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/actions/{id}/execute` | Propose execution → walks `workflow_stages` |
| POST | `/actions/{exec_id}/confirm` / `/reject` | Legacy single-stage |
| POST | `/workflow/decisions/{exec_id}` | Submit `approve`/`reject`/`review_options`/`select_options` for current stage |
| GET | `/workflow/queue` | Items assigned to me / unassigned / all |
| GET | `/workflow/notifications` | My unread notifications |

### Documents (`routers/documents.py`)

MinIO bucket `nexus-documents`. Key format `{tenant_id}/{document_id}/{filename}`. Auto-creates a `Document` ObjectType on first upload with properties: `original_filename`, `mime_type`, `size_bytes`, `file_url`, `storage_key`, `ocr_text`, `extracted_fields`, `extraction_status`, `linked_record_id`.

| Method | Path |
|--------|------|
| POST | `/documents/upload` (multipart) |
| GET | `/documents/{id}` |
| GET | `/documents/{id}/file` |
| PATCH | `/documents/{id}/extracted-fields` (called by inference-service) |
| GET | `/documents/by-record/{ot_id}/{rid}` |

### Shares (`routers/shares.py`)

Creator-side (auth) and public (no auth) routes:
- Creator: POST/GET/PATCH/DELETE `/shares/apps/{app_id}/shares`.
- Public: GET `/s/{token}`, POST `/s/{token}/auth`, GET `/s/{token}/app`, GET `/s/{token}/records`, POST `/s/{token}/aggregate`, POST `/s/{token}/submit`.

Share session JWT (HS256, 30min). Bcrypt passwords. Scope filters merged into queries server-side. PII masking still applies.

## Cross-service calls

| → | URL | Why |
|---|-----|-----|
| connector-service | `/sync` | Fetch records from sources for `/records/sync`. |
| event-log-service | `/events` (fire-and-forget) | Process mining events. |
| audit-service | `/audit` (fire-and-forget) | Audit trail. |
| auth-service | `/users/{user_id}` | Resolve assignees in workflow. |
| inference-service | `/vision/{doc_id}` (planned) | OCR documents. |
| MinIO | `nexus-documents` bucket | File storage. |

## Env

`DATABASE_URL`, `TIMESCALE_URL`, `REDIS_URL`, `QUERY_CACHE_TTL_SECONDS` (60), `QUERY_CACHE_ROLLUP_TTL_SECONDS` (3600), `AGGREGATE_AUTO_INDEX` (true), `AGGREGATE_SLOW_THRESHOLD_MS` (500), `ROLLUP_PROMOTE_THRESHOLD` (20), `ROLLUP_PROMOTE_WINDOW_SECONDS` (600), `ROLLUP_REFRESH_INTERVAL_SECONDS` (120), `RECORD_RETENTION_DAYS` (730), `CONNECTOR_SERVICE_URL`, `INFERENCE_SERVICE_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_PUBLIC_BASE`, `EVENT_LOG_SERVICE_URL`, `AUDIT_SERVICE_URL`, `AUTH_SERVICE_URL`, `SHARE_SESSION_TTL_MIN` (30), `EPHEMERAL_TTL_DAYS` (7).

## When to edit

| Intent | File |
|--------|------|
| Add a new aggregate function (PERCENTILE, MEDIAN) | `routers/records.py:build_aggregate_sql()`. |
| Add a new filter operator | `routers/records.py:_FILTER_OPS` + `_build_jsonb_filters()`. |
| Add a new PII level | `shared/enums.py:PiiLevel` + `routers/records.py:_mask_pii`. |
| Change record retention | env `RECORD_RETENTION_DAYS` or loop in `main.py`. |
| Add a workflow stage type | `workflow.py:advance_stage()` (sentinel + handler) + validate in `routers/actions.py`. |
| Add an OIDC-style scope to shares | `routers/shares.py` access_mode + `share_utils.merge_filter_json()`. |
| Add new ontology link confidence rule | `routers/graph.py:expand` + `scenario_resolver.py`. |
| Change scenario thresholds | `scenario_resolver.py` constants `ENRICHMENT_THRESHOLD` etc. |
| Add a new app kind | extend `kind` filter in `routers/apps.py:list_apps`. |
| Add a new dashboard widget output | record-emit in `event_emit.py` + frontend `WidgetRenderer.tsx`. |
| MinIO bucket migration | `routers/documents.py:_minio_client()` + bucket name env. |
