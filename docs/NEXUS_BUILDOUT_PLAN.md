# NEXUS PLATFORM — REVISED BUILDOUT PLAN
### Based on Full Codebase Audit | April 2026
**Replaces:** Initial plan (pre-audit assumptions removed)

---

## GROUND TRUTH: WHAT'S ACTUALLY BUILT

After reading every router, component, and store file:

| Module | Score | Honest Status |
|---|---|---|
| Pipeline Builder | 10/10 | 13 node types, ReactFlow canvas, full execution |
| Agent Studio | 10/10 | 9 tools, streaming, scheduling, versions |
| Human Actions | 10/10 | Full approval workflow, bulk ops, maps |
| Process Mining | 9.5/10 | 6 tabs, conformance, variants, cases, alerts |
| Ontology | 9.5/10 | Graph, versioning, schema diff, links |
| Alert Engine | 9.5/10 | Rules, email, webhooks, cooldown |
| Event Log | 9.5/10 | SSE streaming, quality scoring, activity filters |
| Utilities | 9.5/10 | 10 executors: OCR, scrape, geocode, pdf, slack... |
| Apps Module | 9/10 | 11 widgets, AI layout gen, grid builder |
| Logic Studio | 8.5/10 | 7 block types, runs, schedules — **missing loops/conditionals** |
| Connectors | 9/10 | REST, Salesforce, HubSpot, Postman import, OAuth2 |
| **Lineage** | **0/10** | **"Coming soon" message. Nothing built.** |
| **Settings** | **0/10** | **"Coming soon" message. Nothing built.** |
| **Finance Module** | **1/10** | **Stub component. Backend exists.** |

**Backend built with zero frontend:**
- `audit-service` — full audit_events table, logs everything, no viewer UI
- `schema-registry` — full schema version history, not exposed in UI
- `correlation-engine` — scores schema similarity, not exposed in UI
- `inference-service/chat_with_data` — endpoint exists, never called from frontend
- `inference-service/platform_help` — endpoint exists, never called

**The real gap summary:** The core platform loop (connect → pipeline → ontology → agent → action) is production-ready. What's missing is: (1) a way for users to **query and analyze** their own data, (2) a way to **test and trust** AI outputs, (3) **lineage + governance** tooling, (4) **graph traversal**, (5) **operational automation**, (6) **collaboration + reporting**, and (7) **ML model management**.

---

## ARCHITECTURE CONSTANTS (DO NOT CHANGE)

```
Existing services:
  connector-service     8001   PostgreSQL
  pipeline-service      8002   PostgreSQL + Redis
  inference-service     8003   Stateless (Claude)
  ontology-service      8004   PostgreSQL
  event-log-service     8005   TimescaleDB
  audit-service         8006   PostgreSQL
  schema-registry       8007   PostgreSQL
  correlation-engine    8008   Stateless
  process-engine        8009   PostgreSQL + TimescaleDB
  alert-engine          8010   PostgreSQL + TimescaleDB
  auth-service          8011   PostgreSQL
  logic-service         8012   PostgreSQL
  agent-service         8013   PostgreSQL
  utility-service       8014   Stateless
  project-mgmt          9000   PostgreSQL
  finance-service       9001   PostgreSQL

New services added across phases:
  analytics-service     8015   PostgreSQL + TimescaleDB   (Phase 2)
  eval-service          8016   PostgreSQL                 (Phase 3)
  automate-service      8018   PostgreSQL + Redis         (Phase 5)
  collab-service        8021   PostgreSQL                 (Phase 6)
  model-service         8019   PostgreSQL + MinIO         (Phase 7)
```

**Shared patterns across all new backend services:**
```python
# Every new service follows this exact structure:
backend/new_service/
├── main.py              # FastAPI app, CORS, startup, health check
├── database.py          # asyncpg pool init, CREATE TABLE IF NOT EXISTS
├── routers/
│   └── *.py             # One router per domain
# Always uses:
from shared.auth_middleware import require_auth
from shared.nexus_logging import get_logger
# Header: x-tenant-id
# URL format: /{service_domain}/{resource}
```

---

---

# PHASE 0 — SURFACE WHAT'S ALREADY BUILT
### "Stop leaving finished work invisible. Wire backend to frontend."
**Effort:** 1–2 weeks | **No new services** | **Highest ROI of any phase**

The following backend services are fully implemented but have **zero frontend exposure**. This phase builds the UI for them.

---

## 0.1 Audit Log Viewer

### What exists
`audit-service` (8006) logs every platform operation to `audit_events(id, tenant_id, user_id, action, resource_type, resource_id, status, changes, timestamp)`. Endpoints: `GET /audit` with full filter support. Nothing calls it from the frontend.

### What to build

**New frontend module: `src/modules/audit/AuditLogPage.tsx`**

```
AuditLogPage.tsx
├── AuditFilters.tsx        # tenant | user | action | resource_type | date range
├── AuditTable.tsx          # paginated table: timestamp | user | action | resource | status
├── AuditDetailDrawer.tsx   # slide-in: full changes JSON diff, before/after
└── AuditExportButton.tsx   # download filtered results as CSV
```

**Table columns:** Timestamp · User (email) · Action (create/update/delete/execute) · Resource Type · Resource ID (clickable → navigates to resource) · Status (success/fail) · Changes (expand for diff)

**Add to NavRail:** Under admin section. Show for `admin` role only.

**New store: `src/store/auditStore.ts`**
```typescript
interface AuditState {
  events: AuditEvent[];
  total: number;
  loading: boolean;
  filters: AuditFilters;
  fetchEvents: (filters: AuditFilters, page: number) => Promise<void>;
  exportCSV: (filters: AuditFilters) => Promise<void>;
}
```

---

## 0.2 Settings Page

### What to build
The NavRail has a Settings entry pointing to a "Coming Soon" stub. This is where tenant-wide platform configuration lives.

**New frontend module: `src/modules/settings/SettingsPage.tsx`**

Sections (tab-based):

**General Tab**
- Tenant name, logo upload, primary contact email
- Timezone selector
- `PATCH /auth/tenants/{id}` (extend auth-service)

**Users & Roles Tab**
- Pull from `GET /auth/users`
- Table: email | name | role | last login | actions (edit role, deactivate)
- Invite user form: email + role
- Role editor: what each role can do

**Notifications Tab**
- Email SMTP configuration (test send button)
- Slack webhook URL (with test button)
- Default notification preferences per event type

**API Keys Tab**
- Generate API keys for external integrations
- Show key prefix, created date, last used
- Revoke keys

**Data Retention Tab**
- Event log retention days (default 90)
- Audit log retention days (default 365)
- Object record retention days (default 730)
- Each is a number input + "Save" that PATCHes the relevant service

**Backend changes needed:**
```
Add to auth-service:
  GET  /auth/tenants/{id}           # Get tenant settings
  PATCH /auth/tenants/{id}          # Update tenant settings

Add table to auth-service:
  tenant_settings (tenant_id, smtp_host, smtp_port, smtp_user,
                   slack_webhook_url, timezone, logo_url, updated_at)
```

---

## 0.3 Finance Module (complete the stub)

### What exists
`finance-service` (9001) has full endpoints for transactions, revenue, and receivables. The frontend module `FinanceModule.tsx` is a stub that renders nothing.

### What to build

**Complete `src/modules/finance/FinanceModule.tsx`**

```
FinanceModule.tsx
├── FinanceSummaryBar.tsx     # Total revenue | Total expenses | Net | AR outstanding
├── TransactionTable.tsx      # Paginated with filter: date | category | amount range
├── RevenueChart.tsx          # Monthly bar chart (Recharts)
├── ReceivablesTable.tsx      # customer | amount | due date | status (overdue badge)
├── AddTransactionModal.tsx   # Form: date, amount, category, description
└── FinanceExport.tsx         # Export to CSV
```

**New store: `src/store/financeStore.ts`**
```typescript
interface FinanceState {
  transactions: Transaction[];
  revenue: RevenueEntry[];
  receivables: Receivable[];
  summary: { total_revenue: number; total_expenses: number; net: number; ar_outstanding: number };
  fetchAll: (tenantId: string) => Promise<void>;
  addTransaction: (t: NewTransaction) => Promise<void>;
}
```

---

## 0.4 Schema Registry UI

### What exists
`schema-registry` (8007) stores every raw connector schema version. `GET /schemas/{connector_id}` returns full version history with timestamps. Nothing shows this in the UI.

### What to build

**Add "Raw Schema History" tab to ConnectorDetailPanel**

Tab shows a timeline of schema versions:
- Each entry: version number | timestamp | field count | changes since last (added/removed/type-changed fields)
- Click version → SchemaDiffViewer component (already exists in ontology module, reuse it) showing field-level diff
- "Restore" button: sets this version as the active schema

**Backend change:** None — endpoints already exist.

---

## 0.5 Correlation Engine UI

### What exists
`correlation-engine` (8008) scores similarity between a connector schema and existing object types. Returns `action: "enrich" | "link" | "new_type"` with a composite score and suggested join key. This runs during connector setup but the results are never shown clearly.

### What to build

**Upgrade connector → ontology mapping flow in PipelineBuilder**

When a SOURCE node is configured with a connector:
1. Auto-call `POST /score-all` with the connector's schema
2. Show a "Schema Mapping" panel below the node
3. Display top 3 matches as cards: object type name | score bar | recommended action badge
4. "Use this match" button pre-fills the SINK_OBJECT node with that object type
5. Show suggested join key and any conflicting fields

