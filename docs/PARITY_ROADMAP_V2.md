# Nexus Parity Roadmap v2

**Date:** April 15, 2026
**Reference:** `docs/COMPETITIVE_ANALYSIS_V2.md`
**Goal:** Close all Critical and High gaps identified in the competitive analysis. Phases ordered by dependency chain and ROI.

---

## Phase Overview

```
Phase 1 — Object Record Foundation          (gaps 1, 2, 10, 11)
Phase 2 — Dashboard Interactivity           (gaps 3, 4, 5, 6, 28, 29)
Phase 3 — Actions & Operational Apps        (gaps 7, 24, 23)
Phase 4 — Process Mining Depth              (gaps 15, 16, 17, 18, 19)
Phase 5 — AI & Intelligence Layer           (gaps 8, 9, 13, 14, 27, 30)
Phase 6 — Data Integration Expansion        (gaps 20, 21, 22)
Phase 7 — Developer Platform                (gaps 25, 26, 12)
```

Each phase lists: what to build, why it matters, backend changes, frontend changes, data model, and acceptance criteria.

---

## Phase 1 — Object Record Foundation

**Why first:** Every subsequent phase depends on having live, queryable object records. Without records, dashboards show nothing, actions modify nothing, agents query nothing. This is the foundation for the entire operational platform.

**Gaps closed:** #1 Object Record Store, #2 Write-to-Ontology Pipeline Step, #10 Object Sets, #11 Link Traversal

### 1A — Object Record Store

**What:** Add a table to `ontology_service` that stores actual instances of object types. When a pipeline runs against a "Patient" object type, the resulting rows live here as queryable records.

**Backend (`ontology_service`, port 8004):**

```sql
CREATE TABLE object_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    record_id TEXT NOT NULL,          -- business key from source (e.g., patient_id)
    properties JSONB NOT NULL DEFAULT '{}',
    source_connector_id TEXT,
    source_pipeline_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, object_type_id, record_id)
);
CREATE INDEX idx_records_tenant_type ON object_records(tenant_id, object_type_id);
CREATE INDEX idx_records_properties ON object_records USING GIN (properties);
CREATE INDEX idx_records_updated ON object_records(updated_at DESC);
```

**New endpoints:**
- `GET /objects/{object_type_id}/records` — list records with filter, sort, pagination
  - Query params: `filter` (JSON: `{"status": "active", "department": "Cardiology"}`), `sort` (field + direction), `limit`, `offset`
  - Returns: `{ records: [...], total: number, page: number }`
- `GET /objects/{object_type_id}/records/{record_id}` — single record detail
- `POST /objects/{object_type_id}/records` — create/upsert single record
- `POST /objects/{object_type_id}/records/bulk` — batch upsert (for pipeline writes)
- `DELETE /objects/{object_type_id}/records/{record_id}` — delete record
- `PATCH /objects/{object_type_id}/records/{record_id}` — update properties

**Frontend:**
- Add "Records" tab to `ObjectTypePanel.tsx` — sortable/filterable table showing live records
- Records table: column headers from object type properties, search bar, pagination
- Empty state: "No records yet. Connect a pipeline with a Write-to-Ontology step to populate."

### 1B — Write-to-Ontology Pipeline Step

**What:** A new pipeline node type `WRITE_OBJECT` that maps pipeline output fields to object type properties and bulk-upserts into `object_records`.

**Backend (`pipeline_service`, port 8002):**
- Add `WRITE_OBJECT` to the node type enum (alongside existing SINK_OBJECT, SINK_EVENT)
- Node config schema:
  ```json
  {
    "target_object_type_id": "uuid",
    "primary_key_field": "patient_id",
    "field_mappings": {
      "patient_id": "record_id",
      "full_name": "name",
      "date_of_birth": "dob",
      "department": "department"
    },
    "upsert_mode": "merge"  // "merge" (update changed fields) or "replace" (overwrite entire record)
  }
  ```
- On pipeline execution: calls `POST /objects/{type}/records/bulk` on ontology_service
- Tracks row counts in node audit log

**Frontend (`NodeConfigPanel.tsx`):**
- When node type is `WRITE_OBJECT`: show object type selector, primary key field dropdown, and field mapping grid (source field → target property)
- Auto-suggest mappings when field names match property names

### 1C — Object Sets (Filtered Collections)

**What:** A reusable, named filter on object records. "All active patients in Cardiology" is an object set.

**Backend (`ontology_service`):**

