---
title: "Nexus — Internal Reference"
subtitle: "Sales + Product enablement"
date: "2026-05-13"
author: "MAIC"
geometry: "margin=0.85in"
fontsize: 11pt
numbersections: true
toc: true
toc-depth: 3
---

\newpage

# Executive Summary

**Nexus is a platform for turning operational data into operational intelligence.** It ingests data from any source (ERPs, databases, files, emails, webhooks, APIs), models it as a graph of business objects, runs pipelines and AI agents over that graph, surfaces deviations and recommendations as actions that humans approve, and gives any analyst — technical or not — a dashboard, an investigation agent, and a chat interface to ask questions in plain language.

Think of it as the layer between *"we have the data"* and *"the right person did the right thing on Tuesday at 9:47am."* That layer is what most companies are trying to build with five disconnected tools (ETL + warehouse + BI + workflow engine + a sprinkle of AI). Nexus is one of those companies' answer, built as one product.

**Who it's for.** Mid-to-large enterprises with operational complexity — procurement, ITSM, healthcare, government, manufacturing, finance, travel & expense. Common pattern: 5+ source systems, 3+ teams that need to act on the same data, real cost of bad decisions or slow decisions, regulator or auditor watching.

**Where it lives.** Self-hostable. Runs in Docker. ~32 microservices, all REST-based. Postgres for transactional state, TimescaleDB for event streams. Frontend is React. Multi-tenant from day one; every read/write is tenant-scoped.

**How to talk about it.** The shortest pitch: *"It's a control tower for your operations — same data, same place, different views for every role, with AI doing the boring parts and humans approving the consequential ones."*

\newpage

# 1. Why Nexus Exists

## 1.1 The problem in five sentences

Enterprise data lives in a dozen systems and the work of acting on it lives in a dozen more.
By the time signal travels from a CRM to a dashboard to a Slack message to a buyer's spreadsheet, the decision is late.
Teams hire analysts to write the same SQL queries every Monday morning.
AI tooling promises to fix this but ships as another disconnected tool.
What actually works is a single environment where the data, the models, the rules, the agents, and the humans are all in one audit trail.

## 1.2 What companies do today (and why it breaks)

| Stack today | What breaks |
|---|---|
| **ETL → warehouse → BI** (Fivetran + Snowflake + Looker) | Read-only. No way to *act* on what you see. Every action is "open another tool." |
| **iPaaS / workflow** (Zapier, n8n, Tray) | No data model. Rules are one-off. No conformance, no auditing, no ontology. |
| **MDM** (Reltio, Informatica) | Models the data well but doesn't *do* anything with it. |
| **RPA** (UiPath, Automation Anywhere) | Automates clicks; doesn't understand why. |
| **Standalone AI agents** (LangChain projects, ChatGPT enterprise) | Hallucinate, no tenant security, no audit trail, no human approval gate. |
| **Palantir Foundry** | Closest in spirit. Closed source, very expensive, slow to deploy, vendor lock. |

## 1.3 What Nexus does differently

1. **One ontology, one tenant boundary** — every record everywhere belongs to one business object type and one tenant. Apps, agents, alerts, pipelines all reference the same canonical objects.
2. **Pipelines and agents share a runtime** — a pipeline can call an agent as a node; an agent can run a pipeline as a tool. Same orchestrator, same audit log.
3. **Every consequential action goes through a Human Actions queue** — AI doesn't fire emails, place orders, or update records without an explicit human approval (or an explicitly waived `requires_confirmation: false`).
4. **Process mining is built in, not bolted on** — every object type with case/activity/timestamp fields gets a process map, variant analysis, conformance check, and bottleneck view automatically.
5. **The chat widget can read from any object type** — and cite specifics. Not "the dashboard says…" but "PO-4500272 with vendor V-001056 for €183,853."

\newpage

# 2. What Nexus Is — The Five Pillars

Everything in Nexus is one of five things:

| # | Pillar | One-line description |
|---|---|---|
| 1 | **Connectors** | How data gets in |
| 2 | **Ontology** | How the data is modeled |
| 3 | **Pipelines, Logic, Agents** | How the data is transformed and acted on |
| 4 | **Actions** | How humans confirm consequential decisions |
| 5 | **Apps** | How people consume and ask questions |

The rest of this document is essentially detailing what each of these is and how they relate.

## 2.1 Connectors

**Definition.** A Connector is a configured connection to a data source. It has a *type* (REST API, Database, Webhook, Email, File Upload, Gmail, WhatsApp), credentials, and a configuration (endpoint paths, query params, pagination strategy).

