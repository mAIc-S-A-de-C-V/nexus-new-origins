# Nexus Platform — QA Testing Guide
## Domain: Sepsis Clinical Operations (Real hospital data, 4TU.nl)

**Purpose:** End-to-end validation of every Nexus module using a real clinical dataset with known ground-truth answers. The goal is not just to verify data ingestion — it is to confirm that Nexus can model a real operational domain as a semantic ontology, run pipelines against it, enable AI-assisted analysis, build operational apps, and automate workflows at the domain level.

**Dataset:** ~1,050 patient cases, ~15,000 clinical events, 16 distinct care activities — real Dutch hospital sepsis event log spanning 2013–2015.

**Sepsis Service:** `http://localhost:8023` (standalone, no auth)

---

## Pre-Flight Checklist

```bash
docker-compose up -d --build
docker-compose ps
```

All containers should show `Up`. Wait ~60 seconds on first start (downloads and parses the XES file).

**Verify sepsis dataset is loaded:**
```
GET http://localhost:8023/health
```
Expected:
```json
{ "status": "ok", "cases": 1050, "events": 15214, "service": "sepsis-service" }
```

**Load ground-truth benchmark answers and keep them open:**
```
GET http://localhost:8023/benchmark
```
These are the 10 exact answers computed from the real dataset — every AI response you test should match them.

---

## MODULE 0 — Authentication & Session

**Goal:** Verify login, session management, tenant context, and first-use password change flow.

### Step 0.1 — Login
1. Navigate to `http://localhost` (or the configured Nexus URL)
2. Enter credentials:
   - **Username:** `admin` (or the tenant admin account)
   - **Password:** as configured
3. Click **Sign In**

**PASS:** Platform loads with the left navigation rail visible.

### Step 0.2 — Verify Tenant Context
1. Check the bottom of the nav rail or header for the active tenant name
2. Should show `tenant-demo-ai` (the tenant that holds the clinical data)

**PASS:** Tenant indicator visible. Any subsequent data operations will scope to this tenant.

### Step 0.3 — Logout and Re-login
1. Click the user avatar or profile menu → **Logout**

**PASS:** Redirected to login screen. Session cleared.

2. Log back in.

**PASS:** Previous module state is not cached in URL — clean session.

### Step 0.4 — Change Password Flow
1. If a first-use password change is enforced, verify the change password page appears
2. Enter a new password and confirm

**PASS:** Password updated. Redirected to the main platform.

### Step 0.5 — SSO Callback (if configured)
1. If SSO is configured, click the SSO login button
2. Complete the external auth flow

**PASS:** Redirected back to Nexus with a valid session. Token exchange succeeds.

---

## MODULE 1 — Connectors

**Goal:** Register the sepsis hospital data source as a managed connector. This is the data contract that feeds the ontology.

### Step 1.1 — Add Connector
1. Open **Connectors** (left nav) → **+ Add Connector**
2. Type: **REST API**
3. Fill in:
   - **Name:** `Sepsis Hospital Data`
   - **Base URL:** `http://sepsis-service:8023`
     *(use `http://localhost:8023` when testing directly from host browser)*
   - **Auth Type:** None
4. Click **Save**

**PASS:** Connector card appears with status badge.

### Step 1.2 — Verify Connection
1. Click the connector card → **Configuration** tab → **Test Connection**

**PASS:** Green result. Response body includes `"status":"ok"` and non-zero case/event counts.

### Step 1.3 — Verify Dynamic Query Parameters
1. In the connector panel, open **Test Request**
2. Path: `/cases` — add params: `limit=10`, `has_icu=true`

**PASS:** Returns 10 cases where `has_icu_admission: true`

### Step 1.4 — Verify Dynamic Headers & Body Builder
1. In the connector Configuration tab, check that dynamic headers can be added
2. Try adding a custom header: `X-Test: value`
3. Verify query parameter builder works for test requests

**PASS:** Dynamic config fields save and persist across page reload.

### Step 1.5 — Verify All Endpoints

| Endpoint | Expected |
|---|---|
| `GET /info` | Endpoint catalog with field descriptions |
| `GET /cases?limit=5` | 5 patient records |
| `GET /cases/A` | Single patient record (case "A") |
| `GET /cases/A/trace` | Ordered event list — first activity = `ER Registration` |
| `GET /events?limit=5` | 5 clinical events |
| `GET /events/activities` | 16 distinct care activities |
| `GET /events/resources` | Hospital org units (A, B, C… and named units) |
| `GET /stats` | Aggregates matching `/benchmark` answers |
| `GET /timeline?bucket=day` | Array of `{bucket, count}` date-bucketed entries |
| `GET /flow` | Care pathway transitions — highest-count edge originates from ER Registration |

**PASS:** All 10 return HTTP 200 with non-empty JSON.

### Step 1.6 — Connector Health Metrics
1. Open the connector detail panel
2. Check the health status visualization

**PASS:** Health badge shows green/OK. Latency is displayed.

### Step 1.7 — Postman Import
1. Click **+ Add Connector** → look for **Import from Postman** option
2. If available, import a Postman collection JSON

**PASS:** Connector is created from the Postman collection with endpoints populated.

### Step 1.8 — Connector Categories
1. Check that connector type categories are visible (REST API, Database, etc.)
2. Verify the category badges display correctly on connector cards

**PASS:** Connectors show type badges and categories.

---

## MODULE 2 — Ontology

**Goal:** Model the clinical operations as a semantic ontology — not a schema of the API, but a representation of real-world entities and how they relate.

### Step 2.1 — Create the `Patient` Object Type

1. Open **Ontology** → **+ New Object Type**
2. **Name:** `Patient`
3. **Description:** `A patient admitted through the emergency department with suspected sepsis. Tracks the full episode from ER registration through release or ICU outcome.`
4. Add the following properties:

| Property | Type | Semantic Meaning |
|---|---|---|
| `case_id` | Text | Unique patient episode identifier (primary key) |
| `age` | Integer | Patient age at time of admission |
| `gender` | Text | Patient gender (M / F) |
| `diagnosis` | Text | Primary clinical diagnosis code |
| `infection_suspected` | Boolean | Whether sepsis infection was suspected at triage |
| `icu_admitted` | Boolean | Whether the patient required ICU-level care |
| `outcome` | Text | Discharge pathway — Release A through E, or No Release Recorded |
| `episode_duration_hours` | Decimal | Total duration of the clinical episode (admission to discharge) |
| `event_count` | Integer | Total number of care activities recorded in this episode |
| `admitted_at` | DateTime | ER registration timestamp — start of episode |
| `discharged_at` | DateTime | Last recorded event timestamp — end of episode |

**PASS:** Object type saved and appears in the ontology graph.

---

### Step 2.2 — Create the `ClinicalEvent` Object Type

1. **+ New Object Type**
2. **Name:** `ClinicalEvent`
3. **Description:** `A single care activity performed during a patient episode. Represents one step in the clinical care pathway — a lab test, a triage assessment, an admission, or a discharge action.`
4. Add properties:

| Property | Type | Semantic Meaning |
|---|---|---|
| `event_id` | Text | Unique event identifier |
| `case_id` | Text | Parent patient episode (foreign key to Patient) |
| `activity` | Text | Care activity name (e.g., ER Registration, Admission IC, Leucocytes) |
| `occurred_at` | DateTime | When the activity was performed |
| `care_unit` | Text | Organizational unit responsible |
| `sirs_criteria_met` | Boolean | Whether ≥2 SIRS criteria were present at this event |
| `infection_suspected` | Boolean | Whether sepsis was suspected at this event |
| `hypotension_present` | Boolean | Whether hypotension was documented |

