# connector-service (port 8001)

**Purpose:** Manage data source connectors. Stores AES-256-GCM-encrypted credentials, tests connections, discovers schemas, receives inbound webhooks.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, httpx, cryptography, openpyxl.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/connector_service/`

## Files

```
connector_service/
├── main.py                    FastAPI app, CORS, body-size limit, security headers
├── database.py                SQLAlchemy: ConnectorRow, WebhookEndpointRow + init_db migrations
├── models.py                  Pydantic: ConnectorConfig, ConnectorPublicView, ConnectorCreateRequest, ConnectionTestResult, WebhookCreate
├── credential_crypto.py       AES-256-GCM encrypt/decrypt for credentials JSON
├── schema_fetcher.py          fetch_schema() + test_credentials() per connector type
├── db_connector.py            PostgreSQL + MySQL introspection (list_tables, table_schema, preview, run_query)
├── email_connector.py         IMAP fetcher (Gmail/Outlook/Yahoo/iCloud/Zoho/FastMail/Custom)
├── auth_middleware.py         Local copy of shared JWT validation
├── routers/
│   ├── connectors.py          Connector CRUD + schema + test + fetch-row + emails/fetch
│   └── webhooks.py            Webhook CRUD + inbound /receive/{slug}
├── requirements.txt
└── Dockerfile
```

## Endpoints

### `/connectors` (auth required, prefix mounted in main.py)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/connectors` | List tenant connectors (filters: `category`, `status`). Returns `ConnectorPublicView[]` (creds masked). |
| POST | `/connectors` | Create connector. Body `ConnectorCreateRequest`. Encrypts credentials. Emits `CONNECTOR_CREATED` event. |
| GET | `/connectors/{id}` | Public view (no creds). |
| GET | `/connectors/{id}/internal` | **Service-to-service only.** Full decrypted creds. Guarded by `x-internal: {INTERNAL_SECRET}` header. Used by pipeline-service, agent-service. |
| PUT | `/connectors/{id}` | Partial update. |
| DELETE | `/connectors/{id}` | 204. |
| POST | `/connectors/{id}/test` | Validates creds against the live source. Updates status to `active` or `error`. Emits test event. |
| GET | `/connectors/{id}/schema` | Real schema + sample rows from source. Calls `schema_fetcher.fetch_schema()`. |
| POST | `/connectors/{id}/fetch-row` | Per-row detail lookup with param overrides. Used by pipeline ENRICH nodes. Body `{"params": {...}}`. |
| GET | `/connectors/{id}/emails/fetch` | **Internal.** IMAP fetch. Query params: `folder`, `limit`, `since` (ISO 8601), `include_attachments`, `max_attachment_bytes`. |

### `/webhooks` (no auth — inbound from external systems)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/webhooks` | List tenant webhooks. |
| POST | `/webhooks` | Register a webhook. Body: `name, slug, secret, target_type (pipeline\|action\|event_log), target_id, field_mappings, enabled`. Auto-slug if not provided. |
| DELETE | `/webhooks/{id}` | 204. |
| POST | `/webhooks/receive/{slug}` | **External inbound.** HMAC-SHA256 validation via `X-Hub-Signature-256` (or `X-Signature-256`). Field mappings remap incoming JSON → target keys. Routes to pipeline `/run`, event-log `/events/batch`, or echoes for action targets. |

## Database (Postgres)

**`connectors`** (`ConnectorRow`):
```
id PK, tenant_id (idx), name, type, category, status, description, base_url, auth_type,
credentials TEXT (AES-256-GCM b64),
headers JSON, pagination_strategy, active_pipeline_count, last_sync, last_sync_row_count,
schema_hash, tags JSON, config JSON, inference_result JSON, inference_ran_at,
created_by, visibility, created_at, updated_at
```

**`webhook_endpoints`** (`WebhookEndpointRow`):
```
id PK, tenant_id (idx), name, slug UNIQUE, secret, target_type, target_id,
field_mappings JSON, enabled, last_received_at, created_at
```

`init_db()` runs `ALTER TABLE ADD COLUMN IF NOT EXISTS` for new columns (config, inference_result, inference_ran_at, created_by, visibility) — additive migrations only.

## Supported connector types (`schema_fetcher.py`)

`HUBSPOT`, `SALESFORCE`, `FIREFLIES`, `GITHUB`, `REST_API`, `WHATSAPP` (via whatsapp-service), `EMAIL_INBOX` (via `email_connector.py`), `GRAFANA_INFLUX`, `RELATIONAL_DB` (PostgreSQL/MySQL via `db_connector.py`), `MONGODB`, `DATA_WAREHOUSE`.

`REST_API` is the heavy one — supports:
- Date templates: `{{$today:FORMAT}}`, `{{$daysAgo:N:FORMAT}}`, `{{$lastRun:FORMAT}}`.
- Connector reference templates: `{{connector:id:field.path}}` (recursive call).
- Auth modes: static token, login endpoint POST/PUT, referenced connector token, basic, API key header.
- Range partition scans: `{{$range:min:max}}` iterates a param over a numeric range.
- SSL toggle via `verify_ssl` config.

## Cross-service calls

| Direction | URL | Purpose |
|-----------|-----|---------|
| → out | `EVENT_LOG_SERVICE_URL/events` | Fire-and-forget connector lifecycle events. |
| → out | `WHATSAPP_SERVICE_URL/...` | WhatsApp connector schema fetching. |
| ← in | `pipeline-service` → `/connectors/{id}/internal` (with `x-internal`) | Decrypted creds for SOURCE nodes. |
| ← in | `pipeline-service` → `/connectors/{id}/fetch-row` | ENRICH node lookups. |
| ← in | `pipeline-service` → `/connectors/{id}/emails/fetch` | Email SOURCE nodes. |
| ← in | webhook receivers → `pipeline-service /pipelines/{id}/run` and `event-log-service /events/batch` | Webhook routing. |

## Env

`DATABASE_URL`, `REDIS_URL`, `EVENT_LOG_SERVICE_URL`, `WHATSAPP_SERVICE_URL`, `AUTH_SERVICE_URL`, `INTERNAL_SECRET` (default `nexus-internal`), `CREDENTIAL_ENCRYPTION_KEY` (32-byte hex; **dev fallback is all zeros — set this in prod**), `MAX_BODY_SIZE_MB` (10), `SKIP_AUTH`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add a new connector type | `schema_fetcher.py` (new `_<type>_schema` function + dispatch in `fetch_schema()` / `test_credentials()`); UI at `frontend/src/modules/connectors/connectorTypes.ts` + new SetupModal. |
| Add a new auth flow (OAuth2 client credentials, Digest, …) | `schema_fetcher.py:_resolve_bearer_token()` + `_rest_api()`. |
| Support a new database engine (Snowflake, Redshift, BQ) | `db_connector.py` + extend `RELATIONAL_DB` dispatch. |
| New email provider preset | `email_connector.py` `PROVIDERS` dict. |
| Change credential encryption | `credential_crypto.py`. Migrating algos requires re-encrypting all rows. |
| Add new column to `connectors` | `database.py:ConnectorRow` + add ALTER in `init_db()`. |
| Webhook signature scheme | `routers/webhooks.py:receive`. |
| Field-mapping DSL | `routers/webhooks.py:_apply_mappings`. |
| Change visibility/permission model | `routers/connectors.py` filter clauses + `auth_middleware.py`. |