Also: add a **"Correlate"** button in the Ontology module's ObjectTypePanel → runs score-all against all connectors → shows "N connectors could map to this type" with match details.

---

## 0.6 Agent Version Restore UI

### What exists
`agent-service` has `GET /{id}/versions` and `POST /{id}/versions/{vid}/restore`. `agentStore` doesn't call these. The backend stores full config snapshots on every save.

### What to build

**Add "Version History" tab to AgentStudio's agent config panel**

```
AgentVersionHistory.tsx
- Timeline list: version number | saved_at | model | tool_count | "Restore" button
- Diff view: side-by-side old vs. current system_prompt when hovering a version
- Restore confirmation modal: "This will replace the current config. Continue?"
```

---

## 0.7 Logic Conditionals + Loops

### What exists
LogicStudio has 7 block types in a linear sequence. The block executor runs them top-to-bottom. There are no branching or iteration primitives.

### What to build

**Two new block types in LogicStudio:**

**Conditional block** (if/else)
```typescript
{
  type: 'conditional',
  config: {
    condition_expression: string,    // e.g. "{{llm_call_1.result.score}} > 0.8"
    // In the UI: two output slots — "true path" and "false path"
    // Subsequent blocks can be attached to either path
  }
}
```

**Loop block** (foreach)
```typescript
{
  type: 'foreach',
  config: {
    array_input: string,             // e.g. "{{ontology_query_1.records}}"
    iteration_variable: string,      // e.g. "item"
    // Contains a sub-sequence of blocks that run for each item
    // Output: array of each iteration's result
  }
}
```

**Backend change to logic-service:**
```python
# Extend block_executor to handle branching:
async def execute_conditional(block, context):
    expr = block["config"]["condition_expression"]
    result = evaluate_expression(expr, context)
    return {"branch": "true" if result else "false", "value": result}

# Extend flow runner to follow branch paths:
if block["type"] == "conditional":
    branch = await execute_conditional(block, context)
    next_blocks = get_blocks_on_path(flow, block_id, branch["branch"])
    # Continue execution on the appropriate path
```

**Frontend: Update block renderer in LogicStudio**
- Conditional block shows as a diamond (decision shape)
- Two output handles: ✓ True (green) and ✗ False (red)
- Loop block wraps contained blocks in a visual "repeat zone" with a dashed border

---

## 0.8 `chat_with_data` in Assistant

### What exists
`inference-service` has `POST /infer/chat-with-data` which accepts a natural language question + object type context and returns a data-grounded answer using Claude. It's never called.

### What to build

**Upgrade `NexusAssistant.tsx`** — when the user asks a question while an object type is selected in any module, automatically include the object type's schema + sample records as context for Claude.

```typescript
// In assistantStore.ts — add context injection:
const sendMessage = async (message: string) => {
  const activeObjType = ontologyStore.selectedObjectType;

  const payload = {
    message,
    context: activeObjType ? {
      object_type_id: activeObjType.id,
      schema: activeObjType.data,
      sample_records: await fetchSampleRecords(activeObjType.id, 5)
    } : null
  };

  // Route to /infer/chat-with-data if context present, else /agents/assist/chat
  const endpoint = payload.context
    ? `${INFERENCE_API}/infer/chat-with-data`
    : `${AGENT_API}/agents/assist/chat`;
};
```

Show a "Data context: {ObjectTypeName}" badge in the assistant header when context is injected.

---

---

# PHASE 1 — ANALYTICS SURFACE
### "Let users query and understand their own data"
**Effort:** 3–4 weeks | **New service: `analytics-service` (8015)**

This is the single largest genuine gap. Users can build pipelines and push data into object types, but there is **no way to query, filter, aggregate, or visualize that data** beyond the pre-built App widgets.

---

## 1.1 Data Explorer

### Architecture

**New service: `analytics-service` (port 8015)**

```
backend/analytics_service/
├── main.py
├── database.py               # pg pool (connects to ontology-service DB for object_records)
├── query_engine.py           # Builds + executes parameterized SQL
├── expression_parser.py      # Formula → SQL: IF(), DATEDIFF(), CONCAT(), etc.
├── chart_builder.py          # Returns Vega-Lite spec from query result + chart config
├── export_streamer.py        # Streams CSV/JSON for large result sets
└── routers/
    ├── explore.py            # Exploration CRUD
    ├── query.py              # Ad-hoc + SQL query execution
    └── charts.py             # Chart config + preview
```

**New tables (analytics_service DB — separate from ontology):**
```sql
CREATE TABLE explorations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    TEXT NOT NULL,
    name         TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    steps        JSONB DEFAULT '[]',      -- ordered filter/group/agg steps
    chart_config JSONB DEFAULT '{}',
    created_by   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE saved_object_sets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    filter_config  JSONB NOT NULL,
    row_count      INTEGER,
    created_by     TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
```

**Query engine — core logic:**
```python
# query_engine.py
class QueryEngine:
    """
    Executes structured queries against object_records.
    NEVER allows raw SQL injection — all filters are parameterized.
    """
    async def execute(self, req: QueryRequest, tenant_id: str) -> QueryResult:
        # Build SELECT
        select_cols = self._build_select(req.columns, req.aggregations)

        # Build WHERE
        where_clause, params = self._build_where(req.filters, tenant_id, req.object_type_id)

        # Build GROUP BY
        group_clause = self._build_group_by(req.group_by)

        # Build ORDER BY
        order_clause = self._build_order(req.sort)

        sql = f"""
            SELECT {select_cols}
            FROM object_records
            WHERE {where_clause}
            {group_clause}
            {order_clause}
            LIMIT {min(req.limit or 500, 10000)}
        """
        rows = await self.pool.fetch(sql, *params)
        return QueryResult(rows=rows, total=len(rows))

    def _build_where(self, filters: list[Filter], tenant_id: str, ot_id: str):
        clauses = ["tenant_id = $1", "object_type_id = $2"]
        params = [tenant_id, ot_id]
        for f in filters:
            idx = len(params) + 1
            if f.op == "eq":
                clauses.append(f"data->>'{f.field}' = ${idx}")
                params.append(f.value)
            elif f.op == "contains":
                clauses.append(f"data->>'{f.field}' ILIKE ${idx}")
                params.append(f"%{f.value}%")
            elif f.op == "gt":
                clauses.append(f"(data->>'{f.field}')::numeric > ${idx}")
                params.append(float(f.value))
            elif f.op == "is_null":
                clauses.append(f"data->>'{f.field}' IS NULL")
            # ... etc
        return " AND ".join(clauses), params
```

**Supported filter operators:** `eq`, `neq`, `contains`, `not_contains`, `starts_with`, `gt`, `gte`, `lt`, `lte`, `between`, `in_list`, `is_null`, `is_not_null`

**Supported aggregations:** `count`, `count_distinct`, `sum`, `avg`, `min`, `max`, `percentile_50`, `percentile_95`

**Supported formula expressions (expression_parser.py):**
- `IF(condition, true_val, false_val)`
- `DATEDIFF(date1, date2, 'days'|'hours'|'months')`
- `CONCAT(field1, " ", field2)`
- `LOWER()`, `UPPER()`, `TRIM()`
- `COALESCE(field, default_val)`
- Math: `+`, `-`, `*`, `/`, `MOD()`

**API endpoints:**
```
GET  /analytics/explore                  List saved explorations
POST /analytics/explore                  Create exploration
GET  /analytics/explore/{id}             Get exploration with full config
PUT  /analytics/explore/{id}             Save exploration changes
DELETE /analytics/explore/{id}           Delete

POST /analytics/query                    Execute structured query
  body: { object_type_id, columns[], filters[], aggregations[], group_by[], sort[], limit }
  returns: { rows[], columns[], total_count, truncated, execution_ms }

POST /analytics/query/sql                Run raw SQL against object_records
  body: { sql, object_type_id }          (admin only, fully parameterized, no DDL)
  returns: { rows[], columns[] }

POST /analytics/chart/preview            Generate Vega-Lite spec
  body: { query_result, chart_type, x, y, color?, title? }
  returns: { vega_spec }

GET  /analytics/object-sets              List saved object sets
POST /analytics/object-sets              Save current filter state as named set
DELETE /analytics/object-sets/{id}       Delete saved set

GET  /analytics/explore/{id}/export      Stream CSV/JSON export
  params: { format: 'csv'|'json' }
```

### Frontend

**New module: `src/modules/explorer/`**
```
DataExplorer.tsx
├── ExplorerSidebar.tsx         # Left: object type tree + saved explorations
├── FilterBuilder.tsx           # Condition rows: field | operator | value
│   └── ConditionRow.tsx        # Single filter condition with field autocomplete
├── AggregationPanel.tsx        # Group by + metrics config
├── ExpressionInput.tsx         # Formula input with autocomplete + syntax highlight
├── ChartConfigurator.tsx       # Chart type picker + axis mapping
├── ResultsTable.tsx            # Paginated sortable table with column resize
├── ChartRenderer.tsx           # Vega-Lite embed
├── SavedObjectSets.tsx         # Saved filter states panel
└── ExportButton.tsx            # CSV/JSON download
```

**UX flow:**
1. Left sidebar: pick object type
2. Filter panel adds conditions
3. "Group by" turns table into aggregation view
4. "Chart" button opens chart configurator with axis mapping
5. "Save" stores current config as named exploration
6. "Export" streams file download