**PASS:** Object type saved.

---

### Step 2.3 — Define the Operational Link

1. Click **Patient** in the ontology graph → **+ Add Link**
2. **Link Name:** `HAS_CARE_EVENT`
3. **Target:** `ClinicalEvent`
4. **Cardinality:** One Patient → Many ClinicalEvents
5. **Description:** `The ordered sequence of care activities that make up a patient episode`

**PASS:** Edge appears in the graph connecting Patient → ClinicalEvent.

---

### Step 2.4 — Validate Semantic Coherence (Correlation Scan)

1. Click **Patient** → **Correlate** tab → **Run Correlation Scan**

**PASS:** Scan finds `case_id` overlap with ClinicalEvent, confirming the link type is correctly expressed.

### Step 2.5 — Schema Diff
1. Open **Patient** → **Schema** tab
2. If a schema diff viewer is available, check that it shows differences between the connector source and the ontology target

**PASS:** Schema diff renders without error.

---

## MODULE 3 — Pipeline Builder

**Goal:** Build pipelines that hydrate the ontology from the sepsis connector.

### Step 3.1 — Create the Sepsis Case Ingest Pipeline

1. Open **Pipelines** → **+ New Pipeline**
2. **Name:** `Sepsis Case Ingest`
3. Add steps:

**Step A — Source**
- Type: `Source`
- Connector: `Sepsis Hospital Data`
- Endpoint: `/cases`

**Step B — Map**
- Type: `Map`
- Field mappings:
  - `case_id` → `case_id`
  - `age` → `age`
  - `gender` → `gender`
  - `diagnosis` → `diagnosis`
  - `infection_suspected` → `infection_suspected`
  - `has_icu_admission` → `icu_admitted`
  - `outcome` → `outcome`
  - `duration_hours` → `episode_duration_hours`
  - `num_events` → `event_count`
  - `start_time` → `admitted_at`
  - `end_time` → `discharged_at`

**Step C — Sink: Object Type**
- Type: `Sink: Object Type`
- Target: `Patient`
- Primary key: `case_id`

4. Click **Save**

**PASS:** Pipeline graph shows 3 connected nodes.

---

### Step 3.2 — Run the Case Pipeline

1. Click **Run Pipeline**
2. Monitor execution status

**PASS:** Status reaches `COMPLETED`. Row count ≈ 1,050 Patient records.

> **If row count = 0:** Check that the connector Base URL uses `http://sepsis-service:8023` (Docker hostname), not `localhost:8023`.

---

### Step 3.3 — Create the ClinicalEvent Ingest Pipeline

1. Open **Pipelines** → **+ New Pipeline**
2. **Name:** `Clinical Event Ingest`
3. Add steps:

**Step A — Source**
- Type: `Source`
- Connector: `Sepsis Hospital Data`
- Endpoint: `/events`

**Step B — Map**
- Field mappings:
  - `event_id` → `event_id`
  - `case_id` → `case_id`
  - `activity` → `activity`
  - `timestamp` → `occurred_at`
  - `org_group` → `care_unit`
  - `sirs_2_or_more` → `sirs_criteria_met`
  - `infection_suspected` → `infection_suspected`
  - `hypotension` → `hypotension_present`

**Step C — Sink: Object Type**
- Type: `Sink: Object Type`
- Target: `ClinicalEvent`
- Primary key: `event_id`

4. Click **Save** → **Run Pipeline**

**PASS:** Status reaches `COMPLETED`. Row count = **15,214** events.

---

### Step 3.4 — Schedule for Continuous Hydration

1. Pipeline detail → **Schedule** button
2. **Name:** `Hourly Sepsis Sync`
3. **Cron:** `0 * * * *` (every hour)
4. **Save**

**PASS:** Schedule appears in Settings → Schedules with next run timestamp.

### Step 3.5 — Test Additional Node Types

1. Open the pipeline editor → **Node Palette**
2. Verify the following node types are available:

| Node Type | Purpose |
|---|---|
| Source | Data ingestion from connector |
| Filter | Row-level filtering |
| Map | Field mapping/renaming |
| Cast | Type conversion |
| Enrich | Add computed fields |
| Flatten | Flatten nested arrays |
| Dedupe | Remove duplicate records |
| Validate | Data validation rules |
| Sink: Object Type | Write to ontology |

**PASS:** All node types appear in the palette and can be dragged onto the canvas.

### Step 3.6 — Pipeline Topology View
1. Click the **Expand** button (if available) for a full-screen topology view of the pipeline

**PASS:** Pipeline topology renders with all nodes and edges visible.

### Step 3.7 — Pipeline Node Audit
1. Click any pipeline node
2. Check the audit/detail panel

**PASS:** Node shows its configuration, input schema, output schema, and execution stats.

---

## MODULE 4 — Graph Explorer

**Goal:** Confirm the ontology graph is a faithful representation of the clinical domain.

### Step 4.1 — View the Ontology Graph
1. Open **Ontology**

**PASS:** Graph renders with `Patient` and `ClinicalEvent` nodes connected by `HAS_CARE_EVENT`.

### Step 4.2 — Open Patient Detail Panel
1. Click **Patient** node

**PASS:** Detail panel opens with **Properties** tab showing the semantic property list. Panel also shows Pipelines, Schema, Data, and Comments tabs.

### Step 4.3 — Inspect Pipeline Flow Nodes
1. Look for pipeline step nodes in the graph (SOURCE → MAP → SINK)

**PASS:** Pipeline flow nodes visible — data provenance and lineage visible in the same graph as the semantic model.

### Step 4.4 — Inspect Connector Flow Nodes
1. Look for connector nodes in the ontology graph

**PASS:** Connector nodes are visible showing the data source relationship to the object types.

### Step 4.5 — Graph Interaction
1. Zoom in/out using scroll wheel
2. Pan by clicking and dragging the canvas
3. Verify nodes can be repositioned by dragging

**PASS:** Graph is interactive — zoom, pan, and drag all work smoothly.

---

## MODULE 5 — Data Explorer

**Goal:** Query the hydrated `Patient` object type using domain-level filters and build operational charts.

### Step 5.1 — Query by Clinical Outcome
1. Open **Data** → **Data Explorer**
2. Select object type: `Patient`
3. Add filter: `icu_admitted = true`
4. **Run Query**

**PASS:** Table shows only ICU patients. Row count matches B4 from `/benchmark`.

### Step 5.2 — Filter Elderly ICU Patients
1. Add filter: `age >= 70`

**PASS:** All rows have age ≥ 70 AND `icu_admitted = true`.

### Step 5.3 — Outcome Distribution Chart
1. Switch to **Chart** view
2. X-axis: `outcome`, Y-axis: `COUNT`, Chart type: Bar

**PASS:** Bar chart shows clinical outcomes. Sum of all bars = B1 from `/benchmark` (~1,050).

### Step 5.4 — Admission Volume Over Time
1. X-axis: `admitted_at`, bucket = `week`, Y-axis: `COUNT`

**PASS:** Line chart shows admission volume over the 2013–2015 period only.

### Step 5.5 — Export Records
1. Click **Export CSV**

**PASS:** CSV downloads with column headers matching ontology property names (not raw source field names).

### Step 5.6 — Multi-Field Aggregation
1. Try grouping by two fields (e.g., `outcome` + `icu_admitted`)
2. Verify chart reflects the combination

**PASS:** Aggregation handles multiple group-by fields correctly.

---

## MODULE 6 — Data Quality