```sql
CREATE TABLE object_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    filter_definition JSONB NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New endpoints:**
- `POST /objects/{type}/sets` — create named set with filter definition
- `GET /objects/{type}/sets` — list sets
- `GET /objects/{type}/sets/{set_id}/records` — resolve set to records (applies filter, returns matching records)
- `DELETE /objects/{type}/sets/{set_id}` — delete set

**Filter definition format:**
```json
{
  "conditions": [
    { "field": "status", "op": "eq", "value": "active" },
    { "field": "department", "op": "in", "value": ["Cardiology", "Neurology"] },
    { "field": "created_at", "op": "gte", "value": "2026-01-01" }
  ],
  "logic": "AND"
}
```

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`, `starts_with`, `is_null`, `is_not_null`

### 1D — Link Traversal at Runtime

**What:** Given a record, traverse its link types to pull related records from other object types. "Given Patient P-001, get all their Cases."

**Backend (`ontology_service`):**
- New endpoint: `GET /objects/{type}/records/{record_id}/links/{link_type_id}` — returns related records from the linked object type
- Implementation: uses link type definition (which has join keys) to query `object_records` on the target object type where the foreign key matches
- Supports pagination and filtering on the linked records

**Frontend:**
- In record detail view (Phase 7), show linked records as expandable sections

### Acceptance Criteria — Phase 1
- [ ] Pipeline with WRITE_OBJECT node populates records visible in ObjectTypePanel Records tab
- [ ] Records tab supports filter by property, sort by column, pagination
- [ ] Object sets can be created, listed, and resolved to records
- [ ] Link traversal returns related records from another object type
- [ ] Existing functionality unchanged (events, process mining, etc.)

---

## Phase 2 — Dashboard Interactivity

**Why now:** With records available from Phase 1, dashboards can display real data. But they need interactivity to be useful. This phase transforms dashboards from static displays into dynamic, connected applications.

**Gaps closed:** #3 Cross-Widget Filtering, #4 Variable System, #5 Event Wiring, #6 Filter Widgets, #28 Form Widget, #29 Object List Widget

### 2A — Dashboard Variable System

**What:** Typed state variables that widgets read from and write to. Shared across all widgets in an app.

**Data model changes (app_definitions JSONB in ontology_service):**

Add `variables` array to app definition schema:
```json
{
  "variables": [
    {
      "id": "var_department",
      "name": "selectedDepartment",
      "type": "string",
      "defaultValue": null
    },
    {
      "id": "var_date_range",
      "name": "dateRange",
      "type": "dateRange",
      "defaultValue": { "start": null, "end": null }
    },
    {
      "id": "var_selected_record",
      "name": "selectedRecord",
      "type": "objectRef",
      "defaultValue": null
    },
    {
      "id": "var_object_set",
      "name": "filteredPatients",
      "type": "objectSet",
      "defaultValue": { "objectTypeId": "...", "filters": [] }
    }
  ]
}
```

**Variable types:**
- `string` — text value
- `number` — numeric value
- `boolean` — true/false
- `dateRange` — `{ start, end }`
- `stringArray` — list of strings (multi-select)
- `objectRef` — `{ objectTypeId, recordId }`
- `objectSet` — `{ objectTypeId, filters[] }`

**Frontend (`AppCanvas.tsx` / `AppEditor.tsx`):**
- Variables panel in editor: define, name, type, default value
- `useAppVariables()` hook: React context providing variable state to all widgets
- Each widget config gets `inputBindings` (which variables it reads) and `outputBindings` (which variables it writes)

### 2B — Dashboard Event Wiring

**What:** When a user interacts with a widget (click, select, submit), it fires an event that updates variables or triggers actions.

**Event definition (in app_definitions JSONB):**
```json
{
  "events": [
    {
      "id": "evt_1",
      "sourceWidgetId": "bar_chart_1",
      "trigger": "onBarClick",
      "actions": [
        { "type": "setVariable", "variableId": "var_department", "valueFrom": "clickedLabel" },
        { "type": "refreshWidget", "targetWidgetId": "data_table_1" }
      ]
    },
    {
      "id": "evt_2",
      "sourceWidgetId": "dropdown_1",
      "trigger": "onChange",
      "actions": [
        { "type": "setVariable", "variableId": "var_status", "valueFrom": "selectedValue" }
      ]
    }
  ]
}
```

**Trigger types:** `onClick`, `onBarClick`, `onRowSelect`, `onChange`, `onSubmit`, `onDateChange`
**Action types:** `setVariable`, `refreshWidget`, `executeAction`, `navigate`

**Frontend:**
- Event wiring UI in editor: select source widget → trigger type → target action → variable mapping
- Visual indicator (lightning bolt icon) on widgets that have events wired
- Runtime: event bus connects widget interactions to variable updates, which trigger re-renders