**New store: `src/store/explorerStore.ts`**
```typescript
interface ExplorerState {
  explorations: Exploration[];
  activeExploration: Exploration | null;
  queryResult: QueryResult | null;
  activeObjectTypeId: string;
  filters: Filter[];
  groupBy: string[];
  aggregations: Aggregation[];
  sort: SortConfig[];
  chartConfig: ChartConfig | null;
  loading: boolean;
  // actions
  runQuery: () => Promise<void>;
  saveExploration: (name: string) => Promise<string>;
  saveObjectSet: (name: string) => Promise<void>;
  loadExploration: (id: string) => Promise<void>;
  exportData: (format: 'csv' | 'json') => Promise<void>;
}
```

**Add to NavRail:** "Explorer" with `BarChart3` icon, between Ontology and Event Log.

---

## 1.2 AIP Analyst — Natural Language Querying

### Architecture

**Extend analytics-service with analyst router:**

```
backend/analytics_service/routers/analyst.py
```

```python
ANALYST_TOOLS = [
    {
        "name": "list_object_types",
        "description": "List all available object types with their properties and record counts",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "query_objects",
        "description": "Query objects with filters, grouping, and aggregations",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string"},
                "filters": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "op": {"type": "string", "enum": ["eq","neq","contains","gt","lt","is_null"]},
                        "value": {}
                    }
                }},
                "group_by": {"type": "array", "items": {"type": "string"}},
                "aggregations": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "function": {"type": "string", "enum": ["count","sum","avg","min","max","count_distinct"]},
                        "field": {"type": "string"},
                        "alias": {"type": "string"}
                    }
                }},
                "sort": {"type": "array"},
                "limit": {"type": "integer", "maximum": 1000}
            },
            "required": ["object_type_id"]
        }
    },
    {
        "name": "follow_link",
        "description": "Traverse a relationship from one object type to a linked one",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_object_type_id": {"type": "string"},
                "link_name": {"type": "string"},
                "filters_on_linked": {"type": "array"}
            }
        }
    },
    {
        "name": "create_chart",
        "description": "Visualize query results as a chart",
        "input_schema": {
            "type": "object",
            "properties": {
                "chart_type": {"type": "string", "enum": ["bar","line","scatter","pie","area","heatmap"]},
                "x_field": {"type": "string"},
                "y_field": {"type": "string"},
                "color_field": {"type": "string"},
                "title": {"type": "string"}
            },
            "required": ["chart_type", "x_field", "y_field"]
        }
    }
]

async def run_analyst(query: str, tenant_id: str, context_object_type_id: str | None = None):
    # Build context from current ontology state
    object_types = await fetch_object_types(tenant_id)
    system_prompt = f"""
    You are a data analyst for the Nexus platform.
    Available object types: {json.dumps([{"id": ot.id, "name": ot.display_name, "properties": list(ot.data.keys())} for ot in object_types])}

    Use the tools to answer the user's question by querying their data.
    Always explain what you're doing before each tool call.
    After getting results, provide a clear summary.
    """

    # Agentic loop with tools
    messages = [{"role": "user", "content": query}]
    steps = []

    while True:
        response = await anthropic.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system_prompt,
            tools=ANALYST_TOOLS,
            messages=messages
        )

        if response.stop_reason == "end_turn":
            break

        for block in response.content:
            if block.type == "tool_use":
                result = await execute_analyst_tool(block.name, block.input, tenant_id)
                steps.append({"tool": block.name, "input": block.input, "result": result})
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)}]})

    return AnalystResult(
        answer=response.content[-1].text,
        steps=steps,
        final_query=steps[-2]["input"] if len(steps) >= 2 else None,
        chart_spec=steps[-1]["result"].get("vega_spec") if steps and steps[-1]["tool"] == "create_chart" else None
    )
```

**New endpoint:**
```
POST /analytics/analyst
  body: { query: string, context_object_type_id?: string }
  returns: {
    answer: string,
    steps: [{ tool, input, result }],
    chart_spec?: VegaSpec,
    result_rows?: any[],
    result_columns?: string[]
  }

POST /analytics/analyst/refine
  body: { session_id: string, refinement: string }
  returns: same shape (continues from prior context)
```

### Frontend

**Add `AnalystPanel.tsx` to DataExplorer:**
- Collapsible panel at the bottom of the Explorer page
- Text input with placeholder "Ask anything about your data…"
- Shows tool call steps as they execute (collapsible list with spinner)
- Renders final answer as markdown
- If chart_spec returned: renders Vega chart inline
- If result_rows returned: shows mini results table
- "Open in Explorer" button: loads the analyst's last query into the full Filter Builder

---

## 1.3 Time Series Analysis View

### Architecture

**Extend event-log-service with 3 new endpoints:**

```python
# New router: routers/timeseries.py

@router.get("/events/timeseries")
async def get_timeseries(
    object_type_id: str,
    bucket: Literal["1h", "6h", "1d", "1w"] = "1d",
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    activity: str | None = None,
    tenant_id: str = Header(...)
):
    """
    Bucketed time series of event counts + avg cost per bucket.
    Uses TimescaleDB time_bucket() for efficient aggregation.
    """
    sql = """
        SELECT
            time_bucket($1::interval, timestamp) AS bucket,
            activity,
            COUNT(*) AS event_count,
            AVG(cost) FILTER (WHERE cost IS NOT NULL) AS avg_cost,
            COUNT(DISTINCT case_id) AS unique_cases
        FROM events
        WHERE tenant_id = $2
          AND object_type_id = $3
          AND ($4::timestamptz IS NULL OR timestamp >= $4)
          AND ($5::timestamptz IS NULL OR timestamp <= $5)
          AND ($6::text IS NULL OR activity = $6)
        GROUP BY bucket, activity
        ORDER BY bucket ASC
    """
    # ...

@router.get("/events/activity-profiles")
async def get_activity_profiles(object_type_id: str, tenant_id: str = Header(...)):
    """
    Per-activity stats: count, avg duration, p95 duration, trend (up/down/stable)
    """

@router.get("/events/anomalies")
async def get_anomalies(
    object_type_id: str,
    sensitivity: float = 0.95,
    tenant_id: str = Header(...)
):
    """
    Z-score anomaly detection on per-activity event counts.
    Returns timestamps where count deviates > (1 - sensitivity) * std.
    """
```

### Frontend

**Upgrade `EventLog.tsx` — add Time Series tab:**

```
EventLog.tsx
├── [existing] EventList tab  — real-time event stream
├── [existing] Quality tab    — completeness/consistency/accuracy
└── [NEW] Time Series tab
    ├── BucketSelector        — 1h | 6h | 1d | 1w
    ├── DateRangePicker       — with presets: 24h | 7d | 30d | 90d | Custom
    ├── ActivityToggle        — multi-select activity filter
    ├── TimeSeriesChart       — Recharts AreaChart with brush for zoom/pan
    │   ├── Multiple series (one per activity, stacked or overlaid)
    │   └── Anomaly markers (red dot with tooltip on deviation)
    └── ActivityProfileTable  — activity | count | avg duration | p95 | trend arrow
```

---

---

# PHASE 2 — GRAPH & SIMULATION
### "Let users traverse the ontology and ask what-if questions"
**Effort:** 2–3 weeks | **No new services** — extends ontology-service

---

## 2.1 Object Graph Explorer

### Architecture

**Extend ontology-service with 3 new endpoints:**

```python
# New router: routers/graph.py

@router.post("/ontology/graph/start")
async def start_graph(
    body: GraphStartRequest,   # { object_type_id, object_id?, depth=2, max_nodes=150 }
    tenant_id: str = Header(...)
):
    """
    Start a graph from a root object (or all objects of a type if no object_id).
    Uses recursive CTE to traverse ontology_links.
    """
    sql = """
    WITH RECURSIVE traversal AS (
        -- Anchor: starting object(s)
        SELECT
            r.id, r.object_type_id,
            ot.display_name AS type_name,
            r.data,
            0 AS depth,
            ARRAY[r.id::text] AS visited
        FROM object_records r
        JOIN object_types ot ON ot.id = r.object_type_id
        WHERE r.tenant_id = $1
          AND ($2::uuid IS NULL OR r.id = $2)
          AND ($3::uuid IS NULL OR r.object_type_id = $3)

        UNION ALL

        -- Recursive: follow ontology links
        SELECT
            r2.id, r2.object_type_id,
            ot2.display_name,
            r2.data,
            t.depth + 1,
            t.visited || r2.id::text
        FROM traversal t
        JOIN ontology_links ol
            ON ol.source_object_type_id = t.object_type_id
            AND ol.tenant_id = $1
        JOIN object_records r2
            ON r2.object_type_id = ol.target_object_type_id
            AND r2.tenant_id = $1
            AND NOT r2.id::text = ANY(t.visited)
        WHERE t.depth < $4
    )
    SELECT DISTINCT id, object_type_id, type_name, data, MIN(depth) as depth
    FROM traversal
    GROUP BY id, object_type_id, type_name, data
    LIMIT $5
    """

@router.post("/ontology/graph/expand")
async def expand_node(body: ExpandRequest, tenant_id: str = Header(...)):
    """
    Expand one hop from a specific node via a named link.
    Returns only nodes not already in the caller's existing graph.
    """

@router.get("/ontology/graph/object-types-summary")
async def get_type_summary(tenant_id: str = Header(...)):
    """
    Returns all object types with their record count and available links.
    Used to populate the Graph Explorer sidebar.
    """
```

### Frontend

**New module: `src/modules/graph/`**