**Goal:** Profile the `Patient` object type to understand completeness and reliability of clinical data.

### Step 6.1 — Run Data Profile
1. Open **Data** → **Data Quality**
2. Select `Patient` → **Run Profile**

**PASS:** Profile completes. Null rate bars appear for each property.

### Step 6.2 — Verify Expected Null Patterns

| Property | Expected Null Rate | Why |
|---|---|---|
| `age` | < 5% | Most admissions have recorded age |
| `diagnosis` | Some nulls | Not always captured in ER triage |
| `discharged_at` | Small % | "No Release Recorded" cases have no end timestamp |

**PASS:** At least one field shows a non-zero null rate (confirms real clinical variability).

### Step 6.3 — Quality Score
**PASS:** Overall quality score 60–100. A perfect 100 would be suspicious.

### Step 6.4 — Distinct Value Counts
1. Check the distinct value counts for key fields

**PASS:** `outcome` shows 6–7 distinct values. `gender` shows 2. `activity` (on ClinicalEvent) shows 16.

### Step 6.5 — Top Values Distribution
1. For any text field, check the top values breakdown

**PASS:** Distribution chart/list renders showing the most common values with counts.

---

## MODULE 7 — Search (⌘K)

**Goal:** Verify search operates at the ontology level — returning domain entities, not raw records.

### Step 7.1 — Open Global Search
1. Press `⌘K` (Mac) or `Ctrl+K` (Windows)

**PASS:** Search input appears (command palette).

### Step 7.2 — Search by Domain Term
1. Type: `SEPSIS`

**PASS:** Results appear within 300ms showing matching `Patient` and `ClinicalEvent` records.

### Step 7.3 — Search by Care Activity
1. Type: `ER Registration`

**PASS:** Results include ClinicalEvent records where `activity = ER Registration`.

### Step 7.4 — Search by Patient ID
1. Type: `A`

**PASS:** Patient record "A" appears at or near the top of results.

### Step 7.5 — Quick Navigation
1. Type the name of a module (e.g., `Pipelines`, `Agents`)

**PASS:** Navigation items appear in results. Clicking one navigates to that page.

### Step 7.6 — Search Pipelines and Agents
1. Type the name of a pipeline: `Sepsis Case Ingest`

**PASS:** Pipeline appears in results with a direct link.

---

## MODULE 8 — Apps (Dashboards)

**Goal:** Build and publish operational dashboard apps backed by live ontology data. Apps are the end-user layer of Nexus — the point at which the ontology becomes something a non-technical user can read and act on.

> **Prerequisite:** `Sepsis Case Ingest` pipeline must have completed (Module 3.2).

### Step 8.1 — Generate an App with AI

1. Open **Apps** (left nav) → **+ New App**
2. The **Build a new app** dialog opens
3. Select object type: **Patient**
4. In the description field, enter:
   `"Clinical operations dashboard for sepsis patients — show total case count, ICU admission rate, outcome distribution, and a table of recent high-risk patients"`
5. Click **Generate with Claude**

**PASS:** The system transitions through `Fetching sample data...` → `Sending prompt to Claude...` → `Review generated app` preview panel. Claude badge shows `Claude designed this`.

### Step 8.2 — Confirm and Open the Generated App

1. Review the component preview
2. Click **Create App**

**PASS:** App appears in the Apps gallery with the name Claude chose.

3. Click the app card to open it

**PASS:** Dashboard renders with real Patient data. A KPI or metric card should show a number close to 1,050 (total cases).

### Step 8.3 — Edit Mode: Add and Rearrange Widgets

1. Click **Edit** (pencil icon in top bar)
2. From the left widget palette, drag a **Bar Chart** onto the canvas
3. Configure it: Object Type = `Patient`, X-axis = `outcome`, Y-axis = `COUNT`
4. Resize the widget by dragging its bottom-right corner
5. Rearrange existing widgets by dragging their headers

**PASS:** Drag, drop, and resize all work without layout corruption. Chart renders with outcome data.

### Step 8.4 — Add a Data Table Widget

1. Still in edit mode — add a **Data Table** widget
2. Configure: Object Type = `Patient`, columns = `case_id`, `age`, `outcome`, `icu_admitted`
3. Add filter: `icu_admitted = true`
4. Click **Save**

**PASS:** Table shows ICU patients only. Row count matches benchmark B4.

### Step 8.5 — Add a KPI Banner Widget

1. In edit mode — add a **KPI Banner** widget
2. Configure: Object Type = `Patient`, metric = `COUNT`

**PASS:** KPI banner shows ~1,050.

### Step 8.6 — Add a Metric Card Widget

1. Add a **Metric Card** widget
2. Configure: Object Type = `Patient`, filter = `icu_admitted = true`, metric = `COUNT`

**PASS:** Metric card shows ~110 (ICU patients).

### Step 8.7 — Add a Text Block Widget

1. Add a **Text Block** widget
2. Enter markdown: `## Sepsis Dashboard\nOperational overview of clinical events.`

**PASS:** Text block renders with formatted heading and body text.

### Step 8.8 — Code View

1. Click **Code** (braces icon) in the top bar

**PASS:** Raw JSON of the app's component array is shown in a syntax-highlighted editor. Editing the JSON and saving should update the canvas layout.

### Step 8.9 — View Mode (Published)

1. Click **View** (eye icon)

**PASS:** Read-only live canvas. No edit controls visible. Data is live from the ontology.

### Step 8.10 — Create a Second Dashboard Manually

1. Go back to **Apps** → **+ New App**
2. This time, skip AI generation and create an empty app named `ICU Monitoring Board`
3. In edit mode, manually add:
   - A bar chart: `Patient` by `outcome` where `icu_admitted = true`
   - A data table: `ClinicalEvent` filtered to activity = `Admission IC`
   - A KPI card: count of ICU patients
4. Save

**PASS:** Dashboard renders with all 3 widgets showing live data. ICU-filtered data is correct.

### Step 8.11 — App Gallery
1. Return to the Apps list

**PASS:** Both apps appear as cards in the gallery. Cards show app name and component count.

---

## MODULE 9 — Logic Studio

**Goal:** Build and run a server-side logic function — a composable workflow that queries ontology data, applies transforms, calls Claude, and can write results back. This is Nexus's programmable automation layer.

> **Prerequisite:** Both ontology pipelines must have run. Patient and ClinicalEvent records must exist.

### Step 9.1 — Create a Logic Function

1. Open **Logic** (left nav) → **+ New Function**
2. **Name:** `ICU Risk Summary`
3. **Description:** `Queries ICU patients, computes a risk summary, and asks Claude to interpret.`
4. Click **Create**

**PASS:** Logic function appears in the sidebar. Empty block canvas opens.

### Step 9.2 — Add an Ontology Query Block

1. Click **+ Add Block** → **Ontology Query**
2. Configure:
   - Object Type: `Patient`
   - Filter: `icu_admitted = true`
   - Fields: `case_id`, `age`, `outcome`, `episode_duration_hours`
   - Limit: `50`
3. **Save block**

**PASS:** Block appears on the canvas labeled `Ontology Query`.

### Step 9.3 — Add a Transform Block

1. **+ Add Block** → **Transform**
2. Configure:
   - Input: output of the Ontology Query block
   - Expression: compute `avg_duration` from `episode_duration_hours`
3. **Save block**

**PASS:** Transform block connected to the Query block.

### Step 9.4 — Add an LLM Call Block

1. **+ Add Block** → **LLM Call**
2. Configure the prompt:
   `"You are a clinical analyst. Here are {count} ICU patients with average episode duration {avg_duration} hours. Identify any patterns or concerns."`
