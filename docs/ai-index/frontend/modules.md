# `src/modules/` — 33 feature modules

Each module is a top-level feature area. Module entry components are lazy-loaded in `App.tsx`. Below is one row per module with: route id, entry component, key sub-components, store(s), backend(s), and what to edit.

> When adding a new module, follow the checklist in [overview.md](overview.md#adding-a-new-top-level-module).

## Quick map

| Route id | Module | Entry component |
|----------|--------|-----------------|
| `connectors` | connectors/ | `ConnectorGrid.tsx` |
| `ontology` / `graph` | ontology/ | `OntologyGraph.tsx` |
| `pipelines` | pipeline/ | `PipelineBuilder.tsx` |
| `apps`, `apps-app` | apps/ | `AppsPage.tsx` |
| `workbench` | workbench/ | `WorkbenchPage.tsx` |
| `projects` | projects/ | `ProjectsModule.tsx` |
| `finance` | finance/ | `FinanceModule.tsx` |
| `logic` | logic/ | `LogicStudio.tsx` |
| `agents` | agents/ | `AgentStudio.tsx` |
| `human-actions` | agents/ | `HumanActions.tsx` |
| `evals` | evals/ | `EvalsPage.tsx` |
| `utilities` | utilities/ | `UtilitiesPage.tsx` |
| `settings` | settings/ | `SettingsPage.tsx` |
| `activity` | activity/ | `ActivityPage.tsx` |
| `data` | data/ | `DataHubPage.tsx` |
| `value` | value/ | `ValuePage.tsx` |
| `admin` | admin/ | `AdminHubPage.tsx` |
| `platform` | superadmin/ | `SuperAdminPage.tsx` |
| `operations` | operations/ | `OperationsModule.tsx` |
| `/pminingv2` | process_v2/ | `ProcessMiningV2.tsx` (hidden) |
| `/s/<token>` | share/ | `SharePage.tsx` (public) |
| `scenarios` | scenarios/ | `ScenariosPage.tsx` (NEW 2026-05) |

Other module folders not in the App.tsx switch but used as sub-routes/sub-views: `alerts/`, `audit/`, `events/`, `explorer/`, `gateway/`, `health/`, `lineage/`, `process/` (legacy), `quality/`, `schedules/`, `users/`, `workflow/`.

---

## connectors/ (9 files)

Entry: `ConnectorGrid.tsx`. Backend: connector-service:8001.

| File | Purpose |
|------|---------|
| `ConnectorGrid.tsx` | Main grid, search/filter, "Add" trigger |
| `ConnectorCard.tsx` | One card with status + health badge |
| `ConnectorDetailPanel.tsx` | Right-side detail on selection |
| `ConnectorHealthBar.tsx` | Health metric viz |
| `AddConnectorModal.tsx` | Generic add wizard |
| `EmailSetupModal.tsx` | Email-specific (IMAP) |
| `WhatsAppSetupModal.tsx` | WhatsApp QR auth |
| `PostmanConnectorModal.tsx` | Postman collection import |
| `connectorTypes.ts` | `CONNECTOR_TYPES` registry |

Store: `useConnectorStore`. API: `connectorsApi.*`.

**To add a connector type:** add to `connectorTypes.ts` + new SetupModal + ensure backend `schema_fetcher.py` supports it.

---

## ontology/ (10 files)

Entry: `OntologyGraph.tsx` (React Flow). Backend: ontology-service:8004.

Sub-components: `ObjectTypeNode`, `ConnectorFlowNode`, `PipelineFlowNode`, `PipelineStepNode`, `ObjectTypePanel`, `PropertyList`, `SchemaDiffViewer`, `ScenarioResolver`, `ontologyTypes.ts`.

Store: `useOntologyStore`. API: `ontologyApi.*` + `inferenceApi.*`.

**To add a node type:** new component + register in React Flow `nodeTypes` map.

---

## pipeline/ (7 files)

Entry: `PipelineBuilder.tsx` (React Flow DAG editor).

Files: `PipelineNode.tsx` (per-type renderer), `PipelineEdge.tsx`, `NodePalette.tsx` (drag-drop), `NodeConfigPanel.tsx` (per-node config form), `NodeAuditPanel.tsx`, `pipelineTypes.ts` (NodeType + `NODE_TYPE_DEFS`).

Store: `usePipelineStore`. API: `pipelinesApi.*`.

**To add a node type:** add to `NODE_TYPE_DEFS` + update `NodeConfigPanel` field input + `pipeline-service/dag_executor.py` handler.

---

## apps/ (9 files)

Entry: `AppsPage.tsx` (tab switcher dashboards vs apps). Backend: ontology-service apps router.

Sub: `AppCanvas`, `AppEditor`, `WidgetRenderer` (kpi-banner, metric-card, data-table, bar-chart, text-block), `ShareManagerModal`, `AppVariableContext`, `queryBuilder.ts`.

Store: `useAppStore`. Types: `types/app.ts`.

**To add a widget type:** `WidgetRenderer.tsx` + `COMPONENT_TYPE_LABELS` + queryBuilder.

---

## workbench/ (6 files)

Entry: `WorkbenchPage.tsx`. Backend: kernel-service:8026.

Sub: `NotebookEditor.tsx`, `cells/` subdir (Code, Markdown, Query, Output cell types), `ChatBar.tsx`, `theme.ts`.

Store: `useWorkbenchStore`.

**To add a cell type:** new component in `cells/` + register in cell renderer + extend `useWorkbenchStore`.

---

## agents/ (2 files — `AgentStudio.tsx` + `HumanActions.tsx`)

Backend: agent-service:8013.

`AgentStudio.tsx`: agent config (name/desc/model/system_prompt/tools/knowledge_scope/schedules/triggers), `TOOL_META` mapping with descriptions.

`HumanActions.tsx`: review queue for action proposals; approve/reject with reason.

Stores: `useAgentStore`, `useHumanActionsStore`.

**To add an agent tool's UI label:** `AgentStudio.tsx:TOOL_META` (also update `agent-service/tools.py`).

---

## operations/ (4 files)

Entry: `OperationsModule.tsx` — state-routes between sub-views (no URL change).

Sub: `HivemindGrid.tsx` (table of runs), `RunDrilldown.tsx` (detail), `EntityHistory.tsx` (related records).

Store: `useOperationsStore` (691 LOC — handles all 3 views' state).

**To add a run filter:** modify `HivemindGrid.tsx` UI + filter logic in `operationsStore`.

---

## settings/ (6 files + lazy children)

Entry: `SettingsPage.tsx`. Tabs: general, providers, catalog, consumption, notifications, api-keys, retention, permissions, alerts, **approvals**, **checkpoints**, **pii**, gateway, health.

Lazy children: `AlertsPage`, `ApiGatewayPage`, `PlatformHealthPage`, `ModelCatalogTab`, `ConsumptionTab`, `ApprovalsTab` (NEW), `CheckpointsTab` (NEW), `PiiScanTab` (NEW).

The three new tabs added 2026-05:
- **`ApprovalsTab.tsx`** — CRUD for `audit-service` approval workflows (resource_type / operations / required_approvers / eligible_roles / expiry_hours).
- **`CheckpointsTab.tsx`** — CRUD for justification-gate checkpoints. Each has a prompt, applies_to (resource + ops list), and applies_to_roles.
- **`PiiScanTab.tsx`** — Drives `inference-service /infer/scan-pii` and `/infer/scan-all`. Polls scan-results and renders per-OT hits with PII level badges.

Stores: `useAlertStore`, `useAuthStore`, `useOntologyStore` (PII tab needs OT list).

**To add a settings tab:** add to `TABS` array + import lazy component + add `case` to render switch.

---

## logic/ — `LogicStudio.tsx`

Backend: logic-service:8012. Visual function builder with the same block-types runtime as backend.

Store: `useLogicStore`.

**To add a block type UI:** corresponds to `logic-service/runner.py` block; update palette + config form.

---

## process/ (legacy, 21 files) and process_v2/ (4 files)

Legacy `process/` — full process mining UI (cases, events, conformance, deviations, alerts, benchmarks). Store: `useProcessStore`.

`process_v2/` — `ProcessMiningV2.tsx`, `MapChat.tsx`, `ConformancePanel.tsx` (NEW 2026-05), `api.ts`. Hidden route `/pminingv2`. Object-centric process mining with chat UI. Tabs: Overview / Process Map / Variants / Insights / Bottlenecks / Cases / **Conformance** (NEW) / Definition.

The **Conformance** tab renders `ConformancePanel` — full CRUD for conformance models (ordered list of expected activities), one-click "Check" runs a conformance check and renders per-case fitness + deviation counts, sortable.

## scenarios/ (NEW 2026-05, 1 file)

Entry: `ScenariosPage.tsx`. Top-level module surfacing the full `analytics-service /scenarios` API:
- List, select, create, delete saved scenarios.
- "Interpret" button — natural language → overrides + derived metrics (Claude via `/scenarios/interpret`).
- "Compute" — runs `/scenarios/{id}/compute` and renders baseline → simulated → delta table with affected-record count.
- Reuses `useOntologyStore` for object-type picker.

Replaces the prior in-DataExplorer prototype that only used `/scenarios/interpret` + `/scenarios/compute` ad-hoc.

---

## Single-file modules

| Module | Component | Backend |
|--------|-----------|---------|
| activity | ActivityPage.tsx | event-log + audit |
| admin | AdminHubPage.tsx | admin-service |
| superadmin | SuperAdminPage.tsx | admin-service (superadmin only) |
| data | DataHubPage.tsx | ontology + data-quality + lineage |
| evals | EvalsPage.tsx | eval-service |
| events | EventLog.tsx | event-log-service |
| explorer | DataExplorer.tsx | ontology records |
| finance | FinanceModule.tsx | finance-service:9001 |
| gateway | ApiGatewayPage.tsx | api-gateway-service |
| health | PlatformHealthPage.tsx | each service /health |
| projects | ProjectsModule.tsx + GanttChart.tsx | project-management-service:9000 |
| schedules | SchedulesPage.tsx | pipeline + logic schedules |
| users | UsersPage.tsx | auth-service users |
| share | SharePage.tsx | ontology shares (public, no auth) |
| alerts | AlertsPage.tsx | alert-engine (also tab in settings) |
| audit | (3 files) | audit-service |
| graph | (6 files) | ontology graph endpoints |
| lineage | (2 files) | lineage-service |
| workflow | (5 files) | ontology workflow + actions |
| utilities | UtilitiesPage.tsx | utility-service |
| value | ValuePage.tsx | analytics value tracker |
| quality | DataQualityPage.tsx | data-quality-service |

---

## Common edit patterns

| Intent | Where |
|--------|-------|
| Add a new module | follow checklist in [overview.md](overview.md). |
| Add a sub-view to an existing module | new component file inside the module folder. |
| Change a store action | `store/<feature>Store.ts`. |
| Change types contract | `types/*.ts` (mirror backend Pydantic). |
| Add API call | `api/<service>.ts` method or fetch directly (auth headers auto-injected). |
| Add nav item | `shell/NavRail.tsx` (also wire `App.tsx:renderPage`). |