**What it produces.** A schema (the fields it returns) and records (rows fetched).

**Examples for a distributor.**

- REST connector to SAP S/4HANA pulling purchase orders
- Webhook connector receiving inbound supplier invoice events
- Email connector watching `purchasing@yourdomain.com` for inbound RFQ Excel attachments
- File upload connector for a CSV your CFO drops in monthly

**Key behaviors.**

- **Schema inference** — Nexus's AI can look at a sample of records and suggest semantic types (`vendor_id` is an IDENTIFIER, `total_amount` is CURRENCY, `email` is EMAIL with PII flag MEDIUM).
- **Pagination** — REST connectors auto-handle offset, cursor, and link-header pagination.
- **HMAC validation on webhooks** — every webhook can be signed with a shared secret; bad signatures are rejected.

## 2.2 Ontology — Object Types

**Definition.** An Object Type is the schema for one kind of business thing in your tenant. It has properties (typed fields), an optional primary key, and zero or more incoming/outgoing **Links** to other object types.

**What it produces.** A queryable record store (`object_records`) for that type, plus a node in the ontology graph.

**Examples for a distributor.**

- `PurchaseOrder` with fields `case_id`, `vendor`, `amount_eur`, `company`, `spend_area`, `document_type`, `cumulative_net_worth_eur`, `is_maverick`, etc.
- `Vendor` with fields `vendor_id`, `vendor_name`, `risk_category`
- `GoodsReceipt`, `Invoice` linked to `PurchaseOrder` (HAS_MANY)
- `Customer` linked to `PurchaseOrder` (BELONGS_TO via `customer_id`)

**Why this matters.** Every other surface in Nexus references object types. A dashboard widget asks "give me top 15 vendors by spend" — that's an `aggregate` query against `PurchaseOrder` records. An agent asks "find POs with maverick patterns" — same query, different consumer. **The ontology is the single source of truth.**

## 2.3 The Three Compute Surfaces — Pipelines, Logic, Agents

These three are similar enough that confusing them is the #1 onboarding mistake. The differences matter for both sales (positioning) and product (when to build which).

### Pipelines

**A Pipeline is a directed graph of typed nodes that moves data from source(s) to sink(s).** Each node has a strict shape (SOURCE, MAP, FILTER, CAST, ENRICH, FLATTEN, PIVOT, DEDUPE, VALIDATE, SINK_OBJECT, SINK_EVENT, AGENT_RUN, LLM_CLASSIFY). Pipelines are *scheduled* or *triggered by webhook*, run end-to-end as one unit, and persist their output as object records or events.

Use a pipeline when:

- You're ingesting data on a schedule or in response to an event
- The transformation is mostly deterministic (parse, filter, normalize, write)
- You want a clear "rows in / rows out" audit trail

### Logic Studio Functions

**A Logic Function is a smaller, block-based workflow that operates on data already in the ontology.** Blocks include `ontology_query`, `transform`, `conditional`, `llm_call`, `action`. Functions are typically *scheduled* (hourly, daily) or *invoked by another agent* and produce zero or more proposed actions or downstream calls.

Use a Logic Function when:

- The data is already in the ontology — you don't need ingestion
- You're running a recurring check (e.g., "any maverick POs in the last hour?")
- The output is a *decision*, not a transformed dataset

### Agents

**An Agent is an LLM that runs in a loop, calling tools, until it produces a final answer.** Tools include `query_records`, `get_object_schema`, `web_search`, `scrape_url`, `action_propose`, `process_mining`, and others. Agents are *invoked interactively* (a user asks a question) or *triggered by pipelines* (an `AGENT_RUN` node sends each new record to an agent for enrichment).

Use an Agent when:

- The shape of the task is ambiguous (the agent decides which tools to call)
- The output is a free-form answer with citations
- You need to handle the long tail (parts of the world that aren't in your ontology — the public web, a one-off PDF, an unstructured supplier portal)

### The defining differences

| Property | Pipeline | Logic Function | Agent |
|---|---|---|---|
| Trigger model | Schedule or webhook | Schedule, manual, or called from agent | Interactive prompt or pipeline `AGENT_RUN` node |
| Output | Records or events | Proposed actions, side effects | Free-form text + tool-call trace + optional proposed actions |
| Determinism | High (same input → same output) | Medium (deterministic blocks + LLM steps) | Low (the agent picks tool order at runtime) |
| Audit shape | `pipeline_runs` row per execution | `logic_runs` row per execution | `agent_runs` row per execution, with full tool-call trace |
| Cost per execution | Compute + occasional LLM | Compute + LLM if any `llm_call` block | LLM-heavy (every step is a Claude call) |
| When you reach for it | "Get this data here" | "Watch for this pattern and propose an action" | "Investigate this question / enrich this record from the open web" |

**Worked example — a maverick PO comes in:**

1. A *Pipeline* ingests the PO from the SAP webhook → writes to the `PurchaseOrder` object type.
2. A *Logic Function* runs hourly, finds it in the next sweep (`activity = Record Goods Receipt` AND no `SRM: Awaiting Approval` upstream), and proposes a `compliance_review` Action.
3. An *Agent* (`Procurement Compliance Auditor`) can be invoked ad-hoc by an investigator asking "show me the top 5 vendors by maverick rate this month" — it does the same work but in conversational form.

## 2.4 Actions — The Human-in-the-Loop Surface

**An Action Template** is a named, schema-validated form. An **Action Execution** is one instance of that template — proposed by an agent, a logic function, or a pipeline node, and queued for human review.

**Action statuses:**

- `proposed` (legacy)
- `pending_confirmation` — in the queue, awaiting human review
- `completed` — confirmed by a human (or auto-confirmed if `requires_confirmation: false`)
- `rejected` — explicitly rejected with a reason

**Workflow on confirmation.** An action template may have a workflow attached — stages, routing rules (e.g., "if `total_estimated_value >= 10000` route to manager"), option selection (the requester picks which supplier from the agent's options). The workflow is a small state machine; each stage transition is logged.

**Why this is structurally important.** This is the *only* surface where consequential things happen. An agent cannot "approve a PO" directly; it can only propose an action. A logic function cannot send an email directly; it can only propose. The Human Actions queue is the single place where automation meets accountability.

## 2.5 Apps — Dashboards, Workbenches, App Studio

**A Dashboard (App)** is a collection of widgets — metrics, bar charts, pie charts, line charts, data tables, custom code, chat — laid out on a 12-column grid. Widgets read from object types via the `/aggregate` and `/records` APIs and re-render in real time.

**Widgets are not limited to a single object type.** Every widget config supports three advanced features that compose into one `/aggregate` call:

- **Joins** — pull columns from a related object type at query time (`emp.full_name`, `proj.name`).
- **Computed fields** — virtual columns derived from a small expression language (`monthly_salary / 30 * allocation_pct / 100`). Can be authored per widget or promoted to a schema-level computed property on the object type.
- **Window functions** — running totals, moving averages, lag/lead, rank.

Together these replace most "materialize a new object type" / "run a Logic Function nightly" patterns when the goal is visualization. Full reference and worked examples (cumulative project cost, total cost to date, joined-name labels, 7-day moving average, ranking) in `docs/WIDGET_ADVANCED_FEATURES.md`.

**The Chat Widget** is special: it sees its sibling widgets and the object types they reference, and can answer cross-widget questions ("which company has the highest maverick rate this quarter?").

**Workbenches** are notebook-style scratch spaces — SQL-like queries, charts, agent calls, all in a notebook UI. Personal, not for production.

**App Studio** is for *external* apps built against Nexus — third-party apps installed into a tenant with scoped permissions. Each app is published with a version and a manifest; tenants explicitly install them.

\newpage

# 3. Core Concepts — A Reference

This section is the single-source dictionary. Anything that gets cited in a contract, a feature spec, or a customer email should match these definitions.

## 3.1 Tenant

The top-level isolation boundary. Every record, every connector, every dashboard, every agent run belongs to exactly one tenant. Cross-tenant reads are not possible by design (the auth layer enforces tenant scoping on every request). One company = one tenant in most deployments. Some customers run multiple tenants to separate environments (prod / staging) or business units.

## 3.2 User and Role

A user is an authenticated identity within one tenant. Roles in increasing order of privilege:

- `viewer` — read-only
- `analyst` — can write, can run queries, cannot delete
- `admin` — full access within the tenant
- `superadmin` — full access plus platform-level (cross-tenant) operations

The frontend nav rail shows different modules based on role and an optional `allowed_modules` list (empty = all modules visible).

## 3.3 Object Type

A named schema for one kind of business thing. Properties have a *data type* (`string`, `integer`, `float`, `boolean`, `datetime`), a *semantic type* (`IDENTIFIER`, `EMAIL`, `CURRENCY`, `STATUS`, `CATEGORY`, `QUANTITY`, etc.), and a *PII level* (`NONE`, `LOW`, `MEDIUM`, `HIGH`). Object types support versioning — the platform tracks schema changes and exposes a history.

## 3.4 Object Record

One instance of an object type. Stored in `object_records` with a `data` JSON column. Read via `GET /object-types/{id}/records` or aggregated via `POST /object-types/{id}/aggregate`.

## 3.5 Event

Distinct from a record. An event is `{case_id, activity, timestamp, attributes}` stored in TimescaleDB. Events are the substrate for process mining: a case is the join key, an activity is a step, and the ordered sequence of events per case is a process trace.

**Records describe state; events describe what happened.** A `PurchaseOrder` record has the latest state of one PO; the events table has the 10+ events that PO went through (Create → SRM Approve → Goods Receipt → Invoice → Pay).

## 3.6 Connector

A configured data source. Type + credentials + config (endpoint paths, headers, pagination). Connectors are tenant-scoped. They emit records when polled (REST, DB) or receive records on push (webhook, email).

## 3.7 Pipeline

A DAG of typed nodes (see §2.3). Has a *status* (DRAFT, PUBLISHED, FAILED), a *version*, a `data` JSON containing the node/edge graph, and a list of *runs* (in `pipeline_runs`). Each run has `rows_in`, `rows_out`, `status`, and `node_audits` (a JSON blob with per-node duration and row count).

## 3.8 Logic Function

A block-based workflow. Has `blocks` (a list with `id`, `type`, and type-specific fields), `version`, `status` (`draft` or `published`), and `published_version`. Each execution writes a row to `logic_runs` with the per-block trace.

## 3.9 Agent

An LLM-driven runtime. Has a *name*, *system prompt*, *model* (Haiku / Sonnet / Opus), an `enabled_tools` list, an optional *knowledge scope* (which object types it's allowed to query), and a `max_iterations` cap. Each invocation writes a row to `agent_runs` with the full tool-call trace and token/cost accounting.

## 3.10 Action (Template + Execution)

A template defines the shape (`input_schema`, `requires_confirmation`, `allowed_roles`, optional `notify_email`). An execution is one instance, proposed by some upstream (agent / logic / pipeline) and routed through the workflow.

## 3.11 Alert Rule + Alert Notification

An alert rule is a recurring check on event streams or record state. Four types are first-class:

- `stuck_case` — a case hasn't had a new event in N hours
- `slow_transition` — time from activity A to activity B exceeds N hours
- `rework_spike` — rework rate exceeds N% in a time window
- `case_volume_anomaly` — case volume drops/spikes vs baseline

When a rule fires, a row is written to `alert_notifications` with a severity, a message, a JSON `details` payload, and an optional `run_link` (deep link to the pipeline/agent run that triggered it).

## 3.12 Process

A registered "process" binds an object type's events to a process map. A process has a `name`, a `case_key_attribute` (the join field), `included_object_type_ids`, and optional `included_activities` / `excluded_activities` filters. Process mining computes the map, variants, bottlenecks, and conformance against an optional reference path.

## 3.13 Conformance Model

A reference sequence of activities ("the golden path"). Cases are compared to it and given a conformance score. Useful when the SOP says one thing and reality says another.

## 3.14 App / Dashboard

A collection of widgets on a 12-column CSS grid. Widgets read from object types. One app can pin as the tenant's "home dashboard" via the slug `dashboards-home` and `is_system: true`.

\newpage

# 4. The "X vs Y" Reference

If you only read one section, read this one. These are the questions that come up in every onboarding.

## 4.1 Agent vs Pipeline

- **Pipeline** is the *plumbing*. Deterministic, scheduled, moves data.
- **Agent** is the *intelligence*. Non-deterministic, called when needed, makes decisions and proposes actions.
- A pipeline can call an agent (via `AGENT_RUN` node). An agent can run a pipeline (via the `run_pipeline` tool). They compose.

## 4.2 Agent vs Logic Function

- **Logic Function** is the right tool when the *decision logic is fixed* — "if A and B, propose C." You can reason about its output from the block graph.
- **Agent** is the right tool when the *decision logic is open-ended* — "investigate this; figure out the right answer." You cannot predict which tools it will call.
- Logic functions are cheaper and faster; agents are more flexible.

## 4.3 Action vs Alert vs Notification

- **Alert (notification)** is *informational*. The bell icon. "Something happened." No required action.
- **Action** is *transactional*. The Human Actions queue. "Approve or reject this proposed change."
- The same upstream event may produce both — e.g., a maverick PO fires a `rework_spike` alert *and* proposes a `compliance_review` action.

## 4.4 Object Type vs Object Record

- **Object Type** is the *schema*. One row per type per tenant.
- **Object Record** is the *instance*. Many rows per type.

(If you've used SQL: object type = table definition; object record = row.)

## 4.5 Record vs Event

- A **record** is the current state of one business thing — one PO, one customer, one ticket.
- An **event** is something that happened to a case at a moment in time — "PO-4500272 went from Created to Approved at 09:32 on Tuesday."
- The two are stored differently (records in Postgres `object_records`, events in TimescaleDB) because their access patterns are different. Records support filters and aggregations; events support time-series queries and process mining.

## 4.6 Connector vs Pipeline

- **Connector** = the connection. Holds credentials and config.
- **Pipeline** = what you do with what the connector returns. Many pipelines can share one connector.

## 4.7 Workbench vs Dashboard

- **Workbench** is for *exploring*. SQL + charts + agent calls in a notebook UI. Private to the user.
- **Dashboard** is for *publishing*. Pinned for a team, refreshes live, widgets are configured (not ad-hoc code).

## 4.8 App Studio vs Apps (Dashboards)

- **Apps** (a.k.a. Dashboards) — the internal layout/widget builder that ships with Nexus.
- **App Studio** — for *external* apps written against the Nexus SDK and installed into a tenant (think of it as Nexus's app store).

\newpage

# 5. The Modules in the Nav Rail

This is what your customer sees when they log in. One row per module, in nav order.

| Module | One-liner | Backed by |
|---|---|---|
| **Dashboards** | The home tile + all published dashboards | `apps` table, `ontology-service` |
| **Apps** | External apps installed in this tenant | `external_apps` table, `apps-service` |
| **Workbench** | Notebook UI for ad-hoc analysis | `kernel-service` |
| **Connectors** | List of data sources, add/edit/test | `connector-service` |
| **Ontology** | Object types graph, edit schema and links | `ontology-service`, `schema-registry` |
| **Data** | Data explorer, process mining, AIP analyst, time series | `analytics-service`, `process-engine-service` |
| **Pipelines** | DAG builder, run history, schedules | `pipeline-service` |
| **Logic Studio** | Block-based functions and run history | `logic-service` |
| **Agent Studio** | Agent configs, threads, runs, schedules | `agent-service` |
| **App Studio** | Build & publish external apps | `apps-service` |
| **Evals** | Test suites for agents and logic functions | `eval-service` |
| **Value Monitor** | Track $ saved / $ generated by each automation | `finance-service` |
| **Scenarios** | What-if simulation over the ontology | `inference-service` |
| **Activity** | Audit log + correlation viewer | `audit-service`, `correlation-engine` |
| **Operations** | Hivemind grid — live wall of pipelines, agents, alerts | combined: `pipeline`, `agent`, `alert-engine` |
| **Utilities** | One-off utility scripts callable by agents and humans | `utility-service` |
| **Actions** | Human Actions queue + history | `ontology-service` |
| **Admin** | Tenant settings, users, API keys, integrations | `admin-service`, `auth-service` |
| **Platform** | Cross-tenant ops (superadmin only) | `admin-service` |
| **Settings** | Personal prefs, theme, language, AI model preferences | client + `auth-service` |

\newpage

# 6. Architecture at a Glance

## 6.1 Service map

Nexus is ~32 microservices, all FastAPI/Python, all REST. The frontend is a single React app served by nginx. Inter-service communication is plain HTTP. There's no message bus by design — every interaction is auditable as a request/response.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React + nginx :3000)             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                       Caddy / API gateway
                               │
   ┌───────────────────────────┼───────────────────────────┐
   │                           │                           │
   │  ┌─ Auth (:8011) ──── tenant + user + JWT             │
   │  ┌─ Ontology (:8004) ──── object types, records,      │
   │  │                        actions, apps               │
   │  ┌─ Connector (:8001) ──── data sources, webhooks     │
   │  ┌─ Pipeline (:8002) ──── DAG execution, runs         │
   │  ┌─ Logic (:8012) ──── block functions, runs          │
   │  ┌─ Agent (:8013) ──── LLM agents, tool calls         │
   │  ┌─ Process Engine (:8009) ──── process mining        │
   │  ┌─ Alert Engine (:8010) ──── rule eval, notifications│
   │  ┌─ Analytics (:8015) ──── aggregations, time series  │
   │  ┌─ Audit (:8006) ──── activity log                   │
   │  ┌─ Apps (:8028) ──── external app sandbox            │
   │  ┌─ Demo (:8024) ──── BPIC datasets for demos         │
   │  ┌─ Scraping (:8027) ──── web research backend        │
   │  ┌─ Inference (:8003) ──── scenarios, simulation      │
   │  └─ ...22 more (search, schema-registry,              │
   │                  collaboration, etc.)                 │
   │                                                       │
   └───────────────────────────┼───────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
        Postgres (OLTP)                 TimescaleDB (events)
        ─────────────────                ─────────────────
        object_records                   events
        object_types                     (time-series partitioned)
        apps, pipelines,
        agents, alert_rules,
        action_executions, ...
```

## 6.2 Two databases, two access patterns

- **Postgres** for everything record-shaped and configuration-shaped. Indexed on tenant_id + object_type_id. Fast for filtered queries and aggregations up to a few million rows.
- **TimescaleDB** for events. Time-partitioned hypertables. Fast for time-window queries and group-by-case operations needed for process mining.

## 6.3 Auth flow

1. User logs in via `auth-service` (email + password, or OIDC if configured).
2. `auth-service` issues a JWT with `sub`, `tenant_id`, `role`, `modules`, exp.
3. Every backend service has `require_auth` middleware that validates the JWT and extracts `tenant_id`.
4. Every DB query is filtered by `tenant_id` — cross-tenant reads are impossible by construction.

## 6.4 LLM provider abstraction

Agents and `llm_call` blocks route through `inference-service` (or directly via configured tenant providers in `agent-service`'s `model-providers` table). Supported: Anthropic (default), OpenAI, Azure OpenAI, local Ollama, vLLM, LM Studio. Tenants can self-host the model.

\newpage

# 7. A Worked Example — End to End

Story: a customer email arrives requesting a quote for `BACB30NN4K12`. Twenty seconds later a procurement officer has a sourced memo on her desk. Here's what fires under the hood.

1. **Email connector** (`connector-service`) watches `purchasing@distributor.com`. A new email arrives with `Subject: Ordenes de Compra` and an Excel attachment.
2. The email connector emits a webhook to the **Pipeline** named `Gmail PO Excel Ingestion`.
3. The pipeline's nodes execute in order:
   - `SOURCE` reads the attached XLSX into a row stream
   - `MAP` normalizes column names
   - `VALIDATE` rejects rows missing `mfg_part_number`
   - `SINK_OBJECT` writes each row as a `PurchaseRequest` object record
   - `AGENT_RUN` invokes the `po_researcher` agent on each new record
4. The **Agent** `po_researcher` (Claude Haiku, 5 tools enabled):
   - calls `web_search` for "BACB30NN4K12 supplier price"
   - calls `scrape_url` on the top 2-3 supplier pages
   - extracts unit price, lead time, MOQ from each
   - calls `action_propose` with a `po_research_memo` payload (sources, recommendation, confidence)
5. The proposed **Action** lands in `pending_confirmation` state in `action_executions`. The Human Actions queue badge ticks from `(10)` to `(11)`.
6. **Carlos**, the procurement officer, opens the action, reviews the three supplier options with cited URLs, picks the recommended one, and clicks Approve.
7. The action transitions to `completed`. The audit log records `confirmed_by: carlos@procurement.demo`.
8. A downstream **Logic Function** (`Auto-RFQ`) wakes up on the `completed` event, picks up the selected supplier from the action's `selected_option_ids`, and proposes a follow-up `send_rfq_email` action — which a human approves before the email actually goes out.
9. In parallel, the **Alert Engine** is sweeping `PurchaseOrder` events on a cron. A separate maverick PO that came in via the SAP webhook fires a `rework_spike` alert; the bell icon ticks; a `compliance_review` action lands in the queue for the compliance officer.
10. The **Procurement Compliance Auditor agent** is sitting idle. Tomorrow morning the compliance officer asks it "top 5 vendors by maverick PO count last 30 days" — it calls `list_object_types`, `get_object_schema`, `count_records`, `query_records` in 8 seconds and returns a ranked list with vendor IDs cited.

Every step in that story writes to one of the auditable run tables (`pipeline_runs`, `agent_runs`, `logic_runs`, `action_executions`, `alert_notifications`). The Activity page shows it all stitched together.

\newpage

# 8. Personas — Who Uses What

| Persona | Their Tuesday morning |
|---|---|
| **Buyer / Procurement Officer** | Opens Human Actions, sees 11 sourced memos, approves the ones with high confidence, kicks back the others with a note. |
| **Compliance Officer** | Bell icon shows new alerts. Opens Operations → Human Actions → filters by `compliance_review`. Each one has a 2-line LLM summary citing case, vendor, amount. |
| **Operations Lead** | Opens Operations (Hivemind). Sees pipelines running, an agent processing a backlog, two alerts active. Click → drilldown → the failing run's logs. |
| **Process Engineer** | Process Mining tab. Selects PurchaseOrder. Looks at the conformance score, the top 3 deviation variants. Builds a Logic Function to auto-flag the highest-frequency deviation. |
| **Data Analyst** | Workbench. Writes a SQL-like query against object types. Plots a chart inline. Saves it. Optionally publishes to a dashboard. |
| **Executive (CFO / VP Ops)** | Dashboards. The Control Tower lands on screen. Chat widget bottom right. Asks "what's our maverick rate trending this quarter vs last?" — answer arrives in 3 seconds with citations. |
| **Auditor (internal or external)** | Activity page. Filters by date range. Every record change, every action, every agent call is visible with who did what when. Exports to CSV. |
| **IT Administrator** | Admin tab. Creates new users, sets `allowed_modules` to scope them, generates API keys, reviews API gateway usage. |

\newpage

# 9. Sales Playbook

## 9.1 Categories Nexus replaces (or augments)

| Their existing tool | What Nexus replaces | What stays |
|---|---|---|
| **ETL** (Fivetran, Airbyte) | Connectors + Pipelines | Source-of-record systems |
| **Data warehouse** (Snowflake, BigQuery) | Object Types + the OLTP/TSDB pair | Only if they want the warehouse for BI |
| **BI** (Looker, Tableau, Power BI) | Dashboards + Chat widget | Often coexists for cross-domain executive reporting |
| **iPaaS** (Zapier, n8n) | Pipelines + Logic Studio | — |
| **Workflow** (ServiceNow, Jira workflows) | Actions + workflow stages | Ticketing if they want it |
| **MDM** (Reltio, Informatica) | Ontology | — |
| **AI agents** (LangChain projects, copilots) | Agent Studio | Production model providers (still rent Claude/OpenAI/etc.) |
| **Process mining** (Celonis, UiPath PM) | Process Mining module | — |

The honest line: *"You don't need to rip anything out. We sit on top of your systems of record. The first thing we replace is the dozen spreadsheets and the Monday-morning analyst meeting."*

## 9.2 Engagement shape

A typical Nexus engagement:

- **Week 1**: install (self-hosted Docker, ~1 day with the customer's IT person). Connect 1-2 source systems. Inference + create initial object types.
- **Week 2**: build the first 2-3 dashboards. Define the first alert rule. Run the first ad-hoc agent investigation.
- **Week 3-4**: model the ontology in more depth (links, derived attributes). First Logic Function in production.
- **Month 2**: process mining + conformance. Maverick triage live. First Human Actions in the queue.
- **Month 3+**: expand to more sources, more roles, more agents.

The "first PR in production" milestone is typically **~3 weeks** from kickoff. That's the honest number for sales conversations.

## 9.3 Pricing model (high level — confirm with leadership before quoting)

Nexus is priced on three axes:

1. **Platform license** — fixed annual fee that scales with tenant size and module set
2. **Compute** — pass-through LLM cost per agent invocation (~$0.001-0.02 per agent run depending on model)
3. **Implementation** — first 90 days have a services component for ontology design and pipeline build

Self-hosting is supported (and encouraged for security-sensitive customers). The platform license stays the same; the customer just bears their own infrastructure cost.

## 9.4 Common objections and 1-line answers

| Objection | Answer |
|---|---|
| "Isn't this just Palantir?" | "Same architectural ideas; one-tenth the cost, deployed in weeks, you can self-host. Open API everywhere." |
| "We already have Snowflake and Looker." | "Great — we sit next to them. Snowflake is the warehouse, Looker is the BI report. Nexus is the operational layer that takes action on what they show." |
| "How do we trust the AI?" | "Every agent action lands in a human approval queue by default. Every URL the agent cited is in the audit trail. You configure which actions can auto-execute and which require sign-off." |
| "What about data residency / GDPR?" | "Self-hosted by default. Your data never leaves your VPC. Multi-tenant isolation enforced at every layer. PII detection runs on every object type." |
| "How long to value?" | "Three weeks to first production alert. Three months to a full control tower. Most customers see their first 'we caught that one before it happened' moment in the first month." |
| "What's the alternative if we don't buy?" | "Hire two analysts, buy iPaaS, retrofit your BI, and re-litigate the data model every six months. It's the path most of your peers are on. We're saying: pay once, build it right." |

\newpage

# 10. Glossary (Alphabetical)

**Action** — A consequential operation proposed by an agent, logic function, or pipeline, queued for human approval. Templated and audited.

**Agent** — An LLM-driven runtime that calls tools in a loop until it produces a final answer. Has a system prompt, model, enabled tools, and a max-iterations cap.

**Alert Rule** — A recurring check on event streams or record state. Four types: stuck_case, slow_transition, rework_spike, case_volume_anomaly.

**Alert Notification** — One firing of an alert rule. Surfaces in the bell icon and on Operations.

**App** — A dashboard or external app. Has components (widgets) and a tenant scope.

**Case** — A business process instance, identified by `case_id`. The unit of analysis in process mining.

**Conformance Model** — A reference activity sequence ("golden path") that cases are compared against.

**Connector** — A configured data source — REST, DB, webhook, email, file upload, etc.

**Event** — `{case_id, activity, timestamp, attributes}`. The substrate of process mining.

**Human Action** — Common shorthand for an Action Execution in `pending_confirmation` status.

**Knowledge Scope** — A list of object types and optional filters that bound what an agent can query. Empty = unrestricted.

**Link** — A typed relationship between two object types (BELONGS_TO, HAS_MANY, MANY_TO_MANY).

**Logic Function** — A block-based workflow. Smaller than a pipeline; operates on data already in the ontology.

**Maverick PO** *(domain-specific)* — A purchase order that received goods or invoice without prior approval. Used as a canonical example in this doc.

**Object Type** — A typed schema for one kind of business thing. Has properties and optional links.

**Object Record** — One instance of an object type.

**Ontology** — The collection of object types + links for one tenant. The single source of truth.

**Pipeline** — A DAG of typed nodes that ingests, transforms, and writes data. Scheduled or triggered.

**PII Level** — `NONE / LOW / MEDIUM / HIGH`. Auto-detected by schema inference and used by guards and audit.

**Process (Process Definition)** — A registered binding of an object type's events to a process map.

**Process Mining** — Discovery and analysis of process flow from event logs. Map, variants, bottlenecks, conformance.

**Reference Path** *(see Conformance Model)*

**Requires Confirmation** — A flag on an Action Template. `true` = action waits for human approval. `false` = auto-execute.

**Run** — One execution of a pipeline, logic function, or agent. Always audited.

**Schema Inference** — AI-driven semantic typing of fields from sample data.

**Sink (SINK_OBJECT, SINK_EVENT)** — The terminal node of a pipeline; writes data into the ontology.

**Source (SOURCE)** — The starting node of a pipeline; reads from a connector.

**Tenant** — The top-level isolation boundary. One company = one tenant.

**Webhook** — An inbound HTTP endpoint that receives data pushed from a source. HMAC-signed.

**Widget** — A unit of a dashboard. Metric, bar, pie, line, table, custom-code, chat, etc.

**Workbench** — A notebook UI for ad-hoc analysis. Personal, not for production publishing.

\newpage

# 11. One-page Cheat Sheet (for printing)

**What Nexus is:** a platform that ingests, models, transforms, and acts on operational data — with AI doing the boring parts and humans approving the consequential ones.

**The Five Pillars:**
1. Connectors (how data gets in)
2. Ontology (how it's modeled)
3. Pipelines / Logic / Agents (how it's transformed and acted on)
4. Actions (how humans confirm)
5. Apps (how people consume)

**The Three Compute Surfaces — when to use which:**
- **Pipeline** for ingestion + deterministic transforms
- **Logic Function** for scheduled "watch for X, propose Y" rules
- **Agent** for open-ended investigation with tool use

**The audit trail:** every run writes a row. `pipeline_runs`, `agent_runs`, `logic_runs`, `action_executions`, `alert_notifications`.

**The human approval gate:** every consequential action defaults to `requires_confirmation: true`. Nothing leaves the platform without a person signing off.

**Time to first value:** 3 weeks. Time to a full control tower: 3 months.

**Who buys this:** mid-to-large enterprise, 5+ source systems, operational complexity, regulator watching.

**What it replaces:** ETL + warehouse + BI + iPaaS + workflow + AI agents — collapsed into one product.

**What it doesn't replace:** systems of record (ERP, CRM, etc.). Nexus sits *on top* of those.