3. **Save block**

**PASS:** LLM Call block connected to the Transform output.

### Step 9.5 — Run the Function

1. Click **Run** (play button)

**PASS:** Execution log shows each block completing in sequence. Final output panel shows Claude's analysis of the ICU patient data. Response references actual numbers from the query.

### Step 9.6 — Verify Block-Level Output

1. Click any block to expand its output in the execution log

**PASS:** Each block shows its input, output, and execution time. Ontology Query block output contains ≤50 ICU patient rows.

### Step 9.7 — Test Additional Block Types

Verify the following block types are available and configurable:

| Block Type | Purpose |
|---|---|
| Ontology Query | Query records from object types |
| LLM Call | Call Claude with a prompt |
| Send Email | Send email notifications |
| Action | Propose a human action |
| Ontology Update | Write/update records |
| Transform | Apply data transformations |
| Utility Call | Call a platform utility |
| Conditional (if/else) | Branching logic |
| For Each | Loop over collections |

**PASS:** All block types appear in the palette.

### Step 9.8 — Conditional Logic

1. Add a **Conditional** block with condition: `avg_duration > 500`
2. Add different LLM prompts for the true/false branches
3. Run

**PASS:** Execution follows the correct branch based on the condition evaluation.

### Step 9.9 — Pre-Built Logic Functions

1. Check the sidebar for any pre-built logic function templates

**PASS:** Pre-built functions list loads (if any exist).

---

## MODULE 10 — Agent Studio (AIP Analyst)

**Goal:** Verify the AI agent can answer questions about the clinical domain using the ontology as its knowledge base. Answers must match the ground-truth benchmark.

### Step 10.1 — Create an Agent

1. Open **Agent Studio** → **+ New Agent**
2. **Name:** `Sepsis Clinical Analyst`
3. **System Prompt:**
   `"You are a clinical data analyst with access to a real sepsis patient dataset from a Dutch hospital (2013–2015). Use your tools to inspect the data schema before answering any question. Never answer without querying first."`
4. Enable tools:
   - `List Object Types`
   - `Get Object Schema`
   - `Query Records`
   - `Count Records`
5. **Save**

**PASS:** Agent appears in the agent list with the 4 tools shown.

### Step 10.2 — Verify All Available Tools

Check that these tools are available for agent configuration:

| Tool | Purpose |
|---|---|
| List Object Types | Discover ontology types |
| Get Object Schema | Get properties of a type |
| Query Records | Fetch records with filters |
| Count Records | Count records with filters |
| Logic Function Run | Execute a logic function |
| Propose Action | Submit a human action proposal |
| List Actions | List available human actions |
| Call Sub-Agent | Delegate to another agent |
| Process Mining | Access process mining data |
| List Utilities | Discover platform utilities |
| Run Utility | Execute a utility |

**PASS:** All tools appear in the tool selection UI.

### Step 10.3 — Open a Thread

1. Click **New Thread** (or **Analyze Data**)

**PASS:** Chat interface opens, ready for input.

### Step 10.4 — Clinical Benchmark Questions

For each question: type it in the thread, wait for response, compare to `/benchmark`.

| # | Question | Expected Answer | Source |
|---|---|---|---|
| 1 | "How many patients are in this dataset?" | **1,050** | B1 |
| 2 | "How many patients were admitted to the ICU?" | **110** | B4 |
| 3 | "What is the most frequently performed care activity?" | **Leucocytes** | B5 |
| 4 | "What is the average length of a patient episode in hours?" | **683.26** (accept 683–684) | B6 |
| 5 | "What activity begins every patient episode?" | **ER Registration** | B9 |
| 6 | "What is the most common discharge outcome?" | **Release A** | B8 |
| 7 | "How many cases have no discharge recorded?" | **268** | B10 |

> **B10 note:** "No discharge recorded" = outcome field is `No Release Recorded` — 268 cases. The agent should query by outcome value, not null check.

**PASS:** Exact match for numeric answers (±1% rounding). Correct activity name for text answers. Response time < 30 seconds.

> **What to look for in reasoning:** Agent should call `get_object_schema` first, then `count_records` or `query_records` with filters. If agent says "I don't have a tool to query that" — check enabled tools list.

### Step 10.5 — Multi-Step Operational Question

Ask: *"What percentage of patients required ICU admission, and how does average episode duration compare between ICU and non-ICU patients?"*

**PASS:** Agent returns a percentage (~10.5%) AND a comparison. ICU patients should have longer average episode duration.

### Step 10.6 — Verify Tool Call Chain is Visible

1. Expand the tool call log for any agent response

**PASS:** Each tool call shows: tool name, input parameters, and returned data. The reasoning chain is visible and traceable.

### Step 10.7 — Agent Schedule Configuration

1. In agent settings, check if a schedule can be configured
2. Set a cron expression for periodic execution

**PASS:** Schedule configuration UI renders and accepts a cron expression.

### Step 10.8 — Knowledge Scope

1. Check the agent's knowledge scope settings
2. Verify the agent can be scoped to specific object types

**PASS:** Knowledge scope can be configured and saved.

### Step 10.9 — Agent Test Harness

1. Look for a test/debug mode for the agent

**PASS:** Test harness allows running single tool calls in isolation.

---

## MODULE 11 — Human Actions

**Goal:** Verify that agents can propose structured write actions, and that a human reviewer can approve or reject them before any data is modified.

### Step 11.1 — Define an Action

1. Open **AIP** → **Human Actions** (or find it in the nav)
2. Click **+ New Action**
3. Fill in:
   - **Name:** `Flag High-Risk Patient`
   - **Description:** `Marks a patient record as high-risk for escalation review`
   - **Writes to:** `Patient`
   - **Input fields:** `case_id` (Text), `risk_level` (Text: high / critical), `reason` (Text)
   - **Requires confirmation:** ON
   - **Allowed roles:** `analyst`, `admin`
4. **Save**

**PASS:** Action appears in the action definitions list with status `Enabled`.

### Step 11.2 — Enable / Disable Toggle

1. Toggle the action OFF, then back ON

**PASS:** Toggle state persists. Disabled actions cannot be proposed by agents.

### Step 11.3 — Trigger an Action Proposal via Agent

1. Go to **Agent Studio** → open the Sepsis Clinical Analyst thread
2. Ask: *"Flag patient A as high-risk — they were in ICU for over 30 days"*

**PASS:** Agent proposes the `Flag High-Risk Patient` action. The proposal appears in **Human Actions → Inbox** tab with status `Pending`.

### Step 11.4 — Review and Approve

1. Open **Human Actions → Inbox**
2. Click the pending action proposal
3. Review the proposed field values (case_id = "A", risk_level, reason)
4. Click **Approve**

**PASS:** Action status changes to `Approved`. If the action writes to Patient, the record is updated.

### Step 11.5 — Reject an Action

1. Ask the agent to flag another patient
2. In Inbox, click the new proposal → **Reject** with reason: `"Needs more evidence"`

**PASS:** Action status changes to `Rejected`. Record is not modified.

### Step 11.6 — Review Action History

1. Click **History** tab

**PASS:** Both the approved and rejected actions appear with timestamps, reviewer identity, and outcome.

### Step 11.7 — Checkpoint Gate

1. If a checkpoint gate is configured for critical actions, verify that the confirmation modal appears before execution

**PASS:** Checkpoint modal renders and requires explicit confirmation.

---

## MODULE 12 — Process Mining