```
GraphExplorer.tsx
├── GraphSidebar.tsx
│   ├── ObjectTypeTree        — filterable list of all object types with record counts
│   ├── SearchInput           — search for a specific record by property value to start from
│   └── SavedGraphs           — saved graph configurations
├── GraphCanvas.tsx           — ReactFlow canvas (reuses existing ReactFlow dependency)
│   ├── ObjectNode.tsx        — colored card: type badge | top 3 properties | record count ring
│   ├── LinkEdge.tsx          — labeled edge showing link name
│   └── GraphToolbar.tsx      — zoom fit | filter | export PNG | depth control
├── SearchAroundPanel.tsx     — right click any node: "Expand via:" shows link names → click to add
└── GraphDetailPanel.tsx      — click a node: full record properties + "Execute Action" buttons
```

**Node visual design:**
- Each object type gets a color derived deterministically from its UUID (HSL hue from hash)
- Node shows: type badge (colored pill) + display_name of record (top label property) + record ID (monospace)
- Edge label = link name
- Double-click = expand via all available links
- Right-click = context menu: View full record | Execute action | Expand via [link name] | Remove from graph

**Toolbar controls:**
- Depth slider: 1–4 hops
- Max nodes: 50 / 100 / 200
- Filter by object type (hide/show specific types)
- "Fit to view" button
- Export as PNG

**Add "Open in Graph" button to:**
- ObjectTypePanel in Ontology module
- Action detail panel in HumanActions
- Any record table in DataExplorer

---

## 2.2 Scenario Simulation

### Architecture

**Extend analytics-service with scenario router:**

```python
# analytics_service/routers/scenarios.py

@router.post("/analytics/scenarios")
async def create_scenario(body: ScenarioCreate, tenant_id: str = Header(...)):
    """
    Defines a what-if scenario: override property values on specific objects,
    then compute how derived metrics change.
    """

@router.post("/analytics/scenarios/{id}/compute")
async def compute_scenario(scenario_id: str, tenant_id: str = Header(...)):
    """
    1. Fetch actual records from object_records
    2. Apply overrides to in-memory copy (NO database writes)
    3. Re-run derived metric formulas against modified copy
    4. Return baseline vs simulated side-by-side
    """
    scenario = await get_scenario(scenario_id, tenant_id)

    # Fetch real records
    real_records = await fetch_records(scenario.object_type_id, tenant_id)

    # Apply overrides (in memory only)
    simulated_records = apply_overrides(real_records, scenario.overrides)

    # Compute metrics on both
    baseline_metrics = {}
    simulated_metrics = {}
    for metric in scenario.derived_metrics:
        baseline_metrics[metric.name] = compute_metric(metric, real_records)
        simulated_metrics[metric.name] = compute_metric(metric, simulated_records)

    deltas = {
        name: {
            "baseline": baseline_metrics[name],
            "simulated": simulated_metrics[name],
            "absolute": simulated_metrics[name] - baseline_metrics[name],
            "percent": ((simulated_metrics[name] - baseline_metrics[name]) / baseline_metrics[name] * 100)
                       if baseline_metrics[name] != 0 else None
        }
        for name in baseline_metrics
    }

    return ScenarioResult(
        baseline=baseline_metrics,
        simulated=simulated_metrics,
        deltas=deltas,
        affected_records=len([r for r in simulated_records if record_was_overridden(r, scenario.overrides)])
    )
```

**New table (analytics_service):**
```sql
CREATE TABLE scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    overrides JSONB NOT NULL,      -- [{object_id, property, simulated_value}]
    derived_metrics JSONB NOT NULL, -- [{name, formula, description}]
    last_result JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Frontend

**Add "Simulate" to DataExplorer and GraphExplorer:**

```
ScenarioPanel.tsx
├── OverrideTable.tsx     — rows: select record | select property | old value | new value input
├── MetricDefinitions.tsx — add derived metric: name + formula (same ExpressionInput as Explorer)
└── ResultsView.tsx
    ├── MetricCard[]      — baseline | simulated | Δ value (red/green) | Δ% badge
    ├── AffectedBadge     — "N records modified in simulation"
    └── ApplyAsAction.tsx — Converts simulation to a human-review action proposal
```

---

---

# PHASE 3 — EVALUATION & TRUST
### "Test and measure every AI output before trusting it in production"
**Effort:** 2–3 weeks | **New service: `eval-service` (8016)**

---

## 3.1 Evaluation Framework

No testing infrastructure currently exists for agents or logic functions. This closes that gap.

### Architecture

**New service: `eval-service` (port 8016)**

```
backend/eval_service/
├── main.py
├── database.py
├── runner.py                    # Orchestrates test case execution against targets
├── evaluators/
│   ├── base.py                  # EvalResult(score: float, passed: bool, details: dict)
│   ├── contains_key_details.py  # Claude-backed: does output contain expected facts?
│   ├── rouge_score.py           # ROUGE-L text similarity (no external deps)
│   ├── json_schema_match.py     # Does output match expected JSON structure?
│   ├── exact_match.py           # String equality
│   └── custom_expression.py    # User-defined Python expression (sandboxed eval)
└── routers/
    ├── suites.py
    ├── cases.py
    ├── runs.py
    └── experiments.py           # Grid search across model/prompt combinations
```

**New tables:**
```sql
CREATE TABLE eval_suites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    target_type TEXT NOT NULL,           -- 'agent' | 'logic_function' | 'logic_flow'
    target_id UUID NOT NULL,
    evaluator_configs JSONB DEFAULT '[]', -- [{type, config, weight}]
    pass_threshold FLOAT DEFAULT 0.7,    -- overall score to count as "pass"
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE eval_test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID REFERENCES eval_suites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs JSONB NOT NULL,
    expected_outputs JSONB,
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE eval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID REFERENCES eval_suites(id),
    tenant_id TEXT NOT NULL,
    status TEXT DEFAULT 'running',       -- running | complete | failed
    config_overrides JSONB DEFAULT '{}', -- model, prompt, temperature overrides
    results JSONB DEFAULT '[]',          -- per-test-case: {case_id, passed, score, output, details}
    summary JSONB,                       -- {pass_rate, avg_score, failed_cases, total_cases}
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE eval_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID REFERENCES eval_suites(id),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    param_grid JSONB NOT NULL,           -- {model: [...], temperature: [...], prompt_variant: [...]}
    run_ids JSONB DEFAULT '[]',
    best_run_id UUID,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Runner — executes a test case against a target:**
```python
# runner.py
class EvalRunner:
    async def run_suite(self, suite_id: str, config_overrides: dict, tenant_id: str) -> str:
        suite = await get_suite(suite_id)
        cases = await get_cases(suite_id)
        run_id = await create_run(suite_id, config_overrides, tenant_id)

        results = []
        for case in cases:
            # Execute the target (agent, logic_function, or logic_flow)
            output = await self.execute_target(suite.target_type, suite.target_id, case.inputs, config_overrides)

            # Run all evaluators
            scores = []
            for eval_config in suite.evaluator_configs:
                evaluator = get_evaluator(eval_config["type"])
                result = await evaluator.evaluate(output, case.expected_outputs, eval_config.get("config", {}))
                scores.append(result.score * eval_config.get("weight", 1.0))

            overall = sum(scores) / len(scores) if scores else 0
            results.append({
                "case_id": str(case.id),
                "case_name": case.name,
                "passed": overall >= suite.pass_threshold,
                "score": overall,
                "output": output,
                "evaluator_details": [r.details for r in scores]
            })

        pass_rate = sum(1 for r in results if r["passed"]) / len(results)
        await update_run(run_id, results, {"pass_rate": pass_rate, "avg_score": sum(r["score"] for r in results)/len(results)})
        return run_id

    async def execute_target(self, target_type: str, target_id: str, inputs: dict, overrides: dict):
        if target_type == "agent":
            return await self.agent_client.test(target_id, inputs, overrides)
        elif target_type == "logic_function":
            return await self.logic_client.run(target_id, inputs)
        elif target_type == "logic_flow":
            return await self.logic_client.run_flow(target_id, inputs)
```

**Evaluator: contains_key_details (Claude-backed)**
```python
async def evaluate(self, output: any, expected: dict, config: dict) -> EvalResult:
    key_details = expected.get("key_details", [])
    if not key_details:
        return EvalResult(score=1.0, passed=True, details={"message": "No key details to check"})

    prompt = f"""
Does this output contain ALL of the following key details?

Output:
{json.dumps(output, indent=2) if isinstance(output, dict) else str(output)}

Required key details:
{chr(10).join(f'- {d}' for d in key_details)}

Respond with JSON only:
{{"contains_all": true/false, "missing": ["list of missing details"], "score": 0.0-1.0}}
"""
    result = await claude_json(prompt, max_tokens=300)
    return EvalResult(score=result["score"], passed=result["contains_all"], details=result)
```

**API endpoints:**
```
GET  /evals/suites                   List suites
POST /evals/suites                   Create suite
GET  /evals/suites/{id}              Get suite + config
PUT  /evals/suites/{id}              Update suite
DELETE /evals/suites/{id}            Delete suite

GET  /evals/suites/{id}/cases        List test cases
POST /evals/suites/{id}/cases        Add test case
PUT  /evals/cases/{id}               Update test case
DELETE /evals/cases/{id}             Delete test case

POST /evals/suites/{id}/run          Execute suite (async)
  body: { config_overrides?: {}, run_n_times?: 1-5 }
  returns: { run_id }

GET  /evals/runs/{id}                Get run results
GET  /evals/suites/{id}/runs         Run history for suite

POST /evals/experiments              Create grid search
  body: { suite_id, name, param_grid: {model: [...], temperature: [...]} }
GET  /evals/experiments/{id}         Get experiment + comparison table
POST /evals/experiments/{id}/run     Execute all parameter combinations
```

