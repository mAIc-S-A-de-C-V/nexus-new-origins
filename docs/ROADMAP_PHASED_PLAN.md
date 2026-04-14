# Nexus Platform — Phased Development Roadmap

**Date:** April 2026
**Reference:** [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md) — gap analysis vs Celonis & Palantir
**Goal:** Close critical gaps in 4 phases while preserving Nexus's unique advantages (unified ontology + process mining + AI agents).

---

## Phase Overview

| Phase | Theme | Duration | Key Outcome |
|---|---|---|---|
| **Phase 1** | Process Intelligence + Dashboard Power | 4–5 weeks | Process mining rivals Celonis; dashboards are usable |
| **Phase 2** | Natural Language Everything + Data In | 4–5 weeks | Ask questions in plain English; ingest any data |
| **Phase 3** | Advanced Analytics + Developer Platform | 4–5 weeks | OLAP, simulation, SDK, external integrations |
| **Phase 4** | Enterprise Scale + Polish | 3–4 weeks | Production-grade security, OCPM, mobile |

---

## Phase 1: Process Intelligence + Dashboard Power

**Theme:** Make the process map world-class and dashboards actually useful.
**Why first:** This is what demos sell. Right now the process map is functional but can't filter, can't drill into edges, and dashboards only have 5 widget types.

### 1.1 — Process Map Enhancements

| # | Feature | Description | Effort |
|---|---|---|---|
| 1.1.1 | **Frequency ↔ Performance toggle** | Toggle button on process map: "Frequency" (case count) vs "Performance" (median/avg throughput time). Performance view shows time on edges, frequency view shows counts. | 2d |
| 1.1.2 | **Edge click drill-down** | Click any edge → side panel shows: throughput time histogram, median/p50/p95 times, case count, % of total cases. Use Recharts BarChart for the histogram. | 3d |
| 1.1.3 | **Node click → filter options** | When clicking a node, show filter buttons: "With this activity", "Without this activity", "Starting with", "Ending with". Applies as a process-level filter. | 2d |
| 1.1.4 | **Date range filter** | Add a date range picker above the process map. Filters all process data to the selected time window. Passed as `start_date` / `end_date` query params. | 2d |
| 1.1.5 | **Attribute filters** | Dropdown filters for case attributes (e.g., `icu_admitted = true`, `outcome = Release A`). Requires passing filters to the process engine and joining with ontology records. | 3d |
| 1.1.6 | **Bottleneck analysis panel** | New "Bottlenecks" sub-view: table of slowest transitions ranked by p95 time. Backend endpoint already exists (`GET /process/bottlenecks`). | 1d |
| 1.1.7 | **Conformance overlay on map** | When a conformance model is active, highlight deviating edges in red on the process map. Show a small badge on nodes that are commonly skipped. | 2d |

**Backend work:**
- Add `start_date`, `end_date` query params to all process engine endpoints
- Add case attribute filter support (join events with ontology records)

### 1.2 — Dashboard Widget Expansion

| # | Feature | Description | Effort |
|---|---|---|---|
| 1.2.1 | **Line chart widget** | Time series visualization. X = datetime field (bucketed), Y = count/sum/avg. Multi-series support. | 2d |
| 1.2.2 | **Pie / donut chart widget** | Proportional data. Field = category, metric = count/sum. | 1d |
| 1.2.3 | **Area chart widget** | Stacked area for trends over time. | 1d |
| 1.2.4 | **Filter widget (dropdown)** | Configurable dropdown that filters all widgets on the dashboard by a field value. | 2d |
| 1.2.5 | **Date picker widget** | Date range selector that filters all widgets by a datetime field. | 2d |
| 1.2.6 | **Cross-widget filtering** | Click a bar in a bar chart → all other widgets on the page filter to that segment. Implemented via app-level variables/events. | 3d |
| 1.2.7 | **Stat / number widget** | Large single number with trend arrow (↑↓), comparison to previous period. | 1d |

**Architecture note:** Cross-widget filtering requires an app-level state/variable system. Each widget publishes filter state; other widgets subscribe. This is the foundation for Phase 2's more advanced apps.

### 1.3 — Process Mining — Variants & Cases Polish