**Goal:** Visualize the actual care pathways taken through the clinical system across all 6 tabs: Map, Variants, Cases, Conformance, Alerts, and Settings.

> **Prerequisite:** `Clinical Event Ingest` pipeline (Module 3.3) must have completed.

### Step 12.1 — Open Process Mining

1. Open **Activity** → **Process Mining**
2. Object type dropdown: select **ClinicalEvent**

### Step 12.2 — Configure Event Mapping (Settings Tab)

1. Click **⚙ Settings** tab
2. **Pipeline:** select `Clinical Event Ingest`
3. Set the following field overrides:
   - **Activity Field Override:** `activity`
   - **Case ID Field Override:** `case_id`
   - **Timestamp Field Override:** `occurred_at`
4. Click **Save & Apply**

**PASS:** Stats bar shows: **Cases** ≈ 1,050 · **Variants** ≈ 849 · **Avg Duration** ≈ 1.8d · **Rework Rate** > 0%

> **IMPORTANT:** Without configuring the Case ID and Timestamp field overrides, process mining will show ~15,000 individual single-event cases with 0 transitions. This is because events are stored with `case_id=evt_*` (event ID) and `activity=RECORD_CREATED` (generic) at the database level. The field overrides tell the process engine to extract real values from `attributes.record_snapshot`.

### Step 12.3 — AI Analyze Button (Settings Tab)

1. Still in **Settings** tab, click the **AI Analyze** button
2. Wait for the analysis to complete

**PASS:** Claude analyzes the activity profile and classifies each activity as either a `stage` (meaningful process step) or `noise` (system/pipeline event). Results display with labels and reasons for each classification.

> **If AI Analyze returns only heuristic results (no Claude reasoning):** Check that `ANTHROPIC_API_KEY` is set in the pipeline-service container's environment (docker-compose.yml).

---

### Step 12.4 — Process Map Tab

1. Click **Process Map**

**PASS:** Directed graph renders with nodes = care activities, edges = transitions. `ER Registration` is leftmost (entry node, blue accent). Exit nodes (Release A/B/C/D/E) are on the right (purple accent).

2. **Single-click** on `ER Registration`

**PASS:** All other nodes dim. Direct successor nodes (outflow) highlight in green with `outflow →` label. All non-connected edge labels disappear — only the direct transition times show on active edges.

3. **Single-click** on `Admission IC`

**PASS:** Blue edges show which activities lead into ICU admission (inflow). Green edges show what follows. Only those edge times are visible.

4. **Double-click** on `ER Triage`

**PASS:** Focus mode activates. Banner at top reads: `Focus: ER Triage — showing all paths through this activity`. Only nodes that can reach ER Triage AND are reachable from it remain visible. Press **esc** or click the banner button to exit.

5. Verify edge thickness — edges from/to high-volume transitions (like ER Registration → ER Triage) should be visibly thicker than low-volume edges.

6. Verify dashed lines appear on back-edges (cycles like Return ER going backwards in the flow).

---

### Step 12.5 — Variants Tab

1. Click **Variants** tab

**PASS:** List of care pathway variants, sorted by case count descending. Each variant shows the activity sequence as chips (e.g., ER Registration → ER Triage → Leucocytes → … → Release A).

2. Click on the **most frequent variant** to expand it

**PASS:** Full activity sequence visible. Case count and percentage of total cases shown.

3. Click **View Cases** (or the drill-down link) on any variant

**PASS:** Navigation switches to the **Cases** tab pre-filtered to that variant's cases only. Variant ID persists as a filter in the Cases view.

---

### Step 12.6 — Cases Tab

1. Click **Cases** tab
2. Verify case list shows patient episodes with columns: case ID, activity count, duration, variant

**PASS:** ~1,050 rows visible. Durations vary — some < 1 hour (quick ER discharge), some > 500 hours (extended ICU stays).

3. Click any case row

**PASS:** Case timeline opens on the right. Activities appear in chronological order. First activity = `ER Registration`.

4. For an ICU patient, verify pathway includes `Admission IC` after triage and lab work.

---

### Step 12.7 — Conformance Tab

1. Click **Conformance** tab
2. Click **+ New Model** (or **Define Happy Path**)
3. Build the expected care pathway by adding activities in order:
   ```
   ER Registration → ER Triage → ER Sepsis Triage → Admission NC → Release A
   ```
4. **Save Model** — name it `Standard Sepsis Pathway`
5. Click **Run Conformance Check**

**PASS:** Check completes. A conformance score appears (0–1). Score < 1 expected because real patient pathways deviate from the ideal.

6. Check the **Deviation Breakdown**

**PASS:** List shows which activities are most frequently skipped or out-of-order in actual cases. `ER Sepsis Triage` skips are expected (not all patients go through full sepsis triage).

---

### Step 12.8 — Alerts Tab

1. Click **Alerts** tab
2. Click **+ New Rule**

**Rule 1 — Stuck Case:**
- **Type:** `Stuck Case`
- **Name:** `Patient stalled > 3 days`
- **Hours without progress:** `72`
- **Severity:** Warning
- **Save**

**Rule 2 — Slow Transition:**
- **Type:** `Slow Transition`
- **Name:** `ER to ICU bottleneck`
- **From stage:** `ER Triage`
- **To stage:** `Admission IC`
- **Threshold:** `24` hours
- **Severity:** Critical
- **Save**

**Rule 3 — Rework Spike:**
- **Type:** `Rework Spike`
- **Name:** `Lab rework alert`
- **Activity:** `Leucocytes`
- **Threshold:** configure as appropriate
- **Save**

**Rule 4 — Volume Anomaly:**
- **Type:** `Volume Anomaly`
- **Name:** `Admission volume drop`
- **Configure threshold**
- **Save**

**PASS:** All four rule types are available and save correctly.

3. Click **Evaluate Rules** (run button)

**PASS:** Evaluation completes. If any cases match, an alert count appears on the rule row.

4. Test **Snooze** on a rule

**PASS:** Rule can be snoozed and the snooze indicator appears.

---

## MODULE 13 — Evals

**Goal:** Create a formal evaluation suite that encodes the benchmark ground-truth as repeatable test cases.

### Step 13.1 — Create Eval Suite
1. Open **Evals** → **+ New Suite**
2. **Name:** `Sepsis Clinical Benchmark`
3. **Description:** `Ground-truth evaluation cases derived from the 4TU.nl Sepsis Cases Event Log.`

### Step 13.2 — Add Benchmark Cases

| Input | Expected Output | Evaluator |
|---|---|---|
| "How many patients are in the dataset?" | 1,050 | `exact_match` |
| "How many patients had ICU admission?" | 110 | `exact_match` |
| "What is the most common care activity?" | Leucocytes | `contains_key_details` |
| "What is the average episode duration in hours?" | 683.26 | `exact_match` |
| "What does every episode start with?" | ER Registration | `exact_match` |
| "What is the most common discharge outcome?" | Release A | `contains_key_details` |
| "How many episodes have no discharge recorded?" | 268 | `exact_match` |

**PASS:** Suite created with ≥ 7 cases.

### Step 13.3 — Verify All Evaluator Types

| Evaluator | Purpose |
|---|---|
| `exact_match` | Exact string comparison |
| `json_schema` | Validates against JSON schema |
| `rouge` | ROUGE text similarity score |
| `contains_key_details` | Checks for presence of key facts |
| `custom_expression` | Custom evaluation expression |

**PASS:** All evaluator types appear in the evaluator dropdown.

### Step 13.4 — Run Suite Against Agent
1. **Run Suite** → select `Sepsis Clinical Analyst`