### 2C — Cross-Widget Filtering

**What:** Widgets that read from the same variable automatically filter when the variable changes. This emerges naturally from 2A + 2B working together.

**Implementation:**
- Each widget's data query includes its `inputBindings`
- When a bound variable changes, the widget re-fetches data with the new filter value
- Example flow:
  1. User clicks "Cardiology" bar in chart
  2. `onBarClick` fires → sets `selectedDepartment` = "Cardiology"
  3. Table widget reads `selectedDepartment` → re-queries records filtered to Cardiology
  4. KPI widget reads `selectedDepartment` → shows Cardiology-only metrics

**Frontend:**
- `useVariableQuery()` hook: given a widget's bindings + variable state, constructs the API query
- All data-displaying widgets (table, chart, KPI) accept variable bindings as filter parameters
- Visual feedback: when a filter is active, show a filter badge on affected widgets

### 2D — New Filter Widgets

**What:** Dedicated widgets for user-driven filtering.

**Widget: `dropdown-filter`**
- Config: variable to bind, data source (object type + property or static list), multi-select toggle, search/typeahead
- Renders: styled dropdown/select, shows current selection, clear button
- On change: updates bound variable

**Widget: `text-input-filter`**
- Config: variable to bind, placeholder text
- Renders: text input with debounced onChange
- On change: updates bound variable

**Widget: `multi-select-filter`**
- Config: variable to bind, data source
- Renders: checkbox list or pill selector
- On change: updates bound `stringArray` variable

**Widget: `object-selector`**
- Config: variable to bind, object type, display property
- Renders: searchable dropdown of records
- On change: updates bound `objectRef` variable

### 2E — Form Widget

**What:** Input fields mapped to Action Type parameters. Submit → execute action → write to ontology.

**Config:**
```json
{
  "type": "form",
  "actionTypeId": "uuid-of-action",
  "fields": [
    { "paramName": "reason", "label": "Approval Reason", "inputType": "textarea" },
    { "paramName": "amount", "label": "Adjusted Amount", "inputType": "number" },
    { "paramName": "approved", "label": "Approve?", "inputType": "boolean" }
  ],
  "submitLabel": "Submit",
  "successMessage": "Action submitted successfully"
}
```

**Behavior:**
- Auto-generates form fields from action type's input_schema (or manual override)
- Validates inputs against action type validation rules
- On submit: calls `POST /actions/{type_id}/execute` (or queues to human confirmation if action requires it)
- Shows success/error feedback inline

### 2F — Object List/Table Widget (Record-Backed)

**What:** Display a filterable, sortable list of object records. The most fundamental data widget.

**Config:**
```json
{
  "type": "object-table",
  "objectTypeId": "uuid",
  "columns": ["name", "department", "status", "created_at"],
  "sortable": true,
  "filterable": true,
  "inputBindings": {
    "department": "var_department"
  },
  "outputBindings": {
    "onRowSelect": "var_selected_record"
  },
  "pageSize": 25
}
```

**Behavior:**
- Fetches from `GET /objects/{type}/records` with filters from bound variables
- Columns auto-generated from object type properties (or manual selection)
- Click row → updates `objectRef` variable → other widgets react (detail view, related records, etc.)

### Acceptance Criteria — Phase 2
- [ ] Variables defined in app editor, visible in a variables panel
- [ ] Dropdown filter widget updates a variable, bar chart filters accordingly
- [ ] Click a bar in chart → table filters to matching records
- [ ] Form widget submits to action type, shows success/error
- [ ] Object table widget shows paginated records from object_records
- [ ] Click table row → updates selected record variable → linked widgets react

---

## Phase 3 — Actions & Operational Apps

**Why now:** With records (Phase 1) and interactive dashboards (Phase 2), we can build apps that *do things*. This phase adds the write-back loop: webhooks, HTTP calls, and inbound event listeners.

**Gaps closed:** #7 Action Wiring, #24 Webhook HTTP Block, #23 Webhook Listeners

### 3A — Action Wiring in Dashboard (Form → Action → Ontology)

**What:** Complete the loop from Phase 2E. When a form submits an action that modifies an object record, the dashboard reflects the change immediately.

**Implementation:**
- After action execution succeeds, emit a `dataChanged` event
- All widgets reading from the affected object type re-fetch
- Optimistic UI: update local state immediately, reconcile on server response
- Support for confirmation-required actions: form shows "Pending approval" state

### 3B — Webhook / HTTP Call Block in Logic Studio

**What:** A new block type in Logic Studio that makes outbound HTTP requests.