### Frontend

**New module: `src/modules/evals/`**
```
EvalsPage.tsx
├── SuiteList.tsx           — card grid: suite name | target | pass rate badge | last run date
├── SuiteEditor.tsx
│   ├── SuiteConfig.tsx     — name, target (agent/function picker), evaluators + weights
│   ├── TestCaseTable.tsx   — add/edit/delete test cases inline
│   │   └── TestCaseRow.tsx — name | inputs JSON | expected outputs JSON | tags
│   └── EvaluatorConfig.tsx — add evaluator: pick type → configure (key_details list, schema, etc.)
├── RunResultsView.tsx
│   ├── SummaryBar.tsx      — pass rate % | avg score | N passed | N failed
│   ├── ResultsTable.tsx    — case | passed ✓/✗ | score bar | output preview | expand for details
│   └── FailureAnalysis.tsx — only failed cases with side-by-side input/output/expected
└── ExperimentView.tsx
    ├── ParamGridBuilder.tsx — add dimensions: model | temperature | prompt_variant
    └── ResultsMatrix.tsx   — table: rows=param combos | cols=cases | cell=score | best highlighted
```

**Add "Evals" tab to:**
- AgentStudio: "Create eval suite for this agent" button
- LogicStudio: "Create eval suite for this function" button

---

---

# PHASE 4 — GOVERNANCE LAYER
### "Audit, approve, classify, and trace everything"
**Effort:** 2–3 weeks | **Extends existing services**

---

## 4.1 Checkpoints (Justification Gates)

### Architecture

**Extend audit-service with checkpoint tables:**
```sql
CREATE TABLE checkpoint_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    applies_to JSONB NOT NULL,  -- [{resource_type, operations[]}]
    applies_to_roles JSONB DEFAULT '[]',   -- empty = all roles
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE checkpoint_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id UUID REFERENCES checkpoint_definitions(id),
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT,
    resource_type TEXT,
    resource_id TEXT,
    operation TEXT,
    justification TEXT NOT NULL,
    token TEXT UNIQUE,          -- short-lived proof token (expires in 10 min)
    token_expires_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New endpoints on audit-service:**
```
GET  /audit/checkpoints                  List checkpoints (admin only)
POST /audit/checkpoints                  Create checkpoint definition
PUT  /audit/checkpoints/{id}             Update
DELETE /audit/checkpoints/{id}           Delete

POST /audit/checkpoints/evaluate
  body: { resource_type, operation, user_role }
  returns: { required: bool, checkpoint_id?, prompt_text? }

POST /audit/checkpoints/{id}/respond
  body: { resource_type, resource_id, operation, justification }
  returns: { token: string, expires_at: string }

GET  /audit/checkpoints/{id}/responses   Review responses (admin only)
```

**Frontend: `CheckpointGate.tsx` — reusable wrapper**
```typescript
const CheckpointGate: React.FC<{
  resourceType: string;
  resourceId?: string;
  operation: string;
  onProceed: (token: string) => void;
  children: (trigger: () => void) => React.ReactNode;
}> = ({ resourceType, operation, onProceed, children }) => {
  const [showModal, setShowModal] = useState(false);
  const [checkpoint, setCheckpoint] = useState<CheckpointDef | null>(null);
  const [justification, setJustification] = useState('');

  const trigger = async () => {
    const { required, checkpoint_id, prompt_text } = await evaluateCheckpoint(resourceType, operation);
    if (!required) { onProceed(''); return; }
    setCheckpoint({ id: checkpoint_id, prompt_text });
    setShowModal(true);
  };

  const submit = async () => {
    const { token } = await respondToCheckpoint(checkpoint!.id, { resourceType, operation, justification });
    setShowModal(false);
    onProceed(token);
  };

  return (
    <>
      {children(trigger)}
      {showModal && <CheckpointModal prompt={checkpoint!.prompt_text} value={justification} onChange={setJustification} onSubmit={submit} onCancel={() => setShowModal(false)} />}
    </>
  );
};
```

**Apply to:** bulk confirm/reject in HumanActions, data export from Explorer, deleting object types, modifying action definitions, bulk pipeline runs.

---

## 4.2 Formal Approvals Workflow

### Architecture

**Extend ontology-service with approval tables:**
```sql
CREATE TABLE approval_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    resource_type TEXT NOT NULL,     -- 'object_type' | 'action_definition' | 'pipeline'
    operations JSONB NOT NULL,       -- ['delete', 'bulk_export']
    required_approvers INTEGER DEFAULT 1,
    eligible_roles JSONB DEFAULT '["admin"]',
    expiry_hours INTEGER DEFAULT 72,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    workflow_id UUID REFERENCES approval_workflows(id),
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    operation TEXT NOT NULL,
    payload JSONB,                   -- what executes if approved
    requested_by TEXT NOT NULL,
    requested_by_email TEXT,
    status TEXT DEFAULT 'pending',   -- pending | approved | rejected | expired
    approvals JSONB DEFAULT '[]',    -- [{user_id, email, note, approved_at}]
    rejections JSONB DEFAULT '[]',   -- [{user_id, email, reason, rejected_at}]
    expires_at TIMESTAMPTZ NOT NULL,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New endpoints:**
```
GET  /approvals/workflows                List workflows
POST /approvals/workflows                Create workflow
PUT  /approvals/workflows/{id}           Update
DELETE /approvals/workflows/{id}         Delete

GET  /approvals/requests                 List (filter: status, resource_type)
POST /approvals/requests                 Submit new request
GET  /approvals/requests/{id}            Get request + approval status
POST /approvals/requests/{id}/approve    Add approval (role check)
POST /approvals/requests/{id}/reject     Reject with reason
GET  /approvals/requests/mine/pending    Requests waiting for MY approval
```

**Frontend:** Add "Approvals" tab to NotificationDrawer + badge count on bell icon. Inline approve/reject with optional note.

---

## 4.3 Full Data Lineage (replace the stub)

### Architecture

**New service: `lineage-service` (port 8017) — read-only aggregator**

```
backend/lineage_service/
├── main.py
├── aggregator.py         # Queries all other services to build graph
├── health_checker.py     # Tests freshness of each node
└── routers/
    └── lineage.py
```

```python
# aggregator.py — queries each service to build the graph
class LineageAggregator:
    async def build(self, tenant_id: str) -> LineageGraph:
        nodes, edges = [], []

        # Layer 1: Connectors
        connectors = await http_get(f"{CONNECTOR_API}/connectors", tenant_id)
        for c in connectors:
            nodes.append({"id": f"connector:{c['id']}", "type": "connector",
                          "label": c["name"], "status": c["status"], "meta": c})

        # Layer 2: Pipelines + connector dependencies
        pipelines = await http_get(f"{PIPELINE_API}/pipelines", tenant_id)
        for p in pipelines:
            nodes.append({"id": f"pipeline:{p['id']}", "type": "pipeline",
                          "label": p["name"], "status": p["status"], "meta": p})
            for cid in (p.get("connector_ids") or []):
                edges.append({"source": f"connector:{cid}", "target": f"pipeline:{p['id']}", "label": "feeds"})

        # Layer 3: Object types + pipeline dependencies
        ots = await http_get(f"{ONTOLOGY_API}/object-types", tenant_id)
        for ot in ots:
            nodes.append({"id": f"objecttype:{ot['id']}", "type": "object_type",
                          "label": ot["display_name"], "meta": ot})
            if ot.get("pipeline_id"):
                edges.append({"source": f"pipeline:{ot['pipeline_id']}", "target": f"objecttype:{ot['id']}", "label": "writes to"})

        # Layer 4: Logic functions + object type deps
        funcs = await http_get(f"{LOGIC_API}/logic/functions", tenant_id)
        for f in funcs:
            nodes.append({"id": f"logic:{f['id']}", "type": "logic_function",
                          "label": f["name"], "meta": f})
            # Parse block configs to find which OTs it queries
            for block in (f.get("blocks") or []):
                if block.get("type") == "ontology_query" and block.get("config", {}).get("object_type_id"):
                    edges.append({"source": f"objecttype:{block['config']['object_type_id']}",
                                  "target": f"logic:{f['id']}", "label": "queried by"})

        # Layer 5: Agents + their scoped object types
        agents = await http_get(f"{AGENT_API}/agents", tenant_id)
        for a in agents:
            nodes.append({"id": f"agent:{a['id']}", "type": "agent",
                          "label": a["name"], "meta": a})
            for ot_id in (a.get("knowledge_scope") or {}).get("object_type_ids", []):
                edges.append({"source": f"objecttype:{ot_id}", "target": f"agent:{a['id']}", "label": "in scope"})

        # Layer 6: Action definitions
        actions = await http_get(f"{ONTOLOGY_API}/actions", tenant_id)
        for action in actions:
            nodes.append({"id": f"action:{action['id']}", "type": "action_def",
                          "label": action["name"], "meta": action})
            if action.get("writes_to_object_type"):
                edges.append({"source": f"action:{action['id']}",
                              "target": f"objecttype:{action['writes_to_object_type']}", "label": "writes to"})

        return {"nodes": nodes, "edges": edges}
```

**New API:**
```
GET /lineage/graph                    Full tenant lineage graph
GET /lineage/node/{id}/upstream       Everything feeding into this node (recursive)
GET /lineage/node/{id}/downstream     Everything this node feeds into (recursive)
GET /lineage/impact/{id}              If this node breaks, what is affected?
GET /lineage/health                   Freshness status of each node
  # Checks: connector last_sync, pipeline last_run, agent last_run
```

