# Nexus vs Celonis vs Palantir — Feature Comparison

**Date:** April 2026
**Purpose:** Identify feature gaps between Nexus and the two market leaders to guide development priorities.

---

## How to Read This Document

Each section compares a feature area across three platforms:
- **Celonis** — Market leader in process mining and execution management
- **Palantir Foundry** — Market leader in ontology-driven operational intelligence
- **Nexus** — Our platform, combining both approaches

Legend: ✅ Full | 🟡 Partial | ❌ Missing | ➖ N/A (not in platform scope)

---

## 1. ONTOLOGY / DATA MODEL

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Object Types (define entities) | 🟡 Data models | ✅ Full (interfaces, type classes) | ✅ Basic (types + properties) | — |
| Properties (typed fields) | ✅ In data model | ✅ 15+ base types, structs, vectors, time series, cipher text | ✅ Basic types (text, int, decimal, bool, datetime) | **Medium** — add more types |
| Derived Properties (computed on-the-fly) | ✅ PQL formulas | ✅ Function-backed, no storage | ❌ | **High** |
| Link Types (relationships) | 🟡 Table joins | ✅ Full (cardinality, interface-based) | ✅ Basic (links with cardinality) | — |
| Schema Versioning | ❌ | ✅ Full | ✅ Version history + diff | — |
| Correlation / Schema Discovery | ❌ | ❌ | ✅ Correlation engine | **Advantage** |
| PII Scanning | ❌ | ✅ Sensitive Data Scanner | ✅ PII scan tab | — |
| Interfaces / Polymorphism | ❌ | ✅ Interfaces with inheritance | ❌ | **Low** |
| Time Series Properties | ❌ | ✅ FoundryTS engine | ❌ | **Medium** |
| Geospatial Properties | ❌ | ✅ Geopoint, geoshape | ❌ | **Low** |
| Media / Attachments on Objects | ❌ | ✅ Media sets, attachments | ❌ | **Low** |
| Semantic Search (vector) | ❌ | ✅ Embedding + vector search | ❌ | **High** |

---

## 2. PROCESS MINING — PROCESS MAP

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Process map visualization | ✅ Full | 🟡 Machinery (basic) | ✅ Dagre layout, entry/exit nodes | — |
| Frequency view (case count on edges) | ✅ Toggle | ➖ | ✅ Edge thickness = frequency | — |
| Performance view (throughput time on edges) | ✅ Toggle median/avg/trimmed | ➖ | 🟡 Avg hours only | **High** — add toggle |
| Click to filter (with/without/starting/ending) | ✅ Full (4 filter types per node) | ➖ | 🟡 Click highlights inflow/outflow only | **High** |
| Connection drill-down (histogram of times) | ✅ Throughput time histogram per edge | ➖ | ❌ | **High** |
| Token replay animation | ✅ Animate cases flowing through map | ➖ | ❌ | **Medium** |
| Conformance overlay on map | ✅ BPMN deviation overlay | ➖ | ❌ (conformance is separate tab) | **Medium** |
| BPMN reference model support | ✅ BPMN 2.0 import | ➖ | ❌ (manual happy path only) | **Medium** |
| Process map filtering (date range, attributes) | ✅ Full filtering + date picker | ➖ | ❌ | **Critical** |
| KPIs on process map | ✅ Custom KPI groups on map | ➖ | ❌ | **High** |
| Back-edge / cycle detection | ❌ | ➖ | ✅ DFS-based, dashed lines | **Advantage** |
| Focus mode (double-click path isolation) | ❌ | ➖ | ✅ BFS reachability | **Advantage** |
| Edge speed indicators | ❌ | ➖ | ✅ Fast/normal/slow coloring | **Advantage** |

---

## 3. PROCESS MINING — ANALYTICS

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Variant explorer | ✅ Histogram + browser | ➖ | ✅ List with chips, drill-down | — |
| Case explorer / timeline | ✅ Full | ➖ | ✅ Case list + timeline | — |
| Conformance checking | ✅ BPMN-based, deviation drill-down, allowlisting | ➖ | 🟡 Happy path model, score, deviations | **Medium** |
| OLAP / Pivot tables | ✅ Full multidimensional | ➖ | ❌ | **High** |
| Bottleneck analysis | ✅ Performance view | ➖ | 🟡 Bottleneck endpoint exists but no UI | **High** |
| Process simulation / what-if | ✅ Digital twin, scenario comparison | ➖ | ❌ | **Low** (advanced) |
| Throughput time histogram per transition | ✅ | ➖ | ❌ | **High** |
| Social network analysis (resources) | ✅ Resource view | ➖ | ❌ | **Low** |
| Root cause analysis | ✅ AI-powered | ➖ | ❌ | **Medium** |
| Object-centric process mining (OCPM) | ✅ Multi-object | ➖ | ❌ (single object type) | **Medium** |