**Block config:**
```json
{
  "type": "http_call",
  "method": "POST",
  "url": "https://hooks.slack.com/services/...",
  "headers": {
    "Content-Type": "application/json"
  },
  "body_template": "{\"text\": \"Case {{case_id}} approved by {{approver}}\"}"
}
```

**Features:**
- Methods: GET, POST, PUT, PATCH, DELETE
- Headers: static or from variables
- Body: JSON template with variable interpolation
- Auth: none, Bearer token, Basic, API key (header or query param)
- Response handling: parse JSON response, extract fields into block output variables
- Timeout: configurable (default 30s)
- Error handling: retry config (count + backoff), fallback output on failure

**Frontend (`LogicStudio.tsx`):**
- New block type in palette: "HTTP Call"
- Config panel: method selector, URL input, headers key-value editor, body template editor with variable autocomplete, auth config, response mapping

### 3C — Webhook Listeners (Inbound)

**What:** Accept HTTP POST/PUT events from external systems and route them to pipelines or actions.

**Backend (new service or extension of `connector_service`):**

```sql
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,          -- URL path: /webhooks/{slug}
    secret TEXT,                         -- HMAC verification secret
    target_type TEXT NOT NULL,           -- 'pipeline' or 'action' or 'event_log'
    target_id TEXT NOT NULL,             -- pipeline_id or action_type_id
    field_mappings JSONB DEFAULT '{}',   -- map incoming JSON fields to target schema
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Endpoint:**
- `POST /webhooks/{slug}` — receives external payload, validates HMAC if secret set, maps fields, triggers target
- `GET /webhooks` — list webhook endpoints
- `POST /webhooks` — create endpoint
- `DELETE /webhooks/{id}` — delete endpoint

**Frontend:**
- Webhook management panel (in Connectors or Settings module)
- Show URL to copy, secret management, test button ("Send test payload")
- Logs: recent webhook deliveries with payload preview and status

### Acceptance Criteria — Phase 3
- [ ] Dashboard form submits action → record updates → widgets refresh showing new data
- [ ] Logic Studio HTTP Call block POSTs to external URL and parses response
- [ ] Webhook endpoint receives external POST → triggers pipeline run
- [ ] Webhook HMAC validation rejects tampered payloads

---

## Phase 4 — Process Mining Depth

**Why now:** Process mining is our strongest differentiator. Deepening it widens the gap with Palantir (which has no process mining) and closes the gap with Celonis.

**Gaps closed:** #15 Performance View Toggle, #16 Click-to-Filter, #17 Connection Drill-Down, #18 Root Cause Analysis, #19 OLAP/Pivot Table

### 4A — Performance View Toggle

**What:** Switch the process map between frequency view (current) and performance view (shows median/avg/p95 throughput time on edges).

**Backend (`process_engine`):**
- Transitions endpoint already returns `avg_hours`, `p50_hours`, `p95_hours` — no backend changes needed

**Frontend (`ProcessMap.tsx`):**
- Add toggle button group: "Frequency" | "Performance"
- In Performance mode:
  - Edge labels show median throughput time (format: "2.4h" or "3.1d")
  - Edge thickness proportional to throughput time (thicker = slower)
  - Edge color: gradient from green (fast) → yellow → red (slow) based on p95
  - Node labels show average time spent at activity
- In Frequency mode: current behavior (edge thickness = case count)

### 4B — Click-to-Filter on Process Map

**What:** Click a node or edge → popup menu with 4 filter options that filter the entire process mining view.

**Frontend (`ProcessMap.tsx`):**
- Click node → context menu:
  - "Cases with this activity" — filter to cases containing this activity
  - "Cases without this activity" — exclude cases containing this activity
  - "Cases starting here" — filter to cases where first activity is this
  - "Cases ending here" — filter to cases where last activity is this
- Click edge → context menu:
  - "Cases with this transition" — filter to cases containing this A→B transition
  - "Cases without this transition" — exclude cases with this transition

**Backend (`process_engine`):**
- Add query params to cases/variants/transitions endpoints:
  - `include_activity=X` — cases containing activity X
  - `exclude_activity=X` — cases NOT containing activity X
  - `starts_with=X` — cases starting at activity X
  - `ends_with=X` — cases ending at activity X
  - `include_transition=A,B` — cases containing transition A→B
  - `exclude_transition=A,B` — cases NOT containing A→B
- Filter applied at SQL level on the activity_sequence array

**Store (`processStore.ts`):**
- Add `mapFilters` state: `{ type: 'include_activity' | 'exclude_activity' | ..., value: string }[]`
- Append map filters to `buildQueryParams()`
- Active filters shown as removable pills below the process map

### 4C — Connection Drill-Down (Throughput Time Histogram)

**What:** Click an edge → slide-out panel showing a histogram of throughput times for that transition, with drag-to-filter.

**Backend (`process_engine`):**
- New endpoint: `GET /process/transition-histogram/{object_type_id}`
  - Query params: `from_activity`, `to_activity`, `bins=20` (number of histogram buckets)
  - Returns: `{ buckets: [{ range_start_hours, range_end_hours, case_count }], stats: { min, max, median, avg, p95, total_cases } }`

**Frontend (new `TransitionDrillDown.tsx`):**
- Triggered on edge click (alternative to the filter menu — both accessible)
- Slide-out panel from right side
- SVG histogram: horizontal bars, x-axis = case count, y-axis = time buckets
- Drag selection on histogram → filter to cases within that time range (adds to mapFilters)
- Stats row above histogram: min, median, avg, p95, max
- Case count badge

### 4D — Root Cause Analysis

**What:** AI-powered identification of why cases are slow, stuck, or exhibit rework. Surfaces contributing factors automatically.

**Backend (`process_engine` or `inference_service`):**
- New endpoint: `POST /process/root-cause/{object_type_id}`
  - Input: `{ target: "slow_cases" | "stuck_cases" | "rework_cases", top_n: 10 }`
  - Process:
    1. Identify the target population (e.g., cases where duration > p75)
    2. Compare attributes of target vs non-target cases
    3. For each attribute key/value, compute frequency ratio (how much more common is this attribute in slow cases vs fast ones)
    4. Rank by frequency ratio * absolute count (impact score)
    5. Optionally use Claude to generate natural language explanation
  - Returns: `{ factors: [{ attribute_key, attribute_value, target_count, baseline_count, frequency_ratio, impact_score, explanation }] }`

**Frontend (new `RootCausePanel.tsx`):**
- Accessible from Bottleneck tab or as a new analysis mode
- Target selector: "Analyze slow cases" | "Analyze stuck cases" | "Analyze rework cases"
- Results: ranked list of contributing factors
  - Each factor: attribute name/value, impact bar chart, frequency ratio badge
  - AI explanation in natural language
- Click a factor → filters process map to cases with that attribute

### 4E — OLAP / Pivot Table

**What:** Multidimensional analysis of process data — group by any combination of dimensions and aggregate.

**Backend (`process_engine`):**
- New endpoint: `GET /process/pivot/{object_type_id}`
  - Query params: `rows` (comma-separated dimension keys), `columns` (optional), `metric` (count, avg_duration, rework_rate, etc.)
  - Returns: `{ dimensions: [...], cells: [{ row_keys: [...], column_keys: [...], value: number }] }`
  - Dimensions can be: activity, resource, variant_id, any attribute key, month, week, day_of_week

**Frontend (new `PivotTable.tsx`):**
- Drag-and-drop dimension selector: row dimensions, column dimensions, metric
- Rendered as styled HTML table with expandable row groups
- Cell formatting: heat-map coloring based on value intensity
- Export as CSV button
- Accessible from a new "Analysis" sub-tab or within Overview

### Acceptance Criteria — Phase 4
- [ ] Toggle between Frequency and Performance view on process map
- [ ] Click node → 4 filter options, click edge → 2 filter options, filters applied across all views
- [ ] Click edge → histogram panel shows throughput time distribution, drag to filter
- [ ] Root cause analysis returns top contributing factors for slow/stuck/rework cases
- [ ] Pivot table renders with configurable row/column dimensions and metric

---

## Phase 5 — AI & Intelligence Layer

**Why now:** The operational foundation is built. Now we make it smart: computed properties, semantic search, multi-model support, and deeper AI integration.

**Gaps closed:** #8 Derived Properties, #9 Vector Search, #13 Multi-Model Registry, #14 Agent in Apps, #27 AI Insights, #30 Custom Retrieval Functions

### 5A — Derived / Computed Properties

**What:** Properties on object types whose values are computed at query time from other properties or linked objects.

**Data model (`ontology_service`):**
- Add to object type property schema:
  ```json
  {
    "name": "total_value",
    "type": "decimal",
    "computed": true,
    "expression": "quantity * unit_price"
  }
  ```
- Supported expressions: arithmetic (`+`, `-`, `*`, `/`), string concat, `COALESCE`, `IF(condition, then, else)`, `DATE_DIFF`, linked property references (`linked.Cases.count`)

**Backend:**
- When returning records, evaluate computed properties server-side
- For simple arithmetic: SQL expression injection in SELECT
- For linked references: sub-query or post-processing
- Computed properties are read-only (cannot be written directly)

### 5B — Vector Properties + Semantic Search

**What:** Store embedding vectors on object records, enable similarity search.

**Prerequisites:** `pgvector` extension in PostgreSQL

**Backend (`ontology_service`):**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE object_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    record_id TEXT NOT NULL,
    property_name TEXT NOT NULL,
    embedding VECTOR(1536),
    text_content TEXT,
    model TEXT DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, object_type_id, record_id, property_name)
);
CREATE INDEX ON object_embeddings USING ivfflat (embedding vector_cosine_ops);
```

