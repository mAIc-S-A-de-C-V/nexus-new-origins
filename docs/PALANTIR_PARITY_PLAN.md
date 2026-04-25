# Nexus → Palantir Parity Plan

Last updated: 2026-04-11
Reference: `docs/QA_SEPSIS_TESTING.md`, comparison analysis in conversation history.

This document tracks every meaningful capability gap between Nexus and Palantir (Foundry + AIP + Apollo) and defines the specific builds needed to close each one. Phases are ordered by ROI — highest impact gaps first.

---

## Gap Summary

| # | Capability | Gap Severity | Phase |
|---|---|---|---|
| 1 | Actions (governed write-back) | 🔴 Critical | Phase A |
| 2 | Object–Dataset live binding | 🔴 Critical | Phase A |
| 3 | Workshop (no-code app builder) | 🔴 Critical | Phase B |
| 4 | Vector search / RAG layer | 🟠 High | Phase B |
| 5 | Incremental pipeline processing | 🟠 High | Phase C |
| 6 | Multi-LLM provider registry | ✅ Shipped (Apr 2026) | Phase B |
| 7 | LLM permission scoping | 🟡 Medium | Phase B |
| 8 | Code Repositories (git-backed pipelines) | 🟡 Medium | Phase C |
| 9 | Compute Modules (Docker container execution) | 🟡 Medium | Phase C |
| 10 | Object Interfaces (polymorphism) | 🟡 Medium | Phase C |
| 11 | Semantic search (vector-backed ⌘K) | 🟡 Medium | Phase B |
| 12 | Object Views (auto detail pages) | 🟢 Low | Phase D |
| 13 | AIP Automations (event-driven triggers) | 🟢 Low | Phase C |
| 14 | Apollo-equivalent CD platform | 🟢 Low | Phase E |

---

## Phase A — The Ontology Read-Write Loop
**This is the most important gap. Palantir is an operational platform because of Actions.**

### A.1 — Action Types

**What Palantir has:**
An Action Type defines a governed write operation on the Ontology. It specifies:
- Which object types are modified and which properties change
- Validation rules (required fields, value constraints, conditional logic)
- Side effects (webhooks, notifications, CDC events downstream)
- Execution modes: auto-apply OR require human confirmation (critical for AI-driven actions)

Actions are how AI agents write data back to real systems. An agent in Foundry can say "approve this shipment" and the Action executes the write with full audit trail. In Nexus today, agents can only read and summarize — they cannot change any system state.

**What to build:**
1. **`action_service`** (new backend, port 8024)
   - Table: `action_types` — schema, validation rules, target object type, confirmation mode
   - Table: `action_executions` — log of every action run (who, when, inputs, result, status)
   - `POST /actions/{type_id}/execute` — validate inputs, apply optional human confirmation gate, write to target
   - `GET /actions/{type_id}/executions` — audit trail
   - Integration with HumanActions module for confirmation-required actions

2. **Ontology integration** — Add "Actions" tab to ObjectTypePanel showing action types defined for that object type

3. **Agent Studio integration** — Add Action as a tool type in Agent Studio. When agent calls an action tool, it either auto-executes or queues to HumanActions for approval depending on the action's confirmation mode.