| # | Feature | Description | Effort |
|---|---|---|---|
| 1.3.1 | **Variant throughput time histogram** | In the Variants tab, show a histogram of case durations for the selected variant. | 1d |
| 1.3.2 | **Case attribute columns** | Show ontology fields (age, outcome, icu_admitted) as columns in the Cases tab. Requires joining process data with ontology records. | 2d |
| 1.3.3 | **Case search / filter** | Text search by case ID + filters by duration, variant, rework status. | 1d |

**Phase 1 Total Estimate:** ~28 dev-days (~5-6 weeks)

---

## Phase 2: Natural Language Everything + Data Ingestion

**Theme:** Ask questions in plain English and get answers from process + ontology data. Make data ingestion frictionless.
**Why second:** NL querying is the #1 differentiator for Celonis (Process Copilot) and Palantir (AIP Threads). This is also where our Claude integration gives us a unique advantage.

### 2.1 — Process Copilot (Natural Language Process Querying)

| # | Feature | Description | Effort |
|---|---|---|---|
| 2.1.1 | **Process Copilot UI** | Chat panel in the Process Mining module. User types a question, gets an answer with auto-generated charts/tables. | 3d |
| 2.1.2 | **NL → Process Query engine** | Backend endpoint: takes a natural language question + object_type_id, uses Claude to generate the right API calls (stats, transitions, cases, variants), executes them, and returns structured answer + chart spec. | 5d |
| 2.1.3 | **NL → Process Map filter** | "Show me only cases that went through ICU" → applies filter to the process map. Claude translates the question to filter params. | 2d |
| 2.1.4 | **Follow-up questions** | Multi-turn conversation. Claude maintains context and suggests follow-up questions. | 2d |
| 2.1.5 | **Chart generation from NL** | "Show a bar chart of throughput time by outcome" → generates a chart spec that renders inline. | 3d |

### 2.2 — Enhanced Nexus Assistant

| # | Feature | Description | Effort |
|---|---|---|---|
| 2.2.1 | **Context-aware data exploration** | Assistant knows which page you're on and can query relevant data. On Ontology page → can explain object types. On Process Mining → can answer process questions. | 3d |
| 2.2.2 | **NL → Data Explorer query** | "Show me all patients over 70 who were admitted to ICU" → generates and runs a Data Explorer query, shows results inline. | 3d |
| 2.2.3 | **Export findings** | Export assistant conversation as PDF or share as a link. | 2d |

### 2.3 — Data Ingestion Expansion

| # | Feature | Description | Effort |
|---|---|---|---|
| 2.3.1 | **CSV / Excel file upload** | Upload a file → auto-detect schema → create object type → ingest records. Most requested connector type. | 3d |
| 2.3.2 | **Webhook listener (inbound)** | Accept POST requests at a Nexus endpoint → write to event log or object type. Enables real-time integrations. | 3d |
| 2.3.3 | **Connector templates** | Pre-configured connector templates for: PostgreSQL, MySQL, Salesforce, HubSpot, Google Sheets, Airtable, Stripe, Jira, GitHub, Slack. Template = pre-filled base URL, auth type, common endpoints. | 3d |
| 2.3.4 | **HTTP request block** (Logic Studio) | New block type: make arbitrary HTTP calls (GET/POST/PUT/DELETE) to external APIs. Enables webhook-out and external integrations. | 2d |

### 2.4 — Derived Properties

| # | Feature | Description | Effort |
|---|---|---|---|
| 2.4.1 | **Derived property definitions** | Define computed fields on object types using expressions (e.g., `episode_duration_hours / 24` → `episode_duration_days`). Computed on query, not stored. | 3d |
| 2.4.2 | **Expression builder UI** | Visual expression editor: pick fields, apply functions (SUM, AVG, IF, CONCAT, DATE_DIFF, etc.), preview result. | 3d |

**Phase 2 Total Estimate:** ~37 dev-days (~7-8 weeks solo, ~4-5 weeks with 2 devs)

---

## Phase 3: Advanced Analytics + Developer Platform

**Theme:** Deep analytics for power users and an SDK for developers building on top of Nexus.
**Why third:** These features unlock enterprise use cases but aren't blockers for initial adoption.