**PASS:** Score ≥ 7/10.
**Excellent:** Score ≥ 9/10.

### Step 13.5 — Review Failures
1. Click into results → examine failed cases

**PASS:** Failed cases show a structured diff between expected and actual output.

### Step 13.6 — Run an Experiment
1. Click **Experiment** → configure a parameter grid (e.g., different system prompts or temperature settings)
2. Run the experiment

**PASS:** Experiment executes multiple runs. Results show a comparison matrix. Best run is highlighted.

---

## MODULE 14 — Utilities

**Goal:** Verify platform utilities — enrichment tools (web scraping, OCR, geocoding) that can be called from Logic functions or agents.

### Step 14.1 — Open Utilities
1. Open **Utilities** (left nav)

**PASS:** Utilities panel opens showing categories: Document, Web, Vision, Geo, Notify. Each utility shows name, description, and a run button.

### Step 14.2 — Verify Utility Categories

| Category | Expected Utilities |
|---|---|
| Document | PDF Extract, Text Parse |
| Web | Web Scrape, RSS Feed |
| Vision | OCR, Image Analysis |
| Geo | Geocoding, Map Display |
| Notify | Email, QR Code |

**PASS:** Each category lists at least one utility.

### Step 14.3 — Run Web Scrape Utility
1. Find **Web Scrape** (or similar) in the Web category
2. Click the run button
3. Input a URL (e.g., `https://example.com`)
4. Click **Execute**

**PASS:** Returns a JSON response with extracted page content within 10 seconds.

### Step 14.4 — Run a Document Utility
1. Find a document utility (e.g., **PDF Extract** or **Text Parse**)
2. Run it with a sample input

**PASS:** Returns structured JSON output. No server errors.

### Step 14.5 — Verify JSON Input/Output
1. For any utility, check that the input accepts JSON and the output is syntax-highlighted JSON

**PASS:** JSON input field and syntax-highlighted output render correctly.

### Step 14.6 — Verify Utility is Callable from Agent

1. Go back to **Agent Studio** → open the Sepsis Clinical Analyst
2. Enable the `utility_run` tool if not already enabled
3. Ask: *"What utilities are available to you?"*

**PASS:** Agent calls `utility_list` and returns the available utility names and categories.

---

## MODULE 15 — Collaboration & Comments

**Goal:** Validate that domain knowledge can be captured and shared directly on ontology objects.

### Step 15.1 — Add Clinical Note to Patient Object Type
1. Open **Ontology** → click **Patient**
2. Click **Comments** tab
3. Add: `"Note: episode_duration_hours is null for ~2% of patients where discharged_at is missing — these correspond to the 'No Release Recorded' outcome cases. See B10 benchmark."`

**PASS:** Comment appears with timestamp and user attribution.

### Step 15.2 — Add a Reply
1. **Reply** to the comment
2. Write: `"Confirmed. These cases were active at the time the dataset was collected and never received a formal discharge activity."`

**PASS:** Threaded reply appears.

### Step 15.3 — Comments on Agents
1. Open **Agent Studio** → select the Sepsis Clinical Analyst
2. Check if a Comments tab or section exists
3. Add a comment

**PASS:** Comment saved and attributed to the current user.

### Step 15.4 — Comments on Logic Functions
1. Open **Logic Studio** → select a function
2. Add a comment

**PASS:** Comment saved.

---

## MODULE 16 — Activity Log & Audit

**Goal:** Verify pipeline runs and system actions leave a traceable audit trail.

### Step 16.1 — Event Log
1. Open **Activity** → **Event Log** tab
2. Filter by source: `pipeline`

**PASS:** `Sepsis Case Ingest` pipeline run appears as a logged event with timestamp.

### Step 16.2 — Event Log Filtering
1. Try different event type filters
2. Search by keyword

**PASS:** Filters narrow results. Search returns matching events.

### Step 16.3 — Audit Log
1. Click **Audit Log** tab
2. Verify system actions are logged: create, update, delete, login

**PASS:** Audit entries show action type, timestamp, user, and affected resource.

### Step 16.4 — Audit Log Detail
1. Click an audit entry to expand details

**PASS:** Full details of the action are visible including before/after state where applicable.

---

## MODULE 17 — Platform Health

**Goal:** Confirm all services powering the clinical ontology are healthy.

### Step 17.1 — Health Dashboard
1. Open **Settings** → **System Health** tab

**PASS:** Service health dashboard renders.

### Step 17.2 — Verify Service Groups

| Group | Expected Services |
|---|---|
| Core | ontology-service, connector-service, pipeline-service |
| Data | event-log-service, search-service |
| Intelligence | inference-service, agent-service, logic-service |
| Operations | process-engine, analytics-service |
| Platform | auth-service, admin-service, notification-service |

**PASS:** All service groups visible with individual service status.

### Step 17.3 — Service Latency
1. Check latency values for each service

**PASS:** All core services show latency < 500ms.

### Step 17.4 — Sepsis Service Health
**PASS:** `sepsis-service` appears with green/OK status.

---

## MODULE 18 — Schedules

**Goal:** Confirm the continuous hydration schedule is registered and active.

### Step 18.1 — View Schedules
1. Open **Settings** → **Schedules** (or dedicated Schedules page)

**PASS:** `Hourly Sepsis Sync` schedule appears with cron `0 * * * *` and a future next-run timestamp.

### Step 18.2 — Create an Agent Schedule
1. Schedule an agent for periodic execution

**PASS:** Agent schedule saved with cron expression and appears in the schedules list.

---

## MODULE 19 — Admin Hub

**Goal:** Verify tenant-level administration — user management and usage reporting.

### Step 19.1 — Users Tab
1. Open **Admin** → **Users** tab

**PASS:** User list renders. At minimum, the admin user appears.

2. Click **+ Invite User** (or **New User**)
3. Fill in a test email, assign role `analyst`
4. Save

**PASS:** New user appears in the list with `analyst` role. Status shows pending or active.

5. Edit the user — change role to `admin`, then back to `analyst`

**PASS:** Role update saves without error.

### Step 19.2 — Verify Role Options

| Role | Description |
|---|---|
| Admin | Full access to all modules |
| Data Engineer | Access to connectors, pipelines, ontology |
| Analyst | Read access + agent studio + data explorer |
| Viewer | Read-only access |

**PASS:** All roles appear in the role selection dropdown.

### Step 19.3 — Module Access Control
1. For a user with `Analyst` role, check the module access permissions
2. Verify restricted modules are not accessible

**PASS:** Module access matrix reflects role-based restrictions.

### Step 19.4 — User Activation/Deactivation
1. Deactivate a test user
2. Reactivate them

**PASS:** Status toggles correctly. Deactivated users cannot log in.

### Step 19.5 — Tenants Tab
1. Click **Tenants** tab

**PASS:** Tenant list shows `tenant-demo-ai` (or your active tenant).

2. Click the tenant row

**PASS:** Usage stats show non-zero record counts for `Patient` and `ClinicalEvent` object types, reflecting the pipeline runs from Modules 3.2 and 3.3.

---

## MODULE 20 — Value Monitor

**Goal:** Track the operational value delivered by the Sepsis Case Ingest automation.

> **Prerequisite:** `Sepsis Case Ingest` pipeline must have at least one completed run.

### Step 20.1 — Create a Value Category
1. Open **Value Monitor** → **+ New Category**
2. Fill in:
   - **Name:** `Clinical Operations Automation`
   - **Currency:** `USD`
3. **Create Category**

**PASS:** Category card appears with $0 identified value.