4. **Logic Studio integration** — Add "Execute Action" block type in Logic Studio (mirrors Palantir's AIP Logic Action block)

**Data model:**
```sql
CREATE TABLE action_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    object_type_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    input_schema JSONB NOT NULL DEFAULT '{}',
    validation_rules JSONB DEFAULT '[]',
    confirmation_required BOOLEAN DEFAULT false,
    webhook_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE action_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    action_type_id UUID REFERENCES action_types(id),
    triggered_by TEXT,  -- 'user', 'agent', 'automation', 'logic'
    triggered_by_id TEXT,
    inputs JSONB NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'pending',  -- pending, approved, rejected, executed, failed
    result JSONB,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### A.2 — Object–Dataset Live Binding

**What Palantir has:**
Object Types are backed by one or more Foundry datasets. The Ontology engine indexes those datasets into queryable objects. You query `SELECT * FROM Employee WHERE department = 'Engineering'` against objects, not raw tables. The binding is live — when the backing dataset updates (via pipeline), the objects update automatically.

**What Nexus has today:**
Object types are schema definitions only. Properties are free-form JSON declarations. There is no live index of actual records.

**What to build:**
1. **Object Record Store** — Add a `object_records` table to ontology-service:
   ```sql
   CREATE TABLE object_records (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id TEXT NOT NULL,
       object_type_id UUID NOT NULL,
       record_id TEXT NOT NULL,  -- business key from source
       properties JSONB NOT NULL DEFAULT '{}',
       source_connector_id TEXT,
       source_pipeline_id TEXT,
       ingested_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW(),
       UNIQUE(tenant_id, object_type_id, record_id)
   );
   CREATE INDEX ON object_records(tenant_id, object_type_id);
   CREATE INDEX ON object_records USING GIN (properties);
   ```

2. **Pipeline "Write to Ontology" step** — Pipeline Builder gets a native "Write to Ontology" step type that maps pipeline output fields → object type properties and upserts into `object_records`

3. **Object Records tab** — ObjectTypePanel in Ontology gets a "Records" tab showing live records with filter/sort

4. **Link traversal** — Given a record, traverse link types to pull related records from other object types (enables the Graph Explorer record mode to show real data)

**Priority:** Build A.2 in parallel with A.1. Without records, actions have nothing to write back to.

---

## Phase B — Workshop (No-Code Application Builder)
**Palantir's biggest differentiator after the Ontology.**

### B.1 — What Workshop Is

Workshop is a drag-and-drop application builder where non-technical users build production operational applications. Every widget is Ontology-aware: tables show live object records, forms call Action Types, charts visualize object sets in real time.

Key capabilities:
- 50+ pre-built widgets: DataTable, Form, Chart (line, bar, scatter, pie), KPI tile, Map, Timeline, Iframe, Markdown
- Custom Widget SDK: write raw React/TypeScript, securely sandboxed
- Bidirectional iframe: Workshop ↔ external React apps share state
- Layout system: drag, resize, responsive grid
- Variables: typed state variables shared across widgets
- Events: widget interaction → update variable → filter another widget (dashboard interactivity)
- Action wiring: Form "Submit" → calls an Action Type → writes to Ontology

### B.2 — What to Build

**New module: `Workshop`** (or call it "App Builder" to avoid trademark issues)

**Backend:**
```
workshop_service (port 8025)
  - app_definitions: JSONB layout schema (widgets, variables, event wiring)
  - widget_data: cached query results per widget
  - POST /apps — create app
  - GET /apps/{id} — load app definition
  - PUT /apps/{id} — save layout
  - GET /apps/{id}/render — execute all widget data queries and return results
  - POST /apps/{id}/action — execute a widget-triggered action
```

**Frontend app builder:**
- Left panel: widget palette (drag to canvas)
- Center: canvas with resizable widget grid (use `react-grid-layout`)
- Right panel: widget config (data source, display properties, action binding)
- Top: mode toggle — Edit / Preview / Publish

**Widget types to build (MVP):**
1. `DataTable` — query object records, sortable/filterable columns
2. `KPITile` — single metric with label and comparison (up/down trend)
3. `BarChart` / `LineChart` — recharts-backed, data from object record query
4. `Form` — input fields mapped to Action Type parameters
5. `Markdown` — static text/HTML for labels and descriptions
6. `Iframe` — embed external URLs
7. `FilterBar` — global filter that drives all other widgets on the page

**Variable system:**
```typescript
type AppVariable = {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'objectRef' | 'objectSet';
  defaultValue: any;
};
```

**Event wiring:**
```typescript
type WidgetEvent = {
  trigger: 'onClick' | 'onRowSelect' | 'onSubmit' | 'onChange';
  action: 'setVariable' | 'executeAction' | 'navigate' | 'refresh';
  params: Record<string, any>;
};
```

**Implementation notes:**
- Use `react-grid-layout` for the drag-resize canvas
- Widget data queries call `object_records` via ontology-service (Phase A.2 prerequisite)
- Form submissions call `action_service` (Phase A.1 prerequisite)
- Workshop apps are published and then accessible via the `AppsPage` (Dashboards) — they become the custom dashboards users see

**Phase B.1 is the single highest-ROI build after Phase A.** This turns Nexus from a back-office data tool into a front-office operational platform.

---

### B.2 — Vector Search / RAG Layer

**What Palantir has:**
AIP agents retrieve context via:
- Object queries with semantic similarity (embedding-based)
- Document repositories with vector search
- Function-backed retrieval with citations

**What to build:**
1. Add `pgvector` extension to the Postgres instance
2. **Embedding pipeline** — when records are written to `object_records` (Phase A.2), compute embeddings for text properties and store in `object_embeddings` table
3. **Semantic search endpoint** — `POST /search/semantic` — query by natural language, returns ranked object records
4. **Agent Studio integration** — Add "Semantic Context" tool type that queries object embeddings at agent invocation time, injects relevant records into system prompt

```sql
-- Requires pgvector extension
CREATE TABLE object_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    object_type_id UUID NOT NULL,
    record_id TEXT NOT NULL,
    embedding VECTOR(1536),  -- OpenAI text-embedding-3-small dimensions
    text_content TEXT,  -- the text that was embedded
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON object_embeddings USING ivfflat (embedding vector_cosine_ops);
```

5. **Search service upgrade** — ⌘K search gains a "Semantic" mode alongside the existing ILIKE mode

---

### B.3 — Multi-LLM Provider Registry — ✅ Shipped April 2026

**What Palantir has:** OpenAI, Claude, Gemini, Llama, and others selectable per function/agent.

**What was built:**
- `model_providers` table on agent-service (`{id, tenant_id, name, provider_type: 'anthropic'|'openai'|'google'|'azure_openai'|'local', api_key_encrypted, base_url, models, is_default, enabled, created_at}`)
- Frontend CRUD UI in Settings → AI Models (masked keys, per-provider model registration, connection test, default selection, enable/disable)
- `backend/shared/llm_router.py` — per-tenant resolver (sync + async) and unified chat / agent-loop adapters that work across Anthropic, OpenAI, Azure OpenAI, and OpenAI-compatible local servers (Ollama / vLLM / LM Studio). Cross-provider tool-use translation included
- Wired into agent-service runtime (run_agent, stream_agent) and inference-service (every Anthropic call site)
- Env-based `ANTHROPIC_API_KEY` retained as fallback when no provider is configured
- API endpoints under `/model-providers` (CRUD + `/test`)

**Still on the roadmap:**
- Google Gemini chat routing (currently connection-test only — needs `google-genai` SDK)
- Per-project rate limits
- Provider failover / retry chain

---

## Phase C — Engineering Power Features

### C.1 — Incremental Pipeline Processing

**What Palantir has:** Pipeline transforms that only process new rows since last run (append-only).

**What to build:**
- Add `last_processed_at` watermark to pipeline steps
- For HTTP source steps: pass `?since=<watermark>` query param
- For Ontology write steps: upsert by record_id (already designed in A.2)
- For transformations: support `mode: 'incremental' | 'full'` toggle

### C.2 — Code Repositories (Git-backed Pipelines)

**What Palantir has:** PySpark/Python/TypeScript code executed in Foundry with git branching, PRs, CI.

**What to build:**
- `code_execution_service` — executes arbitrary Python in a sandboxed Docker container (similar to Palantir Compute Modules)
- Pipeline Builder: add "Run Code" step type — paste Python, specify inputs/outputs, executed in sandbox
- Long-term: git integration via GitHub/GitLab webhooks so pipeline code lives in version control

### C.3 — Object Interfaces (Polymorphism)

**What Palantir has (introduced Aug 2024):** An Interface describes the shape of an object type. Multiple types implement the same interface. Apps and actions work against "any object that has these properties."

**What to build:**
- Add `interfaces` table: `{id, name, properties: typed schema}`
- Add `object_type_interfaces: many-to-many` (object types implement interfaces)
- Workshop widgets and Action types can target an Interface instead of a specific Object Type
- Use case: "Incident" interface implemented by SecurityAlert AND ManufacturingDefect — one Widget shows both

### C.4 — Event-Driven Automations

**What Palantir has:** Automations fire when Ontology data changes — new object, property update, threshold crossed.

**What to build:**
- Extend `alert_engine` to watch `object_records` table (CDC via Postgres LISTEN/NOTIFY)
- Automation definition: `{trigger_type, object_type_id, condition, action_type_id}`
- When condition matches, execute the action (via action_service from Phase A.1)

---

## Phase D — User Experience Polish

### D.1 — Object Views
Auto-generated detail page for any Ontology object record:
- Top: key properties displayed as KPI tiles
- Related objects: linked records via link types
- Timeline: history of changes/events for this record
- Actions: buttons for each Action Type defined on this object type
- Comments: threaded discussion

### D.2 — Ontology SDK (External API)
Allow external developers to build apps on top of the Nexus Ontology:
- REST API per object type: `GET /sdk/{tenant}/objects/{type}` — query records with filters
- API key authentication (reuse api_gateway_service, Phase 13 already built)
- Generated TypeScript types from object type schema
- This is the equivalent of Palantir's Ontology SDK 2.0

### D.3 — Computed Properties
Properties on object types whose values are computed at query time from other properties or linked objects (e.g., `total_value = SUM(linked_line_items.amount)`). Palantir calls these "derived properties."

---

## Phase E — Deployment (Apollo-equivalent)

**Note:** Apollo is a genuinely different product category. It's needed if MAIC/MJSP ever:
- Deploys to air-gapped government networks
- Manages multiple customer environments from one control plane
- Requires FedRAMP or DoD IL authorization

**What to build when needed:**
- `deployment_service` — manages Docker Compose/Kubernetes manifests per environment
- Environment registry: `{env_id, name, type: cloud|onprem|airgap, connection_config}`
- Release channels: production / staging / development
- Deployment history with rollback
- Health check aggregation across environments

This is Phase E because it's infrastructure, not product capability. Build when first customer requires multi-environment management.

---

## Nexus Advantages to Protect and Deepen

These are areas where Nexus is ahead of Palantir — invest here, don't let them atrophy:

| Advantage | Action |
|---|---|
| **Process Mining** | Deepen: add conformance checking, case duration analysis, variant explorer |
| **Self-serve tenant admin** | Deepen: usage quotas, tenant-level model access controls |
| **Data Quality profiling** | Deepen: add trend over time, alerting on quality score drops |
| **Value Realization tracking** | Deepen: this is being built now — it's a genuine gap vs. Palantir |
| **Open source / zero lock-in** | Keep: this is a core go-to-market differentiator |
| **Price accessibility** | Keep: never build pricing gates that lock out mid-market |

---

## Build Priority Order

```
Phase A (Critical — builds the foundation for everything else)
  A.1 Action Types → action_service
  A.2 Object–Dataset Live Binding → object_records table + Write-to-Ontology pipeline step

Phase B (High ROI — turns Nexus into an operational platform)
  B.1 Workshop / App Builder → workshop_service + react-grid-layout canvas
  B.2 Vector Search / RAG → pgvector + embedding pipeline + semantic search
  B.3 Multi-LLM Registry → model_providers table + agent/logic selector

Phase C (Engineering power)
  C.1 Incremental Pipelines
  C.2 Code Execution (sandboxed Python)
  C.3 Object Interfaces
  C.4 Event-Driven Automations (extends alert_engine)

Phase D (Polish)
  D.1 Object Views
  D.2 Ontology SDK
  D.3 Computed Properties

Phase E (Deployment infrastructure — when needed)
  E.1 Deployment service + environment registry
```

---

## Definition of Parity

Nexus reaches **Palantir Foundry parity** when:
1. ✅ Object Types have live records (Phase A.2)
2. ✅ Actions execute write-backs with audit trail (Phase A.1)
3. ✅ Workshop enables non-technical users to build apps on Ontology data (Phase B.1)
4. ✅ AI agents are grounded in real records via RAG (Phase B.2)
5. ✅ Pipelines process incrementally without full rebuilds (Phase C.1)

Items 1–3 alone constitute the minimum viable "operational platform" claim.