### 3.1 — Advanced Process Analytics

| # | Feature | Description | Effort |
|---|---|---|---|
| 3.1.1 | **OLAP / Pivot table** | In Data Explorer or Process Mining: pivot table with drag-and-drop dimensions, measures, and filters. Group by multiple fields, aggregate by count/sum/avg. | 5d |
| 3.1.2 | **Root cause analysis** | "Why are cases stuck?" → AI analyzes case attributes of stuck/slow cases vs normal cases, identifies correlating factors. | 3d |
| 3.1.3 | **Token replay animation** | Animate cases flowing through the process map over time. Play/pause controls, speed adjustment, day/hour grouping. | 4d |
| 3.1.4 | **Process simulation (basic)** | "What if we automate ER Triage?" → simulate removing/speeding up an activity and show projected impact on throughput time. | 5d |
| 3.1.5 | **BPMN import** | Import a BPMN 2.0 XML file as a conformance reference model. Parse activities and connections into the happy path editor. | 3d |

### 3.2 — Developer Platform (SDK + APIs)

| # | Feature | Description | Effort |
|---|---|---|---|
| 3.2.1 | **TypeScript SDK** | NPM package: `@nexus/sdk`. Read/write object types, query records, trigger pipelines, call agents. Auto-generated from OpenAPI spec. | 5d |
| 3.2.2 | **Python SDK** | PyPI package: `nexus-sdk`. Same capabilities as TS SDK. | 3d |
| 3.2.3 | **Public REST API documentation** | Auto-generated OpenAPI docs for all services. Hosted at `/docs` or `/api-docs`. | 2d |
| 3.2.4 | **Inbound webhook endpoints** | Register webhook URLs that trigger pipelines or logic functions when called. | 2d |
| 3.2.5 | **MCP Server** | Expose Nexus ontology and process data as MCP tools for external AI agents (Cursor, Claude Desktop, etc.). | 3d |

### 3.3 — Dashboard Enhancements

| # | Feature | Description | Effort |
|---|---|---|---|
| 3.3.1 | **Scatter plot widget** | X/Y axes with dot size/color dimensions. | 1d |
| 3.3.2 | **Pivot table widget** | Drag-and-drop multidimensional table. | 3d |
| 3.3.3 | **Embedded process map widget** | Show a mini process map inside a dashboard. Click through to full Process Mining. | 2d |
| 3.3.4 | **Dashboard PDF export** | "Export as PDF" button → renders all widgets to a downloadable document. | 2d |
| 3.3.5 | **Dashboard sharing / embedding** | Public URL for read-only dashboard view. Embeddable via iframe. | 2d |

### 3.4 — Pipeline Enhancements

| # | Feature | Description | Effort |
|---|---|---|---|
| 3.4.1 | **Incremental pipelines** | Track watermark (last processed timestamp/ID). Only process new/changed records on subsequent runs. | 4d |
| 3.4.2 | **Pipeline versioning** | Save pipeline versions. Roll back to a previous version. Diff view between versions. | 3d |
| 3.4.3 | **AI-assisted transforms** | "Convert this date field to ISO format" → AI generates the Map node configuration. | 2d |

**Phase 3 Total Estimate:** ~53 dev-days (~10-11 weeks solo, ~5-6 weeks with 2 devs)

---

## Phase 4: Enterprise Scale + Polish

**Theme:** Production-readiness, advanced security, and polish for enterprise deployment.
**Why last:** These are differentiators for enterprise sales but not needed for initial product-market fit.

### 4.1 — Object-Centric Process Mining

| # | Feature | Description | Effort |
|---|---|---|---|
| 4.1.1 | **Multi-object process map** | View interactions between multiple object types in a single process map (e.g., Patient + ClinicalEvent + LabResult). | 5d |
| 4.1.2 | **Object lifecycle view** | Track how a single object type moves through states over time. Separate from the cross-object process map. | 3d |

### 4.2 — Security & Governance