---

## 4. NATURAL LANGUAGE / AI QUERYING

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Natural language to process query | ✅ Process Copilot (GA 2025) | ➖ | ❌ | **Critical** |
| Conversational data exploration | ✅ Follow-up questions, chart gen | ✅ AIP Threads | 🟡 Nexus Assistant (basic) | **Critical** |
| NL query → chart/table | ✅ Auto-generate from question | ✅ AIP Analyst widget | ❌ | **Critical** |
| NL query → process map filter | ✅ Filter map from question | ➖ | ❌ | **High** |
| AI-generated insights / recommendations | ✅ Annotation Builder | ✅ AIP Logic | 🟡 AI Analyze (activity classification only) | **High** |
| Export findings (CSV, PNG, email) | ✅ | ✅ Notepad PDF export | ❌ | **Medium** |
| Slack / Teams integration for AI | ✅ Process Copilot in Slack/Teams | ✅ (via integrations) | ❌ | **Low** |

---

## 5. PIPELINE / DATA TRANSFORMS

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Visual DAG pipeline builder | 🟡 Action Flows | ✅ Pipeline Builder | ✅ Node-based editor | — |
| Node types (source, map, filter, etc.) | 🟡 Limited | ✅ 20+ transform types | ✅ 12 node types | — |
| Incremental / CDC pipelines | ✅ Real-time extraction | ✅ Incremental transforms | ❌ | **High** |
| Streaming pipelines | ✅ Kafka connector | ✅ Streaming keys/joins | ❌ | **Medium** |
| Code-based transforms (Python/SQL) | ✅ ML Workbench | ✅ Code Repos (Python/Java/SQL) | ❌ | **Medium** |
| Pipeline branching / versioning | ❌ | ✅ Git-like branches, PRs | ❌ | **Medium** |
| Data quality checks in pipeline | 🟡 | ✅ Health checks, expectations | 🟡 Validate node exists | **Medium** |
| Scheduling (cron) | ✅ | ✅ Rich scheduling | ✅ Cron schedules | — |
| AI-assisted transforms | ❌ | ✅ Pipeline Assist (NL to code) | ❌ | **Medium** |

---

## 6. DASHBOARDS / APP BUILDER

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Visual app builder | ✅ Studio Views | ✅ Workshop | ✅ App editor | — |
| AI-generated dashboards | ❌ | ❌ | ✅ Claude generates apps | **Advantage** |
| Widget types | ✅ 15+ (charts, KPIs, tables, maps, Sankey) | ✅ 40+ (charts, maps, Gantt, media, AIP) | 🟡 5 (KPI, metric, table, bar, text) | **Critical** |
| Line chart | ✅ | ✅ | ❌ | **Critical** |
| Pie / donut chart | ✅ | ✅ | ❌ | **Critical** |
| Scatter plot | ✅ | ✅ | ❌ | **Medium** |
| Area chart | ✅ | ✅ | ❌ | **Medium** |
| Map / geospatial widget | ✅ World map | ✅ Full map with layers | ❌ | **Low** |
| Gantt chart widget | ❌ | ✅ | ❌ | **Low** |
| Sankey diagram | ✅ (2025) | ❌ | ❌ | **Low** |
| Pivot table widget | ✅ | ✅ | ❌ | **High** |
| Filters / date picker widgets | ✅ | ✅ Full filter suite | ❌ | **Critical** |
| Cross-widget filtering (click chart → filter table) | ✅ | ✅ Events + variables | ❌ | **Critical** |
| Custom widgets (code) | ❌ | ✅ Custom HTML/CSS/JS | ❌ | **Low** |
| Drag-and-drop grid layout | ✅ | ✅ | ✅ react-grid-layout | — |
| Variables / state management | 🟡 | ✅ Full variable system | ❌ | **High** |
| Embedding / iframe | ❌ | ✅ | ❌ | **Low** |
| Mobile support | ❌ | ✅ | ❌ | **Low** |
| Export dashboard as PDF | ✅ | ✅ Notepad → PDF | ❌ | **Medium** |

---