**Frontend: Replace `LineageCanvas.tsx` stub completely**

```
LineageCanvas.tsx
├── LineageControls.tsx    — filter by type, highlight path, search node
├── LineageGraph.tsx       — ReactFlow with 6 node types, layered L→R layout
│   ├── ConnectorNode      — cyan, shows status dot + last sync time
│   ├── PipelineNode       — violet, shows run status + last run time
│   ├── ObjectTypeNode     — green, shows record count
│   ├── LogicNode          — amber, shows last run time
│   ├── AgentNode          — red, shows enabled/disabled
│   └── ActionNode         — blue, shows pending executions count
├── LineageDetailPanel.tsx — right slide-in: node metadata + "Open in {module}" button
└── ImpactPanel.tsx        — "If this breaks:" list of downstream nodes highlighted in orange
```

**Node color legend in bottom-left corner of canvas.**
**Auto-layout using dagre** (already a dep via ReactFlow ecosystem).

---

## 4.4 PII Scanner

### Architecture

**Extend inference-service with scanner:**

```python
# routers/scanner.py

PATTERNS = {
    "EMAIL":       r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
    "SSN":         r"\b\d{3}-\d{2}-\d{4}\b",
    "CREDIT_CARD": r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b",
    "PHONE":       r"\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}",
    "DOB":         r"\b(0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])[-/](19|20)\d{2}\b",
    "IP_ADDRESS":  r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
}

NAME_HINTS = ["name", "first_name", "last_name", "full_name", "email", "phone",
              "address", "ssn", "dob", "birth", "patient", "user", "person"]

@router.post("/infer/scan-pii")
async def scan_pii(body: ScanRequest, tenant_id: str = Header(...)):
    """
    Sample up to sample_size records from an object type.
    Run regex + field-name heuristics on each field.
    Returns risk score + per-field findings.
    """
    records = await fetch_sample_records(body.object_type_id, tenant_id, body.sample_size or 100)

    if not records:
        raise HTTPException(404, "No records found for this object type")

    # Get all field names from first record
    fields = list(records[0]["data"].keys())
    findings = []

    for field in fields:
        values = [str(r["data"].get(field, "")) for r in records if r["data"].get(field)]
        if not values:
            findings.append({"field": field, "pii_detected": False, "pii_types": [], "confidence": 0.0})
            continue

        detected = {}
        for ptype, pattern in PATTERNS.items():
            match_count = sum(1 for v in values if re.search(pattern, v))
            if match_count > 0:
                detected[ptype] = match_count / len(values)

        # Field name heuristic scan
        if not detected and any(hint in field.lower() for hint in NAME_HINTS):
            # Ask Claude to verify with samples
            result = await claude_pii_verify(field, values[:5])
            if result.get("is_pii"):
                detected[result["pii_type"]] = result["confidence"]

        recommendation = "ok"
        if detected:
            max_conf = max(detected.values())
            if max_conf > 0.5:
                recommendation = "restrict"
            elif max_conf > 0.2:
                recommendation = "review"

        findings.append({
            "field": field,
            "pii_detected": bool(detected),
            "pii_types": list(detected.keys()),
            "confidence": max(detected.values()) if detected else 0.0,
            "recommendation": recommendation,
            "sample_count": len(values)
        })

    risk_score = sum(1 for f in findings if f["pii_detected"]) / len(findings) if findings else 0
    return {"scanned_at": datetime.utcnow(), "fields": findings, "risk_score": risk_score,
            "high_risk_fields": [f["field"] for f in findings if f["confidence"] > 0.5]}
```

**New endpoint:**
```
POST /infer/scan-pii
  body: { object_type_id, sample_size?: 100 }
  returns: { scanned_at, fields[], risk_score, high_risk_fields[] }

POST /infer/scan-all          Scan all object types for tenant (async, returns scan_id)
GET  /infer/scan-results/{id} Get async scan results
```

**Frontend: Add "PII Scan" to ObjectTypePanel in Ontology module**
- Button: "Scan for Sensitive Data"
- Shows spinner while scanning
- Results table: field | detected types (colored badges) | confidence bar | recommendation badge
- "Apply restrictions" → opens permission modal to restrict field access by role

---

---

# PHASE 5 — OPERATIONAL RICHNESS
### "Automate operations, schedule work, explore geography"
**Effort:** 3–4 weeks | **New service: `automate-service` (8018)**

---

## 5.1 Event-Driven Automation

### Architecture

**New service: `automate-service` (port 8018)**

```
backend/automate_service/
├── main.py
├── database.py
├── trigger_evaluator.py     # Checks object set conditions against current data
├── effect_executor.py       # Fires actions, functions, notifications
├── scheduler.py             # APScheduler: polls triggers every N seconds
└── routers/
    ├── automations.py
    └── history.py
```

**New tables:**
```sql
CREATE TABLE automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT true,

    trigger_type TEXT NOT NULL,          -- 'schedule' | 'object_added' | 'object_modified' | 'object_removed' | 'combined'
    trigger_schedule TEXT,               -- cron (if schedule trigger)
    trigger_object_type_id UUID,
    trigger_filter_config JSONB,         -- filter conditions defining the watched object set

    effect_type TEXT NOT NULL,           -- 'run_action' | 'run_logic_function' | 'run_agent' | 'notify' | 'run_pipeline'
    effect_config JSONB NOT NULL,        -- target ID + param mapping

    batch_strategy TEXT DEFAULT 'once_per_object',  -- 'once_total' | 'once_per_object' | 'once_per_group'
    batch_group_by TEXT,

    muted_until TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    retry_on_failure BOOLEAN DEFAULT true,
    max_retries INTEGER DEFAULT 3,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID REFERENCES automations(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    trigger_type TEXT,
    trigger_payload JSONB,
    objects_affected INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    effects_log JSONB DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

**Trigger evaluator — object change detection:**
```python
# trigger_evaluator.py
class ObjectChangeTriggerEvaluator:
    """
    Polls ontology-service to detect object additions/modifications/removals.
    Uses Redis to track the last-known set of matching object IDs.
    """
    async def check(self, automation: dict, tenant_id: str) -> list[str]:
        filter_config = automation["trigger_filter_config"]
        ot_id = automation["trigger_object_type_id"]

        # Build query against ontology service
        current_records = await ontology_client.query_records(ot_id, filter_config, tenant_id)
        current_ids = {r["id"] for r in current_records}

        cache_key = f"automate:{automation['id']}:seen:{tenant_id}"
        last_ids = await self.redis.smembers(cache_key)

        trigger_type = automation["trigger_type"]
        if trigger_type == "object_added":
            triggered_ids = list(current_ids - last_ids)
        elif trigger_type == "object_removed":
            triggered_ids = list(last_ids - current_ids)
        elif trigger_type == "object_modified":
            # Check updated_at on matching records against last poll time
            last_poll = await self.redis.get(f"automate:{automation['id']}:last_poll:{tenant_id}")
            triggered_ids = [r["id"] for r in current_records
                             if r.get("updated_at") and r["updated_at"] > (last_poll or "1970-01-01")]
        else:
            triggered_ids = []

        await self.redis.delete(cache_key)
        if current_ids:
            await self.redis.sadd(cache_key, *current_ids)
        await self.redis.set(f"automate:{automation['id']}:last_poll:{tenant_id}", datetime.utcnow().isoformat())

        return triggered_ids
```

**API endpoints:**
```
GET  /automate/automations               List (filter: enabled, trigger_type, effect_type)
POST /automate/automations               Create
GET  /automate/automations/{id}          Get with last run status
PUT  /automate/automations/{id}          Update
DELETE /automate/automations/{id}        Delete

POST /automate/automations/{id}/enable   Enable
POST /automate/automations/{id}/disable  Disable
POST /automate/automations/{id}/mute     body: { until: datetime }
POST /automate/automations/{id}/run-now  Manual trigger

GET  /automate/automations/{id}/history  Paginated run history
GET  /automate/history                   All runs (paginated, cross-automation)
```

### Frontend

**New module: `src/modules/automate/`**
```
AutomatePage.tsx
├── AutomationList.tsx         — table: name | enabled toggle | trigger type | last run | run now
├── AutomationEditor.tsx       — 3-section form:
│   ├── TriggerSection.tsx     — type selector → conditional config:
│   │   ├── ScheduleTrigger    — cron builder (same as LogicStudio)
│   │   └── ObjectTrigger      — object type picker + filter builder (reuse from Explorer)
│   ├── EffectSection.tsx      — type selector + target picker + param mapping
│   └── ControlsSection.tsx    — batching | mute | expiry | retry config
├── AutomationHistory.tsx      — paginated run log: time | trigger | objects affected | status | expand
└── AutomationDeps.tsx         — dependency config: this runs before/after X
```

**Add "Automate" entry to NavRail** with `Zap` icon.

---

## 5.2 Dynamic Gantt Scheduling

### Architecture

**Extend ontology-service with scheduling board config:**
```sql
CREATE TABLE scheduling_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    row_object_type_id UUID NOT NULL,     -- "resources" rows
    puck_object_type_id UUID NOT NULL,    -- "tasks" draggable blocks
    time_property TEXT NOT NULL,          -- property holding start time
    duration_property TEXT,               -- property holding duration (hours)
    end_time_property TEXT,               -- OR explicit end time property
    assignment_property TEXT NOT NULL,    -- property linking puck → row
    row_label_property TEXT NOT NULL,
    puck_label_property TEXT NOT NULL,
    puck_color_property TEXT,             -- optional: color-code by this property
    validation_rules JSONB DEFAULT '[]',  -- [{type: 'no_overlap', config: {}}]
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New endpoints:**
```
GET  /ontology/scheduling/boards              List boards
POST /ontology/scheduling/boards              Create board
PUT  /ontology/scheduling/boards/{id}         Update board
DELETE /ontology/scheduling/boards/{id}       Delete board

GET  /ontology/scheduling/boards/{id}/data    Fetch rows + pucks for time window
  params: { from, to }
  returns: { rows[], pucks[], conflicts[] }

POST /ontology/scheduling/boards/{id}/assign  Assign puck to row + time
  body: { puck_id, row_id, start_time, end_time }
  returns: { success, conflicts[], action_execution_id }
  # Executes an action to write back to ontology, queues human review if configured

POST /ontology/scheduling/boards/{id}/unassign
  body: { puck_id }
```