| # | Feature | Description | Effort |
|---|---|---|---|
| 4.2.1 | **Row-level access control** | Filter records based on user attributes (e.g., analyst can only see their region's data). | 3d |
| 4.2.2 | **Column-level access control** | Hide sensitive fields based on role (e.g., hide `diagnosis` from non-clinical users). | 2d |
| 4.2.3 | **Enhanced data lineage** | Full visual lineage graph: connector → pipeline → object type → derived property → dashboard widget. | 3d |
| 4.2.4 | **Audit log export** | Export audit logs as CSV/JSON for compliance reporting. | 1d |

### 4.3 — Collaboration & Sharing

| # | Feature | Description | Effort |
|---|---|---|---|
| 4.3.1 | **Shareable reports** | Create a report from any view (process map, data explorer, dashboard) → generates a shareable link or PDF. | 3d |
| 4.3.2 | **@mentions in comments** | Tag users in comments → notification sent. | 1d |
| 4.3.3 | **Notification center** | In-app notifications for: pipeline completed, action pending, alert triggered, comment reply. | 2d |

### 4.4 — Platform Polish

| # | Feature | Description | Effort |
|---|---|---|---|
| 4.4.1 | **Onboarding wizard** | First-time user experience: create connector → define ontology → run pipeline → see data. Guided steps. | 3d |
| 4.4.2 | **Performance optimization** | Profile and optimize slow queries. Add caching for process mining aggregations. Lazy load large datasets. | 3d |
| 4.4.3 | **Mobile-responsive dashboard view** | Dashboard apps render cleanly on tablet/phone screens. | 2d |
| 4.4.4 | **i18n completion** | Complete Spanish translation. Add Portuguese, French. | 2d |

**Phase 4 Total Estimate:** ~33 dev-days (~6-7 weeks solo, ~3-4 weeks with 2 devs)

---

## Full Roadmap Timeline

```
Phase 1: Process Intelligence + Dashboards     ██████████████████  4-5 weeks
Phase 2: NL Querying + Data Ingestion          ██████████████████████  4-5 weeks
Phase 3: Advanced Analytics + SDK              ██████████████████████████  5-6 weeks
Phase 4: Enterprise Scale + Polish             ████████████████  3-4 weeks
                                               ─────────────────────────────────
                                               Total: ~16-20 weeks (4-5 months)
                                               With 2 devs: ~10-12 weeks (2.5-3 months)
```

---

## Quick Wins (Can Ship This Week)

These are low-effort, high-impact items that can be done immediately:

| # | Feature | Effort | Impact |
|---|---|---|---|
| Q1 | Frequency ↔ Performance toggle on process map | 2d | High — basic expectation |
| Q2 | Line chart widget for dashboards | 2d | High — most requested chart type |
| Q3 | Pie chart widget for dashboards | 1d | High — basic expectation |
| Q4 | Bottleneck analysis panel (backend exists) | 1d | Medium — surfaces existing data |
| Q5 | Date range filter for process mining | 2d | High — basic expectation |

---

## Decision Log

| Decision | Rationale |
|---|---|
| NL querying in Phase 2 (not Phase 1) | Process map fundamentals must work first; NL querying on broken data is useless |
| SDK in Phase 3 (not earlier) | No external developers yet; internal API is sufficient |
| OCPM in Phase 4 | Complex, requires multi-object event model; current single-object model covers 80% of use cases |
| No PQL equivalent planned | We use Claude instead of a query language — NL is more accessible |
| No task mining planned | Desktop recording is invasive and niche; not aligned with our market |
| Process simulation is basic | Full digital twin (Celonis-level) requires 6+ months; basic "what-if" is sufficient |

---

## Success Metrics Per Phase

| Phase | Ship Criteria |
|---|---|
| **Phase 1** | Demo a sepsis process map with date filters, edge drill-down, frequency/performance toggle. Show a dashboard with 8+ widget types and cross-filtering. |
| **Phase 2** | Ask "What percentage of patients go to ICU?" in the Process Copilot and get a correct answer with a chart. Upload a CSV and see it in the ontology in < 2 minutes. |
| **Phase 3** | External developer builds an app using the TypeScript SDK. Process simulation shows "automating ER Triage saves 2 hours avg throughput time." |
| **Phase 4** | MJSP analyst restricted to their jurisdiction's data. Dashboard loads on iPad. Onboarding wizard creates a working pipeline in < 5 minutes. |
