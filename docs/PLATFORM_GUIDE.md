# Nexus Platform — Full Capability Guide

> Living document. Every feature added to the platform gets added here.

---

## Table of Contents

1. [Logging In & Multi-Tenancy](#1-logging-in--multi-tenancy)
2. [Connectors](#2-connectors)
3. [Pipeline Builder](#3-pipeline-builder)
4. [Ontology (Object Types & Records)](#4-ontology-object-types--records)
5. [Logic Studio](#5-logic-studio)
6. [Agent Studio](#6-agent-studio)
7. [Process Mining](#7-process-mining)
8. [Event Log](#8-event-log)
9. [Human Actions](#9-human-actions)
10. [Utilities](#10-utilities)
11. [Users & Roles](#11-users--roles)
12. [Superadmin & Platform Management](#12-superadmin--platform-management)
13. [Admin Console](#13-admin-console)
14. [Nexus Assistant](#14-nexus-assistant)
15. [Data Quality](#15-data-quality)
16. [Value Monitor](#16-value-monitor)
17. [API Gateway](#17-api-gateway)
18. [Collaboration](#18-collaboration)
19. [Search](#19-search)
20. [Audit & Compliance](#20-audit--compliance)
21. [Settings — AI Models & Providers](#21-settings--ai-models--providers)
22. [Template Variable Reference](#22-template-variable-reference)
23. [Quick-Reference Cheatsheet](#23-quick-reference-cheatsheet)

---

## 1. Logging In & Multi-Tenancy

### How it works

Each company is isolated by **email domain**. Users from `maic.ai` see only maic.ai data. Users from `mjsp.sv` see only mjsp.sv data. They cannot see each other's connectors, pipelines, ontology records, agents, or anything else.

```
admin@maic.ai  →  tenant-001  (existing data, all modules)
admin@mjsp.sv  →  tenant-mjsp-sv  (clean workspace)
test@anyco.com →  tenant-anyco-com  (auto-provisioned on first user create)
```

### Login flow

```
┌─────────────────────────────────────────┐
│                                         │
│         [maic icon]                     │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  user@domain.com                │   │
│   └─────────────────────────────────┘   │
│                                         │
│   [ Next ]                              │
│                                         │
│   ─────────── or sign in with ──────── │
│   [ Google ]  [ Okta ]  [ Microsoft ]  │
│                                         │
└─────────────────────────────────────────┘
```

**Step 1** — Enter email → click Next
**Step 2** — Enter password → click Sign in
**Step 3** — Land on the **Dashboards** module (default landing page for fresh sign-ins; returning users resume the last page they viewed).

Default credentials (maic.ai):
- Email: `admin@maic.ai`
- Password: `admin`

### Creating a user for a new company

Go to **Users** → click **+ New User** → enter email like `admin@mjsp.sv`. The platform automatically provisions `tenant-mjsp-sv` and places the user there. Share the temp password shown in the credentials card.

---

## 2. Connectors

> **Where:** Left sidebar → Connectors

Connectors are authenticated connections to external data sources. They feed into Pipelines.

### Supported types

| Type | Use case |
|---|---|
| `REST_API` | Any HTTP API |
| `HUBSPOT` | CRM contacts, deals, companies |
| `SALESFORCE` | CRM objects |
| `FIREFLIES` | Meeting transcripts |
| `RELATIONAL_DB` | PostgreSQL / MySQL (schema only) |
| `MONGODB` | Document collections (schema only) |
| `DATA_WAREHOUSE` | Snowflake / BigQuery (schema only) |

### REST_API connector — full field reference

```
┌──────────────────────────────────────────────────────────┐
│  Name            Alertas Tiburon                         │
│  Type            REST_API                                │
│  Base URL        http://3.137.194.227                    │
│                                                          │
│  ── Authentication ───────────────────────────────────   │
│  Auth Type       Basic                                   │
│  Username        api_alertas_tiburon                     │
│  Password        ••••••••••••                            │
│                                                          │
│  ── Config ───────────────────────────────────────────   │
│  Path            /api/alertas_tiburon/api/v1/alertas/    │
│                  por-fechas                              │
│  Method          GET                                     │
│                                                          │
│  Query Params                                            │
│  ┌─────────────────┬──────────────────────────────────┐  │
│  │ fecha_inicio    │ {{$lastRun:YYYY-MM-DD}}           │  │
│  │ fecha_fin       │ {{$today:YYYY-MM-DD}}             │  │
│  └─────────────────┴──────────────────────────────────┘  │
│                                                          │
│  [ Test Connection ]   [ Save ]                          │
└──────────────────────────────────────────────────────────┘
```

### Auth types

| Auth Type | Fields needed |
|---|---|
| None | — |
| Bearer Token | Token |
| API Key | Header name, header value |
| Basic | Username, password |
| Dynamic Login | Token endpoint URL, method, body JSON, token path |
| Connector Auth | Pick another connector that returns the token |

#### Dynamic Login example (OAuth-style)

Set **Auth Type = Dynamic Login**, then:

```
Token Endpoint URL   https://auth.example.com/oauth/token
Method               POST
Body                 {"client_id":"abc","client_secret":"xyz","grant_type":"client_credentials"}
Token Path           data.access_token
```

The connector fetches a fresh token before every request using those details.

### Dynamic query param templates

These resolve at runtime when the pipeline runs:

| Template | Resolves to |
|---|---|
| `{{$today:YYYY-MM-DD}}` | Today's date |
| `{{$today:YYYY-MM-DDTHH:mm:ss}}` | Today's datetime |
| `{{$lastRun:YYYY-MM-DD}}` | Date of last successful pipeline run (7-day fallback) |
| `{{$daysAgo:7:YYYY-MM-DD}}` | 7 days ago |
| `{{$daysAgo:30:YYYY-MM-DD}}` | 30 days ago |
| `{{$range:1:50}}` | Iterates pages 1–50, merges rows |
| `{{connector:ID:field.path}}` | Pulls a value from another connector's first row |

#### Incremental date range (common pattern)

```
fecha_inicio  →  {{$lastRun:YYYY-MM-DD}}
fecha_fin     →  {{$today:YYYY-MM-DD}}
```

First run: fetches last 7 days (fallback). Every subsequent run: fetches only new data since the last run. The connector's `last_sync` is stamped automatically after each successful pipeline run.

#### Pagination via range

```
page  →  {{$range:1:20}}
```

Makes 20 requests (page=1 through page=20) and merges all rows into one batch.

### Connection test

Click **Test Connection** to see a step-by-step log:

```
✓ auth    Resolved bearer token (dynamic login → 200 OK)
✓ request GET https://api.example.com/v1/records?start=2026-03-30 → 200 OK
✓ data    47 rows, 12 fields detected
```

---

## 3. Pipeline Builder

> **Where:** Left sidebar → Pipelines

Pipelines transform raw connector data into clean ontology records or process mining events. They are built as a vertical step-list.

### Node types

```
SOURCE      →  pulls rows from a connector
ENRICH      →  per-row lookup against a second connector
MAP         →  rename / remap fields
FILTER      →  drop rows that don't match a condition
DEDUPE      →  remove duplicate rows by a key field
CAST        →  coerce field types (string → number, etc.)
FLATTEN     →  explode an array field into one row per item
VALIDATE    →  drop rows missing required fields
SINK_OBJECT →  write records into an ontology object type
SINK_EVENT  →  write records as process mining events
```

### Building a pipeline step by step

**1. Create pipeline** → give it a name → Save

**2. Add a SOURCE node**

```
Step Label      Fetch Alertas
Connector       Alertas Tiburon          ← pick your connector
Sync Frequency  1h                       ← how often this runs
Endpoint/Table  (leave blank)            ← uses connector's configured path+params
Batch Size      500
Incremental Key (leave blank for REST)   ← only for DB connectors
```

> **Endpoint/Table**: Leave blank to use the connector's full config (path + query params + templates). Fill it in only to override the connector's path with a specific one.

> **Incremental Key**: For database connectors, enter a field like `updated_at` to fetch only rows newer than the last run. For REST APIs, use `{{$lastRun}}` in the connector's query params instead.

**3. Add transform nodes** as needed (MAP, FILTER, DEDUPE, etc.)

**MAP example** — rename API fields to clean names:

```
API field        →  Target field
alerta_id        →  id
fecha_alerta     →  occurred_at
tipo_alerta      →  alert_type
monto            →  amount
estado           →  status
```

**FILTER example** — only active alerts:

```
Field     status
Op        equals
Value     ACTIVE
```

**4. Add a SINK_OBJECT node** — write to ontology

```
Object Type     Alerta                   ← pick the object type
Match Field     id                       ← used for upsert (update if exists)
Write Mode      upsert
```

**5. Run the pipeline**

Click **▶ Run Now**. The run log shows each node:

```
SOURCE      → 47 rows in, 47 rows out
FILTER      → 47 rows in, 31 rows out
MAP         → 31 rows in, 31 rows out
SINK_OBJECT → 31 rows in, 31 rows out  (29 created, 2 updated)
```

### ENRICH node — per-row detail lookups

Use when your source returns a list (e.g., alert IDs) and a second connector has the full detail per ID.

```
Lookup Connector    Alert Detail API
Join Key            id              ← field on the incoming row
Lookup Field        alert_id        ← query param on the detail endpoint
```

For each row, the pipeline calls `GET /detail?alert_id={row.id}` and merges the response onto the row. Up to 10 concurrent calls.

### Pipeline status and error handling

- Pipeline status now correctly reports **FAILED** when SOURCE nodes receive HTTP errors (4xx, 5xx).
- Field mappings and validation rules display as formatted JSON in the node inspector.

### SOURCE node — HTTP method

SOURCE nodes support an **HTTP Method** field (`GET`, `POST`, `PUT`). This overrides the connector's default method for the pipeline run. Useful when the same connector is used for both read and write operations.

```
Step Label      Fetch Records
Connector       My API
HTTP Method     POST             ← override connector default
```

### SINK_EVENT node — process mining

```
Case ID Field       loan_id         ← groups events into a "case"
Activity Field      stage           ← the step name (e.g., "Applied", "Approved")
Timestamp Field     occurred_at
```

Records written here appear in the **Process Mining** module as a process map.

---

## 4. Ontology (Object Types & Records)

> **Where:** Left sidebar → Ontology

The ontology is the platform's data model. Every business entity (Borrower, Alert, Loan, Contact) is an **Object Type** with typed fields. Pipelines write records into it.

### Creating an object type

1. Click **+ New Object Type** (top bar or node graph)
2. Enter display name (e.g., `Borrower`)
3. Add fields:

```
Field name      Type        Required    Unique
id              text        ✓           ✓
name            text        ✓
email           text
credit_score    number
status          text
created_at      timestamp
```

4. Save

### Finding an object type's UUID

In the **Ontology** view, click on any object type node. The **Configuration** tab on the right panel shows:

```
ID    3f4a7c9d-12ab-...    [copy]
```

You need this UUID when configuring Logic Studio's `ontology_update` block or pipeline SINK nodes.

### Records view

Click an object type node → **Records** tab to see all rows currently stored. From here you can also manually trigger a connected pipeline to refresh records.

### Relationships

Connect two object type nodes by dragging from one to the other. Labels the relationship (e.g., `Borrower → owns → Loan`). Relationships appear in lineage and can be used in agent knowledge scope.

---

## 5. Logic Studio

> **Where:** Left sidebar → Logic Studio

Logic Studio builds serverless functions — sequences of blocks that process data. Functions can be triggered manually, by pipelines, or by agents.

### Block types

| Block | Color | What it does |
|---|---|---|
| `ontology_query` | Blue | Fetch records from an object type |
| `llm_call` | Purple | Call Claude with a prompt, get text back |
| `action` | Orange | Trigger a registered human action |
| `ontology_update` | Green | Write/update a record in an object type |
| `transform` | Gray | Run JavaScript-style field manipulation |
| `send_email` | Teal | Send an email (via utility) |
| `utility_call` | Yellow | Call any registered utility |

### Building a function

**Example: Enrich Borrower with Geocode**

```
Block 1  ontology_query
         Object Type:  Borrower
         Filter:       status = "pending"

Block 2  utility_call
         Utility:      geocode
         Input:        {records[0].address}

Block 3  ontology_update
         Object Type:  Borrower (paste UUID here)
         Match Field:  id
         Match Value:  {records[0].id}
         Fields JSON:  {"lat": "{geocode_result.lat}", "lng": "{geocode_result.lng}"}
```

### Template syntax

Templates use `{path.to.value}` notation. You can reference:

```
{records[0].name}           first record's name field
{records[0].address}        first record's address field
{llm_result.text}           output from an llm_call block
{geocode_result.lat}        nested field from a utility result
{records[0].nested.field}   deeply nested JSON field
```

Arrays use `[index]` notation: `records[0]`, `records[1]`, etc.

### ontology_update block

```
┌──────────────────────────────────────────────────┐
│  Block type    ontology_update                   │
│  Object Type   Borrower  [dropdown]              │
│  Match Field   id                                │
│  Match Value   {records[0].id}                   │
│  Fields JSON   {                                 │
│                  "geocoded_lat": "{result.lat}",  │
│                  "geocoded_lng": "{result.lng}",  │
│                  "geocoded": true                │
│                }                                 │
└──────────────────────────────────────────────────┘
```

This does an **upsert** — updates the record if it exists, creates it if not.

---

## 6. Agent Studio

> **Where:** Left sidebar → Agent Studio

Agents are AI assistants that can query the ontology, run logic functions, call utilities, and propose actions — all within a configurable scope.

### Creating an agent

```
Name            Loan Risk Analyst
Description     Analyzes borrower risk and recommends actions
Model           claude-haiku-4-5-20251001   ← fast, good for structured tasks
Max Iterations  10                          ← max tool-call loops
Enabled         ✓
```

### System prompt (recommended structure)

```
You are a loan risk analyst for [Company Name].

You have access to:
- Borrower records (credit score, income, status)
- Loan records (amount, term, outstanding balance)
- Recent financial news via utility_run → rss_fetch

When asked about a borrower:
1. Search the ontology for their record
2. Check their loan history
3. Fetch relevant financial news if needed
4. Summarize risk level (LOW / MEDIUM / HIGH) with reasoning

Always cite the specific record IDs you used.
```

### Available tools

| Tool | What it does |
|---|---|
| `ontology_search` | Full-text + filter search across all object types |
| `list_object_types` | List all object types in the ontology |
| `logic_function_run` | Run a Logic Studio function |
| `action_propose` | Propose a human action for review |
| `list_actions` | List available registered actions |
| `agent_call` | Call another agent (multi-agent orchestration) |
| `process_mining` | Query process mining data |
| `utility_list` | List available utilities |
| `utility_run` | Run a utility (e.g., RSS fetch, geocode) |

### Knowledge scope

Restrict which object types the agent can see:

```
┌─────────────────────────────────────┐
│  Knowledge Scope                    │
│  ┌──────────────────────────────┐   │
│  │  ✓  Borrower                 │   │
│  │  ✓  Loan                     │   │
│  │  ✗  Internal HR Records      │   │
│  └──────────────────────────────┘   │
│  [ + Add Object Type ]              │
└─────────────────────────────────────┘
```

Leave scope empty = agent can search everything.

### Testing an agent

Click **Test** → type a message → the response renders as markdown with tables, bullets, and headers.

```
┌──────────────────────────────────────────────────────┐
│  Test Agent                                          │
│                                                      │
│  Message:  Analyze risk for borrower ID B-1042       │
│                                                      │
│  [ Run Test ]          ☐ Dry run (no side effects)   │
│                                                      │
│  ── Response ─────────────────────────────────────   │
│                                                      │
│  ## Risk Assessment: Borrower B-1042                 │
│                                                      │
│  **Risk Level: MEDIUM**                              │
│                                                      │
│  | Field         | Value      |                      │
│  |---------------|------------|                      │
│  | Credit Score  | 618        |                      │
│  | Income        | $42,000    |                      │
│  | Outstanding   | $28,500    |                      │
│                                                      │
│  **Reasoning:** Credit score below 650 threshold...  │
│                                                      │
│  Iterations: 3    Tools used: ontology_search (2x)   │
└──────────────────────────────────────────────────────┘
```

### Version history

Every **Save** creates a snapshot. Click **Versions** to see the history and restore any previous version.

### Analytics

**Runs over time** — bar chart of how many times the agent was invoked per day
**Top tools** — which tools the agent calls most
**Error rate** — % of runs that errored
**Avg iterations** — how many tool-call loops per run on average

---

## 7. Process Mining

> **Where:** Left sidebar → Process Mining

Visualizes how cases (loans, orders, incidents) move through stages over time. Requires a pipeline with a SINK_EVENT node.

### Setting up a pipeline for process mining

In the pipeline's SINK_EVENT node:

```
Case ID Field    loan_id      ← groups all events for one loan together
Activity Field   stage        ← the stage name (Applied, Approved, Disbursed, etc.)
Timestamp Field  occurred_at  ← when this stage transition happened
```

### What you see

```
┌──────────────────────────────────────────────────────┐
│  Process Map                                         │
│                                                      │
│   [Applied] ──42%──> [Underwriting] ──78%──> [Approved]
│                                         ──22%──> [Rejected]
│                                                      │
│   Median time: Applied → Approved: 3.2 days          │
│   Cases: 143    Variants: 7                          │
└──────────────────────────────────────────────────────┘
```

### Event Config (pipeline settings)

Click the **gear icon** on a process mining pipeline to configure which fields map to which roles:

```
Pipeline             Loan Status Events
Case ID Field        loan_id
Activity Field       stage
Timestamp Field      occurred_at
```

Click **Save Settings** — the pipeline now populates the process map on every run.

---

## 8. Event Log

> **Where:** Left sidebar → Event Log

Real-time log of everything that happens on the platform:

```
2026-04-06 10:32:41   PIPELINE_COMPLETED     Alertas Tiburon Sync    47 rows
2026-04-06 10:32:38   CONNECTOR_SCHEMA_FETCH  Alertas Tiburon
2026-04-06 10:31:02   RECORD_CREATED         Alerta               id: ALT-291
2026-04-06 10:31:02   RECORD_UPDATED         Borrower             id: B-1042
```

Events are filterable by type, object type, pipeline, connector, and time range.

---

## 9. Human Actions

> **Where:** Left sidebar → Human Actions

A queue of proposed actions waiting for a human to approve or reject. Agents propose actions using the `action_propose` tool. Humans review here.

```
┌────────────────────────────────────────────────────────────┐
│  Pending Actions                                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Flag Borrower for Manual Review                     │  │
│  │  Proposed by: Loan Risk Analyst                      │  │
│  │  Borrower: B-1042 — Juan Perez                       │  │
│  │  Reason: Credit score 618, high DTI ratio            │  │
│  │                                                      │  │
│  │  [ ✓ Approve ]    [ ✗ Reject ]                       │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 10. Utilities

> **Where:** Left sidebar → Utilities

Standalone tools that agents and Logic Studio functions can call.

### Built-in utilities

| Utility | What it does | Key input |
|---|---|---|
| `rss_fetch` | Fetches and parses an RSS/Atom feed | `url` |
| `geocode` | Converts an address to lat/lng | `address` |
| `send_email` | Sends an email | `to`, `subject`, `body` |

### Calling from an agent

In the agent's system prompt, tell it:

```
To get financial news: use utility_run with utility=rss_fetch and
url=https://feeds.reuters.com/reuters/businessNews
```

The agent will use `utility_list` to discover available utilities and `utility_run` to call them.

### Calling from Logic Studio

Add a `utility_call` block:

```
Utility    rss_fetch
url        https://feeds.reuters.com/reuters/businessNews
```

The result is available in subsequent blocks as `{utility_result.items[0].title}`.

---

## 11. Users & Roles

> **Where:** Left sidebar → Users (ADMIN only)

### Roles

| Role | Access |
|---|---|
| `SUPERADMIN` | Full platform access, cross-tenant visibility, impersonation, token tracking |
| `ADMIN` | Tenant-level administration — users, all modules, all data |
| `ANALYST` | Read + explore + query across all modules |
| `VIEWER` | Read-only access |

### Creating a user

1. Users → **+ New User**
2. Fill in name, email, role
3. A temp password is auto-generated
4. The **Credentials Card** appears — copy and share with the user

```
┌──────────────────────────────────────┐
│  Account created                     │
│                                      │
│  Email                               │
│  jose@mjsp.sv              [copy]    │
│                                      │
│  Temporary password                  │
│  Kx7mP9qTwR2n              [copy]    │
│                                      │
│  ● User must set a new password      │
│    before accessing the platform.    │
└──────────────────────────────────────┘
```

### Email domain = tenant

| Email | Tenant | Sees |
|---|---|---|
| `*@maic.ai` | `tenant-001` | All maic.ai data |
| `*@mjsp.sv` | `tenant-mjsp-sv` | All mjsp.sv data |
| `*@newco.com` | `tenant-newco-com` | Auto-provisioned clean workspace |

Creating a user for a domain auto-provisions that domain's tenant if it doesn't exist yet.

---

## 12. Superadmin & Platform Management

> **Where:** Left sidebar → Globe icon (only visible to `SUPERADMIN` role)

The **superadmin** role has full cross-tenant visibility. Superadmins can see and manage all tenants, users, and usage from a single view. This is the top-level operator role for platform owners.

### Platform page

The Platform page is accessed via the **globe icon** in the NavRail. It is only rendered for users with the `SUPERADMIN` role. It contains four tabs:

| Tab | Purpose |
|---|---|
| **Tenants** | Create and manage tenants (name, slug, plan) |
| **Token Usage** | Monitor all LLM calls across services and tenants |
| **Health** | Platform health overview |
| **Impersonation** | Impersonate any user across any tenant |

### Creating tenants

From the **Tenants** tab, click **+ New Tenant** and fill in:

```
Name        MJSP
Slug        mjsp-sv
Plan        enterprise
```

### Creating users for tenants

From within a tenant view, click **+ New User** to provision a user directly into that tenant. The same credentials card flow applies.

### Token usage monitoring

The **Token Usage** tab tracks all LLM calls across all services (agents, Logic Studio `llm_call` blocks, assistant queries). Usage is broken down by tenant, service, and model.

### Impersonation

Click **Impersonate** on any user row. The app immediately behaves as that user:

- A **red banner** appears at the top of the screen indicating the impersonated session.
- All data, permissions, and views reflect the impersonated user's tenant and role.
- Click **Exit** on the banner to return to the superadmin session.
- Impersonated sessions persist across page reloads via `sessionStorage`.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠ Impersonating: jose@mjsp.sv (ADMIN)          [ Exit ]        │
├──────────────────────────────────────────────────────────────────┤
│  ... app renders as jose@mjsp.sv ...                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Admin Console

> **Where:** `/admin` route (protected by `SUPERADMIN` role)

The Admin Console provides a dedicated interface for tenant CRUD operations. Accessible at the `/admin` route, it is protected and only available to users with the `SUPERADMIN` role.

### Capabilities

- **Create** new tenants with name, slug, and plan
- **Read** tenant details and associated users
- **Update** tenant configuration and plan
- **Delete** tenants (with confirmation)

---

## 14. Nexus Assistant

> **Where:** Bottom-right chat icon (available on all pages)

The Nexus Assistant is an AI-powered chat sidebar that provides contextual help and data exploration.

### Opening the assistant

Click the **chat icon** in the bottom-right corner of any page. The sidebar slides open.

### Two modes

| Mode | Purpose |
|---|---|
| **Platform Help** | Ask questions about the platform, get streaming responses |
| **Data Explorer** | Query specific object type records using natural language |

### Platform Help mode

- **Streaming responses** — answers appear token by token.
- **Context-aware** — the assistant knows your current page, connectors, pipelines, and object types.
- Ask things like "How do I set up a Dynamic Login connector?" or "What pipelines are connected to the Borrower object type?"

### Data Explorer mode

- Select an **object type** from the dropdown.
- Ask natural language questions about the data: "Show me all borrowers with credit score above 700" or "How many alerts were created this week?"
- Results render as tables within the chat.

### Action system

The assistant can **create** platform resources on your behalf:

- Connectors
- Object types
- Pipelines
- Logic functions

Actions appear as **confirmation cards** in the chat with **Confirm** and **Cancel** buttons. You must explicitly confirm before any resource is created.

```
┌──────────────────────────────────────────────────────┐
│  🔧 Create Object Type                               │
│                                                      │
│  Name:    Invoice                                    │
│  Fields:  id (text), amount (number), status (text)  │
│                                                      │
│  [ Confirm ]    [ Cancel ]                           │
└──────────────────────────────────────────────────────┘
```

Actions are **chained sequentially** — one action per message. The assistant waits for confirmation before proposing the next action.

### Tenant scoping

Conversations are **tenant-scoped**. Each tenant sees only their own conversation history.

---

## 15. Data Quality

> **Where:** Left sidebar → Data Quality

Monitor and enforce data quality across your ontology.

### Quality scoring

Each object type receives a **quality score** based on completeness, consistency, and validity of its records. Scores are displayed as a percentage on the Data Quality dashboard.

### On-demand quality checks

Click **Run Check** on any object type to trigger a quality evaluation. The check analyzes all records and updates the quality score in real time.

---

## 16. Value Monitor

> **Where:** Left sidebar → Value Monitor

Track the business value delivered by the platform over time.

### Business value categories

Organize value delivery into categories (e.g., cost savings, risk reduction, operational efficiency) and associate them with specific use cases.

### Timeline view

A timeline visualization shows when and how value was delivered, making it easy to report on ROI and platform impact.

---

## 17. API Gateway

> **Where:** Left sidebar → API Gateway

Expose ontology data as external REST APIs for downstream consumers.

### How it works

1. Select an **object type** to expose
2. The gateway generates a **dynamic endpoint** with a slug (e.g., `/api/v1/borrowers`)
3. Consumers authenticate with an **API key**

### API key management

- **Create** API keys with a label and optional expiration
- **Revoke** keys instantly
- **Toggle** keys on/off without deleting them

```
┌──────────────────────────────────────────────────────┐
│  API Keys                                            │
│                                                      │
│  Key              Status     Created                 │
│  sk-abc...xyz     Active     2026-04-01    [Revoke]  │
│  sk-def...uvw     Disabled   2026-03-15    [Toggle]  │
│                                                      │
│  [ + Create Key ]                                    │
└──────────────────────────────────────────────────────┘
```

### Dynamic endpoints

Endpoints are generated with slugs based on the object type name:

```
GET  /api/v1/borrowers          → list all records
GET  /api/v1/borrowers/:id      → get one record
```

---

## 18. Collaboration

> **Where:** Available on data objects and records

### Comments

Add comments to any data object or individual record. Comments support threaded discussions for focused conversations.

### Thread-based discussions

Reply to any comment to start a thread. Threads keep discussions organized and contextual to the specific data point being discussed.

---

## 19. Search

> **Where:** Top bar search icon (available globally)

### Global full-text search

Search across **all data objects** in the platform from a single search bar. Results are grouped by object type and ranked by relevance.

---

## 20. Audit & Compliance

> **Where:** Left sidebar → Event Log (expanded)

Building on the Event Log, the audit and compliance system adds structured approval workflows.

### Checkpoint gates

Define **checkpoint gates** at critical stages of a pipeline or process. When a case reaches a checkpoint, it pauses and waits for explicit approval before proceeding.

### Approval request flow

1. A pipeline or agent triggers a checkpoint gate
2. An **approval request** is created and assigned to the appropriate reviewer
3. The reviewer sees the request in their **Human Actions** queue
4. The reviewer **approves** or **rejects** the request
5. The pipeline resumes or halts based on the decision

---

## 21. Settings — AI Models & Providers

> **Where:** Left sidebar → Settings → **AI Models** tab (Cpu icon, second from top)

Each tenant can plug in its own LLM providers — cloud (Anthropic, OpenAI, Azure OpenAI, Google) or self-hosted (Ollama, vLLM, LM Studio) — and pick a default that the whole platform flows through.

### What it covers

Every AI surface in the platform consults the tenant's chosen provider:

- Agent Studio (tool-using agents, sync + streaming)
- AIP Analyst (chat with data)
- Schema inference, similarity scoring, conflict detection
- AI-generated apps and dashboards
- Workbench notebook cell generation
- Pipeline / logic copilot prompts
- Lineage explanations and anomaly surfacing

When no provider is configured for a tenant, the platform falls back to the server's `ANTHROPIC_API_KEY`.

### Adding a provider

1. Click **+ Add provider**
2. Pick a **Provider type**:

| Provider type | Notes |
|---|---|
| **Anthropic** | API key required. Default models: Claude Opus 4.7, Sonnet 4.6, Haiku 4.5. |
| **OpenAI** | API key required. Default models: GPT-4o, GPT-4o mini, o1. |
| **Azure OpenAI** | API key + base URL of the form `https://<resource>.openai.azure.com`. |
| **Google (Gemini)** | API key required. Connection test works; full chat routing is on the roadmap. |
| **Local / Self-hosted** | No API key needed. Base URL example: `http://host.docker.internal:11434` for Ollama. The platform appends `/v1` automatically for Ollama-style servers. |

3. Optionally override the **Base URL** (leave blank to use the provider's default endpoint).
4. Add or remove **models** — anything you list shows up in model pickers across the platform. Custom IDs are supported (e.g. `llama3.1:8b`, a fine-tuned snapshot, or an Azure deployment name).
5. Toggle **Default for tenant** — exactly one default per tenant. Set / clear from the row's star button.
6. Toggle **Enabled** — disabled providers stay configured but are skipped by the resolver.
7. **Save** → the row appears in the list with a masked key (`abcd••••••••wxyz`). Plaintext keys never come back from the server after the first save.

### Testing a connection

Each row has a **Test** button that hits a lightweight endpoint:

| Type | Test target |
|---|---|
| Anthropic | `POST /v1/messages` with a 1-token ping |
| OpenAI / Azure OpenAI | `GET /v1/models` |
| Google | `GET /v1beta/models?key=…` |
| Local | `GET /api/tags` (Ollama-style) |

A green banner means the credentials and endpoint are reachable.

### Editing & rotating keys

- Click the pencil to edit. Leaving the API key field blank keeps the existing key.
- The provider type is locked once the row exists (create a new provider if you need to switch backends).
- Deleting a provider drops it from the resolver — anything that was using it falls back to the tenant default.

### Provider matrix (current)

| Provider | Inference (chat, JSON) | Agents w/ tools | SSE streaming |
|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ token-by-token |
| OpenAI / Azure | ✅ | ✅ (function calls translated to Claude-style tool blocks) | ⚠️ chunk-once |
| Local (Ollama / vLLM / LM Studio) | ✅ | ✅ if the model supports OpenAI-style tools | ⚠️ chunk-once |
| Google Gemini | ❌ falls back to env Anthropic | ❌ | ❌ |

### API endpoints (agent-service :8013)

```
GET    /model-providers              — list tenant providers (api keys masked)
POST   /model-providers              — create provider
PUT    /model-providers/{id}         — update (masked key body is ignored on PUT)
DELETE /model-providers/{id}         — remove provider
POST   /model-providers/{id}/test    — connection probe
```

---

## 22. Template Variable Reference

### Date templates (connector query params)

```
{{$today:YYYY-MM-DD}}             →  2026-04-06
{{$today:YYYY-MM-DDTHH:mm:ss}}    →  2026-04-06T14:30:00
{{$lastRun:YYYY-MM-DD}}           →  last pipeline run date (7-day fallback)
{{$lastRun:YYYY-MM-DDTHH:mm:ss}}  →  last pipeline run datetime
{{$daysAgo:1:YYYY-MM-DD}}         →  yesterday
{{$daysAgo:7:YYYY-MM-DD}}         →  7 days ago
{{$daysAgo:30:YYYY-MM-DD}}        →  30 days ago
```

### Format tokens

```
YYYY   →  2026
MM     →  04
DD     →  06
HH     →  14    (24-hour)
mm     →  30
ss     →  00
```

### Pagination template

```
{{$range:1:50}}   →  iterates param from 1 to 50, one request per value
```

### Cross-connector reference

```
{{connector:CONNECTOR_UUID:field.path}}
```

Fetches the first row from another connector and extracts a nested field value.

### Logic Studio templates

```
{records[0].id}               →  first record's id
{records[0].address}          →  first record's address
{records[1].name}             →  second record's name
{llm_result.text}             →  LLM call output
{utility_result.lat}          →  utility output field
{utility_result.items[0].title}  →  nested array in utility result
```

---

## 23. Quick-Reference Cheatsheet

### Most common pipeline patterns

**Daily incremental API sync → ontology**
```
SOURCE (connector with {{$lastRun}} in queryParams)
  → MAP (rename fields)
  → DEDUPE (by id)
  → SINK_OBJECT (upsert)
```

**Paginated API → ontology**
```
Connector queryParams:  page → {{$range:1:20}}
SOURCE (no endpoint set)
  → MAP
  → SINK_OBJECT
```

**API with detail lookup**
```
SOURCE (list endpoint)
  → ENRICH (detail endpoint per row)
  → MAP
  → SINK_OBJECT
```

**Events for process mining**
```
SOURCE
  → FILTER (only completed records)
  → SINK_EVENT (case_id=loan_id, activity=stage)
```

### Common mistakes

| Mistake | Fix |
|---|---|
| Pipeline returns 0 rows | Leave Endpoint blank if connector has path+params configured |
| `{{$lastRun}}` always returns 7 days ago | Pipeline must complete successfully at least once to stamp `last_sync` |
| Agent saves but loses settings on navigation | Fixed — auth service now persists properly |
| Utilities use `localhost:8014` on AWS | Fixed — `VITE_UTILITY_SERVICE_URL` now in deploy.yml |
| New user can't log in | Their email domain needs a user created via the Users page first |
| Logic Studio `records[0]` fails | Use `{records[0].field}` — array index notation is supported |

### Connector auth quick-pick

| API gives you | Auth type to use |
|---|---|
| A static token | Bearer Token |
| Username + password | Basic |
| A header key like `X-API-Key` | API Key |
| A login endpoint that gives you a token | Dynamic Login |
| OAuth client credentials | Dynamic Login (body = grant_type, client_id, client_secret) |

### Agent model guide

The model dropdown in Agent Studio (and every other AI surface) lists whatever the tenant has registered in Settings → AI Models. Default Anthropic options when nothing is configured:

| Model | Best for |
|---|---|
| `claude-haiku-4-5-20251001` | Fast, cheap, structured lookups |
| `claude-sonnet-4-6` | Complex reasoning, multi-step analysis |
| `claude-opus-4-7` | Deep research, long documents |
| `gpt-4o` / `gpt-4o-mini` | OpenAI alternatives once an OpenAI provider is registered |
| `llama3.1:8b`, `qwen2.5:7b`, custom IDs | Self-hosted via the **Local** provider type (Ollama / vLLM / LM Studio) |

### Default credentials

| Account | Email | Password |
|---|---|---|
| Default admin | `admin@maic.ai` | `admin` |

### Superadmin features

| Feature | How to access |
|---|---|
| Platform management | Globe icon in NavRail (superadmin only) |
| Impersonation | Platform → Impersonation tab → click "Impersonate" |
| Token usage | Platform → Token Usage tab |
| Admin Console | Navigate to `/admin` |

### Nexus Assistant shortcuts

| Action | How |
|---|---|
| Open assistant | Click the chat icon (bottom-right corner) |
| Switch mode | Toggle between "Platform Help" and "Data Explorer" at the top of the sidebar |
| Confirm action | Click "Confirm" on the action card |
| Cancel action | Click "Cancel" on the action card |

---

*Last updated: April 2026*