### Frontend

**Add `GanttBoard.tsx` as a widget in Apps module + standalone page:**
```
GanttBoard.tsx
├── GanttHeader.tsx          — time axis (day/week/month zoom)
├── GanttSidebar.tsx         — row labels with resource properties
├── GanttGrid.tsx            — the drop zone grid
│   ├── GanttRow.tsx         — resource row with time slots
│   ├── GanttPuck.tsx        — draggable task block (react-dnd)
│   └── ConflictOverlay.tsx  — red shading on overlap zones
├── UnscheduledList.tsx      — right panel: pucks with no assignment yet
└── GanttToolbar.tsx         — zoom controls | today | filter
```

**Add "Scheduling" to Apps module widget picker** so builders can embed a Gantt board in any dashboard app.

---

## 5.3 Full Map Module

**New module: `src/modules/map/`** — upgrades from point widget to full geospatial analysis surface.

```
MapExplorer.tsx
├── LayerPanel.tsx            — left: add/configure/toggle layers
│   ├── ObjectLayer.tsx       — configure: object type + lat field + lon field + color property
│   ├── TrackLayer.tsx        — configure: object type + id field + lat + lon + time field
│   ├── ClusterLayer.tsx      — configure: same as object + H3 resolution slider
│   └── HeatmapLayer.tsx      — configure: same as object
├── MapCanvas.tsx             — OpenLayers (already loaded in HumanActions!) + CartoDB dark tiles
│   ├── ObjectMarkerLayer     — ol.layer.Vector with circle style, color by property
│   ├── TrackAnimationLayer   — ol.layer.Vector with LineString + animated dot
│   ├── ClusterHexLayer       — ol.layer.Vector with H3 hex polygons colored by count
│   └── DrawingLayer          — polygon/point drawing → saves to ontology record
├── MapPopup.tsx              — click a feature: record properties + "Execute action" buttons
├── TimeSlider.tsx            — scrub timeline for track animation
└── MapToolbar.tsx            — zoom | fit | draw tools | export PNG
```

**Layer management:**
- Any number of layers, each independently toggled
- Each layer tied to an object type with configurable field mapping
- Layer opacity slider
- Click any rendered object → popup shows full record properties + actions (reuses action execution from HumanActions)

**Add "Map" to NavRail** with `Map` icon.

---

---

# PHASE 6 — COLLABORATION & DISTRIBUTION
### "Report, share, branch, and package solutions"
**Effort:** 4–5 weeks | **New services: `collab-service` (8021)**

---

## 6.1 Notepad — Collaborative Reporting

### Architecture

**New service: `collab-service` (port 8021)**
```
backend/collab_service/
├── main.py
├── database.py
├── template_engine.py       # {{variable}} substitution with type coercion
├── pdf_exporter.py          # HTML → PDF (WeasyPrint)
└── routers/
    ├── documents.py
    ├── templates.py
    └── embeds.py
```

**New tables:**
```sql
CREATE TABLE collab_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content JSONB NOT NULL,          -- TipTap/ProseMirror JSON doc
    template_id UUID,
    template_variables JSONB,
    frozen_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE collab_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    content JSONB NOT NULL,
    input_schema JSONB DEFAULT '{}',  -- {variable_name: {type, description, required}}
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE collab_embeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES collab_documents(id) ON DELETE CASCADE,
    embed_type TEXT NOT NULL,         -- 'chart' | 'table' | 'metric' | 'query_result'
    source_config JSONB NOT NULL,     -- exploration_id or inline query config
    frozen_data JSONB,                -- filled when document is frozen
    last_refreshed_at TIMESTAMPTZ
);
```

**API:**
```
GET  /collab/documents                  List documents
POST /collab/documents                  Create
GET  /collab/documents/{id}             Get with all embeds resolved to live data
PUT  /collab/documents/{id}             Save document content
DELETE /collab/documents/{id}           Delete

POST /collab/documents/{id}/freeze      Snapshot all embed data
POST /collab/documents/{id}/export-pdf  Generate PDF (returns download URL)
POST /collab/documents/{id}/embeds      Add embed block
PUT  /collab/embeds/{id}/refresh        Re-fetch live data

GET  /collab/templates                  List templates
POST /collab/templates                  Create template
POST /collab/templates/{id}/generate    Generate document from template
  body: { variables: {object_id?, date?, custom_text?, ...} }
  returns: { document_id }
```

### Frontend

**New module: `src/modules/collab/`**
```
CollabPage.tsx               — list: documents + templates tabs
DocumentEditor.tsx           — TipTap rich text editor
├── EditorToolbar.tsx        — formatting + embed insert button
├── EmbedBlock.tsx           — TipTap custom node: renders live chart/table inline
│   └── EmbedConfig.tsx      — configure embed: pick exploration from ExplorerStore
├── TemplateMode.tsx         — {{variable}} highlighting in template editing mode
└── DocumentActions.tsx      — freeze | export PDF | share link
TemplateGenerator.tsx        — form: fill {{variables}} → generates document
```

**Embed flow:**
1. Click "Insert" → "Chart / Table / Metric"
2. Picks from saved explorations or inline query config
3. Embed renders live — data fetches fresh on doc open
4. "Freeze" snapshots all embed data as of now (for reports)
5. Export PDF: sends doc HTML to collab-service → WeasyPrint renders → download

---

## 6.2 Platform Branching

**New service: `branch-service` (port 8020)**

Every resource (pipeline, agent, logic function, logic flow, object type) gets a `branch_id` field added to its table via migration. Default `branch_id = 'main'`.

```sql
-- Migration applied to all services:
ALTER TABLE pipelines ADD COLUMN branch_id TEXT DEFAULT 'main';
ALTER TABLE agents ADD COLUMN branch_id TEXT DEFAULT 'main';
ALTER TABLE logic_functions ADD COLUMN branch_id TEXT DEFAULT 'main';
ALTER TABLE object_types ADD COLUMN branch_id TEXT DEFAULT 'main';
```

**New tables (branch_service):**
```sql
CREATE TABLE platform_branches (
    id TEXT PRIMARY KEY,              -- e.g. 'main', 'feat/new-agent-v2'
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    base_branch_id TEXT DEFAULT 'main',
    status TEXT DEFAULT 'active',     -- active | merged | abandoned | protected
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    merged_at TIMESTAMPTZ
);

CREATE TABLE branch_resource_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id TEXT REFERENCES platform_branches(id),
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    operation TEXT NOT NULL,          -- 'created' | 'modified' | 'deleted'
    snapshot_before JSONB,
    snapshot_after JSONB,
    changed_by TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE merge_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    source_branch_id TEXT REFERENCES platform_branches(id),
    target_branch_id TEXT DEFAULT 'main',
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'open',       -- open | approved | rejected | merged
    approvals JSONB DEFAULT '[]',
    required_approvals INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    merged_at TIMESTAMPTZ
);
```

**API:**
```
GET  /branches                         List branches
POST /branches                         Create branch (snapshots relevant resources)
GET  /branches/{id}/diff               Compare to main → [{resource_type, id, name, op, summary}]
POST /branches/{id}/proposals          Create merge proposal
GET  /branches/proposals               Open proposals
POST /branches/proposals/{id}/approve  Approve
POST /branches/proposals/{id}/merge    Execute merge (admin post-approval)
```

**Frontend: Branch selector in AppShell top bar**
- Dropdown: `main` | active branches | "New branch"
- Shows "Working in: feat/new-agent" badge in breadcrumb when not on main
- Yellow banner: "You are working in branch X. Changes will not affect production until merged."
- All API calls in all stores pass `X-Branch-Id` header when not on main
- "Merge" button opens proposal editor with diff view

---

## 6.3 Marketplace

**Extend pipeline-service with marketplace tables:**
```sql
CREATE TABLE marketplace_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_tenant_id TEXT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    category TEXT,                    -- 'analytics' | 'automation' | 'connectors' | 'ai' | 'templates'
    icon TEXT,
    version TEXT NOT NULL,
    changelog TEXT,
    resources JSONB NOT NULL,         -- serialized resource definitions
    dependencies JSONB DEFAULT '[]',  -- other package slugs
    install_count INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE package_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES marketplace_packages(id),
    tenant_id TEXT NOT NULL,
    installed_version TEXT,
    installed_resource_ids JSONB DEFAULT '{}',
    status TEXT DEFAULT 'installed',
    installed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Frontend: `src/modules/marketplace/`**
```
MarketplacePage.tsx
├── PackageGrid.tsx          — category tabs + card grid
├── PackageCard.tsx          — icon | name | category | install count | one-line desc
├── PackageDetail.tsx        — full description + included resources list + install button
├── InstallProgress.tsx      — step-by-step install with progress per resource
├── PublishWizard.tsx        — select resources → metadata → publish
└── MyInstallations.tsx      — installed packages + update available badge
```

---

---

# PHASE 7 — ML MODEL LAYER
### "Train, catalog, version, evaluate, and deploy ML models"
**Effort:** 4–5 weeks | **New service: `model-service` (8019)**

---

## 7.1 Model Catalog + Lifecycle

**New service: `model-service` (port 8019)**

```
backend/model_service/
├── main.py
├── database.py
├── artifact_store.py       # Stores model files in MinIO (S3-compatible)
├── inference_runner.py     # Loads sklearn/custom model + runs prediction
├── evaluator.py            # Binary classification, regression evaluators
└── routers/
    ├── models.py
    ├── versions.py
    ├── evaluations.py
    └── deployments.py