## 7. AGENT / AI FRAMEWORK

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| AI agent builder | 🟡 AgentC (partner-focused) | ✅ Agent Studio (4-tier framework) | ✅ Agent Studio | — |
| Agent tools (read data) | 🟡 Process Intelligence API | ✅ Object Query, Function, Command | ✅ 11 tools | — |
| Agent tools (write data) | 🟡 Action Flows | ✅ Action tool (auto/confirm) | ✅ Propose Action | — |
| Agent tools (call sub-agents) | ❌ | ✅ | ✅ agent_call | — |
| Agent tools (process mining) | ❌ | ❌ | ✅ process_mining tool | **Advantage** |
| Multi-model support | ❌ | ✅ Model catalog | ✅ Haiku/Sonnet/Opus | — |
| Knowledge scope / grounding | ❌ | ✅ Retrieval context, citations | 🟡 Scoped to object types | **Medium** |
| Agent evaluation / testing | ❌ | ✅ AIP Evals | ✅ Eval suites | — |
| Autonomous scheduled agents | ❌ | ✅ Automate triggers | ✅ Cron schedules | — |
| Agent embedding in apps | ❌ | ✅ Workshop AIP widget | ❌ | **High** |
| MCP (Model Context Protocol) | ✅ MCP Server (2025) | ✅ Ontology MCP | ❌ | **Medium** |

---

## 8. WORKFLOW / LOGIC AUTOMATION

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Visual workflow builder | ✅ Action Flows | ✅ AIP Logic (blocks) | ✅ Logic Studio (9 block types) | — |
| Conditional logic (if/else) | ✅ | ✅ | ✅ | — |
| Loops (for each) | ✅ | ✅ | ✅ | — |
| LLM call block | ❌ | ✅ Use LLM block | ✅ LLM Call block | — |
| Ontology query block | ❌ | ✅ | ✅ | — |
| Ontology write-back block | ❌ | ✅ | ✅ Ontology Update | — |
| Email / notification block | ✅ Action Flows | ✅ Notifications side effect | ✅ Send Email | — |
| Webhook / HTTP call block | ✅ | ✅ Webhooks | ❌ | **High** |
| Utility integration (OCR, scrape, etc.) | ❌ | ✅ Compute modules | ✅ Utility Call block | — |
| Function versioning | ❌ | ✅ | ❌ | **Medium** |
| Execution tracing / debugging | 🟡 | ✅ | ✅ Block-level output | — |

---

## 9. HUMAN-IN-THE-LOOP / ACTIONS

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Action definitions | ✅ Skills/Action Flows | ✅ Action Types (rich schema) | ✅ Human Actions | — |
| Approval workflow | ✅ Tasks | ✅ Submission criteria, approvals | ✅ Approve/reject | — |
| Batch actions | 🟡 | ✅ Batched execution | ❌ | **Medium** |
| Undo / revert actions | ❌ | ✅ | ❌ | **Medium** |
| Action monitoring dashboard | ✅ | ✅ Action monitoring | 🟡 History tab only | **Medium** |
| Webhook side effects | ✅ | ✅ | ❌ | **High** |

---

## 10. DATA INTEGRATION / CONNECTORS

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Pre-built connectors | ✅ 100+ process connectors | ✅ 200+ connectors | 🟡 REST API + generic DB | **High** |
| SAP / Oracle / Salesforce native | ✅ | ✅ | ❌ | **Medium** (add later) |
| Database connectors | ✅ PostgreSQL, MSSQL, Oracle | ✅ 15+ database types | 🟡 Generic SQL | **Medium** |
| File upload (CSV, Excel) | ✅ | ✅ | ❌ | **High** |
| Real-time / streaming | ✅ Replication Cockpit, Kafka | ✅ Streaming sync, webhooks | ❌ | **Medium** |
| Postman import | ❌ | ❌ | ✅ | **Advantage** |
| Zero-copy data (Databricks, Fabric) | ✅ (2025) | ✅ Virtual tables | ❌ | **Low** |
| Webhook listeners | ❌ | ✅ | ❌ | **High** |

---

## 11. SEARCH & DISCOVERY

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Full-text search across records | 🟡 | ✅ | ✅ Basic | — |
| Command palette (quick nav) | ❌ | ❌ | ✅ ⌘K | **Advantage** |
| Vector / semantic search | ❌ | ✅ Embeddings | ❌ | **High** |
| Global resource search | ✅ | ✅ | ✅ | — |

---