### Step 20.2 — Create a Use Case Linked to the Pipeline
1. **+ New Use Case**
2. Fill in:
   - **Name:** `Sepsis Case Ingest Automation`
   - **Source Type:** `Pipeline`
   - **Source:** `Sepsis Case Ingest`
   - **Value per Run:** `250`
   - **Value per Record:** `0.50`
   - **Track Records:** ON
   - **Est. Runs/Month:** `30`
3. Note the **Formula Preview**
4. **Create Use Case**

**PASS:** Use case appears. Identified value card updates to non-zero.

### Step 20.3 — Verify Summary Cards

**PASS:**
- **Identified** card > $0
- **Framed** = $0
- **Realized** = $0

### Step 20.4 — Sync and Log Runs

1. Use case detail → **Realize Value** tab → **Sync Runs**

**PASS:** List of completed pipeline runs appears.

2. With at least one run included → **Log All Included**

**PASS:** Realized value on use case increases. Global Realized summary card updates.

### Step 20.5 — Frame Value

1. **Frame Value** tab → **Framed Value:** `5000`

**PASS:** Framed card shows $5,000. Progress bar shows Realized vs. Framed percentage.

### Step 20.6 — Timeline Chart

1. **Identify Value** tab → scroll to **Realized Value Timeline**

**PASS:** Chart renders with a non-zero bar for the current month. Hover tooltip shows dollar amount.

### Step 20.7 — Category Color and Currency
1. Edit the category — change color and currency

**PASS:** Changes persist and display correctly.

---

## MODULE 21 — Settings Hub

**Goal:** Verify all platform settings tabs are functional.

### Step 21.1 — General Tab
1. Open **Settings** → **General**
2. Check:
   - Organization name is displayed
   - Tenant ID is visible and copyable (click to copy)
   - Timezone configuration is present
   - Account info section shows current user

**PASS:** All general settings fields render and are editable where expected.

### Step 21.2 — Notifications Tab
1. Click **Notifications** tab
2. Configure email notification settings (SMTP server, from address)
3. Configure Slack webhook URL
4. Click **Test Delivery** for each

**PASS:** Test delivery fires without error. If a real endpoint is configured, notification is received.

### Step 21.3 — API Keys Tab
1. Click **API Keys** tab
2. Click **+ Generate Key**
3. Copy the generated key
4. Verify key appears in the list with creation timestamp

**PASS:** API key generated and displayed. Key can be revoked.

### Step 21.4 — Data Retention Tab
1. Click **Data Retention** tab
2. Verify retention policies for:
   - Event logs
   - Audit logs
   - Object records

**PASS:** Retention period settings are displayed and configurable.

### Step 21.5 — Permissions Tab
1. Click **Permissions** tab
2. Review the role-based capability matrix (Admin / Analyst / Viewer)

**PASS:** Permission matrix renders showing which capabilities each role has.

### Step 21.6 — Alerts Tab
1. Click **Alerts** tab
2. Create a new alert rule
3. Edit and delete the rule

**PASS:** CRUD operations work for alert rules.

### Step 21.7 — API Gateway Tab
1. Click **API Gateway** tab
2. Click **+ New Endpoint**
3. Configure:
   - Object Type: `Patient`
   - Methods: GET
   - Scope: read-only
4. Save

**PASS:** REST endpoint is created and appears in the list. Enable/disable toggle works.

### Step 21.8 — System Health Tab
(Covered in Module 17)

---

## MODULE 22 — Projects (MAIC)

**Goal:** Verify project management and organizational tracking.

### Step 22.1 — Create a Project
1. Open **Projects** (in the MAIC nav group)
2. Click **+ New Project**
3. Fill in:
   - **Name:** `Sepsis Pathway Optimization`
   - **Description:** `Clinical pathway analysis and optimization for sepsis patient care`
4. Save

**PASS:** Project created and appears in the project list.

### Step 22.2 — Project Stages
1. Open the project
2. Verify the stage pipeline is visible: **Discover → Design → Implement → Monitor**
3. Move the project to the next stage

**PASS:** Stage transition works. Current stage indicator updates.

### Step 22.3 — Stage Comments
1. Add a comment to the current stage
2. Reply to the comment

**PASS:** Comments saved with user attribution and timestamp.

### Step 22.4 — Team Member Assignment
1. Add a team member to the project
2. Assign a role

**PASS:** Team member appears in the project with assigned role.

### Step 22.5 — Gantt Chart
1. Check if a Gantt/timeline visualization is available

**PASS:** Timeline renders with project milestones.

### Step 22.6 — Link to Ontology Records
1. Link the project to a Patient or ClinicalEvent record

**PASS:** Record linkage saved and navigable.

---

## MODULE 23 — Finance (MAIC)

**Goal:** Verify financial tracking capabilities.

### Step 23.1 — Create a Transaction
1. Open **Finance** (in the MAIC nav group)
2. Add a new transaction:
   - **Description:** `Sepsis analysis tooling subscription`
   - **Amount:** `500`
   - **Category:** `Software`
   - **Type:** Revenue or Expense
3. Save

**PASS:** Transaction appears in the transaction list.

### Step 23.2 — Category Management
1. Verify expense categories exist: Salaries, Software, Admin, Marketing, Office
2. Add a custom category if possible

**PASS:** Categories display correctly.

### Step 23.3 — Financial Charts
1. Check for budget vs. actual reporting
2. Verify line/bar charts render with financial data

**PASS:** Charts render without error.

### Step 23.4 — Revenue Tracking
1. Add a revenue entry
2. Verify it appears in the receivables section

**PASS:** Revenue tracked separately from expenses.

---

## MODULE 24 — Nexus Assistant (Right Sidebar)

**Goal:** Verify the contextual AI assistant that provides help throughout the platform.