```

**Infrastructure: Add MinIO to docker-compose.yml**
```yaml
minio:
  image: minio/minio:latest
  ports:
    - "9100:9000"
    - "9101:9001"
  command: server /data --console-address ":9001"
  environment:
    - MINIO_ROOT_USER=nexus
    - MINIO_ROOT_PASSWORD=nexus_minio_pass
  volumes:
    - minio_data:/data
  networks:
    - nexus-net
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
    interval: 30s
    timeout: 5s
    retries: 3
```

**New tables:**
```sql
CREATE TABLE ml_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    task_type TEXT NOT NULL,          -- 'classification' | 'regression' | 'clustering' | 'nlp'
    framework TEXT,                   -- 'sklearn' | 'pytorch' | 'custom'
    input_schema JSONB,               -- {feature_name: type}
    output_schema JSONB,              -- {output_name: type}
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ml_model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID REFERENCES ml_models(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    artifact_path TEXT,               -- MinIO path
    training_config JSONB,            -- hyperparameters
    training_metrics JSONB,           -- loss, accuracy etc
    eval_metrics JSONB,               -- from formal eval run
    status TEXT DEFAULT 'candidate',  -- candidate | staging | production | deprecated
    promoted_by TEXT,
    promoted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ml_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_version_id UUID REFERENCES ml_model_versions(id),
    tenant_id TEXT NOT NULL,
    deployment_type TEXT NOT NULL,    -- 'batch' | 'live'
    target_object_type_id UUID,       -- write predictions back to objects
    target_property TEXT,
    status TEXT DEFAULT 'pending',
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ml_eval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_version_id UUID REFERENCES ml_model_versions(id),
    tenant_id TEXT NOT NULL,
    evaluator_type TEXT NOT NULL,
    test_config JSONB,
    results JSONB,                    -- accuracy, f1, rmse, etc.
    confusion_matrix JSONB,
    feature_importance JSONB,
    completed_at TIMESTAMPTZ
);
```

**API endpoints:**
```
GET  /models                              List models
POST /models                             Create model entry
GET  /models/{id}                         Get model + versions
GET  /models/{id}/versions               List versions
POST /models/{id}/versions               Upload new version (multipart: artifact + config JSON)
PUT  /models/{id}/versions/{vid}/promote  Promote: candidate → staging → production
POST /models/{id}/versions/{vid}/evaluate Run evaluation
  body: { evaluator_type, object_type_id, feature_mapping, label_field }
GET  /models/{id}/versions/{vid}/evals   Evaluation history

GET  /models/deployments                  List deployments
POST /models/{id}/versions/{vid}/deploy   Deploy version
  body: { deployment_type, target_object_type_id?, target_property? }
POST /models/deployments/{id}/predict    Live inference
  body: { inputs: {} }
  returns: { prediction, confidence, model_version }
DELETE /models/deployments/{id}          Undeploy
```

**Batch inference: add `trained_model` node to Pipeline Builder**
```python
# New node type in pipeline-service/dag_executor.py
class TrainedModelNodeExecutor:
    async def execute(self, inputs: list[dict], config: NodeConfig) -> list[dict]:
        deployment_id = config["deployment_id"]
        feature_cols = config["feature_columns"]
        output_col = config["output_column"]

        # Batch call to model-service
        batch_input = [{col: row.get(col) for col in feature_cols} for row in inputs]
        predictions = await model_client.predict_batch(deployment_id, batch_input)

        for row, pred in zip(inputs, predictions):
            row[output_col] = pred["prediction"]
        return inputs
```

### Frontend

**New module: `src/modules/models/`**
```
ModelCatalog.tsx
├── ModelList.tsx             — card grid: name | task type | framework | production status badge
├── ModelDetail.tsx
│   ├── VersionsTable.tsx     — version | status | eval score | promoted by | promote button
│   ├── EvalDashboard.tsx
│   │   ├── ClassificationView  — confusion matrix heatmap + ROC curve + precision/recall
│   │   ├── RegressionView      — actual vs predicted scatter + residuals histogram
│   │   └── FeatureImportance   — horizontal bar chart sorted by importance
│   └── DeploymentConfig.tsx  — batch (pick pipeline) or live (writeback to object type)
├── UploadVersionModal.tsx    — artifact file upload + hyperparameters form
└── InferenceTest.tsx         — live test: JSON inputs → prediction output
```

**Add `trained_model` to Pipeline Builder node palette** with ModelIcon.

---

---

# COMPLETE PHASE SUMMARY

| Phase | Name | New Services | Weeks | Key Deliverables |
|---|---|---|---|---|
| **0** | Surface What's Built | — | 1–2 | Audit Log UI, Settings, Finance, Schema Registry UI, Correlation UI, Agent Versions, Logic Loops |
| **1** | Analytics Surface | analytics-service (8015) | 3–4 | Data Explorer, AIP Analyst, Time Series View |
| **2** | Graph & Simulation | — (extends ontology+analytics) | 2–3 | Object Graph Explorer, Scenario Simulation |
| **3** | Evaluation & Trust | eval-service (8016) | 2–3 | Eval suites + test cases + evaluators + experiments |
| **4** | Governance | lineage-service (8017) | 2–3 | Checkpoints, Approvals, Full Lineage, PII Scanner |
| **5** | Operational | automate-service (8018) | 3–4 | Event-Driven Automation, Gantt Scheduling, Full Map |
| **6** | Collaboration | collab-service (8021) | 4–5 | Notepad, Platform Branching, Marketplace |
| **7** | ML Layer | model-service (8019) + MinIO | 4–5 | Model Catalog, Eval Dashboard, Batch+Live Deployment |

**Total: ~21–29 weeks**

**Recommended execution order:**
1. **Phase 0** immediately — highest ROI, surfaces finished work
2. **Phase 1** — biggest user-facing gap (no data query surface)
3. **Phase 4** — governance is a trust signal; Lineage is a promised feature
4. **Phase 2** — graph traversal is high visual impact
5. **Phase 3** — evals can be built in parallel with Phase 2
6. **Phase 5** — automation and map after core analytics is solid
7. **Phase 6** — collaboration compounds value of everything above
8. **Phase 7** — ML layer can be independent track starting in parallel with Phase 5

---

## NEW PORTS TO ADD TO docker-compose.yml

```yaml
analytics-service:
  build: ./backend/analytics_service
  ports: ["8015:8015"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - ONTOLOGY_SERVICE_URL=http://ontology-service:8004
  networks: [nexus-net]

eval-service:
  build: ./backend/eval_service
  ports: ["8016:8016"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - AGENT_SERVICE_URL=http://agent-service:8013
    - LOGIC_SERVICE_URL=http://logic-service:8012
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  networks: [nexus-net]

lineage-service:
  build: ./backend/lineage_service
  ports: ["8017:8017"]
  environment:
    - CONNECTOR_SERVICE_URL=http://connector-service:8001
    - PIPELINE_SERVICE_URL=http://pipeline-service:8002
    - ONTOLOGY_SERVICE_URL=http://ontology-service:8004
    - LOGIC_SERVICE_URL=http://logic-service:8012
    - AGENT_SERVICE_URL=http://agent-service:8013
  networks: [nexus-net]

automate-service:
  build: ./backend/automate_service
  ports: ["8018:8018"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - REDIS_URL=redis://redis:6379/1
    - ONTOLOGY_SERVICE_URL=http://ontology-service:8004
    - LOGIC_SERVICE_URL=http://logic-service:8012
    - AGENT_SERVICE_URL=http://agent-service:8013
    - PIPELINE_SERVICE_URL=http://pipeline-service:8002
  networks: [nexus-net]

model-service:
  build: ./backend/model_service
  ports: ["8019:8019"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - MINIO_URL=http://minio:9000
    - MINIO_USER=nexus
    - MINIO_PASSWORD=nexus_minio_pass
    - ONTOLOGY_SERVICE_URL=http://ontology-service:8004
  networks: [nexus-net]

collab-service:
  build: ./backend/collab_service
  ports: ["8021:8021"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - ANALYTICS_SERVICE_URL=http://analytics-service:8015
    - MINIO_URL=http://minio:9000
    - MINIO_USER=nexus
    - MINIO_PASSWORD=nexus_minio_pass
  networks: [nexus-net]

minio:
  image: minio/minio:latest
  ports: ["9100:9000", "9101:9001"]
  command: server /data --console-address ":9001"
  environment:
    - MINIO_ROOT_USER=nexus
    - MINIO_ROOT_PASSWORD=nexus_minio_pass
  volumes: [minio_data:/data]
  networks: [nexus-net]
```

---

*Document: /Users/ishmontalvo/Desktop/nexus-new-origins/docs/NEXUS_BUILDOUT_PLAN.md*
*Last updated: 2026-04-09 — Full codebase audit complete*