## 12. SECURITY & GOVERNANCE

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| RBAC (role-based access) | ✅ | ✅ | ✅ Admin/Analyst/Viewer | — |
| Marking-based access (column/row level) | ❌ | ✅ | ❌ | **Low** |
| Audit logs | ✅ | ✅ Append-only | ✅ Audit service | — |
| Data lineage visualization | ❌ | ✅ Full lineage graph | 🟡 Basic lineage | **Medium** |
| Data retention policies | 🟡 | ✅ Data Lifetime | ✅ Retention config | — |
| API key management | ✅ | ✅ | ✅ | — |
| SSO / OIDC | ✅ | ✅ | ✅ | — |

---

## 13. COLLABORATION

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Comments on objects | 🟡 | ✅ Rich comments with @mentions | ✅ Threaded comments | — |
| Shareable reports | ✅ Email from Copilot | ✅ Notepad → PDF | ❌ | **Medium** |
| Code review / PRs | ❌ | ✅ | ❌ | **Low** |
| Real-time collaboration | ❌ | ✅ Notepad co-editing | ❌ | **Low** |

---

## 14. VALUE TRACKING

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| Value realization tracking | ✅ Path-to-Value | ❌ | ✅ Value Monitor | **Advantage** |
| ROI calculation | ✅ Process simulation | ❌ | ✅ Formula-based | — |
| Value lifecycle (identify → frame → realize) | ✅ | ❌ | ✅ | — |

---

## 15. DEVELOPER EXPERIENCE

| Feature | Celonis | Palantir | Nexus | Gap Priority |
|---|---|---|---|---|
| External SDK (TypeScript/Python) | 🟡 PyCelonis | ✅ OSDK (TS, Python, Java) | ❌ | **High** |
| REST API for external apps | ✅ | ✅ | 🟡 Internal only | **High** |
| API Gateway (expose data as APIs) | ❌ | ✅ | ✅ API Gateway module | — |
| Custom query language | ✅ PQL (150+ operators) | ❌ (code-based) | ❌ | **Medium** |
| Webhook endpoints (inbound) | ❌ | ✅ | ❌ | **High** |

---

## Summary: Critical Gaps (What's Hurting Us Most)

### Must-Have (Critical)
1. **Natural language process querying** — Ask questions about processes in plain English, get charts/tables/filtered maps
2. **Process map filtering** — Date range picker, attribute filters, filter by clicking nodes
3. **More chart types in dashboards** — Line, pie, area at minimum; filter/date picker widgets
4. **Cross-widget filtering in dashboards** — Click a bar → filter the table
5. **Dashboard filter widgets** — Date picker, dropdown, text filter, object selector

### Should-Have (High)
6. **Performance view toggle** on process map (frequency ↔ throughput time)
7. **Connection drill-down** — Click an edge, see throughput time histogram
8. **OLAP / pivot table** — Multidimensional process analysis
9. **Bottleneck analysis UI** — Surface the existing backend endpoint
10. **Derived properties** — Computed fields without storage
11. **Webhook HTTP block** in Logic Studio
12. **File upload connector** (CSV/Excel)
13. **Pre-built connector templates** — At least 10-20 common sources
14. **External SDK** — TypeScript/Python client for the ontology
15. **Inbound webhooks** — Accept events from external systems
16. **Incremental pipelines** — Don't re-process entire datasets
17. **Vector / semantic search** across records

### Nice-to-Have (Medium)
18. Token replay animation on process map
19. Conformance overlay on process map
20. BPMN reference model import
21. Root cause analysis
22. Object-centric process mining (multi-object)
23. Process simulation / what-if
24. Export dashboard as PDF
25. Shareable reports
26. MCP server for external AI agents
27. Pipeline branching / versioning
28. Time series properties
29. Function versioning

---

## Nexus Competitive Advantages (Things They Don't Have)

1. **AI-generated dashboards** — Neither Celonis nor Palantir can generate full dashboard apps from a natural language prompt
2. **Unified process mining + ontology + AI agents** — Celonis has process mining but weak ontology; Palantir has ontology but weak process mining. Nexus has both.
3. **Process mining tool for AI agents** — Our agents can query process data directly
4. **Correlation engine** — Automatic schema relationship discovery
5. **Back-edge / cycle detection** in process maps
6. **Focus mode** (double-click path isolation) in process maps
7. **Speed indicators** (fast/normal/slow) on process map edges
8. **Value realization tracking** — Better than Celonis's Path-to-Value in some ways
9. **Postman API import** for connectors
10. **Command palette** (⌘K) for quick navigation
