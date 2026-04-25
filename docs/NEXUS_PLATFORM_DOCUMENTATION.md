# Nexus Platform — Complete Documentation

> **Version:** 1.1
> **Last Updated:** 2026-04-20
> **Architecture:** 25+ microservices, React/TypeScript frontend, PostgreSQL + TimescaleDB, Redis

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture](#2-architecture)
3. [Authentication & Multi-Tenancy](#3-authentication--multi-tenancy)
4. [Connectors](#4-connectors)
5. [Ontology](#5-ontology)
6. [Pipeline Builder](#6-pipeline-builder)
7. [Graph Explorer](#7-graph-explorer)
8. [Data Explorer](#8-data-explorer)
9. [Data Quality](#9-data-quality)
10. [Apps](#10-apps)
11. [Logic Studio](#11-logic-studio)
12. [Agent Studio](#12-agent-studio)
13. [Human Actions](#13-human-actions)
14. [Process Mining](#14-process-mining)
15. [Evals](#15-evals)
16. [Utilities](#16-utilities)
17. [Value Monitor](#17-value-monitor)
18. [Activity & Audit](#18-activity--audit)
19. [Search](#19-search)
20. [Alerts](#20-alerts)
21. [Collaboration](#21-collaboration)
22. [API Gateway](#22-api-gateway)
23. [Projects](#23-projects)
24. [Finance](#24-finance)
25. [Admin Hub](#25-admin-hub)
26. [Superadmin Management](#26-superadmin-management)
27. [Nexus Assistant](#27-nexus-assistant)
28. [Settings & Health](#28-settings--health)
29. [Lineage](#29-lineage)
30. [Token Tracking](#30-token-tracking)
31. [Backend Services Reference](#31-backend-services-reference)
32. [Frontend Architecture](#32-frontend-architecture)
33. [Deployment](#33-deployment)

---

## 1. Platform Overview

Nexus is an enterprise data operations platform — a unified system for modeling real-world domains as semantic ontologies, connecting data sources, building transformation pipelines, running AI agents, mining processes, and tracking the operational value delivered by automation.

### Core Capabilities

| Capability | What It Does |
|---|---|
| **Connectors** | Register and manage external data sources (REST APIs, databases, files) |
| **Ontology** | Model real-world entities and their relationships as a semantic graph |
| **Pipelines** | Build DAG-based ETL workflows that hydrate the ontology from connectors |
| **Apps** | Create operational dashboards backed by live ontology data — with AI generation |
| **Logic Studio** | Build server-side automation workflows using composable blocks |
| **Agent Studio** | Configure and run Claude-powered AI agents with tool use |
| **Human Actions** | Human-in-the-loop approval for agent-proposed write operations |
| **Process Mining** | Analyze event logs for process patterns, bottlenecks, and conformance |
| **Evals** | Formal evaluation suites for testing AI agent and logic function outputs |
| **Value Monitor** | Track the business value delivered by automation use cases |
| **Utilities** | Pre-built enrichment tools: web scraping, OCR, geocoding, PDF extraction |
| **API Gateway** | Expose ontology data as external REST APIs with key-based authentication |

### Design Principles

- **Ontology-first:** Everything flows through the semantic data model. Raw data is translated into domain language at the pipeline level, not at the UI level.
- **Multi-tenant:** All data is scoped to a tenant via `x-tenant-id` headers. A single deployment serves multiple isolated organizations.
- **AI-native:** Claude is integrated at every layer — schema inference, app generation, agent execution, logic function generation, anomaly detection.
- **Human-in-the-loop:** Write operations proposed by AI agents require explicit human confirmation before execution.
- **Auditable:** Every action leaves a trace in the audit log. Pipeline runs, agent conversations, and approval decisions are all recorded.

---

## 2. Architecture

### Service Topology

```
┌─────────────────────────────────────────────────────────┐
│                     NGINX (port 80)                     │
│              Static files + API reverse proxy            │
└─────────────────────┬───────────────────────────────────┘
                      │
    ┌─────────────────┼──────────────────┐
    │                 │                  │
┌───▼───┐     ┌──────▼──────┐    ┌──────▼──────┐
│Frontend│     │ 25+ Backend │    │  Databases  │
│ React  │     │ Microsvcs   │    │ Postgres    │
│ :3000  │     │ :8001-9001  │    │ TimescaleDB │
└────────┘     └─────────────┘    │ Redis       │
                                  └─────────────┘
```

### Backend Services (25+)

| Port | Service | Purpose |
|------|---------|---------|
| 8001 | connector-service | Data source management, connection testing, schema discovery |
| 8002 | pipeline-service | DAG execution engine, scheduling, event config |
| 8003 | inference-service | Claude-powered schema inference, code generation, app generation |
| 8004 | ontology-service | Object types, properties, links, records, apps, actions |
| 8005 | event-log-service | TimescaleDB event storage for process mining |
| 8006 | audit-service | Immutable audit trail, checkpoints, approval workflows |
| 8007 | schema-registry | Version control for raw connector schemas |
| 8008 | correlation-engine | Semantic similarity scoring for schema matching |
| 8009 | process-engine | Process mining analytics: variants, bottlenecks, conformance |
| 8010 | alert-engine | Alert rules, notifications, webhook channels |
| 8011 | auth-service | JWT authentication, MFA, OIDC (Google/Okta/Azure), user management |
| 8012 | logic-service | Logic function editor and block executor |
| 8013 | agent-service | Claude agent runtime, threads, tool execution, streaming |
| 8014 | utility-service | Pre-built utilities: HTTP, OCR, PDF, web scrape, geocode, Slack |
| 8015 | analytics-service | Data exploration, value tracking, scenario analysis |
| 8016 | eval-service | Evaluation suites, test cases, experiment runner |
| 8017 | lineage-service | Cross-service data lineage graph |
| 8018 | search-service | Full-text search across the ontology |
| 8019 | data-quality-service | Data profiling, completeness scoring |
| 8020 | collaboration-service | Comments and threaded discussions |
| 8021 | api-gateway-service | External API exposure with key authentication |
| 8022 | admin-service | Tenant management, token usage tracking |
| 8023 | sepsis-service | Sample clinical dataset for sepsis demo |
| 8024 | demo-service | Multi-industry demo datasets |
| 8025 | whatsapp-service | WhatsApp Business API integration |
| 9000 | project-management | Project tracking, Gantt charts, team management |
| 9001 | finance-service | Expense, revenue, and accounts receivable tracking |

### Database Layer

| Database | Technology | Purpose |
|----------|-----------|---------|
| Primary | PostgreSQL 15 | Object types, records, pipelines, agents, users, configs |
| Time-series | TimescaleDB | Event log storage for process mining (hypertable on `occurred_at`) |
| Cache | Redis 7 | Session caching, pub/sub, rate limiting |

### Shared Backend Code (`/backend/shared/`)

| Module | Purpose |
|--------|---------|
| `auth_middleware.py` | Reusable FastAPI dependency for JWT validation and role-based access |
| `models.py` | Shared Pydantic schemas: pipelines, events, properties, scores |
| `enums.py` | SemanticType (14 types), NodeType (13 types), PipelineStatus, PiiLevel, Role |
| `nexus_logging.py` | Structured JSON logging setup |
| `token_tracker.py` | Fire-and-forget token usage reporting to admin service |
| `llm_router.py` | Per-tenant LLM provider resolution + unified chat / agentic-loop adapters that work across Anthropic, OpenAI, Azure OpenAI, and OpenAI-compatible local endpoints (Ollama, vLLM, LM Studio). Both async and sync variants. Falls back to `ANTHROPIC_API_KEY` env when no provider is configured. |

### Key Architectural Patterns

- **Multi-tenancy:** `x-tenant-id` header scopes all data. Tenant ID resolved at request time via `getTenantId()`.
- **JWT Auth:** RS256 tokens issued by auth-service, validated via JWKS at each service.
- **Async Execution:** Pipelines and evals return `202 Accepted` — poll for completion status.
- **Fire-and-Forget Events:** Services emit audit/event-log entries asynchronously.
- **Credential Encryption:** Connector credentials encrypted at rest using Fernet.
- **Schema Versioning:** Full version history with diffs and rollback on every object type.

---

## 3. Authentication & Multi-Tenancy

### Login Flow

1. User navigates to the platform URL
2. **LoginPage** presents email/password form (or SSO button if configured)
3. Auth service validates credentials, returns JWT access + refresh tokens
4. Tokens stored in `localStorage` via `authStore`
5. All subsequent API requests include `x-tenant-id` header
6. Default landing page on fresh sign-in: **Dashboards** (`apps` module). Returning users resume the last page they viewed (persisted in the navigation store).

### Authentication Methods

| Method | How It Works |
|--------|-------------|
| **Email/Password** | Standard login with bcrypt-hashed passwords. Rate limited: 10 attempts/min, lockout after 5 failures (15-min cooldown). |
| **MFA (TOTP)** | Optional 2FA via authenticator app. Setup generates QR code, subsequent logins require 6-digit code. |
| **OIDC SSO** | Redirect-based flow for Google, Okta, or Azure AD. Callback at `/auth/callback?token=...` maps external identity to Nexus user. |

### User Roles

| Role | Access |
|------|--------|
| `SUPERADMIN` | Platform-wide operator — cross-tenant visibility, impersonation, health monitoring. Reserved for @maic.ai accounts. |
| `ADMIN` | Full access — all modules, user management, tenant configuration |
| `DATA_ENGINEER` | Connectors, pipelines, ontology, logic, utilities |
| `ANALYST` | Data explorer, agents, apps, process mining, evals |
| `VIEWER` | Read-only access to dashboards and data |

Users may also have `allowed_modules[]` restrictions that limit navigation to specific modules.

### Multi-Tenancy

- Every API request includes `x-tenant-id` in the header
- The frontend resolves this via `getTenantId()` from the auth store
- All database queries filter by tenant
- Tenant provisioning and usage tracking are managed in the Admin Hub

### JWKS Key Rotation

The auth service publishes a JWKS endpoint for key discovery. All backend services validate JWTs against the JWKS keys. On key rotation, services automatically retry key fetching — if the current key ID (`kid`) is not found in the cached key set, the JWKS is re-fetched before failing.

### Rate Limiting

- Login endpoint: **10 attempts per minute** per IP (slowapi)
- Account lockout after 5 failed attempts (15-minute cooldown)

### API Endpoints (auth-service :8011)

```
POST /auth/login              — Email/password login
POST /auth/refresh            — Refresh access token
POST /auth/logout             — Revoke refresh token
GET  /auth/me                 — Current user profile
POST /auth/mfa/setup          — Enable TOTP 2FA
POST /auth/mfa/verify         — Verify MFA code
GET  /auth/oidc/{provider}    — OIDC redirect (google, okta, azure)
POST /auth/impersonate        — Impersonate a user (superadmin only)
GET  /auth/users              — List users (admin only)
POST /auth/users              — Create user
PATCH /auth/users/{id}        — Update user (role, status)
DELETE /auth/users/{id}       — Deactivate user
```

---

## 4. Connectors

### What It Does

Connectors are managed registrations of external data sources. A connector stores the connection details (URL, credentials, auth type) and provides schema discovery, connection testing, and health monitoring. Connectors feed data into the platform through pipelines.

### Supported Connector Types

| Category | Examples |
|----------|---------|
| REST | Any REST API with JSON responses |
| GraphQL | GraphQL endpoints |
| Database | PostgreSQL, MySQL, MongoDB |
| Stream | Kafka, WebSocket |
| File | CSV, Excel, Parquet uploads |
| ERP/CRM | SAP, Salesforce |
| Data Warehouse | Snowflake, BigQuery, Redshift |
| Productivity | Google Sheets, Slack |

### Features

- **Connection Testing:** Validates credentials and connectivity before saving
- **Schema Discovery:** Fetches and parses the raw schema from the source
- **AI Schema Inference:** Claude analyzes sample data to suggest semantic types, PII levels, and ontology mappings
- **Health Monitoring:** Tracks latency, error rate, and sync status per connector
- **Dynamic Configuration:** Query parameters, headers, and request body can be configured per test request
- **Postman Import:** Import connector configs from Postman collections

### User Interface

- **Grid View:** Cards showing each connector with name, type, status badge, and last-sync timestamp
- **Detail Panel:** Tabs for Configuration, Test Request, Schema, Health, and Pipeline usage
- **Filters:** Search by name, filter by category or status

### API Endpoints (connector-service :8001)

```
GET    /connectors                          — List all connectors
POST   /connectors                          — Create connector
GET    /connectors/{id}                     — Get connector details
PUT    /connectors/{id}                     — Update connector
DELETE /connectors/{id}                     — Delete connector
GET    /connectors/{id}/schema              — Fetch raw source schema
GET    /connectors/{id}/inference           — AI-inferred schema
POST   /connectors/{id}/test               — Test connection
POST   /connectors/{id}/fetch-row          — Fetch sample row
PATCH  /connectors/{id}/last-sync          — Update sync metadata
```

---

## 5. Ontology

### What It Does

The ontology is the semantic core of Nexus. It models real-world entities (Object Types) and their relationships (Links) — not database tables, but business concepts as understood by domain experts. Each object type has typed properties with semantic annotations.

### Concepts

| Concept | Description |
|---------|-------------|
| **Object Type** | A business entity: `Patient`, `Invoice`, `Device`, `Transaction`. Has a name, display name, description, and a set of properties. |
| **Property** | A field on an object type: `age` (Integer), `diagnosis` (Text), `admitted_at` (DateTime). Properties carry semantic type, data type, PII level, display name, and sample values. |
| **Link** | A relationship between object types: `Patient` → `HAS_CARE_EVENT` → `ClinicalEvent`. Cardinality: one-to-one, one-to-many, many-to-many. |
| **Schema Version** | Every change to an object type creates a new version. Full diff and rollback are available. |

### Semantic Types (14)

`EMAIL`, `PERSON_NAME`, `PHONE`, `ADDRESS`, `IDENTIFIER`, `CURRENCY`, `PERCENTAGE`, `DATE`, `TIMESTAMP`, `URL`, `GEO_COORDINATE`, `CATEGORY`, `FREE_TEXT`, `NUMERIC`

### PII Levels

`NONE`, `LOW` (e.g., age), `MEDIUM` (e.g., email), `HIGH` (e.g., SSN, medical record)

### Features

- **Visual Graph Editor:** ReactFlow-based graph showing object types as nodes and links as edges
- **Property Management:** Add, edit, reorder properties with type selectors
- **AI Enrichment:** Claude suggests display names, semantic types, and descriptions for properties
- **Schema Versioning:** Full version history with visual diff viewer
- **Conflict Detection:** When a connector schema changes, Nexus identifies vocabulary, type, granularity, and scale conflicts
- **Correlation Scan:** Detects shared fields between object types to suggest links
- **Inline Comments:** Threaded comments on any object type (via Collaboration service)

### User Interface

- **Graph Canvas:** Interactive ontology graph with object type nodes, link edges, and pipeline flow nodes
- **Object Type Panel:** Tabs — Properties, Schema, Data (preview records), Pipelines, Comments, Correlate
- **Context Actions:** + New Object Type, + Add Link, Run Correlation Scan

### API Endpoints (ontology-service :8004)

```
GET    /object-types                          — List all object types
POST   /object-types                          — Create object type
GET    /object-types/{id}                     — Get details
PUT    /object-types/{id}                     — Update schema
DELETE /object-types/{id}                     — Remove
GET    /object-types/{id}/versions            — Schema version history
GET    /object-types/{id}/diff/{v1}/{v2}      — Compare versions
POST   /object-types/{id}/enrich              — AI property enrichment
POST   /object-types/links                    — Create relationship
GET    /object-types/links/all                — List all links
DELETE /object-types/links/{link_id}          — Remove link
GET    /object-types/{id}/records             — Query records
POST   /object-types/{id}/records/ingest      — Insert record
POST   /object-types/{id}/records/sync        — Sync from source
```

---

## 6. Pipeline Builder

### What It Does

Pipelines are DAG-based (directed acyclic graph) workflows that move data from connectors into the ontology. Each pipeline is a chain of processing steps — source extraction, field mapping, filtering, validation, and sinking into an object type.

### Node Types (13)

| Node Type | Purpose |
|-----------|---------|
| `SOURCE` | Fetch data from a connector endpoint. Supports HTTP method selection (GET/POST/PUT). |
| `FILTER` | Apply conditional filters (field, operator, value) |
| `MAP` | Rename/transform fields from source schema to ontology schema |
| `CAST` | Convert data types (string → integer, date parsing) |
| `ENRICH` | Add computed fields or call external enrichment |
| `FLATTEN` | Flatten nested JSON structures |
| `DEDUPE` | Remove duplicate records by key |
| `VALIDATE` | Apply validation rules (required fields, ranges) |
| `LLM_CLASSIFY` | Claude-powered classification of records into categories |
| `SINK_OBJECT` | Write records to an ontology object type (PostgreSQL) |
| `SINK_EVENT` | Write events to TimescaleDB for process mining |
| `AGENT_RUN` | Trigger an agent execution within the pipeline |
| `LOOKUP` | Cross-reference records against another object type |

### Pipeline Execution

1. User clicks **Run Pipeline**
2. Backend returns `202 Accepted` with a run ID
3. DAG executor processes nodes in topological order
4. Each node logs: rows_in, rows_out, errors, duration
5. Final status: `COMPLETED` or `FAILED`
6. Pipeline marks `FAILED` on HTTP errors (not just exceptions) — any non-2xx response from a SOURCE node triggers failure
7. Results queryable via the run audit endpoint

### Scheduling

Pipelines can be scheduled for recurring execution using cron expressions:

- `0 * * * *` — Every hour
- `0 0 * * *` — Daily at midnight
- `*/15 * * * *` — Every 15 minutes

Schedules support: name, cron expression, enable/disable toggle, and manual trigger.

### Event Log Integration

When a pipeline processes event-log-style data (with `activity`, `case_id`, and `timestamp` fields), the DAG executor:

1. Auto-detects the activity field (looks for `activity`, `stage`, `status`, `step`)
2. Auto-detects timestamp fields (`occurred_at`, `timestamp`, `created_at`)
3. Writes to both `object_records` (PostgreSQL) and the `events` table (TimescaleDB)
4. Preserves original casing for activity names from the `activity` field

### User Interface

- **Graph Editor:** Drag nodes from the palette, connect with edges, configure each node
- **Node Palette:** Left sidebar listing all available node types
- **Node Config Panel:** Right sidebar with node-specific configuration (connector, endpoint, field mappings, filters)
- **Run Status:** Live execution status with per-node row counts
- **Audit Panel:** Detailed per-node audit: rows_in/out, errors, duration
- **Schedule Manager:** Create, edit, delete, and trigger schedules

### API Endpoints (pipeline-service :8002)

```
GET    /pipelines                                    — List pipelines
POST   /pipelines                                    — Create pipeline
GET    /pipelines/{id}                               — Get pipeline
PUT    /pipelines/{id}                               — Update pipeline
DELETE /pipelines/{id}                               — Delete pipeline
POST   /pipelines/{id}/run                           — Execute pipeline
GET    /pipelines/{id}/runs                          — List runs
GET    /pipelines/{id}/runs/{run_id}/audit           — Run audit trail
GET    /pipelines/{id}/quality                       — Data quality metrics
POST   /pipelines/{id}/analyze-events               — Profile event log
PATCH  /pipelines/{id}/event-config                  — Update event mapping config
GET    /pipelines/{id}/schedules                     — List schedules
POST   /pipelines/{id}/schedules                     — Create schedule
PUT    /pipelines/{id}/schedules/{sid}               — Update schedule
DELETE /pipelines/{id}/schedules/{sid}               — Delete schedule
POST   /pipelines/{id}/schedules/{sid}/run-now       — Trigger immediate run
```

---

## 7. Graph Explorer

### What It Does

The Graph Explorer provides a visual interface for exploring the ontology and its data at two levels: the type-level schema graph and the record-level relationship graph.

### Modes

| Mode | What It Shows |
|------|--------------|
| **Type Overview** | Object types as nodes, links as edges, pipeline flow nodes showing data lineage |
| **Record Focus** | Individual records as nodes, relationships between specific records, expandable neighborhoods |

### Features

- **Interactive Graph:** ReactFlow canvas with zoom, pan, and drag
- **Node Details:** Click any node to open a detail panel (properties, records, links)
- **Relationship Traversal:** Expand a record to see all connected records via defined links
- **Layout Options:** Circular and grid layouts
- **Color Coding:** Nodes colored by type (blue = entry, purple = exit, navy = standard)
- **Pipeline Flow:** SOURCE → MAP → SINK nodes visible in the graph showing data provenance

### User Interface

- **Canvas:** Main graph area with minimap and controls
- **Sidebar:** Object type list with record counts
- **Detail Panel:** Tabs for properties, data preview, and relationships

---

## 8. Data Explorer

### What It Does

The Data Explorer is an ad-hoc query builder for exploring data stored in ontology object types. It supports filtering, aggregation, charting, and CSV export.

### Features

- **Object Type Selection:** Dropdown to pick which entity to query
- **Filter Builder:** Add multiple filter conditions (field, operator, value)
  - Operators: `=`, `!=`, `contains`, `starts_with`, `>`, `>=`, `<`, `<=`, `is_empty`, `is_not_empty`
- **Aggregation:** COUNT, SUM, AVG, MIN, MAX on any numeric field
- **Grouping:** Group by any field (creates dimension for charts)
- **Chart View:** Bar chart visualization of aggregated data
  - X-axis: any field (with optional time bucketing for dates)
  - Y-axis: aggregation function
- **Table View:** Paginated data grid with sortable columns
- **CSV Export:** Download query results as CSV

### User Interface

- **Query Panel:** Object type selector, filter rows, aggregation config
- **Results Area:** Toggle between Table and Chart views
- **Export Button:** Download results as CSV

### API Endpoints (analytics-service :8015)

```
GET  /explore/object-types                           — Discoverable object types
GET  /explore/object-types/{id}/fields               — Field listing
GET  /explore/object-types/{id}/sample               — Sample rows
POST /explore/query                                  — Execute structured query
POST /analyst/query                                  — Natural language query
```

---

## 9. Data Quality

### What It Does

Data Quality profiles each object type to measure completeness, uniqueness, and reliability. It computes per-field null rates, distinct counts, and an overall quality score.

### Metrics

| Metric | Description |
|--------|-------------|
| **Overall Score** | 0–100 composite score based on completeness and uniqueness |
| **Null Rate** | Percentage of null values per field |
| **Distinct Count** | Number of unique values per field |
| **Unique Rate** | Distinct / total — measures how unique the field values are |
| **Top Values** | Most common values per field with counts |

### User Interface

- **Object Type Selector:** Pick which entity to profile
- **Run Profile:** Trigger a fresh quality scan
- **Score Card:** Overall quality score with color indicator
- **Property Breakdown:** Per-field null rate bars, distinct counts, and top values

### API Endpoints (data-quality-service :8019)

```
GET  /quality/summary                    — Overall quality dashboard
GET  /quality/{object_type_id}           — Quality metrics for a type
POST /quality/{object_type_id}/run       — Run quality profile
```

---

## 10. Apps

### What It Does

Apps are operational dashboards that display live data from the ontology. Users can build apps manually using a drag-and-drop editor, or generate them instantly using Claude AI.

### AI-Powered Generation

1. User clicks **+ New App** and enters a plain-language description
2. System fetches the selected object type's schema and 7 sample rows
3. Claude designs a dashboard layout: widget types, positions, configurations
4. User previews the AI-designed app and confirms
5. App is saved and immediately usable

### Widget Types

| Widget | Description |
|--------|-------------|
| `kpi-banner` | Full-width banner with multiple KPI values |
| `metric-card` | Single metric with value, label, and optional trend |
| `data-table` | Filterable data grid with configurable columns |
| `bar-chart` | Bar chart with X/Y axis mapped to ontology fields |
| `line-chart` | Time-series line chart |
| `text-block` | Static text, markdown, or instructions |
| `gauge` | Radial gauge for percentage/progress metrics |

### Editor Modes

| Mode | Description |
|------|-------------|
| **View** | Read-only live dashboard — no edit controls visible |
| **Edit** | Three-panel builder: widget palette (left), 12-column grid canvas (center), widget config panel (right). Drag to add, resize, and rearrange widgets. |
| **Code** | Raw JSON editor for the components array. Edits are parsed live and reflected on the canvas. |

### Features

- **Drag-and-Drop:** Place widgets on a 12-column grid layout
- **Resize:** Drag widget corners to resize
- **Live Data:** All widgets fetch from the ontology API in real time
- **Filters:** Widgets can have filters (e.g., `icu_admitted = true` on a data table)
- **App Gallery:** All published apps shown as cards with name, description, and component count
- **Navigation:** Apps appear in the left nav under their own section

### API Endpoints (ontology-service :8004)

```
GET    /apps              — List apps
POST   /apps              — Create app
GET    /apps/{id}         — Get app details
PUT    /apps/{id}         — Update app
DELETE /apps/{id}         — Delete app
```

### AI Generation (inference-service :8003)

```
POST /infer/generate-app       — Generate full app layout from description
POST /infer/generate-widget    — Generate a single widget component
```

---

## 11. Logic Studio

### What It Does

Logic Studio is the automation engine. Users build server-side workflows (Logic Functions) by composing blocks — each block performs one operation (query data, call Claude, send email, update records). Blocks execute in sequence; each block's output feeds the next block's input.

### Block Types (9)

| Block | Description |
|-------|-------------|
| `ontology_query` | Fetch records from an object type with filters and field selection |
| `llm_call` | Call Claude with a prompt template. Supports variable substitution from prior blocks. |
| `transform` | Apply in-memory transformations: compute averages, filter arrays, reshape data |
| `action` | Propose a write action (goes through Human Actions approval) |
| `ontology_update` | Write field values back to an ontology record directly |
| `send_email` | Send an email via SMTP with templated subject and body |
| `utility_call` | Run a platform utility (OCR, web scrape, geocode) |
| `conditional` | Branch execution: if condition is true → branch A, else → branch B |
| `foreach` | Iterate over an array from a previous block's output |

### Features

- **Visual Block Editor:** Add blocks from a palette, configure each block's parameters
- **Input Schema:** Define function inputs (name, type, required) that can be referenced in blocks via `{inputs.fieldName}`
- **Filter Builder:** Advanced filter UI for `ontology_query` blocks with operators and value selectors
- **LLM Output Schema:** Define expected output fields from `llm_call` blocks
- **Test Run:** Execute the function synchronously and view per-block inputs/outputs/timing
- **Publish/Version:** Publish a version for use by agents and pipelines
- **Schedule:** Attach cron schedules for recurring execution

### Execution Model

1. Function receives input parameters
2. Blocks execute in order (respecting conditional/foreach branches)
3. Each block has access to outputs from all prior blocks
4. Final output is the last block's result
5. Full execution trace is logged: block name, input, output, duration, errors

### User Interface

- **Sidebar:** List of logic functions with create/delete actions
- **Block Canvas:** Vertical list of configured blocks
- **Block Config:** Inline config panel for the selected block
- **Run Panel:** Execution log with expandable per-block output
- **Version History:** View published versions

### API Endpoints (logic-service :8012)

```
GET    /logic/functions                          — List functions
POST   /logic/functions                          — Create function
GET    /logic/functions/{id}                     — Get function
PUT    /logic/functions/{id}                     — Update function
DELETE /logic/functions/{id}                     — Delete function
POST   /logic/functions/{id}/run                 — Execute async
POST   /logic/functions/{id}/run/sync            — Execute blocking
POST   /logic/functions/{id}/publish             — Publish version
GET    /logic/runs                               — List all runs
GET    /logic/runs/{run_id}                      — Get run result
GET    /logic/functions/{id}/schedules           — List schedules
POST   /logic/functions/{id}/schedules           — Create schedule
```

---

## 12. Agent Studio

### What It Does

Agent Studio is the AI analyst layer. Users configure Claude-powered agents with specific system prompts, enabled tools, and knowledge scopes. Each agent can hold multi-turn conversations in threads, calling tools to query data, run functions, and propose actions.

### Agent Configuration

| Setting | Description |
|---------|-------------|
| **Name** | Display name for the agent |
| **System Prompt** | Instructions defining the agent's persona and behavior |
| **Model** | Model picker. Lists Claude defaults plus any model the tenant has registered in Settings → AI Models (OpenAI, Azure OpenAI, local Ollama / vLLM / LM Studio model IDs). Resolution at run-time consults the tenant's default provider unless a `provider_id` is overridden on the agent or schedule. |
| **Max Iterations** | Maximum tool-use loops per message (prevents runaway) |
| **Enabled Tools** | Which tools the agent can call |
| **Knowledge Scope** | Restrict the agent to specific object types and/or filters |

### Available Tools (11)

| Tool | Description |
|------|-------------|
| `list_object_types` | Discover available object types with record counts |
| `get_object_schema` | Inspect fields and sample rows for an object type |
| `query_records` | Execute structured queries with filters, sorting, pagination |
| `count_records` | Count records matching filter criteria |
| `logic_function_run` | Execute a published logic function |
| `action_propose` | Propose a write action (requires human approval) |
| `list_actions` | List available action definitions |
| `agent_call` | Delegate to another agent (sub-agent pattern) |
| `process_mining` | Query process mining stats and transitions |
| `utility_list` | List available utilities |
| `utility_run` | Execute a utility (OCR, scrape, geocode) |

### Orchestrator Pattern

The agent operates as a pure orchestrator:
1. Claude inspects the schema (calls `get_object_schema` to see fields + sample rows)
2. Claude specifies a structured query (filters, fields, limit, sort)
3. The server executes the query and returns only the matching results
4. Claude interprets the results and responds to the user

This prevents token explosion — the agent never sees all 1,000+ records.

### Conversations & Threads

- Each thread is an independent conversation with full message history
- Messages stream via Server-Sent Events (SSE) for real-time display
- Tool calls are shown inline: tool name, input parameters, and returned data
- Messages are persisted to the database in the streaming generator's `finally` block

### Features

- **Thread Management:** Create, list, and switch between threads
- **Streaming Responses:** SSE-based streaming with live tool call display
- **Version History:** Agent configs are versioned with rollback support
- **Scheduling:** Attach cron schedules for autonomous agent runs
- **Analytics:** Usage metrics per agent (message count, tool calls, errors)

### API Endpoints (agent-service :8013)

```
GET    /agents                                   — List agents
POST   /agents                                   — Create agent
GET    /agents/{id}                              — Get agent config
PUT    /agents/{id}                              — Update agent
DELETE /agents/{id}                              — Delete agent
POST   /agents/{id}/test                         — Test in playground
GET    /agents/{id}/versions                     — Version history
PUT    /agents/{id}/knowledge-scope              — Update knowledge scope
GET    /agents/{id}/analytics                    — Usage metrics
GET    /agents/tools                             — Available tools
GET    /threads                                  — List threads
POST   /threads/{agent_id}                       — Start new thread
GET    /threads/{thread_id}/messages             — Get messages
POST   /threads/{thread_id}/messages             — Send message (SSE stream)
GET    /agents/{id}/schedules                    — List agent schedules
POST   /agents/{id}/schedules                    — Create schedule
```

---

## 13. Human Actions

### What It Does

Human Actions is the approval queue for write operations proposed by AI agents. When an agent calls `action_propose`, the proposal enters a pending queue where a human reviewer can approve or reject it before any data is modified.

### Action Lifecycle

```
Agent proposes action
  → Pending (in Inbox)
    → Human reviews details (inputs, reasoning, source agent)
      → Approve → Action executes → Record updated
      → Reject (with reason) → No data modified
```

### Action Definition

Each action is defined with:

| Field | Description |
|-------|-------------|
| **Name** | Action identifier (e.g., `Flag High-Risk Patient`) |
| **Description** | What the action does |
| **Writes to** | Target object type |
| **Input Schema** | Required fields and types |
| **Requires Confirmation** | Whether human approval is needed (toggle) |
| **Allowed Roles** | Which roles can approve |
| **Email Notification** | Optional email when action is proposed |

### Severity Levels

Actions can be classified as: `critical`, `high`, `medium`, `low` — affecting sort order and visual treatment in the queue.

### Features

- **Inbox:** Pending action proposals with source agent, inputs, and reasoning
- **Bulk Actions:** Approve or reject multiple proposals at once
- **History:** Completed and rejected actions with timestamps, reviewer, and outcome
- **Deduplication:** Built-in deduplication agent detects near-duplicate proposals
- **Audit Trail:** Every action decision is logged in the audit service

### User Interface

- **Three Tabs:** Inbox (pending), History (completed/rejected), Settings (action definitions)
- **Badge Count:** NavRail shows pending action count
- **Detail View:** Expand any action to see full input payload and agent reasoning

### API Endpoints (ontology-service :8004)

```
GET    /actions                                  — List action definitions
POST   /actions                                  — Define action
PUT    /actions/{name}                           — Update action
DELETE /actions/{name}                           — Delete action
POST   /actions/{name}/execute                   — Execute action
GET    /actions/{name}/executions                — Execution history
GET    /actions/executions/pending               — Pending approvals
POST   /actions/executions/{id}/confirm          — Approve
POST   /actions/executions/{id}/reject           — Reject
```

---

## 14. Process Mining

### What It Does

Process Mining analyzes event logs to discover actual process flows, identify bottlenecks, detect rework patterns, and check conformance against expected models. It reads from the TimescaleDB `events` table.

### Data Sources

Events are written to TimescaleDB by pipelines (via `SINK_EVENT` nodes or automatic event detection in `dag_executor.py`). Each event has: `case_id`, `activity`, `occurred_at`, `resource`, and optional attributes.

### Six Tabs

#### 1. Process Map

Interactive directed graph showing activity nodes and transition edges.

**Layout:** Dagre LR (left-to-right) with cycle detection. Back-edges shown as dashed lines.

**Interactions:**
- **Single click:** Highlights inflows (blue) and outflows (green). All non-connected edges hide their labels. Dimmed nodes fade to 10% opacity.
- **Double click:** Focus mode — only the subgraph reachable from/to the selected node remains visible. Banner shows activity name. Press `Esc` to exit.
- **Edge thickness:** Proportional to transition frequency
- **Edge color:** Green = fast, gray = normal, red = bottleneck

#### 2. Variants

Lists all unique process paths (sequences of activities), sorted by frequency.

- Each variant shows the activity sequence as chips with arrows
- Case count and percentage of total
- Click a variant to drill into its cases in the Cases tab
- Rework indicators (↩) shown on repeated activities

#### 3. Cases

Browse individual cases (process instances).

- Columns: case ID, activity count, duration, variant, state (active/stuck)
- Click a case to open its **timeline**: chronological activity sequence with timestamps, resources, and duration between events
- Filter by variant ID (when navigating from Variants tab)

#### 4. Conformance

Compare actual process behavior against expected (happy path) models.

- **Define Happy Path:** Add activities in expected order
- **Run Conformance Check:** Scores each case against the model (0.0 – 1.0)
- **Deviation Breakdown:** Lists which activities are most frequently skipped, out-of-order, or added
- **Score Card:** Overall conformance percentage, case-level pass/fail counts

#### 5. Alerts

Define operational alert rules on process metrics.

| Rule Type | Description |
|-----------|-------------|
| `stuck_case` | Fire when a case hasn't progressed for N hours |
| `slow_transition` | Fire when a step-to-step transition exceeds a time threshold |
| `rework_spike` | Fire when rework percentage exceeds a threshold |
| `case_volume_anomaly` | Fire when case volume drops significantly vs baseline |

Each rule has: name, type, config parameters, severity (warning/critical), and enabled toggle.

#### 6. Settings

Configure event mapping for the selected object type:

- **Pipeline selector:** Which pipeline produced the events
- **Activity Field Override:** Custom field name for the activity (leave blank for auto-detection)
- **Excluded Activities:** Activities to filter out of analysis
- **Activity Labels:** Custom display names for activities

### Stats Bar

When a process is configured, the top stats bar shows:
- **Cases** — total case count
- **Avg Duration** — average case duration
- **Variants** — number of distinct process paths
- **Rework Rate** — percentage of cases with repeated activities
- **Stuck** — number of currently stuck cases

### API Endpoints (process-engine :8009)

```
GET  /process/stats/{ot_id}                            — Case/event counts
GET  /process/cases/{ot_id}                            — List cases
GET  /process/cases/{ot_id}/{case_id}/timeline         — Event sequence
GET  /process/transitions/{ot_id}                      — Transition matrix
GET  /process/variants/{ot_id}                         — Process variants
GET  /process/bottlenecks/{ot_id}                      — Slow activities
POST /process/conformance/models/{ot_id}               — Define process model
GET  /process/conformance/models/{ot_id}               — List models
GET  /process/conformance/check/{ot_id}/{model_id}     — Run conformance check
GET  /process/conformance/summary/{ot_id}              — Conformance summary
```

---

## 15. Evals

### What It Does

Evals is an evaluation framework for testing AI agent and logic function outputs against expected answers. It supports test suites, multiple evaluator types, experiment tracking with parameter grid search, and run comparison.

### Concepts

| Concept | Description |
|---------|-------------|
| **Suite** | A collection of test cases targeting a specific agent or logic function |
| **Test Case** | An input/expected-output pair with an evaluator config |
| **Run** | A single execution of a suite — produces pass/fail per case |
| **Experiment** | A parameter grid search across multiple runs to find optimal config |

### Evaluator Types (5)

| Evaluator | How It Works |
|-----------|-------------|
| `exact_match` | Output must exactly match expected value |
| `contains_key_details` | Output must contain specified key phrases |
| `json_schema` | Output must conform to a JSON schema |
| `rouge` | String similarity scoring (ROUGE-L) |
| `custom_expression` | Arbitrary expression evaluation |

### Features

- **Suite Builder:** Create suites with name, target (agent/logic), evaluator configs, and pass threshold
- **Case Editor:** Add cases with structured inputs and expected outputs, plus tags for filtering
- **Run Execution:** Execute a suite against its target, producing per-case results with scores
- **Experiment Runner:** Define a parameter grid (e.g., vary temperature, prompt variations), run all combinations, compare results
- **Result Viewer:** Drill into individual case results — see the actual output, expected output, evaluator score, and pass/fail

### API Endpoints (eval-service :8016)

```
GET    /suites                                   — List suites
POST   /suites                                   — Create suite
GET    /suites/{id}                              — Get suite
PUT    /suites/{id}                              — Update suite
DELETE /suites/{id}                              — Delete suite
POST   /suites/{id}/cases                        — Add test case
GET    /suites/{id}/cases                        — List cases
POST   /suites/{id}/run                          — Execute suite
GET    /suites/{id}/runs                         — List runs
GET    /runs/{run_id}                            — Get run results
GET    /experiments                               — List experiments
POST   /experiments                               — Create experiment
POST   /experiments/{id}/run                      — Run experiment
```

---

## 16. Utilities

### What It Does

Utilities are pre-built enrichment and processing tools that can be called from Logic Functions, agents, or directly from the UI. They handle tasks that require external integrations or specialized processing.

### Available Utilities (10)

| Utility | Category | Description |
|---------|----------|-------------|
| `http_request` | Web | Generic HTTP call to any URL |
| `webhook_post` | Web | POST payload to an external webhook URL |
| `web_scrape` | Web | Scrape and extract content from HTML pages |
| `rss_fetch` | Web | Fetch and parse RSS/Atom feeds |
| `ocr_extract` | Vision | Extract text from images using OCR |
| `pdf_extract` | Document | Parse and extract text/tables from PDFs |
| `excel_parse` | Document | Read Excel files into structured data |
| `geocode` | Geo | Convert addresses to lat/lon coordinates |
| `qr_read` | Vision | Decode QR codes from images |
| `slack_notify` | Notify | Send a message to a Slack channel |

### Features

- **Utility Catalog:** Browse utilities by category with descriptions
- **Direct Execution:** Run any utility from the UI with input fields
- **JSON Output:** All utilities return structured JSON
- **Agent Integration:** Agents can call `utility_list` and `utility_run` to use utilities
- **Logic Integration:** Logic functions can include `utility_call` blocks

### API Endpoints (utility-service :8014)

```
GET  /utilities                  — List all utilities
GET  /utilities/{id}             — Get utility details
POST /utilities/{id}/run         — Execute utility
```

---

## 17. Value Monitor

### What It Does

Value Monitor tracks the operational value delivered by automation use cases — from initial identification through committed framing to realized delivery. It connects directly to pipeline runs to quantify value per execution.

### Value Lifecycle

```
Identified → Framed → Realized
(estimate)   (committed)  (proven)
```

### Concepts

| Concept | Description |
|---------|-------------|
| **Category** | A grouping for related use cases (e.g., "Clinical Operations Automation") |
| **Use Case** | A specific automation linked to a pipeline or logic function |
| **Identified Value** | Estimated monthly value (formula-based: runs × value_per_run + records × value_per_record) |
| **Framed Value** | Committed business case amount (manual entry) |
| **Realized Value** | Proven value from actual pipeline runs (logged from sync) |

### Features

- **Summary Cards:** Global Identified / Framed / Realized totals
- **Category Management:** Create categories with name, currency
- **Use Case Builder:** Link to pipeline source, configure value formula, estimate monthly runs
- **Run Sync:** Pull completed pipeline runs, select which to include
- **Value Logging:** Log included runs as realized value
- **Progress Bar:** Realized vs. Framed percentage with overflow indicator
- **Timeline Chart:** Monthly realized value bar chart with hover tooltips

### API Endpoints (analytics-service :8015)

```
GET    /value/summary                            — Global value totals
GET    /value/timeline                           — Value over time
GET    /value/categories                         — List categories
POST   /value/categories                         — Create category
PATCH  /value/categories/{id}                    — Update category
DELETE /value/categories/{id}                    — Delete category
GET    /value/use-cases                          — List use cases
POST   /value/use-cases                          — Create use case
GET    /value/use-cases/{id}                     — Get use case
PATCH  /value/use-cases/{id}                     — Update use case
POST   /value/use-cases/{id}/events              — Log value event
GET    /value/use-cases/{id}/events              — View events
```

---

## 18. Activity & Audit

### What It Does

The Activity module is a unified hub for operational monitoring: event logs from pipelines, audit trails from user actions, and process mining analytics.

### Three Tabs

#### 1. Event Log
Raw event stream from pipeline executions. Shows: timestamp, source pipeline, activity, case ID, and attributes. Filterable by pipeline, activity, and date range.

#### 2. Audit Log
Immutable record of every user and system action. Shows: timestamp, actor, action type, resource, and details.

### Audit Service Features

- **Immutable Trail:** Once logged, audit events cannot be modified or deleted
- **Checkpoints:** Named gates that require approval before proceeding (e.g., "Production Deploy" requires 2/3 approvals)
- **Approval Workflows:** Multi-step approval chains with role-based routing
- **Retention Policies:** Configurable per event type

#### 3. Process Mining
Full process mining interface (see [Section 14](#14-process-mining)).

### API Endpoints (audit-service :8006)

```
POST /audit                                      — Log action
GET  /audit                                      — Query audit events
GET  /audit/summary                              — Audit stats
POST /audit/checkpoints                          — Create checkpoint
GET  /audit/checkpoints                          — List checkpoints
POST /audit/checkpoints/{id}/respond             — Approve/reject
POST /audit/approvals/requests                   — Create approval request
GET  /audit/approvals/requests/mine/pending       — My pending approvals
POST /audit/approvals/requests/{id}/approve       — Approve
POST /audit/approvals/requests/{id}/reject        — Reject
GET  /audit/approvals/workflows                   — List workflows
POST /audit/approvals/workflows                   — Create workflow
```

---

## 19. Search

### What It Does

Global search across the entire ontology. Activated via `Cmd+K` (Mac) or `Ctrl+K` (Windows).

### Features

- **Full-Text Search:** Searches across object type names, property names, record values, pipeline names, connector names, agent names, and dashboard names
- **Type-Aware Results:** Results tagged with type badges (object_type, pipeline, connector, agent, logic, dashboard, record)
- **Debounced:** 200ms debounce to avoid excessive API calls
- **Navigation:** Selecting a result navigates to the relevant module and object

### API Endpoints (search-service :8018)

```
GET /search?q={query}         — Search across platform
```

---

## 20. Alerts

### What It Does

The Alert Engine monitors metrics and conditions, firing notifications when thresholds are breached.

### Rule Types

| Type | Description |
|------|-------------|
| `stuck_case` | Case hasn't progressed for N hours |
| `slow_transition` | Step-to-step transition exceeds threshold |
| `rework_spike` | Rework percentage exceeds threshold |
| `case_volume_anomaly` | Case volume drops significantly |

### Notification Channels

- **In-app:** Notification bell with read/snooze actions
- **Email:** SMTP-based notifications
- **Webhook:** POST to external URL
- **Slack:** Message to configured channel (via utility)

### API Endpoints (alert-engine :8010)

```
GET    /alerts/rules                             — List rules
POST   /alerts/rules                             — Create rule
PATCH  /alerts/rules/{id}                        — Update rule
DELETE /alerts/rules/{id}                        — Delete rule
POST   /alerts/rules/{id}/test                   — Test rule on historical data
GET    /alerts/notifications                     — User notifications
POST   /alerts/notifications/{id}/read           — Mark read
POST   /alerts/notifications/{id}/snooze         — Snooze
GET    /alerts/channels                          — List channels
PUT    /alerts/channels                          — Update channel config
POST   /alerts/notifications/webhooks            — Register webhook
```

---

## 21. Collaboration

### What It Does

Threaded comments and annotations attached to any ontology resource. Comments are scoped by resource type and ID, supporting inline domain knowledge capture.

### Features

- **Comments:** Add timestamped, attributed comments to object types, pipelines, or any resource
- **Threaded Replies:** Reply to comments for structured discussions
- **Count Badge:** Comment count shown on resource tabs

### API Endpoints (collaboration-service :8020)

```
GET    /comments                    — Get comments (by resource_id, resource_type)
POST   /comments                    — Add comment
PATCH  /comments/{id}               — Edit comment
DELETE /comments/{id}               — Delete comment
GET    /comments/count              — Count by resource
```

---

## 22. API Gateway

### What It Does

The API Gateway exposes ontology data as external REST APIs. External consumers can query published endpoints using API keys, without needing full platform access.

### Features

- **Publish Endpoints:** Map an object type to a slug (e.g., `/gateway/v1/patients`)
- **API Keys:** Generate, revoke, and toggle keys with per-key access control
- **Query Interface:** Published endpoints support filtering and pagination
- **Rate Limiting:** Per-key rate limits (configurable)

### API Endpoints (api-gateway-service :8021)

```
GET    /gateway/keys                             — List API keys
POST   /gateway/keys                             — Create key
DELETE /gateway/keys/{id}                        — Revoke key
PATCH  /gateway/keys/{id}/toggle                 — Enable/disable
GET    /gateway/manage                           — List published endpoints
POST   /gateway/manage                           — Publish endpoint
DELETE /gateway/manage/{id}                      — Unpublish
GET    /gateway/v1/{slug}                        — Query data (external access)
GET    /gateway/v1/{slug}/{record_id}            — Get single record
```

---

## 23. Projects

### What It Does

Project management with companies, teams, stages, and Gantt chart visualization. Designed for tracking implementation engagements and sales pipelines.

### Data Model

| Entity | Description |
|--------|-------------|
| **Company** | Client organization with name and color |
| **Project** | Named initiative under a company with status tracking |
| **Stage** | Ordered phases: Discovery → Planning → Execution → Deployment → Review |
| **Team Member** | People assigned to a company with roles: Manager, Engineer, Analyst, Stakeholder |

### Features

- **Company Management:** Create and manage client organizations
- **Project Lifecycle:** Track projects through stages
- **Team Assignment:** Assign people to companies with roles
- **Gantt Chart:** Visual timeline of project stages with duration bars
- **Stage Comments:** Add collaboration notes to individual stages
- **Linked Records:** Connect ontology records to project stages

---

## 24. Finance

### What It Does

Financial tracking for expenses, revenue, and accounts receivable.

### Data Types

| Type | Fields |
|------|--------|
| **Transaction** | category, date, vendor, amount, payment method |
| **Revenue** | client, invoice number, amount, status (received/pending) |
| **Receivable** | client, invoice date, due date, amount, status (pending/partial/paid/overdue), balance |

### Expense Categories

`salaries`, `software`, `admin`, `finanzas`, `oficina`, `marketing`

### Features

- **Transaction Upload:** Upload expense CSVs
- **Revenue Tracking:** Create and manage revenue entries
- **Accounts Receivable:** Track invoices with aging and status
- **Category Summary:** Breakdown by expense category
- **Monthly Reports:** Filterable by date range

---

## 25. Admin Hub

### What It Does

Platform administration for user management and tenant configuration.

### Users Tab

- **User List:** All users with name, email, role, status
- **Create User:** Add users with email, name, role
- **Edit User:** Change role, toggle active/inactive, reset password
- **Role Assignment:** ADMIN, DATA_ENGINEER, ANALYST, VIEWER
- **Module Restrictions:** Limit user access to specific modules via `allowed_modules[]`

### Tenants Tab

- **Tenant List:** All tenants with name, status, creation date
- **Usage Stats:** Record counts per object type, pipeline run counts, active users
- **Tenant Config:** Update tenant settings, feature flags
- **Provision/Deactivate:** Create or deactivate tenants

### API Endpoints (admin-service :8022)

```
GET    /admin/tenants                            — List tenants
POST   /admin/tenants                            — Create tenant
GET    /admin/tenants/{id}/usage                 — Usage metrics
PATCH  /admin/tenants/{id}                       — Update tenant
DELETE /admin/tenants/{id}                       — Deactivate tenant
```

---

## 26. Superadmin Management

### What It Does

Superadmin Management provides platform-wide operational controls for @maic.ai operators. The `SUPERADMIN` role grants cross-tenant visibility, health monitoring, token usage tracking, and the ability to impersonate any user for debugging and support.

### Platform Page

The Platform page is accessible only to superadmin users and contains four tabs:

| Tab | Description |
|-----|-------------|
| **Tenants** | Cross-tenant list with usage stats, record counts, and active user counts |
| **Token Usage** | Aggregated LLM token consumption by tenant, service, and model |
| **Health** | Platform-wide service health dashboard with latency metrics |
| **Impersonation** | Browse and impersonate any user across any tenant |

### Token Usage Tracking

- All LLM call sites across the platform report token usage via fire-and-forget POST to the admin service
- Uses the shared `token_tracker.py` utility (see [Section 30](#30-token-tracking))
- Dashboard shows aggregation by tenant, service, and model
- Supports date range filtering and CSV export

### Account Impersonation

Superadmins can impersonate any user to debug tenant-specific issues:

1. Superadmin selects a user from the Impersonation tab
2. `POST /auth/impersonate` issues a new JWT with an `impersonated_by` claim containing the superadmin's user ID
3. The frontend switches to the impersonated user's tenant and role
4. A **red impersonation banner** is displayed at the top of the screen with an exit button
5. Impersonation state is persisted in `sessionStorage` to survive page reloads
6. Clicking "Exit Impersonation" restores the superadmin's original session

### Security

- Impersonation is restricted to the `SUPERADMIN` role
- The `impersonated_by` claim is included in all audit log entries during an impersonation session
- All impersonation events (start/end) are logged in the audit service

---

## 27. Nexus Assistant

### What It Does

The Nexus Assistant is an in-app AI sidebar that provides context-aware help and data exploration capabilities. It is accessible from the right side of the application shell.

### Modes

| Mode | Description |
|------|-------------|
| **Platform Help** | Streaming, context-aware answers about platform features, navigation, and best practices. Uses the current page context to provide relevant help. |
| **Data Explorer** | Natural language queries against object records. Ask questions like "show me all patients admitted in the last 7 days" and get structured results. |

### Action System

The assistant can perform platform actions on behalf of the user:

| Action | Description |
|--------|-------------|
| **Create Connector** | Set up a new data source connection |
| **Create Object Type** | Define a new ontology entity |
| **Create Pipeline** | Build a data transformation pipeline |
| **Create Logic Function** | Define an automation workflow |

### Action Flow

1. User requests an action in natural language (e.g., "create a connector for our HR API")
2. The assistant gathers required parameters through conversation
3. A **confirmation card** is rendered in the chat with the proposed action details
4. User confirms or modifies the parameters
5. Action is executed against the relevant backend service

### Sequential Action Chaining

The assistant supports chaining multiple actions in sequence. For example: "Create an object type called Employee, then create a pipeline to sync data from the HR connector into it." Each action is proposed as a confirmation card and executed in order upon approval.

### Conversations

- Conversations are **tenant-scoped** — each tenant has its own conversation history
- Full message history is persisted and retrievable
- Streaming responses via SSE for real-time display

---

## 28. Settings & Health

### Settings

User and platform preferences accessible from the nav rail. Tab-based layout:

| Tab | Description |
|---------|-------------|
| **General** | Organization name, timezone, account info |
| **AI Models** | Per-tenant LLM provider management — Anthropic / OpenAI / Azure OpenAI / Google / Local. CRUD with masked API keys, custom base URLs, model registration, connection testing, default selection, and enable/disable toggle. Detailed below. |
| **Notifications** | Email + Slack channel configuration with test-send |
| **API Keys** | Outbound integration keys exposed by Nexus (separate from inbound LLM keys above) |
| **Data Retention** | Per-domain retention windows (events, audit, ontology records) |
| **Permissions** | Role/capability matrix (read-only) |
| **Alert Rules** | Linked Alerts page |
| **API Gateway** | Linked Gateway page |
| **System Health** | Service health dashboard |

Top-bar / global preferences:

| Setting | Description |
|---------|-------------|
| **Theme** | Light / Dark mode toggle |
| **Density** | Compact / Normal layout density |
| **Language** | English / Espa\u00f1ol (i18next) |
| **Schedules** | View and manage all active cron schedules across pipelines, agents, and logic functions |
| **Health** | Service health dashboard |

#### AI Models / Providers

Each tenant can register its own LLM providers and pick which one the platform uses by default. The choice flows through every AI surface: Agent Studio, AIP Analyst, schema inference, app generation, workbench cells, lineage explanations, and chat-with-data.

**Resolution order**

1. If the caller passes an explicit `provider_id`, use that row.
2. Otherwise, the tenant's `is_default = true` provider.
3. Otherwise, the tenant's first `enabled = true` provider (oldest).
4. Otherwise, the platform-wide `ANTHROPIC_API_KEY` env fallback.

**Backed by `model_providers` table**

```sql
id, tenant_id, name, provider_type, api_key_encrypted, base_url,
models (jsonb), is_default, enabled, created_at
```

**Provider types**

| `provider_type` | Routing | SDK |
|---|---|---|
| `anthropic` | Direct Anthropic API | `anthropic.AsyncAnthropic` |
| `openai` | OpenAI Chat Completions | `openai.AsyncOpenAI` |
| `azure_openai` | Azure OpenAI Chat Completions | `openai.AsyncOpenAI` w/ resource base URL |
| `local` | OpenAI-compatible local server (Ollama auto-appends `/v1`) | `openai.AsyncOpenAI` w/ custom base URL |
| `google` | Connection test only — chat path falls back to Anthropic env until the Gemini SDK is wired | — |

**Cross-provider tool-use** — `agent_turn_async` in `shared/llm_router.py` translates Anthropic tool definitions to OpenAI `function` schema, and converts OpenAI `tool_calls` back into Claude-style `tool_use` content blocks so the agentic loop in `agent_service/runtime.py` works regardless of provider.

**API endpoints (agent-service :8013)**

```
GET    /model-providers              — list (api_key_encrypted is masked: abcd••••••••wxyz)
POST   /model-providers              — create
PUT    /model-providers/{id}         — update; masked-value bodies are ignored
DELETE /model-providers/{id}         — remove
POST   /model-providers/{id}/test    — connection probe
```

### Platform Health

Displays the status of all 25+ backend services:

- **Service Name** and port
- **Status:** Healthy (green) / Unhealthy (red)
- **Latency:** Response time of the health endpoint
- **Last Check:** Timestamp of the most recent health probe

Each service exposes `GET /health` returning `{ "status": "ok" }`.

---

## 29. Lineage

### What It Does

The Lineage service aggregates data flow information across all services to build a complete data lineage graph. It shows how data moves from connectors through pipelines into object types, and which logic functions, agents, and apps consume that data.

### Features

- **Full Lineage DAG:** Visual graph of all data sources, transformations, and destinations
- **Upstream/Downstream:** For any node, trace where its data comes from and where it goes
- **Impact Analysis:** Identify all downstream consumers affected if a source changes

### API Endpoints (lineage-service :8017)

```
GET /lineage/graph                               — Full lineage DAG
GET /lineage/graph/health                        — Lineage graph status
GET /lineage/node/{id}/upstream                  — Sources for a node
GET /lineage/node/{id}/downstream                — Destinations from a node
GET /lineage/impact/{id}                         — Affected objects
```

---

## 30. Token Tracking

### What It Does

Token tracking provides platform-wide visibility into LLM token consumption across all services that call an LLM. It enables cost attribution by tenant, service, and model — across whatever provider the tenant has configured (Anthropic / OpenAI / Azure OpenAI / Local). Records carry the resolved model ID, so downstream cost reports remain accurate even when a tenant switches providers.

### Architecture

- **Shared Utility:** `token_tracker.py` in `/backend/shared/` provides a fire-and-forget function to report token usage
- **Fire-and-Forget:** Each LLM call site sends a non-blocking POST to the admin service with usage data after the LLM response completes. Failures are logged but never block the caller.
- **Admin Service Aggregation:** The admin service (8022) stores and aggregates token usage records

### Instrumentation

Token tracking is instrumented across **10 LLM call sites** in the platform:

- Inference service (schema inference, app generation, code generation, PII scanning)
- Agent service (agent conversations, tool use)
- Logic service (LLM call blocks)
- Pipeline service (LLM_CLASSIFY nodes)
- Nexus Assistant (platform help, data explorer)

### Usage Record Fields

| Field | Description |
|-------|-------------|
| `tenant_id` | Tenant that initiated the request |
| `service` | Originating service name |
| `model` | Resolved model ID (e.g., `claude-sonnet-4-6`, `gpt-4o`, `llama3.1:8b`) — captured at call time from the tenant's selected provider |
| `input_tokens` | Prompt token count |
| `output_tokens` | Completion token count |
| `timestamp` | When the call was made |

### Aggregation

The admin service provides aggregation queries:

- **By tenant:** Total tokens per tenant over a date range
- **By service:** Which services consume the most tokens
- **By model:** Token distribution across model tiers

---

## 31. Backend Services Reference

### Complete API Endpoint Count

**Total: 350+ endpoints across 25+ services**

| Service | Port | Endpoints | Key Focus |
|---------|------|-----------|-----------|
| connector-service | 8001 | 11 | Data source CRUD, connection testing |
| pipeline-service | 8002 | 16 | DAG execution, scheduling, event config |
| inference-service | 8003 | 16 | Claude AI: schema inference, app/code generation, PII scanning |
| ontology-service | 8004 | 28 | Object types, records, apps, actions, graph |
| event-log-service | 8005 | 7 | TimescaleDB event storage |
| audit-service | 8006 | 18 | Immutable audit, checkpoints, approvals |
| schema-registry | 8007 | 3 | Schema version control |
| correlation-engine | 8008 | 2 | Semantic similarity scoring |
| process-engine | 8009 | 13 | Process mining analytics, conformance |
| alert-engine | 8010 | 15 | Alert rules, notifications, webhooks |
| auth-service | 8011 | 15 | JWT auth, MFA, OIDC, impersonation, user management |
| logic-service | 8012 | 14 | Logic function editor/executor |
| agent-service | 8013 | 20 | Claude agents, threads, tool execution |
| utility-service | 8014 | 3 | Pre-built utilities (OCR, scrape, geocode) |
| analytics-service | 8015 | 25 | Data exploration, value tracking, scenarios |
| eval-service | 8016 | 14 | Test suites, evaluators, experiments |
| lineage-service | 8017 | 5 | Cross-service data lineage |
| search-service | 8018 | 1 | Full-text search |
| data-quality-service | 8019 | 3 | Data profiling, quality scoring |
| collaboration-service | 8020 | 5 | Comments, threaded discussions |
| api-gateway-service | 8021 | 9 | External API exposure |
| admin-service | 8022 | 8 | Tenant management, token usage tracking |
| sepsis-service | 8023 | 12 | Sepsis clinical demo dataset |
| demo-service | 8024 | 6 | Multi-industry demo datasets |
| whatsapp-service | 8025 | 5 | WhatsApp Business API integration |
| project-management | 9000 | 12 | Projects, companies, teams, Gantt |
| finance-service | 9001 | 10 | Expenses, revenue, accounts receivable |

### Shared Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| PostgreSQL 15 | :5432 | Primary data store (ontology, configs, auth) |
| TimescaleDB | :5434 | Time-series event log for process mining |
| Redis 7 | :6379 | Cache, rate limiting, pub/sub |
| NGINX | :80 | Reverse proxy, static file serving |

### Common Headers

All inter-service and frontend-to-backend requests use:

```
x-tenant-id: {tenant_id}        — Multi-tenant data scoping
Content-Type: application/json   — Standard JSON payloads
Authorization: Bearer {jwt}      — Optional JWT auth (skippable in dev)
```

---

## 32. Frontend Architecture

### Technology Stack

| Technology | Purpose |
|-----------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Zustand | State management (24 stores) |
| @xyflow/react | Graph/node editors (ontology, pipelines, process map) |
| @dagrejs/dagre | Automatic graph layout |
| react-grid-layout | App dashboard grid |
| Recharts | Charts and visualizations |
| Lucide React | Icon library |
| i18next | Internationalization (English, Espa\u00f1ol) |
| Vite | Build tool |

### File Structure

```
frontend/src/
  App.tsx                           — Auth gate, page routing, theme sync
  shell/
    AppShell.tsx                     — Main layout (nav + content + assistant)
    NavRail.tsx                      — Left navigation sidebar
    SearchModal.tsx                  — Global search (Cmd+K)
    TenantContext.tsx                — Auth context provider
  modules/
    connectors/                      — Connector grid, cards, detail panel
    ontology/                        — Ontology graph, object type panel
    pipeline/                        — Pipeline builder, node palette, config
    apps/                            — App gallery, editor, canvas
    logic/                           — Logic studio block editor
    agents/                          — Agent studio, human actions
    evals/                           — Eval suite editor, run results
    process/                         — Process mining (6 tabs)
    explorer/                        — Data explorer query builder
    quality/                         — Data quality profiler
    graph/                           — Graph explorer (type/record views)
    value/                           — Value monitor
    activity/                        — Activity hub (event log, audit, process)
    utilities/                       — Utility catalog and runner
    projects/                        — Project management + Gantt
    finance/                         — Financial tracking
    admin/                           — Admin console + users
    settings/                        — User preferences
    data/                            — Data hub (explorer + quality)
    alerts/                          — Alert management
    audit/                           — Checkpoint gates
    events/                          — Event log viewer
    lineage/                         — Lineage canvas
    gateway/                         — API gateway management
    users/                           — User management
  store/
    agentStore.ts                    — Agent CRUD, threads, messages, streaming
    connectorStore.ts                — Connector CRUD, health
    pipelineStore.ts                 — Pipeline CRUD, runs, schedules
    ontologyStore.ts                 — Object types, links
    logicStore.ts                    — Logic functions, runs
    processStore.ts                  — Process mining data
    appStore.ts                      — Dashboard apps
    humanActionsStore.ts             — Action queue, pending/history
    explorerStore.ts                 — Data explorer query state
    graphStore.ts                    — Graph visualization state
    searchStore.ts                   — Search query and results
    authStore.ts                     — JWT tokens, tenant ID
    uiStore.ts                       — Theme, density
    navigationStore.ts               — Current page, breadcrumbs
    alertStore.ts                    — Alert rules
    approvalStore.ts                 — Approval workflows
    assistantStore.ts                — AI assistant conversations
    checkpointStore.ts               — Checkpoint gates
    conformanceStore.ts              — Conformance models/results
    inferenceStore.ts                — Schema inference state
    runLogStore.ts                   — Pipeline run history
    shortcutStore.ts                 — Keyboard shortcuts
    utilityStore.ts                  — Utility definitions
  types/
    connector.ts                     — ConnectorConfig, AuthType, Category
    pipeline.ts                      — NodeType, PipelineStatus, PipelineRun
    ontology.ts                      — ObjectType, ObjectProperty, OntologyLink
    app.ts                           — NexusApp, AppComponent, ComponentType
    project.ts                       — Company, Project, Stage, TeamMember
    event.ts                         — Event structures
    inference.ts                     — Schema inference types
  pages/
    LoginPage.tsx                    — Email/password + SSO login
    ChangePasswordPage.tsx           — First-use password change
    SSOCallbackPage.tsx              — OIDC callback handler
```

### State Management Pattern

All stores use Zustand:

```typescript
export const useExampleStore = create<ExampleState>((set, get) => ({
  items: [],
  loading: false,
  fetchItems: async () => {
    set({ loading: true });
    const res = await fetch(`${API}/items`, { headers: { 'x-tenant-id': getTenantId() } });
    const data = await res.json();
    set({ items: data.items, loading: false });
  },
}));
```

### Design Tokens

```
Background:  #F8FAFC (light gray)
Panel:       #FFFFFF (white)
Border:      #E2E8F0 (light border)
Accent:      #7C3AED (purple) or #2563EB (blue)
Text:        #0D1117 (near-black)
Muted:       #64748B (medium gray)
Success:     #059669 (green)
Error:       #DC2626 (red)
Warning:     #D97706 (orange)
```

---

## 33. Deployment

### Docker Compose

All services are orchestrated via `docker-compose.yml`. To start the full platform:

```bash
docker-compose up -d --build
```

### Service Dependencies

```
postgres ─────┬──→ connector-service
              ├──→ pipeline-service ──→ ontology-service, event-log-service
              ├──→ ontology-service
              ├──→ auth-service ──→ audit-service
              ├──→ agent-service ──→ logic-service, utility-service, ontology-service
              ├──→ analytics-service
              └──→ ... (all services depend on postgres health)

timescaledb ──→ event-log-service ──→ process-engine

redis ────────→ connector-service, pipeline-service (cache, pub/sub)
```

### CI/CD — GitHub Actions

Deployments are automated via GitHub Actions with a security-first pipeline:

1. **Security Scan:** `pip-audit` checks Python dependencies for known vulnerabilities; Trivy scans Docker images for CVEs
2. **Build:** Docker images built for all services
3. **Deploy:** SSH into the EC2 instance with a **30-minute command timeout**
4. **Pull & Restart:** `git reset --hard` to avoid local change conflicts, then `docker-compose up -d --build`

#### Security Scan Details

- **pip-audit:** Scans `requirements.txt` for packages with known CVEs
- **Trivy:** Container image vulnerability scanner
- **`.trivyignore`:** Allowlist for non-exploitable CVEs that would otherwise block deployment
- Scans run on every push and PR to `main`

### Production Infrastructure

| Resource | Value |
|----------|-------|
| **Elastic IP** | `52.202.36.168` |
| **Instance** | AWS EC2 |
| **SSH Timeout** | 30 minutes per command |

### Environment Variables

Key environment variables (set in docker-compose.yml or `.env`):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TIMESCALE_URL` | TimescaleDB connection string |
| `REDIS_URL` | Redis connection string |
| `ANTHROPIC_API_KEY` | Default Claude API key. Acts as a platform-wide fallback when a tenant has no provider configured in Settings → AI Models. Tenants override this with their own Anthropic / OpenAI / Azure OpenAI / Local credentials. |
| `JWT_SECRET` | Secret for JWT token generation |
| `SKIP_AUTH` | Set `true` in dev to bypass authentication |
| `CORS_ORIGINS` | Allowed CORS origins (default: localhost:3000,5173) |
| `ALLOWED_ORIGIN_EC2` | Production CORS origin for the EC2 deployment |

### NGINX Configuration

NGINX serves at port 80:

- `/.well-known/`, `/.vite/`, `/assets/` → Static files (long TTL, immutable)
- `/index.html` → No cache (forces re-check)
- All other paths → React Router SPA fallback

### Health Checks

Every service exposes `GET /health`. Docker Compose health checks run at 5-second intervals with 5 retries. Dependent services wait for their dependencies to be healthy before starting.

### Rebuilding Individual Services

```bash
# Rebuild and restart a single service
docker-compose build pipeline-service && docker-compose up -d pipeline-service

# Rebuild frontend only
cd frontend && npm run build

# View logs for a specific service
docker-compose logs -f agent-service
```

---

## Appendix A — Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open global search |
| `Esc` | Close modals, exit focus mode in process map |

---

## Appendix B — Internationalization

The platform supports two languages via i18next:

- **English** (default)
- **Espa\u00f1ol**

Language is selectable from the user menu in the nav rail. Navigation labels, button text, and common UI strings are translated.

---

## Appendix C — Security

| Layer | Mechanism |
|-------|-----------|
| **Auth** | RS256 JWT with refresh tokens. JWKS endpoint for key rotation with auto-retry. MFA via TOTP. |
| **Rate Limiting** | slowapi on auth endpoints: 10 requests/minute |
| **Account Lockout** | 5 failed login attempts → 15-minute lockout |
| **Credential Storage** | Connector credentials encrypted at rest (Fernet) |
| **PII Detection** | AI-powered PII scanning via inference service |
| **Multi-Tenancy** | Strict tenant isolation via header-based scoping |
| **Impersonation** | JWT-based with `impersonated_by` claim, superadmin-only, fully audited |
| **Security Headers** | X-Content-Type-Options, X-Frame-Options on all responses |
| **CORS** | Configurable origins via `CORS_ORIGINS` and `ALLOWED_ORIGIN_EC2`, restrictive defaults |
| **CI Security** | pip-audit + Trivy scanning on every deployment, `.trivyignore` for non-exploitable CVEs |
| **Audit Trail** | Immutable event log of all actions |