**New endpoints:**
- `POST /objects/{type}/records/{id}/embed` — generate embedding for specified text properties using configured model, store in object_embeddings
- `POST /objects/{type}/search/semantic` — `{ query: "patients with heart failure", limit: 20 }` → returns ranked records by cosine similarity
- Embedding generation: call OpenAI or Claude embedding API (configurable per tenant)

**Pipeline integration:**
- WRITE_OBJECT node gets optional `embed_properties: ["description", "notes"]` — auto-generates embeddings on upsert

**Search service upgrade:**
- Cmd+K search gains "Semantic" toggle alongside existing text search
- Semantic mode calls the new endpoint

### 5C — Multi-Model Provider Registry

**What:** Support multiple LLM providers, configurable per tenant.

**Backend (new table in `agent_service` or shared config):**

```sql
CREATE TABLE model_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,  -- 'anthropic', 'openai', 'google', 'azure_openai', 'local'
    api_key_encrypted TEXT,
    base_url TEXT,
    models JSONB NOT NULL DEFAULT '[]',  -- [{"id": "gpt-4o", "label": "GPT-4o", "context_window": 128000}]
    is_default BOOLEAN DEFAULT false,
    rate_limit_rpm INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Integration points:**
- Agent Studio: model selector dropdown pulls from registry (not hardcoded)
- Logic Studio: LLM Call block selects from registry
- Infer Service: uses default provider for schema inference
- Fallback chain: if primary model fails, try secondary provider

**Frontend:**
- Admin settings page: manage providers, add API keys, test connection
- Agent Studio / Logic Studio: model selector shows all available models with provider badge

### 5D — Agent Embedding in Apps

**What:** Drop an AI agent into a dashboard as a chat widget. The agent is context-aware of the dashboard's current variable state.

**Implementation:**
- New widget type: `agent-chat`
- Config:
  ```json
  {
    "type": "agent-chat",
    "agentId": "uuid-of-agent",
    "contextBindings": {
      "selectedPatient": "var_selected_record",
      "department": "var_department"
    }
  }
  ```
- When the user sends a message, the widget:
  1. Reads current variable values
  2. Prepends context to the agent invocation: "User is viewing Patient P-001 in Cardiology department"
  3. Calls `POST /agents/{id}/run` with the enriched context
  4. Streams response into the chat widget
- Agent can use its tools (query records, propose actions, etc.) while aware of dashboard context

### 5E — AI-Generated Insights & Recommendations

**What:** Surface actionable findings about process performance. Beyond activity classification.

**Backend (`process_engine` + `inference_service`):**
- New endpoint: `POST /process/insights/{object_type_id}`
  - Runs a series of automated analyses:
    1. Trend detection: "Rework rate increased 15% vs last month"
    2. Anomaly detection: "Case volume dropped 40% this week"
    3. Correlation discovery: "Cases from Resource X are 2.3x more likely to get stuck"
    4. Optimization opportunities: "Eliminating activity Y would save avg 3.2 days per case"
  - Uses statistical analysis + Claude for natural language explanations
  - Returns: `{ insights: [{ type, severity, title, description, metric_before, metric_after, affected_cases }] }`

**Frontend:**
- Insights panel in Overview tab (card-based, ranked by severity)
- Each insight: severity badge, title, description, "View affected cases" link

### 5F — Custom Retrieval Functions for Agents

**What:** Developers write custom context-fetching logic that agents call before responding.

**Implementation:**
- New tool type in Agent Studio: `custom_retrieval`
- Config: points to a Logic function that takes a query string and returns context text
- Logic function can: query object records, call external APIs, apply business logic, format results
- Agent invocation: before responding, calls the retrieval function, injects result into context window

**Example:**
- Logic function `get_patient_context(patient_id)`:
  1. Queries patient record
  2. Traverses links to get recent cases
  3. Queries process mining for case durations
  4. Formats as structured text
- Agent uses this context to answer "How is Patient P-001 doing?"

### Acceptance Criteria — Phase 5
- [ ] Computed property `total = qty * price` shows correct value in records table
- [ ] Semantic search returns relevant records for natural language query
- [ ] Agent Studio model selector shows OpenAI and Claude models from registry
- [ ] Agent chat widget in dashboard responds with awareness of selected record
- [ ] Insights panel shows at least 3 types of automated findings
- [ ] Custom retrieval function provides context that agent uses in response

---

## Phase 6 — Data Integration Expansion

**Why now:** The platform is powerful but can only ingest data via REST APIs. Most enterprise data lives in databases and files. This phase makes Nexus accessible to real customer data.

**Gaps closed:** #20 Incremental Pipelines, #21 File Upload, #22 Database Connectors

### 6A — File Upload Connector

**What:** Upload CSV, Excel, or JSON files directly into the platform. No API configuration needed.

**Backend (`connector_service`):**
- New connector type: `FILE_UPLOAD`
- `POST /connectors/{id}/upload` — accepts multipart file upload
  - Parses CSV (detect delimiter, encoding), Excel (.xlsx — first sheet), JSON (array of objects)
  - Stores parsed data in a staging table or temporary dataset
  - Returns schema preview: `{ columns: [{ name, detected_type, sample_values }], row_count }`
- `POST /connectors/{id}/import` — confirms import, writes to pipeline input or directly to object records

**Frontend:**
- New connector type card: "File Upload" with drag-and-drop zone
- Upload flow: drop file → preview schema (editable column names/types) → map to object type → import
- Support re-upload (replace or append)

### 6B — Database Connectors

**What:** Connect directly to PostgreSQL, MySQL, MSSQL, and Oracle databases.

**Backend (`connector_service`):**
- New connector types: `POSTGRESQL`, `MYSQL`, `MSSQL`, `ORACLE`
- Config schema:
  ```json
  {
    "host": "db.example.com",
    "port": 5432,
    "database": "production",
    "username": "nexus_reader",
    "password_encrypted": "...",
    "ssl": true
  }
  ```
- `POST /connectors/{id}/test` — verify connection
- `GET /connectors/{id}/tables` — list available tables
- `GET /connectors/{id}/tables/{table}/schema` — column names, types, sample data
- `GET /connectors/{id}/tables/{table}/preview?limit=100` — sample rows
- Pipeline SOURCE node: when connector type is database, config includes `query` or `table` + optional `where` clause

**Libraries:** Use `asyncpg` (Postgres), `aiomysql` (MySQL), `aioodbc` (MSSQL/Oracle) — or `databases` package for unified async access

### 6C — Incremental Pipeline Processing

**What:** Only process rows that are new or changed since the last pipeline run.

**Data model:**
- Add to pipeline node config: `incremental: { enabled: true, watermark_column: "updated_at", mode: "append" | "upsert" }`
- Add to pipeline runs table: `watermark_value TIMESTAMPTZ` — last processed timestamp

**Implementation:**
- SOURCE node with incremental enabled: adds `WHERE updated_at > {last_watermark}` to query
- WRITE_OBJECT node: upserts by record_id (already supported from Phase 1B)
- After successful run: updates `watermark_value` to max timestamp of processed rows
- Manual "Full Refresh" button to reset watermark and reprocess everything

### Acceptance Criteria — Phase 6
- [ ] Upload CSV file → preview schema → import to object records
- [ ] Connect to external PostgreSQL database → list tables → preview data
- [ ] Pipeline with database source node extracts data on schedule
- [ ] Second pipeline run with incremental mode only processes new rows
- [ ] Full refresh reprocesses all rows

---

## Phase 7 — Developer Platform

**Why now:** The platform is feature-rich. Now external developers need to build on top of it. And we need the auto-generated record detail view to complete the object experience.

**Gaps closed:** #25 External SDK, #26 NL → Process Map Filter, #12 Record Detail View

### 7A — Record Detail View (Auto-Generated Object Views)

**What:** Click any object record → see a rich detail page.

**Frontend (new `RecordDetailView.tsx`):**
- Layout:
  - **Header:** Record title (title property), object type badge, status
  - **Properties section:** Key properties as KPI-style cards (top 6), then full property table
  - **Linked records:** Expandable sections per link type, showing related records (uses link traversal from Phase 1D)
  - **Timeline:** If this record has associated events (via case_id match), show event timeline
  - **Actions:** Buttons for each Action Type defined on this object type
  - **Comments:** Threaded comments (uses collaboration_service)
- Accessible from: Records tab click, Object Table widget row click, search result click

### 7B — External TypeScript SDK

**What:** NPM package that lets external developers query the Nexus ontology.

**Package: `@nexus/sdk`**

```typescript
import { NexusClient } from '@nexus/sdk';