### Step 24.1 — Open the Assistant
1. Click the assistant icon in the right sidebar (or wherever it's accessible)

**PASS:** Assistant panel opens with a chat interface.

### Step 24.2 — Context-Aware Help
1. Navigate to **Pipelines** page
2. Open the assistant
3. Ask: *"How do I create a new pipeline?"*

**PASS:** Assistant provides relevant help about pipeline creation. Response is context-aware (knows you're on the Pipelines page).

### Step 24.3 — Multi-Turn Conversation
1. Follow up: *"What node types are available?"*

**PASS:** Assistant maintains conversation context and provides a list of pipeline node types.

### Step 24.4 — Conversation History
1. Check if previous conversations are saved
2. Navigate to an older conversation

**PASS:** Conversation history is accessible. Previous threads are listed.

### Step 24.5 — Live Data Fetching
1. Ask the assistant about current platform state: *"How many pipelines do I have?"*

**PASS:** Assistant fetches live data from services and returns an accurate count.

---

## MODULE 25 — UI Shell & Navigation

**Goal:** Verify platform shell components — navigation, theme, shortcuts, and responsive behavior.

### Step 25.1 — NavRail Navigation
1. Click each item in the left navigation rail
2. Verify each navigates to the correct module

**PASS:** All nav items work. Active item is highlighted.

### Step 25.2 — NavRail Collapse
1. Click the collapse/expand toggle on the nav rail

**PASS:** Nav rail collapses to icon-only mode. Expands back to full width.

### Step 25.3 — Theme Toggle
1. Toggle between **Light** and **Dark** themes

**PASS:** Theme switches without page reload. All components render correctly in both themes.

### Step 25.4 — Density Setting
1. Toggle density between compact / normal / spacious (if available)

**PASS:** UI density adjusts. Tables and lists reflect the new spacing.

### Step 25.5 — Keyboard Shortcuts
1. Press `?` or check the shortcuts overlay

**PASS:** Shortcuts reference modal appears showing:
- `⌘K` — Global search
- `Escape` — Close modals/panels
- `?` — Show shortcuts

### Step 25.6 — Breadcrumb Navigation
1. Navigate deep into a module (e.g., Pipelines → specific pipeline → node detail)
2. Check the breadcrumb bar

**PASS:** Breadcrumbs show the navigation hierarchy. Clicking a breadcrumb navigates to that level.

### Step 25.7 — Notification Bell
1. Click the notification bell icon in the top bar

**PASS:** Notification drawer opens. Shows recent notifications or empty state.

### Step 25.8 — Language Selector
1. Open the user menu (bottom of nav rail)
2. Switch language from English to Español

**PASS:** UI labels switch to Spanish. Switch back to English.

### Step 25.9 — User Menu
1. Click the user avatar/name at the bottom of the nav rail

**PASS:** Menu shows: user info, language selector, and sign out option.

---

## MODULE 26 — Lineage & Data Provenance

**Goal:** Verify data lineage tracking through the platform.

### Step 26.1 — View Data Lineage
1. Navigate to the lineage visualization (if accessible from ontology or pipelines)

**PASS:** Lineage canvas renders showing data flow from connectors through pipelines to object types.

### Step 26.2 — Trace a Record
1. For a Patient record, check if lineage information shows which pipeline ingested it

**PASS:** Record provenance is visible — shows the pipeline and connector source.

---

## Summary Scorecard

| Module | Focus | Checks |
|---|---|---|
| 0. Authentication | Login, session, tenant, SSO | 5 |
| 1. Connectors | Data source registration, health, import | 8 |
| 2. Ontology | Semantic domain model, schema diff | 5 |
| 3. Pipeline Builder | Ontology hydration, node types, topology | 7 |
| 4. Graph Explorer | Operational graph, interaction | 5 |
| 5. Data Explorer | Domain-level queries, charts, export | 6 |
| 6. Data Quality | Data completeness, distribution | 5 |
| 7. Search | Cross-entity search, navigation | 6 |
| 8. Apps | AI dashboards, manual build, all widget types | 11 |
| 9. Logic Studio | Block-based workflows, conditionals, all block types | 9 |
| 10. Agent Studio | AI benchmark, all tools, schedule, test harness | 9 |
| 11. Human Actions | Action definitions, approve/reject, checkpoint | 7 |
| 12. Process Mining | Map, Variants, Cases, Conformance, Alerts, Settings, AI Analyze | 8 |
| 13. Evals | Ground-truth evaluation, experiments | 6 |
| 14. Utilities | Enrichment tools, all categories | 6 |
| 15. Collaboration | In-context knowledge, multi-entity comments | 4 |
| 16. Activity & Audit | Event log, audit trail, filtering | 4 |
| 17. Platform Health | Service observability, latency | 4 |
| 18. Schedules | Pipeline and agent schedules | 2 |
| 19. Admin Hub | Users, roles, access control, tenants | 5 |
| 20. Value Monitor | Value lifecycle, timeline charts | 7 |
| 21. Settings Hub | General, notifications, API keys, retention, permissions, gateway | 7 |
| 22. Projects | Project management, stages, Gantt | 6 |
| 23. Finance | Transactions, categories, charts | 4 |
| 24. Nexus Assistant | Contextual AI help, conversation history | 5 |
| 25. UI Shell | Nav, theme, shortcuts, i18n, notifications | 9 |
| 26. Lineage | Data provenance tracking | 2 |
| **Total** | | **164 checks** |

**Passing threshold:** 140/164 (85%) = demo-ready
**164/164** = production QA sign-off

---

## Appendix A — Useful curl Commands

```bash
# Dataset overview
curl http://localhost:8023/info | jq .

# Ground-truth benchmark answers
curl http://localhost:8023/benchmark | jq '.items[] | {id, question, answer}'

# Aggregate clinical stats
curl http://localhost:8023/stats | jq .

# 5 ICU patients
curl "http://localhost:8023/cases?limit=5&has_icu=true" | jq '.items[] | {case_id, age, outcome}'

# Patient A full care trace
curl "http://localhost:8023/cases/A/trace" | jq '{num_events, first_activity: .events[0].activity}'

# Care activity frequency ranking
curl "http://localhost:8023/events/activities" | jq '.items[0:5]'

# Care pathway flow graph (top 10 transitions)
curl "http://localhost:8023/flow" | jq '.edges[0:10]'

# Daily admissions timeline
curl "http://localhost:8023/timeline?bucket=day" | jq '.items[0:10]'

# Test process mining with field overrides (use actual object_type_id UUID)
curl -H "x-tenant-id: tenant-demo-ai" \
  "http://localhost:8009/process/transitions/<OBJECT_TYPE_UUID>?activity_attribute=activity&case_id_attribute=case_id&timestamp_attribute=occurred_at" | jq .
```

---

## Appendix B — Clinical Domain Facts

Cross-check these known facts — any deviation suggests a data or pipeline issue:

1. **Every episode begins with `ER Registration`** — if any trace doesn't start there, there is a parsing or ordering bug
2. **No ICU admission precedes ER Registration** — clinical ordering check
3. **Leucocytes is among the most frequent activities** — expected in top 3 lab activities
4. **Release A is typically the most common outcome** — verify with B8
5. **Timestamps span 2013–2015** — dates outside this range indicate a parse error
6. **Some episodes are < 1 hour** — valid (quick ER discharge without admission)
7. **Some episodes are > 500 hours** — valid (extended ICU stays)
8. **`care_unit` values are single letters (A–E) or named units** — garbled values indicate XES parsing failure

---

## Appendix C — Ontology Design Notes

| API field | Ontology property | Why |
|---|---|---|
| `has_icu_admission` | `icu_admitted` | Domain language — clinicians say "admitted to ICU" |
| `duration_hours` | `episode_duration_hours` | Clarifies what the duration measures |
| `start_time` / `end_time` | `admitted_at` / `discharged_at` | Domain events, not generic timestamps |
| `org_group` | `care_unit` | "Org group" is a process mining term; "care unit" is what clinicians call it |
| `sirs_2_or_more` | `sirs_criteria_met` | The boolean describes what it means clinically |

A Nexus ontology should be readable by a clinician, not just an engineer.

---

## Appendix D — Re-run Instructions

```bash
# Reset cached data and rebuild
docker-compose stop sepsis-service
docker volume rm nexus-new-origins_sepsis-data
docker-compose up -d --build sepsis-service

# Watch startup logs
docker-compose logs -f sepsis-service
```

Expected:
```
[sepsis] Parsed 1050 cases, 15214 events
INFO:     Application startup complete.
```

---

## Appendix E — Process Mining Troubleshooting

### Problem: 15,000+ cases with 0 transitions
**Cause:** Events are stored with generic fields (`case_id=evt_*`, `activity=RECORD_CREATED`) instead of domain values. The real data is nested in `attributes.record_snapshot`.

**Fix:** In Process Mining → Settings tab, set:
- **Case ID Field Override:** `case_id`
- **Activity Field Override:** `activity`
- **Timestamp Field Override:** `occurred_at`

Click **Save & Apply**. The process engine will extract real values from the record snapshot.

### Problem: AI Analyze returns heuristic results only
**Cause:** Missing `ANTHROPIC_API_KEY` in the pipeline-service container.

**Fix:** Ensure `docker-compose.yml` includes `- ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}` in the pipeline-service environment section. Rebuild: `docker compose up -d --build pipeline-service`.
