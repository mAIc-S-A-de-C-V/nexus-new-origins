# Nexus vs Celonis vs Palantir — Deep Competitive Analysis

**Date:** April 15, 2026
**Version:** 2.0
**Purpose:** Granular, feature-by-feature comparison across every capability area. Each row represents a discrete, shippable feature — not a category summary.

---

## How to Read This Document

- **Celonis** — Market leader in process mining, execution management, and object-centric process intelligence
- **Palantir Foundry** — Market leader in ontology-driven operational intelligence, AI platform, and defense/government deployments
- **Nexus** — Our platform combining process mining + ontology + AI agents + workflow automation

**Legend:**
- FULL — Production-grade, feature-complete implementation
- PARTIAL — Exists but limited in scope, depth, or polish
- MISSING — Not implemented
- N/A — Outside the platform's design scope
- ADVANTAGE — Nexus leads both competitors here

**Gap Severity:**
- CRITICAL — Blocks sales, demos, or core workflows. Must fix.
- HIGH — Noticeable gap that erodes credibility in competitive evaluations
- MEDIUM — Would be nice, not a deal-breaker
- LOW — Advanced/niche, build when needed

---

## TABLE OF CONTENTS

1. [Ontology / Data Model](#1-ontology--data-model)
2. [Object Records & Live Data](#2-object-records--live-data)
3. [Process Mining — Process Map](#3-process-mining--process-map)
4. [Process Mining — Analytics & Exploration](#4-process-mining--analytics--exploration)
5. [Process Mining — Object-Centric (OCPM)](#5-process-mining--object-centric-ocpm)
6. [Process Mining — Simulation & Digital Twin](#6-process-mining--simulation--digital-twin)
7. [Process Mining — Task Mining](#7-process-mining--task-mining)
8. [Natural Language / AI Querying](#8-natural-language--ai-querying)
9. [AI Agents & LLM Framework](#9-ai-agents--llm-framework)
10. [AI Evaluation & Observability](#10-ai-evaluation--observability)
11. [Pipeline / Data Transforms](#11-pipeline--data-transforms)
12. [Code Repositories & Developer IDE](#12-code-repositories--developer-ide)
13. [Dashboards / App Builder](#13-dashboards--app-builder)
14. [Workflow / Logic Automation](#14-workflow--logic-automation)
15. [Actions (Governed Write-Back)](#15-actions-governed-write-back)
16. [Data Integration / Connectors](#16-data-integration--connectors)
17. [Search & Discovery](#17-search--discovery)
18. [Notebooks & Analysis Tools](#18-notebooks--analysis-tools)
19. [Collaboration & Documents](#19-collaboration--documents)
20. [Security & Governance](#20-security--governance)
21. [Value Tracking & ROI](#21-value-tracking--roi)
22. [Developer Experience / SDK](#22-developer-experience--sdk)
23. [Deployment Infrastructure](#23-deployment-infrastructure)
24. [Marketplace & Ecosystem](#24-marketplace--ecosystem)
25. [Gap Summary & Priority Matrix](#25-gap-summary--priority-matrix)
26. [Nexus Competitive Advantages](#26-nexus-competitive-advantages)

---

## 1. ONTOLOGY / DATA MODEL

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 1.1 | Object Types (define entities) | PARTIAL — Data models in OCDM, object/event types | FULL — Object types with primary key, title key, backing datasets | FULL — Object types with properties, display names | — |
| 1.2 | Properties: basic types (string, int, bool, date) | FULL | FULL — String, Boolean, Byte, Short, Integer, Long, Float, Double, Decimal, Date, Timestamp | FULL — text, int, decimal, bool, datetime | — |
| 1.3 | Properties: structs (nested typed fields) | MISSING | FULL — Schema-based struct properties with typed sub-fields | MISSING | **MEDIUM** |
| 1.4 | Properties: vectors (embeddings) | MISSING | FULL — Vector base type for semantic search | MISSING | **HIGH** |
| 1.5 | Properties: time series | MISSING | FULL — FoundryTS engine, dedicated time series database | MISSING | **MEDIUM** |
| 1.6 | Properties: geopoint / geoshape | MISSING | FULL — Geopoint (lat/lng) + Geoshape (polygons, lines) | MISSING | **LOW** |
| 1.7 | Properties: cipher text (encrypted) | MISSING | FULL — String values encoded with Cipher encryption | MISSING | **LOW** |
| 1.8 | Properties: media reference / attachments | MISSING | FULL — Media sets, file attachments on objects | MISSING | **LOW** |
| 1.9 | Properties: arrays of base types | MISSING | FULL — All types except Vector and TimeSeries | MISSING | **MEDIUM** |
| 1.10 | Shared properties (reusable across types) | MISSING | FULL — Consistent modeling across object types | MISSING | **LOW** |
| 1.11 | Required / edit-only properties | MISSING | FULL — Required fields + edit-only (action-gated) | MISSING | **MEDIUM** |
| 1.12 | Derived / computed properties | PARTIAL — PQL formulas at runtime | FULL — Function-backed, computed at query time | MISSING | **HIGH** |
| 1.13 | Property reducers (conflict resolution) | MISSING | FULL — Rules for resolving conflicting values | MISSING | **LOW** |
| 1.14 | Conditional formatting on properties | MISSING | FULL — Dynamic presentation rules | MISSING | **LOW** |
| 1.15 | Prominent properties (enhanced display) | MISSING | FULL — Media renders in viewer, geo on maps, TS as charts | MISSING | **LOW** |
| 1.16 | Link types (relationships) | PARTIAL — Table joins, OCDM relationships | FULL — One-to-one, one-to-many, many-to-many, traversable | FULL — Links with cardinality (has_many, belongs_to, has_one, many_to_many) | — |
| 1.17 | Link traversal in code/queries | PARTIAL — PQL joins | FULL — Functions, OSDK, Workshop all traverse links | PARTIAL — Graph explorer visualizes, no runtime traversal API | **HIGH** |
| 1.18 | Interfaces / polymorphism | MISSING | FULL — Interfaces with inheritance, actions on interfaces | MISSING | **MEDIUM** |
| 1.19 | Schema versioning | MISSING | FULL — Full versioning | FULL — Version history + diff + rollback | — |
| 1.20 | Schema diff comparison | MISSING | PARTIAL | FULL — Breaking change detection between versions | **ADVANTAGE** |
| 1.21 | Correlation / schema discovery | MISSING | MISSING | FULL — Automatic relationship inference with confidence scores | **ADVANTAGE** |
| 1.22 | PII scanning | MISSING | FULL — Sensitive Data Scanner (datasets + media sets) | FULL — PII level classification per property (NONE/LOW/MEDIUM/HIGH) | — |
| 1.23 | AI-powered schema inference | MISSING | MISSING | FULL — Claude-based semantic type detection, field naming, similarity scoring | **ADVANTAGE** |
| 1.24 | Schema enrichment from connectors | MISSING | PARTIAL — Pipeline-backed | FULL — Enrichment proposals with source tracking, conflict detection | **ADVANTAGE** |
| 1.25 | Source pipeline binding (authoritative source lock) | N/A | FULL — Datasets back object types | FULL — Lock pipeline as authoritative source | — |
| 1.26 | Object sets (filtered collections) | PARTIAL — OCDM filters | FULL — First-class primitive, used everywhere | MISSING | **HIGH** |

---

## 2. OBJECT RECORDS & LIVE DATA

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 2.1 | Live object record store (queryable instances) | FULL — OCDM objects with attributes | FULL — Object types backed by indexed datasets, live updates | MISSING — Object types are schema-only, no record store | **CRITICAL** |
| 2.2 | Records auto-update when pipeline runs | FULL — Extraction triggers updates | FULL — Pipeline output → object index, automatic | MISSING | **CRITICAL** |
| 2.3 | Query records by property filters | FULL — PQL queries | FULL — Object set filters, OSDK queries | MISSING — No records to query | **CRITICAL** |
| 2.4 | Record detail view (auto-generated) | PARTIAL | FULL — Object Views (GA Feb 2026): key data, links, metrics, actions, timeline | MISSING | **HIGH** |
| 2.5 | Inline editing of record properties | MISSING | FULL — Inline edits via Actions in Workshop/Notepad | MISSING | **HIGH** |
| 2.6 | Record change history / CDC | FULL — OCDM changes table (timestamp, old/new value) | FULL — Append-only audit, action history | MISSING | **HIGH** |
| 2.7 | Write-to-Ontology pipeline step | FULL — Transformation → OCDM objects | FULL — Pipeline output → object type | MISSING | **CRITICAL** |
| 2.8 | Bulk record operations | PARTIAL | FULL — Batched actions, bulk edits | MISSING | **MEDIUM** |

---

## 3. PROCESS MINING — PROCESS MAP

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 3.1 | Process map visualization | FULL — Directed graph, activity nodes, connection edges | PARTIAL — Machinery (basic) | FULL — Dagre layout, entry/exit marker nodes | — |
| 3.2 | Frequency view (case count on edges) | FULL — Case frequency + activity frequency toggles | N/A | FULL — Edge thickness proportional to frequency | — |
| 3.3 | Performance view toggle | FULL — Switch between frequency/throughput time (median, avg, trimmed mean) | N/A | PARTIAL — Shows avg hours only, no toggle | **HIGH** |
| 3.4 | KPI display on map (custom KPI groups) | FULL — Custom KPI groups on process graph (2025) | N/A | MISSING | **HIGH** |
| 3.5 | Click-to-filter: "with this connection" | FULL — Show only variants containing selected connection | N/A | MISSING — Click only highlights inflow/outflow | **HIGH** |
| 3.6 | Click-to-filter: "without this connection" | FULL — Show only variants NOT containing selected connection | N/A | MISSING | **HIGH** |
| 3.7 | Click-to-filter: starting/ending at activity | FULL — 4 filter types per node | N/A | MISSING | **HIGH** |
| 3.8 | Connection drill-down (throughput time histogram per edge) | FULL — Click edge, see time distribution histogram, drag to filter | N/A | MISSING | **HIGH** |
| 3.9 | Throughput time filtering (drag time range) | FULL — Click-and-drag on histogram to filter cases by duration | N/A | MISSING | **HIGH** |
| 3.10 | Process map date range filter | FULL — Full date picker + attribute filters | N/A | FULL — Date range + attribute filters in collapsible filter bar | — |
| 3.11 | Token replay animation | FULL — Animate cases flowing through process map | N/A | MISSING | **MEDIUM** |
| 3.12 | Conformance overlay on map | FULL — BPMN deviation overlay directly on process map | N/A | MISSING — Conformance is a separate tab | **MEDIUM** |
| 3.13 | BPMN reference model import | FULL — BPMN 2.0 import, model repair (Feb 2026) | N/A | MISSING — Manual happy path definition only | **MEDIUM** |
| 3.14 | Adherence Explorer (deviation analysis view) | FULL — New view (Mar 2026), integrates with charts/tables | N/A | MISSING | **MEDIUM** |
| 3.15 | Back-edge / cycle detection | MISSING | N/A | FULL — DFS-based detection, dashed lines for rework loops | **ADVANTAGE** |
| 3.16 | Focus mode (path isolation on double-click) | MISSING | N/A | FULL — BFS reachability, isolate selected path | **ADVANTAGE** |
| 3.17 | Edge speed indicators (fast/normal/slow) | MISSING | N/A | FULL — Color-coded edges by transition speed | **ADVANTAGE** |
| 3.18 | Entry/exit marker nodes | MISSING | N/A | FULL — Visual START/END markers | **ADVANTAGE** |

---

## 4. PROCESS MINING — ANALYTICS & EXPLORATION

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 4.1 | Variant explorer (distinct case flows) | FULL — Histogram + browser, drag-and-drop variant selection | N/A | FULL — Ranked list with activity chips, frequency bars, drill-down | — |
| 4.2 | Case explorer / browser | FULL — Full case lifecycle with filters | N/A | FULL — Case list with timeline view, variant filtering | — |
| 4.3 | Case timeline (event-level detail) | FULL — Time-stamped activity history | N/A | FULL — Event timeline per case | — |
| 4.4 | Conformance checking | FULL — BPMN-based, deviation drill-down, allowlisting (Feb 2025) | N/A | PARTIAL — Happy path model, score, deviation list. No BPMN, no allowlisting | **MEDIUM** |
| 4.5 | Deviation allowlisting | FULL — Mark acceptable deviations, exclude from conformance rate | N/A | MISSING | **MEDIUM** |
| 4.6 | Bottleneck analysis | FULL — Performance view highlights slow transitions | N/A | FULL — Bottleneck endpoint + BottleneckPanel UI | — |
| 4.7 | Throughput time histogram per transition | FULL — Click any edge, see distribution | N/A | MISSING | **HIGH** |
| 4.8 | OLAP / Pivot tables | FULL — Full multidimensional PQL-powered | N/A | MISSING | **HIGH** |
| 4.9 | Benchmark / segment comparison | PARTIAL — Via custom Views | N/A | FULL — Side-by-side segment comparison with auto-populated attribute values | **ADVANTAGE** |
| 4.10 | Overview dashboard (monthly trends, distributions) | PARTIAL — Via custom Views | N/A | FULL — Combo chart, donut, resource table, KPI banner | **ADVANTAGE** |
| 4.11 | AI chatbot on process data | PARTIAL — Process Copilot (separate) | N/A | FULL — Embedded chatbot with widget creation, markdown rendering | **ADVANTAGE** |
| 4.12 | Root cause analysis (AI-powered) | FULL — Identifies contributing factors automatically | N/A | MISSING | **HIGH** |
| 4.13 | Social network analysis (resource handoffs) | FULL — Resource view showing collaboration patterns | N/A | MISSING | **LOW** |
| 4.14 | Insight Explorer (AI-powered opportunity detection) | FULL — Ranked insights by impact, filterable (Jan 2026) | N/A | MISSING | **MEDIUM** |
| 4.15 | PQL (Process Query Language, 150+ operators) | FULL — SQL-like, process-specific functions, SOURCE/TARGET | N/A | MISSING | **MEDIUM** |
| 4.16 | Knowledge Model (reusable KPIs, filters, variables) | FULL — Central store for business definitions | N/A | MISSING | **MEDIUM** |
| 4.17 | Alert rules (stuck case, slow transition, rework, volume anomaly) | FULL — Via Action Flows | N/A | FULL — 4 rule types, cooldown, alert engine | — |
| 4.18 | Event config (activity field mapping, excluded activities) | PARTIAL | N/A | FULL — AI-powered activity classification, field remapping, exclusion | **ADVANTAGE** |
| 4.19 | Event quality scoring | MISSING | N/A | FULL — Completeness, timeliness, consistency, accuracy | **ADVANTAGE** |

---

## 5. PROCESS MINING — OBJECT-CENTRIC (OCPM)

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 5.1 | Multi-object event logs (event linked to multiple objects) | FULL — OCDM: events linked to multiple object types simultaneously | N/A | MISSING — Single object type per process | **MEDIUM** |
| 5.2 | Object-centric data model (5 components: objects, events, changes, relationships, attributes) | FULL — PI Graph, prebuilt + custom types | N/A | MISSING | **MEDIUM** |
| 5.3 | Cross-object process analysis (order + invoice + delivery) | FULL — Eliminates convergence/divergence problems | N/A | MISSING | **MEDIUM** |
| 5.4 | Performance Spectrum | FULL — OCPM-specific visualization | N/A | MISSING | **LOW** |
| 5.5 | Instance Explorer | FULL — Deep dive into individual object instances across processes | N/A | MISSING | **LOW** |

---

## 6. PROCESS MINING — SIMULATION & DIGITAL TWIN

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 6.1 | Digital twin extraction from process data | FULL — Arrival rates, resource dynamics, activity metadata, branching logic | N/A | MISSING | **LOW** |
| 6.2 | Scenario simulation (what-if) | FULL — Adjust automation rate, processing times, resources, arrival patterns | N/A | MISSING | **LOW** |
| 6.3 | Scenario comparison dashboard | FULL — Multiple scenarios vs baseline, KPI comparison | N/A | MISSING | **LOW** |
| 6.4 | Automation rate simulation | FULL — Define % automated vs manual, see impact | N/A | MISSING | **LOW** |

---

## 7. PROCESS MINING — TASK MINING

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 7.1 | Desktop task mining client | FULL — Background capture of clicks, copy/paste, app usage | N/A | MISSING | **LOW** |
| 7.2 | Screenshot capture + OCR | FULL — Optical character recognition on screen captures | N/A | MISSING | **LOW** |
| 7.3 | Click/scroll data in process data model | FULL — Integrates with main process mining | N/A | MISSING | **LOW** |
| 7.4 | Privacy controls (redaction, pseudonymization, allowlisting) | FULL — Full privacy by design | N/A | MISSING | **LOW** |

---

## 8. NATURAL LANGUAGE / AI QUERYING

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 8.1 | NL → process query (ask about processes in plain English) | FULL — Process Copilot GA (May 2025), Knowledge Model-backed | N/A | PARTIAL — Overview chatbot can answer process questions | **HIGH** |
| 8.2 | NL → chart/table generation | FULL — Auto-generate visualizations from questions | FULL — AIP Analyst generates charts | PARTIAL — Chatbot proposes widget JSON, user clicks to add | **MEDIUM** |
| 8.3 | NL → process map filter | FULL — Filter map from natural language question | N/A | MISSING | **HIGH** |
| 8.4 | Conversational follow-up questions | FULL — Context-aware follow-ups, recommendations | FULL — AIP Threads, multi-turn | PARTIAL — Multi-turn chat exists but no context chaining to process queries | **MEDIUM** |
| 8.5 | AI-generated insights / recommendations | FULL — Annotation Builder, Insight Explorer | FULL — AIP Logic recommendations | PARTIAL — AI Analyze classifies activities only | **HIGH** |
| 8.6 | NL in Slack / Teams | FULL — Process Copilot in Slack + Teams | FULL — Via integrations | MISSING | **LOW** |
| 8.7 | Export findings (CSV, PNG, PDF, email) | FULL — Email from Copilot | FULL — Notepad PDF export | MISSING | **MEDIUM** |

---

## 9. AI AGENTS & LLM FRAMEWORK

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 9.1 | Agent builder UI | PARTIAL — AgentC (partner-focused, API-based) | FULL — Agent Studio: 4-tier agent model (ad-hoc → automated) | FULL — Agent Studio with system prompt, tool config, test runs | — |
| 9.2 | Agent tools: read ontology data | PARTIAL — Process Intelligence API | FULL — Query Objects, traverse links, custom retrieval functions | FULL — list_object_types, get_object_schema, query_records, count_records | — |
| 9.3 | Agent tools: write data / execute actions | PARTIAL — Action Flows | FULL — Action tool (auto/confirm modes), Apply Action block | FULL — action_propose (human confirmation gate) | — |
| 9.4 | Agent tools: call sub-agents | MISSING | FULL — Agents-as-functions (Tier 4) | FULL — agent_call tool | — |
| 9.5 | Agent tools: process mining | MISSING | MISSING | FULL — process_mining tool for querying process data | **ADVANTAGE** |
| 9.6 | Agent tools: run logic/functions | MISSING | FULL — Execute Function block in Logic | FULL — logic_function_run tool | — |
| 9.7 | Agent tools: run utilities | MISSING | PARTIAL — Compute Modules | FULL — utility_list + utility_run tools | — |
| 9.8 | Multi-model support | MISSING | FULL — GPT-5.x, Claude 4.x, Gemini 3.x, Grok 4.x, Nemotron | PARTIAL — Claude models only (Haiku/Sonnet/Opus) | **HIGH** |
| 9.9 | Model catalog / provider registry | MISSING | FULL — Full catalog with ZDR option | MISSING — Hardcoded Claude | **HIGH** |
| 9.10 | Agent knowledge scoping (per object type) | MISSING | FULL — Object-backed, document-backed, function-backed context | FULL — Scoped to object types with filters | — |
| 9.11 | Agent version history + rollback | MISSING | PARTIAL | FULL — Version snapshots with restore | **ADVANTAGE** |
| 9.12 | Agent analytics (run metrics, tool usage, error tracking) | MISSING | FULL — AIP Observability | FULL — Run metrics, tool frequency, per-day trends, errors | — |
| 9.13 | Agent threads (multi-turn conversations) | MISSING | FULL — AIP Threads | FULL — Thread management, message persistence | — |
| 9.14 | Agent embedding in apps (widget) | MISSING | FULL — AIP Agent widget in Workshop | MISSING | **HIGH** |
| 9.15 | Custom retrieval functions (pro-code RAG) | MISSING | FULL — Sept 2025 feature | MISSING | **HIGH** |
| 9.16 | Autonomous scheduled agents | MISSING | FULL — AIP Automate: time + data triggers | FULL — Cron-scheduled execution | — |
| 9.17 | MCP server (Model Context Protocol) | FULL — Industry's first MCP for process intelligence (Nov 2025) | FULL — Palantir MCP (70+ tools) + Ontology MCP (Jan 2026) | MISSING | **MEDIUM** |
| 9.18 | Agent marketplace / distribution | MISSING | FULL — Marketplace distribution | MISSING | **LOW** |

---

## 10. AI EVALUATION & OBSERVABILITY

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 10.1 | Evaluation suite builder | MISSING | FULL — AIP Evals: auto-generate test cases, 19 built-in evaluators | FULL — Eval suites with 5 evaluator types | — |
| 10.2 | Evaluator types: exact match, regex, keyword | MISSING | FULL — 19 types: exact, regex, range, Levenshtein, keyword, LLM-as-judge | FULL — exact_match, json_schema_match, rouge_score, contains_key_details, custom_expression | — |
| 10.3 | Auto-generated test cases | MISSING | FULL — Sept 2025 beta | MISSING | **MEDIUM** |
| 10.4 | Evaluate intermediate blocks in workflows | MISSING | FULL — Feb 2025 | MISSING | **LOW** |
| 10.5 | AI observability (token usage, tracing, logging) | MISSING | FULL — AIP Observability dashboard | MISSING | **MEDIUM** |
| 10.6 | LLM-as-judge evaluator | MISSING | FULL — Apr 2026 | MISSING | **LOW** |

---

## 11. PIPELINE / DATA TRANSFORMS

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 11.1 | Visual DAG pipeline builder | PARTIAL — Action Flows (automation-focused) | FULL — Pipeline Builder: point-and-click, outputs to datasets/ontology | FULL — Node-based editor with drag-and-drop | — |
| 11.2 | Node types: source | FULL — Extraction from connectors | FULL | FULL — SOURCE node | — |
| 11.3 | Node types: filter | PARTIAL | FULL | FULL — FILTER node | — |
| 11.4 | Node types: map / transform | PARTIAL | FULL — 90+ transform functions | FULL — MAP + CAST nodes | — |
| 11.5 | Node types: enrich (external lookup) | MISSING | FULL — Enrich board in Contour | FULL — ENRICH node | — |
| 11.6 | Node types: flatten nested arrays | MISSING | FULL — Flatten Struct | FULL — FLATTEN node | — |
| 11.7 | Node types: deduplicate | MISSING | FULL — Drop/Keep Duplicates, Time Bounded Dedup | FULL — DEDUPE node | — |
| 11.8 | Node types: validate | PARTIAL | FULL — Data health checks, expectations | FULL — VALIDATE node | — |
| 11.9 | Node types: write to ontology | FULL — Transformation → OCDM | FULL — Pipeline output → object type | FULL — SINK_OBJECT node | — |
| 11.10 | Node types: write to event log | PARTIAL | PARTIAL | FULL — SINK_EVENT node (for process mining) | **ADVANTAGE** |
| 11.11 | Node types: run agent | MISSING | PARTIAL — Via functions | FULL — AGENT_RUN node | **ADVANTAGE** |
| 11.12 | Incremental / CDC pipelines | FULL — Real-time extraction, Replication Cockpit | FULL — Incremental transforms, watermark-based | MISSING | **HIGH** |
| 11.13 | Streaming pipelines (real-time) | FULL — Kafka connector | FULL — Apache Flink-based streaming | MISSING | **MEDIUM** |
| 11.14 | Batch pipeline execution | FULL | FULL | FULL — Manual + cron trigger | — |
| 11.15 | Pipeline scheduling (cron) | FULL | FULL — Rich scheduling | FULL — Cron-based schedules | — |
| 11.16 | Pipeline run history / audit trail | FULL | FULL | FULL — Per-node audit logs, run history | — |
| 11.17 | Pipeline versioning | PARTIAL | FULL — Git-backed with branching | PARTIAL — Status tracking, no versioning | **MEDIUM** |
| 11.18 | Data quality checks in pipeline | PARTIAL | FULL — Health checks, expectations, data quality frameworks | PARTIAL — VALIDATE node exists | **MEDIUM** |
| 11.19 | AI-assisted pipeline creation | MISSING | FULL — Pipeline Assist (NL to transforms) | MISSING | **MEDIUM** |
| 11.20 | Joins (inner, left, right, outer, anti, semi, cross) | PARTIAL — SQL transforms | FULL — 12+ join types + 9 geospatial joins | MISSING | **HIGH** |
| 11.21 | Pivot / unpivot | PARTIAL — SQL | FULL — Pivot, Unpivot, Rollup | MISSING | **MEDIUM** |
| 11.22 | File parsing (CSV, Excel, JSON, XML, Shapefile) | FULL — File upload in extraction | FULL — 10 file parsing transforms | MISSING | **HIGH** |
| 11.23 | ML transforms (clustering, pattern mining) | FULL — ML Workbench | FULL — K-means, Frequent Pattern Growth, no-code ML inference (Apr 2026) | MISSING | **LOW** |
| 11.24 | Faster pipelines (Rust/DataFusion engine) | N/A | FULL — GA Dec 2025, substantially faster than Spark | N/A | — |
| 11.25 | Managed compute profiles (auto-scaling) | N/A | FULL — Apr 2026, auto-scales based on usage patterns | MISSING | **LOW** |

---

## 12. CODE REPOSITORIES & DEVELOPER IDE

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 12.1 | Web-based code IDE | FULL — ML Workbench (JupyterLab) | FULL — Code Repositories: Python, SQL, Java, TypeScript, Mesa | MISSING | **MEDIUM** |
| 12.2 | Git-backed code versioning | MISSING | FULL — Full Git: branching, committing, tagging via web UI | MISSING | **MEDIUM** |
| 12.3 | Code review / pull requests | MISSING | FULL — PR workflow, configurable approvals | MISSING | **LOW** |
| 12.4 | CI/CD for code transforms | MISSING | FULL — ci/foundry-publish, code scanning (Sept 2025) | MISSING | **LOW** |
| 12.5 | Custom Python transforms (PySpark, Pandas, Polars) | FULL — PyCelonis in ML Workbench | FULL — Lightweight Python Transforms (up to 200M rows/50GB) | MISSING | **MEDIUM** |
| 12.6 | Custom SQL transforms | FULL — Vertica SQL in Transformation Center | FULL — SQL code repos | MISSING | **MEDIUM** |
| 12.7 | Compute Modules (run any Docker container) | MISSING | FULL — GA Feb 2026, dynamic scaling | MISSING | **LOW** |
| 12.8 | VS Code integration | MISSING | FULL — Palantir VS Code extension | MISSING | **LOW** |
| 12.9 | Foundry Branching (cross-app branch testing) | MISSING | FULL — GA Apr 2025, unified branching across apps | MISSING | **LOW** |

---

## 13. DASHBOARDS / APP BUILDER

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 13.1 | Visual drag-and-drop app builder | FULL — Studio (grid-based editor) | FULL — Workshop (60+ widgets, drag-resize) | FULL — App Editor with react-grid-layout | — |
| 13.2 | AI-generated dashboards from NL prompt | MISSING | MISSING | FULL — Claude generates full app definitions from description | **ADVANTAGE** |
| 13.3 | Widget: KPI / metric card | FULL — KPI Card, KPI List, KPI Meter | FULL — Metric Card | FULL — metric-card, kpi-banner, stat-card | — |
| 13.4 | Widget: data table | FULL — OLAP Table | FULL — Object Table (sortable, filterable) | FULL — data-table | — |
| 13.5 | Widget: bar chart | FULL | FULL — XY Chart (bar mode) | FULL — bar-chart | — |
| 13.6 | Widget: line chart | FULL | FULL — XY Chart (line mode) | FULL — line-chart | — |
| 13.7 | Widget: pie / donut chart | FULL | FULL — Pie Chart | FULL — pie-chart | — |
| 13.8 | Widget: area chart | FULL | FULL — XY Chart (area mode) | FULL — area-chart | — |
| 13.9 | Widget: scatter plot | FULL — Point chart | FULL — XY Chart (scatter mode) | MISSING | **MEDIUM** |
| 13.10 | Widget: waterfall chart | MISSING | FULL — Waterfall Chart | MISSING | **LOW** |
| 13.11 | Widget: Gantt chart | MISSING | FULL — Gantt Chart | MISSING | **LOW** |
| 13.12 | Widget: timeline | MISSING | FULL — Timeline widget | MISSING | **LOW** |
| 13.13 | Widget: Sankey diagram | FULL — 2025 | MISSING | MISSING | **LOW** |
| 13.14 | Widget: lollipop chart | FULL | MISSING | MISSING | **LOW** |
| 13.15 | Widget: pivot table | FULL — OLAP | FULL — Pivot Table (stacked/outlined/banded) | MISSING | **HIGH** |
| 13.16 | Widget: map / geospatial | FULL — World map | FULL — Map with layers, heatmap | PARTIAL — map widget exists (lat/lng fields) | **MEDIUM** |
| 13.17 | Widget: Vega/Vega-Lite (custom grammar) | MISSING | FULL — Full Vega/Vega-Lite spec | MISSING | **LOW** |
| 13.18 | Widget: markdown / text block | PARTIAL | FULL — Markdown widget | FULL — text-block | — |
| 13.19 | Widget: iframe (embed external) | MISSING | FULL — Iframe widget | MISSING | **LOW** |
| 13.20 | Widget: date picker filter | FULL — Date range filters | FULL — Date and Time Picker, Date Input | FULL — date-picker | — |
| 13.21 | Widget: dropdown / string selector filter | FULL — Dropdown filters | FULL — Object Dropdown, String Selector | MISSING — No standalone filter widget | **CRITICAL** |
| 13.22 | Widget: filter bar (collapsible panel) | FULL — Filter bar component | FULL — Filter List with histograms | PARTIAL — filter-bar widget exists | **MEDIUM** |
| 13.23 | Widget: chat / AI assistant | MISSING | FULL — AIP Analyst widget, AIP Agent widget | FULL — chat-widget | — |
| 13.24 | Widget: custom code (HTML/CSS/JS) | MISSING | FULL — Custom Widget SDK (TypeScript/React) | FULL — custom-code widget | — |
| 13.25 | Widget: form (input → action) | MISSING | FULL — Form via action parameters, inline edits | MISSING | **HIGH** |
| 13.26 | Widget: media preview (images, PDF) | MISSING | FULL — Media Preview, PDF Viewer, Image Annotation | MISSING | **LOW** |
| 13.27 | Widget: object list / object set display | MISSING | FULL — Object List (list or grid mode), Object Set Title | MISSING | **HIGH** |
| 13.28 | Widget: status tracker / stepper | MISSING | FULL — Status Tracker, Stepper | MISSING | **LOW** |
| 13.29 | Widget: utility output | N/A | N/A | FULL — utility-output widget | **ADVANTAGE** |
| 13.30 | Cross-widget filtering (click chart → filter table) | FULL — Component interactions | FULL — Events + variables, bidirectional | MISSING | **CRITICAL** |
| 13.31 | Variables / state management | PARTIAL — PQL variables | FULL — Typed variables: string, boolean, timestamp, object set, struct, geo | MISSING | **CRITICAL** |
| 13.32 | Event wiring (widget interaction → update variable → action) | PARTIAL | FULL — Layout events, widget events, action triggers | MISSING | **CRITICAL** |
| 13.33 | Action wiring (form submit → execute action → write to ontology) | PARTIAL — Via Action Flows | FULL — Direct form → Action Type → Ontology write | MISSING | **CRITICAL** |
| 13.34 | Responsive layout / sections / tabs / overlays | PARTIAL | FULL — Sections, tabs, pages, overlays, collapsible | PARTIAL — Grid layout only, no sections/tabs | **MEDIUM** |
| 13.35 | Export dashboard as PDF | FULL | FULL — Via Notepad integration | MISSING | **MEDIUM** |
| 13.36 | Aggregation options (count, sum, avg, max, min) | FULL — PQL-powered | FULL — Function-backed aggregations | FULL — Per-widget aggregation config | — |
| 13.37 | Presentation / full-screen mode | FULL | FULL — Presentation mode | MISSING | **LOW** |

---

## 14. WORKFLOW / LOGIC AUTOMATION

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 14.1 | Visual workflow / logic builder | FULL — Action Flows (Make.com-style) | FULL — AIP Logic (block-based) | FULL — Logic Studio (block-based) | — |
| 14.2 | Conditional logic (if/else) | FULL | FULL — Conditional Block | FULL | — |
| 14.3 | Loops (for each) | FULL | FULL — Loop Block (parallel support) | FULL | — |
| 14.4 | LLM call block | MISSING | FULL — Use LLM Block (any model, configurable temperature) | FULL — LLM Call block | — |
| 14.5 | Ontology query block | MISSING | FULL — Query Objects tool in Use LLM | FULL | — |
| 14.6 | Ontology write-back block | MISSING | FULL — Apply Action Block (deterministic, no LLM) | FULL — Ontology Update block | — |
| 14.7 | Email / notification block | FULL — Email module in Action Flows | FULL — Notification side effects | FULL — Send Email block | — |
| 14.8 | Webhook / HTTP call block | FULL — HTTP module with OAuth2 | FULL — Webhooks as action side effects | MISSING | **HIGH** |
| 14.9 | Execute sub-function block | PARTIAL | FULL — Execute Function Block (calls any TS/Python function) | PARTIAL — Can call utility functions | **MEDIUM** |
| 14.10 | Calculator / expression block | PARTIAL | FULL — Calculator Tool in Use LLM | FULL — Custom expression blocks | — |
| 14.11 | Variable creation block | PARTIAL | FULL — Create Variable Block (all types) | PARTIAL | **LOW** |
| 14.12 | Execution tracing / debugging | PARTIAL | FULL — Block-level output trace | FULL — Full execution trace, real-time output | — |
| 14.13 | Draft vs published versions | MISSING | PARTIAL | FULL — Draft and published with publication locking | — |
| 14.14 | Async + sync execution modes | MISSING | FULL | FULL — Background async + synchronous debugger | — |
| 14.15 | Function versioning | MISSING | FULL — Full versioning | MISSING | **MEDIUM** |
| 14.16 | SAP / ERP native integration modules | FULL — SAP RFC, Oracle, ServiceNow, Salesforce modules | PARTIAL — Via connectors | MISSING | **MEDIUM** |
| 14.17 | 100+ pre-built integration modules | FULL — Action Flow modules (SAP, Slack, Teams, ServiceNow, etc.) | PARTIAL — Via connectors + functions | MISSING | **MEDIUM** |

---

## 15. ACTIONS (GOVERNED WRITE-BACK)

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 15.1 | Action type definitions (schema + validation) | PARTIAL — Skills in Action Flows | FULL — Input schema, validation rules, submission criteria | FULL — Input schema, confirmation mode, role-based access | — |
| 15.2 | Human confirmation gate (approve/reject) | PARTIAL — Tasks | FULL — User-confirmed vs auto-execute modes | FULL — Confirmation required toggle, approval workflow | — |
| 15.3 | Action execution audit trail | PARTIAL | FULL — Full audit: who, when, inputs, result, status | FULL — Execution tracking (source: manual/agent/pipeline/logic) | — |
| 15.4 | Action side effects: webhooks | PARTIAL — Via Action Flows | FULL — Writeback mode + side effect mode | MISSING | **HIGH** |
| 15.5 | Action side effects: notifications | PARTIAL | FULL — Email + platform notifications | FULL — Email notification on approval | — |
| 15.6 | Batched actions (bulk execution) | PARTIAL | FULL — Batched execution, function-backed | MISSING | **MEDIUM** |
| 15.7 | Action undo / revert | MISSING | FULL | MISSING | **MEDIUM** |
| 15.8 | Actions on interfaces (polymorphic) | MISSING | FULL — Apply to all implementing types | MISSING | **LOW** |
| 15.9 | Inline edits (direct property editing) | MISSING | FULL — Workshop + Notepad inline edits | MISSING | **MEDIUM** |
| 15.10 | Action metrics (success rate, P95 duration) | MISSING | FULL — Dec 2025 | MISSING | **LOW** |
| 15.11 | Agent-triggered actions | PARTIAL — AgentC | FULL — Auto-execute from AIP Automate | FULL — action_propose tool in Agent Studio | — |
| 15.12 | Role-based action access | MISSING | FULL — Permission-based | FULL — allowed_roles per action | — |
| 15.13 | Action expiry configuration | MISSING | PARTIAL | FULL — Expiry hours | — |

---

## 16. DATA INTEGRATION / CONNECTORS

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 16.1 | Pre-built connectors count | FULL — 100+ process connectors | FULL — 200+ connectors (databases, CRMs, ERPs, cloud, streaming) | PARTIAL — REST API + generic concepts | **HIGH** |
| 16.2 | REST API connector (generic) | FULL — HTTP module | FULL — REST API connector | FULL — Full REST with headers, auth, pagination | — |
| 16.3 | Database connectors (Postgres, MySQL, MSSQL, Oracle) | FULL | FULL — 30+ database types | MISSING — No database connectors yet | **HIGH** |
| 16.4 | SAP native connector | FULL — SAP ECC, S/4HANA, Ariba | FULL — SAP ERP, Business One, ByDesign | MISSING | **MEDIUM** |
| 16.5 | Salesforce connector | FULL | FULL | MISSING | **MEDIUM** |
| 16.6 | ServiceNow connector | FULL | FULL | MISSING | **MEDIUM** |
| 16.7 | Cloud storage (S3, Azure Blob, GCS) | FULL | FULL | MISSING | **MEDIUM** |
| 16.8 | Streaming connectors (Kafka, Kinesis, Pub/Sub) | FULL — Kafka connector (Lenses.io) | FULL — Kafka, Kinesis, Pub/Sub | MISSING | **LOW** |
| 16.9 | File upload (CSV, Excel, JSON) | FULL — File extraction | FULL — File parsing transforms | MISSING | **HIGH** |
| 16.10 | Webhook listeners (inbound) | MISSING | FULL — Data Connection webhooks | MISSING | **HIGH** |
| 16.11 | Zero-copy data (Databricks, Snowflake, Fabric) | FULL — Data Core with Delta Sharing (Nov 2025) | FULL — Virtual tables, Iceberg format | MISSING | **LOW** |
| 16.12 | Connection testing | PARTIAL | FULL | FULL — Test connection endpoint | — |
| 16.13 | Schema discovery from source | PARTIAL | FULL | FULL — AI-enhanced schema discovery | — |
| 16.14 | Credential encryption | FULL | FULL | FULL — Encrypted credential storage | — |
| 16.15 | Health status tracking | PARTIAL | FULL | FULL — Health status (idle/active/error), last sync, row count | — |
| 16.16 | Postman import | MISSING | MISSING | FULL — Import API from Postman collections | **ADVANTAGE** |
| 16.17 | Tag-based organization | MISSING | PARTIAL | FULL — Tags on connectors | **ADVANTAGE** |
| 16.18 | On-premise agent/bridge | FULL — On-Premise Client (OPC) | FULL — Agent Proxy (private network access) | MISSING | **MEDIUM** |
| 16.19 | Replication Cockpit (real-time CDC) | FULL — Trigger-based real-time extraction | FULL — CDC syncs | MISSING | **MEDIUM** |

---

## 17. SEARCH & DISCOVERY

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 17.1 | Global full-text search | FULL | FULL — Object Explorer | FULL — Search service across object types + records | — |
| 17.2 | Command palette (quick navigation) | MISSING | MISSING | FULL — Cmd+K | **ADVANTAGE** |
| 17.3 | Vector / semantic search | MISSING | FULL — KNN on embedding vectors, Palantir-provided + custom models | MISSING | **HIGH** |
| 17.4 | Multimodal search (text + image embeddings) | MISSING | FULL — Multimodal embedding models | MISSING | **LOW** |
| 17.5 | Resource discovery / catalog | PARTIAL — Marketplace | FULL — Compass filesystem, Files Landing, Resource Promotion | PARTIAL — Module-based navigation | **MEDIUM** |
| 17.6 | Search result ranking / scoring | PARTIAL | FULL | FULL — Ranking/scoring system | — |
| 17.7 | Ontology Augmented Generation (document → ontology) | MISSING | FULL — PDF chunking, incorporation into objects | MISSING | **MEDIUM** |

---

## 18. NOTEBOOKS & ANALYSIS TOOLS

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 18.1 | Notebook / canvas analysis tool | FULL — ML Workbench (JupyterLab) | FULL — Quiver: point-and-click, ontology-native, 40+ transforms | MISSING | **MEDIUM** |
| 18.2 | Point-and-click data exploration (no code) | PARTIAL — Process Explorer | FULL — Contour: 25 board types for dataset exploration | MISSING | **MEDIUM** |
| 18.3 | Time series analysis | MISSING | FULL — Quiver: cumulative/rolling/periodic aggregates, signal processing | MISSING | **LOW** |
| 18.4 | Regression / forecasting | MISSING | FULL — Quiver: regression + forecasting cards | MISSING | **LOW** |
| 18.5 | Correlation matrix | MISSING | FULL — Quiver card | MISSING | **LOW** |
| 18.6 | Parameter-driven exploration | PARTIAL — PQL variables | FULL — Quiver: string, numeric, boolean, date/time, range selectors | MISSING | **MEDIUM** |
| 18.7 | Canvas embeddable in apps | MISSING | FULL — Quiver embeddable in Workshop + Notepad | MISSING | **LOW** |
| 18.8 | Model Studio (no-code ML) | MISSING | FULL — GA Feb 2026: forecasting, classification, regression | MISSING | **LOW** |

---

## 19. COLLABORATION & DOCUMENTS

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 19.1 | Comments on entities (threaded) | PARTIAL | FULL — Rich comments with @mentions | FULL — Threaded comments, entity-agnostic, resolution status | — |
| 19.2 | Collaborative document editing | MISSING | FULL — Notepad: real-time co-editing, rich text, object widgets | MISSING | **MEDIUM** |
| 19.3 | Document templates (auto-generation) | MISSING | FULL — Template inputs, Workshop-triggered generation | MISSING | **LOW** |
| 19.4 | PDF export from documents | MISSING | FULL — Page orientation, headers/footers, page breaks | MISSING | **MEDIUM** |
| 19.5 | Embed charts/analysis in documents | MISSING | FULL — Contour, Quiver, Code Workbook charts in Notepad | MISSING | **LOW** |
| 19.6 | Object cards / property widgets in docs | MISSING | FULL — Inline object properties, media previews, Markdown editors | MISSING | **LOW** |
| 19.7 | User mentions / @mentions | MISSING | FULL | MISSING | **LOW** |
| 19.8 | Shareable reports | FULL — Email from Copilot | FULL — Notepad sharing + PDF export | MISSING | **MEDIUM** |

---

## 20. SECURITY & GOVERNANCE

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 20.1 | RBAC (role-based access) | FULL — Team-level + granular permissions | FULL — Discretionary per-resource, project-based | FULL — 6 roles, 10 permissions | — |
| 20.2 | SSO / SAML / OIDC | FULL — SAML SSO | FULL — SAML, Active Directory | FULL — Google, Okta, Azure AD, OIDC | — |
| 20.3 | SCIM (automated user provisioning) | FULL | FULL | MISSING | **LOW** |
| 20.4 | Audit logs (immutable) | FULL — Viewable, exportable CSV, API access | FULL — Append-only, checkpoint justifications | FULL — Immutable, before/after state, IP capture, ISO 27001 A.8.15 | — |
| 20.5 | Marking-based access (mandatory, column/row level) | MISSING | FULL — Conjunctive markings, propagation through lineage | MISSING | **LOW** |
| 20.6 | Classification levels (IL2/IL4/IL5/IL6) | MISSING | FULL — Government/military classification | MISSING | **LOW** |
| 20.7 | Data lineage visualization | MISSING | FULL — Workflow Lineage (GA Dec 2025): resource dependencies, AI model tracking | PARTIAL — Lineage service with upstream/downstream impact analysis | **MEDIUM** |
| 20.8 | Sensitive data scanner (auto-detect PII) | MISSING | FULL — Datasets + media sets (Sept 2025) | FULL — PII scanning per property | — |
| 20.9 | Data obfuscation / encryption | MISSING | FULL — Cipher encryption with multiple modes (Feb 2026) | MISSING | **LOW** |
| 20.10 | Multi-tenant isolation | FULL — Multi-tenant SaaS | FULL — Organizations as mandatory silos | FULL — Tenant-scoped everything, domain-based derivation | — |
| 20.11 | API key management | FULL — Application keys (migrating to OAuth) | FULL — OAuth + OSDK auth | FULL — API keys with hashing, scopes, usage tracking | — |
| 20.12 | Rate limiting | PARTIAL | FULL | FULL — 10/min login, configurable | — |
| 20.13 | Account lockout | PARTIAL | FULL | FULL — Lockout mechanism | — |
| 20.14 | Tenant plan management (free/pro/enterprise) | N/A — SaaS only | N/A | FULL — Plan types with module allowlisting | **ADVANTAGE** |
| 20.15 | FedRAMP / HIPAA certification | PARTIAL — ISO 27001, 27701, 9001 | FULL — FedRAMP High, IL5/IL6, HIPAA | MISSING — Not yet needed for MAIC/MJSP | — |

---

## 21. VALUE TRACKING & ROI

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 21.1 | Value realization tracking | FULL — Value Report, KPI improvement → monetary value | MISSING | FULL — Value categories, use cases, three-phase status (open → framed → realized) | — |
| 21.2 | ROI / monetary value calculation | FULL — Converts KPI improvement to currency | MISSING | FULL — Formula-based value calculation | — |
| 21.3 | Value lifecycle (identify → frame → realize) | FULL — Framing Value Opportunities | MISSING | FULL — Open → Framed → Realized status flow | — |
| 21.4 | Value event recording | PARTIAL | MISSING | FULL — Source tracking (manual, pipeline, automation, agent, logic) | **ADVANTAGE** |
| 21.5 | Improvement potential tracking | PARTIAL | MISSING | FULL — Improvement potential percentage per use case | **ADVANTAGE** |
| 21.6 | Path-to-Value methodology | FULL — Structured methodology, Academy courses | MISSING | MISSING | **LOW** |
| 21.7 | Enterprise value roll-up | FULL — Cross-process, cross-objective | MISSING | PARTIAL — Per-category roll-up | **MEDIUM** |

---

## 22. DEVELOPER EXPERIENCE / SDK

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 22.1 | External TypeScript SDK | MISSING | FULL — OSDK (NPM): query, traverse, actions, functions, semantic search | MISSING | **HIGH** |
| 22.2 | External Python SDK | FULL — PyCelonis (PyPI) | FULL — OSDK (Pip/Conda) | MISSING | **HIGH** |
| 22.3 | External Java SDK | MISSING | FULL — OSDK (Maven) | MISSING | **LOW** |
| 22.4 | OpenAPI spec generation | MISSING | FULL — Auto-generate clients in any language | MISSING | **MEDIUM** |
| 22.5 | REST API for external apps | FULL — Intelligence API, Process Intelligence API | FULL — Full ontology CRUD, AIP, S3, JDBC access | PARTIAL — Internal APIs only, API Gateway module exists | **HIGH** |
| 22.6 | API Gateway (expose data as APIs) | MISSING | PARTIAL — Via OSDK endpoints | FULL — API Gateway with key management, scopes, slugs | — |
| 22.7 | Developer Console (app management) | MISSING | FULL — OAuth config, code generation, token management | MISSING | **MEDIUM** |
| 22.8 | JDBC access (BI tool integration) | MISSING | FULL — Power BI, Tableau, Jupyter via JDBC | MISSING | **MEDIUM** |
| 22.9 | Custom query language (PQL) | FULL — PQL: 150+ operators, process-specific | MISSING — Code-based | MISSING | **MEDIUM** |
| 22.10 | Functions as a Service (serverless) | MISSING | FULL — TypeScript v2 + Python functions, serverless, distributable | MISSING | **MEDIUM** |

---

## 23. DEPLOYMENT INFRASTRUCTURE

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 23.1 | Cloud-native SaaS | FULL — AWS, Azure, GCP, IBM Cloud | FULL — AWS, Azure, GCP | FULL — Docker Compose (Colima local), cloud deployable | — |
| 23.2 | Multi-environment management | MISSING | FULL — Apollo hub-and-spoke, centralized control | MISSING | **LOW** |
| 23.3 | Air-gapped / disconnected deployments | MISSING | FULL — Apollo, intelligent bundling | MISSING | **LOW** |
| 23.4 | Release channels (canary, stable, production) | MISSING | FULL — Organization-defined channels, auto-promotion | MISSING | **LOW** |
| 23.5 | Automated rollback | MISSING | FULL — Safe rollback capabilities | MISSING | **LOW** |
| 23.6 | Health monitoring across environments | MISSING | FULL — Continuous health checks | PARTIAL — Per-service health endpoints | **LOW** |
| 23.7 | On-premise deployment option | FULL — Via On-Premise Client bridge | FULL — Full on-prem or hybrid | PARTIAL — Docker Compose anywhere | **LOW** |
| 23.8 | Kubernetes / OpenShift | FULL — Red Hat OpenShift (ROSA) | FULL — Kubernetes native | MISSING — Docker Compose only | **MEDIUM** |

---

## 24. MARKETPLACE & ECOSYSTEM

| # | Feature | Celonis | Palantir | Nexus | Gap |
|---|---------|---------|----------|-------|-----|
| 24.1 | Asset marketplace | FULL — 500+ assets: apps, connectors, Action Flows, accelerators | FULL — Marketplace for functions, widgets, agents, apps | MISSING | **LOW** |
| 24.2 | Pre-built industry apps | FULL — Supply Chain, Finance, Sustainability, Front Office suites | FULL — Defense, manufacturing, healthcare solutions | MISSING | **LOW** |
| 24.3 | Partner app ecosystem | FULL — Platform Apps Program, partner landings | FULL — Warp Speed partners (Anduril, L3Harris, etc.) | MISSING | **LOW** |
| 24.4 | Accelerator packages (bundled solutions) | FULL — Celonis licenses + implementation hours | PARTIAL | MISSING | **LOW** |
| 24.5 | Solution suites by domain | FULL — Supply Chain, Sustainability, Finance, Front Office (2025) | FULL — Defense, manufacturing, healthcare | MISSING | **LOW** |

---

## 25. GAP SUMMARY & PRIORITY MATRIX

### CRITICAL (Blocks core value proposition — must build)

| # | Gap | What It Means | Who Has It |
|---|-----|---------------|------------|
| 1 | **Object record store** (live queryable instances) | Object types are schemas only. No live data to query, filter, display in apps, or write back to. This blocks Workshop, Actions, OSDK, and the entire "operational platform" claim. | Both |
| 2 | **Write-to-Ontology pipeline step** | Pipelines can write events but cannot populate object records. Without this, the record store stays empty. | Both |
| 3 | **Cross-widget filtering in dashboards** | Click a bar chart, table filters. This is table stakes for any BI tool. Without it, dashboards feel static and toy-like. | Both |
| 4 | **Dashboard variable / state system** | Widgets need shared state (selected object, date range, filter values). Without variables, cross-widget filtering is impossible. | Both |
| 5 | **Dashboard event wiring** | Widget interactions must trigger updates to other widgets. The mechanism that connects clicks to state changes. | Both |
| 6 | **Dashboard dropdown/selector filter widget** | Users need to filter dashboard data. No standalone filter widget exists. | Both |
| 7 | **Dashboard action wiring** (form → action → write) | Forms that submit data and write to ontology. This is how Workshop apps become operational tools, not just dashboards. | Palantir |

### HIGH (Erodes credibility in competitive evaluations)

| # | Gap | What It Means | Who Has It |
|---|-----|---------------|------------|
| 8 | **Derived / computed properties** | Fields calculated from other fields without storage (e.g., `total = qty * price`). | Both |
| 9 | **Vector properties + semantic search** | Store embeddings on objects, query by similarity. Foundation for RAG and intelligent search. | Palantir |
| 10 | **Object sets** (first-class filtered collections) | Palantir's core query primitive. Used everywhere: Workshop, Functions, Actions, Agents. | Palantir |
| 11 | **Link traversal at runtime** | Given an object, traverse its links to pull related objects. Critical for any operational app. | Palantir |
| 12 | **Record detail view** (auto-generated object views) | Click any record, see its properties, links, timeline, actions. Palantir has this GA Feb 2026. | Palantir |
| 13 | **Multi-model provider registry** | Support OpenAI, Google, local models — not just Claude. Many customers require model diversity. | Palantir |
| 14 | **Agent embedding in apps** | Drop an AI agent into a dashboard as a widget. Palantir has AIP Agent widget. | Palantir |
| 15 | **Process map: performance view toggle** | Switch between frequency and throughput time. Celonis core feature. | Celonis |
| 16 | **Process map: click-to-filter** (4 filter types) | Click a node → filter to cases with/without/starting/ending at that activity. | Celonis |
| 17 | **Process map: connection drill-down** | Click an edge → see throughput time histogram, drag to filter. | Celonis |
| 18 | **Root cause analysis** (AI-powered) | Automatically identify contributing factors for slow/stuck cases. | Celonis |
| 19 | **OLAP / Pivot table** | Multidimensional process analysis. Both competitors have it. | Both |
| 20 | **Incremental pipelines** | Only process new/changed data. Full re-processing is wasteful at scale. | Both |
| 21 | **File upload connector** (CSV, Excel, JSON) | Most basic data integration need. Both competitors have it. | Both |
| 22 | **Database connectors** (at least Postgres, MySQL, MSSQL) | Can't connect to customer databases. REST-only limits data integration severely. | Both |
| 23 | **Webhook listeners** (inbound) | Accept events from external systems. Required for real-time integrations. | Both |
| 24 | **Webhook HTTP block** in Logic Studio | Call external APIs from workflows. Both competitors have this. | Both |
| 25 | **External SDK** (TypeScript + Python) | Let customers build apps on top of Nexus data. Palantir's OSDK is a major selling point. | Both |
| 26 | **NL → process map filter** | Ask a question, map filters accordingly. Celonis Process Copilot core feature. | Celonis |
| 27 | **AI-generated insights / recommendations** | Beyond activity classification — surface actionable process insights. | Both |
| 28 | **Dashboard form widget** | Input fields → action execution. Required for operational apps. | Palantir |
| 29 | **Dashboard object list widget** | Display filtered object records. Core of any data-driven app. | Palantir |
| 30 | **Custom retrieval functions** (pro-code RAG) | Let developers write custom context retrieval logic for agents. | Palantir |

### MEDIUM (Would be nice, strengthens competitive position)

| # | Gap | What It Means | Who Has It |
|---|-----|---------------|------------|
| 31 | Struct properties (nested typed fields) | Complex property types. | Palantir |
| 32 | Array properties | Store lists of values on a property. | Palantir |
| 33 | Required / edit-only property enforcement | Schema-level data integrity. | Palantir |
| 34 | Interfaces / polymorphism | One interface, many implementing types. | Palantir |
| 35 | Token replay animation | Cases flowing through map in real-time. | Celonis |
| 36 | Conformance overlay on process map | See deviations directly on the map. | Celonis |
| 37 | BPMN reference model import | Industry-standard process model format. | Celonis |
| 38 | Object-centric process mining (OCPM) | Events linked to multiple objects simultaneously. | Celonis |
| 39 | NL → chart/table generation (deeper) | More sophisticated than current widget proposals. | Both |
| 40 | AI observability dashboard | Token usage, tracing, logging for AI workflows. | Palantir |
| 41 | Streaming pipelines | Real-time data processing. | Both |
| 42 | Pipeline versioning (proper) | Track pipeline changes over time. | Palantir |
| 43 | Pipeline join transforms | Inner, left, right, anti joins in pipeline. | Palantir |
| 44 | Pivot / unpivot in pipeline | Reshape data. | Palantir |
| 45 | Code-based transforms (Python/SQL) | Custom code execution in pipelines. | Both |
| 46 | Web-based code IDE | JupyterLab or similar for custom code. | Both |
| 47 | Scatter plot widget | Missing chart type. | Both |
| 48 | Dashboard PDF export | Print/share dashboards. | Both |
| 49 | Responsive layout (sections, tabs, overlays) | Dashboard layout beyond flat grid. | Palantir |
| 50 | Collaborative document editing | Real-time co-editing with object awareness. | Palantir |
| 51 | Shareable reports | Generate and share analysis. | Both |
| 52 | Data lineage (deeper visualization) | Full dependency graph. | Palantir |
| 53 | MCP server | Expose Nexus as tools for external AI agents. | Both |
| 54 | Function versioning | Track changes to logic functions. | Palantir |
| 55 | Developer Console | App management, OAuth config, code generation. | Palantir |
| 56 | Kubernetes deployment | Production-grade container orchestration. | Both |
| 57 | On-premise connectivity agent | Secure bridge for private networks. | Both |
| 58 | SAP / Salesforce / ServiceNow connectors | Enterprise system integration. | Both |
| 59 | Batched actions | Bulk write-back operations. | Palantir |
| 60 | Action undo / revert | Reverse a write-back. | Palantir |
| 61 | Resource discovery / catalog | Better navigation and content discovery. | Palantir |
| 62 | Notebook analysis tool | Point-and-click data exploration. | Both |
| 63 | Insight Explorer equivalent | AI-powered opportunity detection. | Celonis |
| 64 | Action monitoring dashboard | Real-time success/failure rates. | Both |
| 65 | Export findings (CSV, PNG, PDF) | Get data out. | Both |

### LOW (Advanced/niche — build when needed)

| # | Gap | What It Means | Who Has It |
|---|-----|---------------|------------|
| 66+ | Time series properties, geopoint/geoshape, cipher text, media/attachments, shared properties, property reducers, conditional formatting, prominent properties, process simulation/digital twin, task mining, social network analysis, Gantt/waterfall/timeline/Sankey/lollipop widgets, Vega custom charts, iframe widget, status tracker/stepper, presentation mode, classification levels (IL2-IL6), marking-based access, SCIM provisioning, code review/PRs, CI/CD for code, Compute Modules, Foundry Branching, VS Code integration, marketplace, industry apps, partner ecosystem, air-gapped deployment, release channels, automated rollback, FedRAMP/IL5/IL6, real-time co-editing, document templates, LaTeX in docs, multimodal search, auto-generated test cases, LLM-as-judge evaluator, PyCelonis LLM equivalent, Orchestration Engine, Data Core zero-copy | Various |

---

## 26. NEXUS COMPETITIVE ADVANTAGES

These are areas where Nexus **leads both Celonis and Palantir**. Protect and deepen.

| # | Advantage | Description | Why It Matters |
|---|-----------|-------------|----------------|
| 1 | **AI-generated dashboards** | Neither competitor can generate full dashboard apps from a natural language prompt. Claude generates complete app definitions. | Dramatically lowers the barrier to dashboard creation. Non-technical users describe what they want and get a working app. |
| 2 | **Unified process mining + ontology + AI agents** | Celonis has process mining but weak ontology. Palantir has ontology but no process mining. Nexus has both tightly integrated. | Only platform where an AI agent can query process data, ontology records, and trigger workflows in a single conversation. |
| 3 | **Process mining tool for AI agents** | Agents can query cases, variants, bottlenecks, conformance directly. Neither competitor offers this. | AI agents that understand processes — not just data — can provide deeper operational insights. |
| 4 | **AI-powered schema inference** | Claude analyzes connector data to detect semantic types, suggest names, classify PII, score similarity to existing types. | Massively accelerates data onboarding. Upload data, get an auto-classified schema in seconds. |
| 5 | **Correlation engine** | Automatic relationship discovery between object types with confidence scores. | Finds hidden connections in data that humans miss. Neither competitor has this. |
| 6 | **Schema diff with breaking change detection** | Visual diff between object type versions, highlighting what will break. | Safe schema evolution. Neither competitor surfaces breaking changes this clearly. |
| 7 | **Process map: back-edge / cycle detection** | DFS-based rework loop detection with dashed visual indicators. Celonis doesn't detect cycles. | Immediately surfaces rework patterns that add cost and delay. |
| 8 | **Process map: focus mode** | Double-click → BFS reachability isolation. See only the selected path. | Cuts through complex spaghetti processes to focus on one flow. |
| 9 | **Process map: speed indicators** | Color-coded edges (fast/normal/slow) based on transition time. | Instant visual identification of slow transitions without switching views. |
| 10 | **Process mining: embedded AI chatbot with widget creation** | Ask questions about process data, get markdown answers with clickable widget proposals to add to dashboard. | Conversational process intelligence that builds its own dashboard. Neither competitor has this flow. |
| 11 | **Process mining: benchmark/segment comparison** | Side-by-side comparison of any two attribute segments with auto-populated values. | One-click "compare region A vs region B" that Celonis requires custom Views to build. |
| 12 | **Process mining: event quality scoring** | Completeness, timeliness, consistency, accuracy metrics for event data. | Know if your process data is trustworthy before analyzing it. Neither competitor scores event quality. |
| 13 | **Value realization with source attribution** | Track whether value came from manual input, pipeline, automation, agent, or logic function. | Proves which parts of the platform deliver ROI. Palantir has no value tracking at all. |
| 14 | **Postman API import** | Import connector configs from Postman collections. Neither competitor has this. | Developers already have their APIs in Postman. One-click import saves hours. |
| 15 | **Command palette (Cmd+K)** | Quick navigation across all platform resources. Neither competitor has this. | Power-user navigation that's standard in modern dev tools but missing from both competitors. |
| 16 | **Agent version history + rollback** | Snapshot and restore any agent version. | Safe agent iteration. Palantir's agent versioning is less explicit. |
| 17 | **Tenant plan management** | Free/pro/enterprise tiers with module allowlisting per tenant. | Built-in SaaS monetization. Neither competitor has per-tenant plan management as a platform feature. |
| 18 | **Logic Studio: draft vs published with locking** | Prevent accidental edits to production logic functions. | Safety mechanism neither competitor surfaces as a first-class feature. |
| 19 | **SINK_EVENT pipeline node** | Dedicated pipeline step for writing to event logs (process mining). | Direct pipeline-to-process-mining integration that neither competitor offers as a discrete node type. |
| 20 | **AGENT_RUN pipeline node** | Execute an AI agent as a pipeline step. | AI-in-the-pipeline, not AI-on-the-side. Novel integration pattern. |

---

## APPENDIX A: Platform Architecture Comparison

| Dimension | Celonis | Palantir | Nexus |
|-----------|---------|----------|-------|
| **Core paradigm** | Process Intelligence + Execution Management | Ontology-first Operational Intelligence | Unified Process Mining + Ontology + AI |
| **Data layer** | OCDM (Object-Centric Data Model) in managed cloud | Foundry datasets + Ontology index | TimescaleDB (events) + PostgreSQL (ontology) + Redis (cache) |
| **Query language** | PQL (Process Query Language, 150+ operators) | Code-based (Python/TypeScript/SQL) | SQL (backend), REST API (frontend) |
| **AI approach** | Process Copilot + AgentC (partner ecosystem) | AIP: Logic + Agents + Automate + Analyst (full stack) | Agent Studio + Logic Studio + Infer Service |
| **App builder** | Studio Views (grid, KPI, Process Explorer) | Workshop (60+ widgets, full event system) | App Editor (15 widgets, react-grid-layout) |
| **Automation** | Action Flows (Make.com-style visual) | AIP Logic (block-based) + AIP Automate (triggers) | Logic Studio (block-based) + Cron scheduling |
| **Deployment** | Multi-cloud SaaS only | Cloud + On-prem + Air-gapped (Apollo) | Docker Compose (local + cloud) |
| **Security ceiling** | ISO 27001/27701/9001 | FedRAMP High, IL5/IL6, HIPAA | RBAC + SSO + Audit (ISO-aligned) |
| **Developer tools** | PyCelonis SDK, ML Workbench | OSDK (TS/Python/Java), Code Repos, Functions | API Gateway, Agent tools |
| **Marketplace** | 500+ assets | Growing marketplace | None (internal only) |
| **Backend services** | Monolithic SaaS | Monolithic SaaS | 22+ microservices |
| **Pricing model** | Enterprise SaaS (high six/seven figures) | Enterprise + government contracts | Self-hosted, per-tenant plan |

---

## APPENDIX B: Build Priority Recommendation

### Phase 1 — Object Record Foundation (unlocks everything)
1. Object record store (`object_records` table in ontology-service)
2. Write-to-Ontology pipeline step (SINK_OBJECT populates records)
3. Object set query API (filter, sort, paginate records)
4. Records tab in ObjectTypePanel

### Phase 2 — Dashboard Interactivity (makes apps real)
5. Dashboard variable system (typed state shared across widgets)
6. Dashboard event wiring (click → update variable → filter)
7. Cross-widget filtering
8. Dropdown/selector filter widget
9. Form widget (input fields → action execution)
10. Object list/table widget backed by object records

### Phase 3 — Process Mining Depth (close Celonis gap)
11. Performance view toggle on process map
12. Click-to-filter on nodes/edges (4 filter types)
13. Connection drill-down (throughput time histogram per edge)
14. Root cause analysis (AI-powered)
15. OLAP / pivot table for process analytics

### Phase 4 — AI & Integration Platform
16. Multi-model provider registry (OpenAI, Google, local)
17. Vector properties + semantic search (pgvector)
18. Derived / computed properties
19. File upload connector (CSV, Excel)
20. Database connectors (Postgres, MySQL, MSSQL)
21. Webhook listeners (inbound)
22. Webhook HTTP block in Logic Studio

### Phase 5 — Developer & Enterprise
23. External TypeScript SDK (OSDK equivalent)
24. External Python SDK
25. Incremental pipeline processing
26. Agent embedding in apps (widget)
27. Custom retrieval functions for agents
28. MCP server

### Phase 6 — Polish & Scale
29. NL → process map filter
30. Code-based transforms in pipelines
31. Collaborative documents
32. Dashboard PDF export
33. Kubernetes deployment
34. On-premise connectivity agent