const nexus = new NexusClient({
  baseUrl: 'https://nexus.example.com',
  apiKey: 'nx_key_...',
  tenantId: 'tenant-001'
});

// Query records
const patients = await nexus.objects('Patient').filter({ status: 'active' }).limit(50).list();

// Get single record
const patient = await nexus.objects('Patient').get('P-001');

// Traverse links
const cases = await patient.links('PatientCases').list();

// Execute action
await nexus.actions('ApproveCase').execute({ caseId: 'C-123', reason: 'Approved' });

// Semantic search
const results = await nexus.objects('Patient').search('heart failure history');
```

**Implementation:**
- Auto-generate TypeScript types from object type schemas
- Wraps API Gateway endpoints (already exists at port 8021)
- Publish to NPM (or private registry)
- Includes: query builder, pagination helpers, type-safe property access

### 7C — External Python SDK

**What:** Pip package equivalent of 7B.

**Package: `nexus-sdk`**

```python
from nexus_sdk import NexusClient

nexus = NexusClient(
    base_url="https://nexus.example.com",
    api_key="nx_key_...",
    tenant_id="tenant-001"
)

patients = nexus.objects("Patient").filter(status="active").limit(50).list()
patient = nexus.objects("Patient").get("P-001")
cases = patient.links("PatientCases").list()
```

### 7D — NL → Process Map Filter

**What:** Type a natural language question in the process mining chatbot, and the process map filters accordingly.

**Implementation:**
- Extend the Overview chatbot's system prompt to recognize filter intent
- When AI detects a filter request, include a structured filter block in response:
  ```json
  {"type": "process_filter", "filters": [
    {"type": "date_range", "start": "2026-01-01", "end": "2026-03-31"},
    {"type": "include_activity", "value": "Review"},
    {"type": "attribute", "key": "department", "value": "Cardiology"}
  ]}
  ```
- Frontend: `extractFiltersAndClean()` function (similar to existing `extractWidgetsAndClean()`)
- When filter block detected: automatically apply to process store, switch to Map tab, show active filter pills
- Chat shows: "Filtered to: Cases from Jan-Mar 2026 containing Review activity in Cardiology"

### Acceptance Criteria — Phase 7
- [ ] Click record → detail view shows properties, linked records, timeline, actions, comments
- [ ] TypeScript SDK: `npm install @nexus/sdk` → query records, traverse links, execute actions
- [ ] Python SDK: `pip install nexus-sdk` → query records, traverse links
- [ ] Chat: "Show me cases from last quarter that went through the Review step" → map filters accordingly

---

## Timeline Estimate

| Phase | Scope | Dependencies |
|-------|-------|--------------|
| **Phase 1** — Object Records | 4 builds (record store, write-to-ontology, object sets, link traversal) | None — start immediately |
| **Phase 2** — Dashboard Interactivity | 6 builds (variables, events, cross-filter, filter widgets, form, object table) | Phase 1 (records needed for object table) |
| **Phase 3** — Actions & Operational Apps | 3 builds (action wiring, HTTP block, webhooks) | Phase 2 (dashboard forms), Phase 1 (records for write-back) |
| **Phase 4** — Process Mining Depth | 5 builds (perf toggle, click-filter, histogram, root cause, pivot) | None — can run in parallel with Phase 2/3 |
| **Phase 5** — AI & Intelligence | 6 builds (computed props, vectors, multi-model, agent widget, insights, retrieval) | Phase 1 (records for embeddings), Phase 2 (app variables for agent widget) |
| **Phase 6** — Data Integration | 3 builds (file upload, DB connectors, incremental) | Phase 1 (records to write to) |
| **Phase 7** — Developer Platform | 4 builds (detail view, TS SDK, Python SDK, NL filter) | Phase 1 (records), Phase 5 (semantic search for SDK) |

**Parallelism:** Phase 4 (process mining) has no dependency on Phase 1-3 and can be built in parallel from day one.

---

## Definition of Parity

Nexus reaches **competitive parity** when:

1. Object Types have live, queryable records populated by pipelines (Phase 1)
2. Dashboards are interactive: click chart → filter table → submit form → write data (Phase 2 + 3)
3. Process mining has click-to-filter, performance view, and root cause analysis (Phase 4)
4. AI agents support multiple models and embed in dashboards with context (Phase 5)
5. External developers can build on the platform via SDK (Phase 7)

Items 1-3 constitute the **minimum viable operational platform**. Items 4-5 establish **differentiation**.
