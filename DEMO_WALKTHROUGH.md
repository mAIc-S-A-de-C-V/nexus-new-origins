# Nexus Platform — Complete Demo Walkthrough

> **Purpose:** Step-by-step guide for recording demo videos showcasing every feature of Nexus across 10 real-world process mining datasets spanning Finance, Procurement, Healthcare, Government, Manufacturing, and Travel.

---

## Prerequisites

1. Platform running: `docker-compose up -d --build`
2. Frontend at `http://localhost:3000`
3. All services healthy (check Settings → System Health)
4. LLM provider configured. Either:
   - Set `ANTHROPIC_API_KEY` in `.env` (platform-wide fallback used for any tenant that hasn't customised), **or**
   - Sign in and add a provider per-tenant in **Settings → AI Models** (Anthropic / OpenAI / Azure OpenAI / Local Ollama / vLLM / LM Studio). Hit **Test** to confirm the connection, then mark **Default for tenant**.
5. Demo service running at `http://localhost:8024` (included in docker-compose)
6. Default landing page is **Dashboards** (`apps`) — fresh sign-ins land here. Returning users resume their last page.

## Demo User Accounts

Each demo tenant has a pre-seeded admin user. Log in at `http://localhost:3000` with the email and password below.

### Admin Accounts

| Email | Password | Tenant | Notes |
|-------|----------|--------|-------|
| `admin@maic.ai` | Set via `ADMIN_SEED_PASSWORD` env var | `tenant-001` | Platform super-admin. If env var is not set, a random password is generated at startup — check auth-service logs or set the env var in `.env`. |
| `admin@mjsp.sv` | Set via `MJSP_ADMIN_PASSWORD` env var | `tenant-mjsp` | MJSP tenant admin. Same behavior — set the env var or check logs. |

### Demo User Accounts (fixed passwords)

| Email | Password | Tenant | Persona | Best For |
|-------|----------|--------|---------|----------|
| `ana@finance.demo` | `Finance2024!demo` | `tenant-finance` | Ana Torres — Finance | Demo 1 (Loan Apps 2012), Demo 2 (Loan Apps 2017) |
| `carlos@procurement.demo` | `Procure2024!demo` | `tenant-procurement` | Carlos Reyes — Procurement | Demo 3 (SAP Purchase Orders) |
| `laura@healthcare.demo` | `Health2024!demo` | `tenant-healthcare` | Dr. Laura Mendez — Healthcare | Demo 4 (Hospital), Demo 8 (Sepsis ICU) |
| `diego@itsm.demo` | `Service2024!demo` | `tenant-itsm` | Diego Vargas — ITSM | Demo 5 (Rabobank ITIL Incidents) |
| `sofia@government.demo` | `GovComp2024!demo` | `tenant-government` | Sofia Castillo — Government | Demo 6 (Traffic Fines), Demo 7 (Building Permits) |
| `miguel@manufacturing.demo` | `Factory2024!demo` | `tenant-manufacturing` | Miguel Ortega — Manufacturing | Demo 9 (Smart Factory IoT) |
| `elena@travel.demo` | `Travel2024!demo` | `tenant-travel` | Elena Rios — Travel | Demo 10 (University Travel Expenses) |
| `demo@demo.nexus` | `NexusDemo2024!x` | `tenant-demo` | Demo User | General-purpose demo account |

> **Tenant isolation:** Each user sees only data within their tenant. Log in as the matching persona for each demo to start with a clean workspace. Data created in one tenant is invisible to others.

## Demo Data Service

All 19 datasets are served by the **Demo Service** at `http://localhost:8024`. No file downloads or conversions needed — just point REST_API connectors at it.

**Browse all datasets:** http://localhost:8024/docs

**Quick reference — Connector Base URLs:**

**Base URL for ALL connectors:** `http://demo-service:8024`

| Dataset | Endpoint Path (set in Configuration tab) |
|---------|------------------------------------------|
| BPIC 2012 Loan Apps | `/datasets/bpic2012-loan-applications/records` |
| BPIC 2017 Loan Apps v2 | `/datasets/bpic2017-loan-applications/records` |
| BPIC 2019 SAP POs | `/datasets/bpic2019-purchase-orders/records` |
| BPIC 2011 Hospital | `/datasets/bpic2011-hospital/records` |
| Sepsis ICU | `/datasets/sepsis-icu/records` |
| BPIC 2014 Incidents | `/datasets/bpic2014-incidents/records` |
| BPIC 2014 Changes | `/datasets/bpic2014-changes/records` |
| Traffic Fines | `/datasets/traffic-fines/records` |
| Building Permits M1-M5 | `/datasets/bpic2015-permits-m1/records` (through m5) |
| Smart Factory IoT | `/datasets/smart-factory-iot/records` |
| BPIC 2020 Domestic | `/datasets/bpic2020-domestic/records` |
| BPIC 2020 International | `/datasets/bpic2020-international/records` |
| BPIC 2020 Prepaid | `/datasets/bpic2020-prepaid/records` |
| BPIC 2020 Permits | `/datasets/bpic2020-permits/records` |
| BPIC 2020 Payments | `/datasets/bpic2020-payments/records` |

**Each dataset provides these endpoints:**
- `GET /records?limit=500&offset=0` — Paginated event records (for pipeline SOURCE)
- `GET /schema` — Field names + types + samples (for schema inference)
- `GET /cases?limit=50` — Case-level summaries
- `GET /stats` — Quick statistics (case count, activity list, date range)

**Connector setup pattern for ALL demos:**
1. Create a **REST API** connector (not File Upload)
2. **Base URL:** `http://demo-service:8024`
3. **Auth:** None
4. **Endpoint path (in Configuration tab):** `/datasets/{dataset-id}/records`
   - e.g. `/datasets/bpic2012-loan-applications/records`
5. **Pagination:** offset-based (limit/offset query params — handled automatically)

---

# Demo 1: Finance — Loan Application (BPIC 2012)

**Dataset:** BPI Challenge 2012 — Dutch bank loan applications
**Source:** https://data.4tu.nl/articles/dataset/BPI_Challenge_2012/12689204
**Size:** ~13,087 cases, ~262,200 events
**Columns (after CSV conversion):**
| Column | Description |
|--------|------------|
| `case:concept:name` | Application ID (e.g., "173688") |
| `concept:name` | Activity name (e.g., "A_SUBMITTED", "W_Completeren aanvraag") |
| `time:timestamp` | Event timestamp |
| `lifecycle:transition` | Event lifecycle (SCHEDULE, START, COMPLETE) |
| `org:resource` | Employee/resource ID |
| `case:AMOUNT_REQ` | Requested loan amount |
| `case:REG_DATE` | Application registration date |

### What You'll See in Nexus

**Process Map:** Complex flow with ~24 activities. Main happy path: A_SUBMITTED → A_PARTLYSUBMITTED → A_PREACCEPTED → W_Completeren_aanvraag → A_ACCEPTED → A_FINALIZED. Multiple loops through "W_" (work item) activities showing rework.

**Key Insights:**
- High rework rate in "W_Completeren aanvraag" (completing the application)
- Bottleneck at "W_Nabellen offertes" (calling back offers) — avg 5-10 day wait
- ~30% of applications get declined (A_DECLINED)
- Loan amount (`AMOUNT_REQ`) correlates with approval likelihood

**Variants:** 4,366 unique variants — extremely high variability. Top 5 variants cover ~30% of cases.

---

### Step-by-Step

#### Step 1: Create the Connector

1. **Navigate:** Click **Connectors** in the left nav rail
2. **Add:** Click the **"+ Add Connector"** button (top right)
3. **Select type:** Choose **"REST API"** from the modal
4. **Configure:**
   - **Name:** `BPIC 2012 - Loan Applications`
   - **Description:** `Dutch bank loan application process log — 13K cases, 262K events`
   - **Base URL:** `http://demo-service:8024`
   - **Auth Type:** None
5. **Save:** Click **"Add Connector"**
6. **Configure endpoint:** In the connector detail panel, go to the **Configuration** tab
   - Set **Endpoint Path:** `/datasets/bpic2012-loan-applications/records`
   - Click **Test** — should return records with fields: case_id, activity, timestamp, lifecycle, resource, amount_requested, reg_date

#### Step 2: Run Schema Inference

1. **Go to Schema tab** in the connector detail panel
2. Click **"Run Inference"** (blue button)
3. **Watch the log** — system sends sample rows to Claude, which returns:
   - `case:concept:name` → **IDENTIFIER** (case ID), confidence 98%
   - `concept:name` → **CATEGORY** (activity name), confidence 95%
   - `time:timestamp` → **DATETIME**, confidence 99%
   - `org:resource` → **IDENTIFIER** (resource ID), confidence 90%
   - `case:AMOUNT_REQ` → **CURRENCY**, confidence 92%
   - `lifecycle:transition` → **CATEGORY**, confidence 88%
4. **Review inferred fields** — check semantic types, PII levels (all should be NONE for this dataset)

#### Step 3: Create Object Type

1. Click **"Create Object Type: LoanApplication"** (or whatever Claude suggests)
2. System creates the object type in the **Ontology** with all inferred properties
3. System auto-generates a pipeline: `SOURCE(BPIC 2012) → SINK_OBJECT(LoanApplication)`
4. **Navigate to Ontology** — see the new `LoanApplication` node in the graph
5. Click the node → verify properties in the **Properties** tab

#### Step 4: Run the Pipeline

1. **Navigate:** Click **Pipelines** in the left nav rail
2. Find the auto-generated pipeline (named something like `BPIC 2012 - Loan Applications → LoanApplication`)
3. Click **Play** (run button) to execute
4. Watch status change: DRAFT → RUNNING → IDLE
5. Verify row count in the pipeline KPI banner: ~262,200 rows synced

#### Step 5: Process Mining

1. **Navigate:** Click **Data** → **Process Mining** in the left nav rail
2. **Select object type:** Choose `LoanApplication` from the dropdown at the top
3. **Configure event attributes** (Settings tab):
   - **Case ID:** `case:concept:name`
   - **Activity:** `concept:name`
   - **Timestamp:** `time:timestamp`
4. **Process Map tab:**
   - See the Sankey/flow diagram with all activities
   - **Point out:** The main flow A_SUBMITTED → A_PARTLYSUBMITTED → A_PREACCEPTED
   - **Point out:** The loops through W_ activities (rework)
   - Frequency labels on edges show how many cases take each path
5. **Variants tab:**
   - 4,366 unique process variants
   - Top variant: the "happy path" — ~8% of cases
   - Click a variant → see its case list
6. **Bottlenecks tab:**
   - "W_Nabellen offertes" shows longest average duration
   - "W_Completeren aanvraag" shows highest event count (rework)
7. **Conformance tab:**
   - Define happy path: A_SUBMITTED → A_PREACCEPTED → A_ACCEPTED → A_FINALIZED
   - See compliance score (likely ~15-20% for this complex process)
8. **Insights tab:**
   - Click **Refresh** to trigger AI analysis
   - Expect insights like: "HIGH: Rework loop detected in W_Completeren_aanvraag affecting 8,421 cases"
   - "MEDIUM: Bottleneck at W_Nabellen_offertes — avg wait time 7.2 days"
9. **Cases tab:**
   - Browse individual application cases
   - Click a case → see timeline of all events
   - Filter by AMOUNT_REQ > 10000 to see high-value applications

#### Step 6: Create Dashboard

1. **Navigate:** Click **Dashboards** in the left nav rail
2. Click **"Generate with Claude"**
3. **Prompt:** `Loan application dashboard showing: approval rate, average processing time, top bottleneck activities, applications by amount requested, monthly application volume trend`
4. **Select data source:** Check `LoanApplication`
5. **Review generated layout** — should include:
   - Metric cards: Total Applications (13,087), Approval Rate, Avg Duration
   - Bar chart: Applications by activity frequency
   - Line chart: Monthly application volume trend
   - Pie chart: Application outcomes (Accepted/Declined/Cancelled)
   - Data table: Recent applications with key fields
6. Click **"Create App"**
7. **Edit mode:** Fine-tune positions, add a Chat widget
8. **Add Chat widget:**
   - Drag "Chat" from the left palette
   - In config panel → DATA SOURCES: check `LoanApplication`
   - Also check sibling widgets under "Dashboard Widgets"
   - Ask: *"What percentage of applications over €20,000 get declined?"*

#### Step 7: Build an Agent

1. **Navigate:** Click **Agent Studio** in the left nav rail
2. Click **"+ New Agent"**
3. **Configure:**
   - **Name:** `Loan Risk Analyst`
   - **System prompt:** `You are a loan application risk analyst. Analyze application patterns, identify cases at risk of decline, and flag unusual processing delays. When you find concerning patterns, propose alerts via action_propose.`
   - **Model:** Sonnet 4.6
   - **Max iterations:** 5
   - **Enable tools:** `list_object_types`, `get_object_schema`, `query_records`, `count_records`, `action_propose`
   - **Knowledge scope:** Select `LoanApplication`
4. **Run** the agent → watch it query data, analyze patterns, propose actions
5. **Check Human Actions** queue for proposed alerts

---

# Demo 2: Finance — Loan Application Enhanced (BPIC 2017)

**Dataset:** BPI Challenge 2017 — Same Dutch bank, richer data
**Source:** https://data.4tu.nl/repository/uuid:5f3067df-f10b-45da-b98b-86ae4c7a310b
**Size:** ~31,509 cases, ~1,202,267 events
**Additional columns vs 2012:**
| Column | Description |
|--------|------------|
| `case:ApplicationType` | Loan type (e.g., "New credit", "Limit raise") |
| `case:LoanGoal` | Purpose (e.g., "Home improvement", "Car") |
| `case:RequestedAmount` | Loan amount requested |
| `case:OfferID` | Linked offer identifier |
| `case:CreditScore` | Applicant credit score |
| `case:NumberOfTerms` | Loan term in months |
| `case:Accepted` | Final outcome (true/false) |
| `Action` | Sub-activity detail |
| `EventOrigin` | System that generated event (Application, Offer, Workflow) |

### What You'll See in Nexus

**Process Map:** Three parallel sub-processes visible: Application (A_), Offer (O_), Workflow (W_). More structured than BPIC 2012 with clear offer lifecycle.

**Key Insights:**
- Offers go through: O_Created → O_Sent → O_Returned (or O_Cancelled)
- Multiple offers per application — up to 8 iterations
- Credit score strongly correlates with offer acceptance
- "Limit raise" applications have 2x faster processing than "New credit"
- 42% of offers are cancelled before customer response

**Dashboard Ideas:**
- Offer funnel: Created → Sent → Returned → Accepted
- Credit score distribution by outcome
- Processing time by ApplicationType
- Offer iteration count histogram

### Step-by-Step

1. **Connector:** Create `BPIC 2017 - Loan Applications v2` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2017-loan-applications/records`)
2. **Test:** `/records?limit=10` — see enriched fields: credit_score, loan_goal, application_type, accepted
3. **Schema inference:** Claude detects ApplicationType as CATEGORY, RequestedAmount as CURRENCY, CreditScore as QUANTITY, Accepted as BOOLEAN
4. **Object type:** `LoanApplicationV2` — note the richer property set
5. **Pipeline:** SOURCE → SINK_OBJECT, run sync
6. **Ontology:** Link `LoanApplicationV2` to `LoanApplication` (from Demo 1) via ontology links — show cross-dataset relationships
7. **Process Mining:**
   - Set Case ID: `case:concept:name`, Activity: `concept:name`, Timestamp: `time:timestamp`
   - **Process Map:** Three parallel swim lanes visible (Application, Offer, Workflow)
   - **Filter** by EventOrigin = "Offer" to isolate offer subprocess
   - **Benchmark tab:** Compare `ApplicationType = "New credit"` vs `ApplicationType = "Limit raise"` — show side-by-side stats
   - **Root Cause:** Why do some applications take >30 days? (likely multiple offer iterations)
8. **Dashboard:** Generate with prompt: `Offer conversion funnel, credit score distribution by acceptance, processing time by loan type, monthly volume with trend line`
9. **Logic Studio function:**
   - Block 1: `ontology_query` — fetch applications where Accepted = false AND RequestedAmount > 20000
   - Block 2: `llm_call` — "Analyze these declined high-value applications and summarize common patterns"
   - Block 3: `send_email` — email summary to compliance team

---

# Demo 3: Procurement — SAP Purchase Orders (BPIC 2019)

**Dataset:** BPI Challenge 2019 — SAP Purchase Order handling
**Source:** https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853
**Size:** ~251,734 cases, ~1,595,923 events (the largest dataset)
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Purchase order ID |
| `concept:name` | Activity (e.g., "Create Purchase Order Item", "Record Goods Receipt") |
| `time:timestamp` | Event timestamp |
| `org:resource` | SAP user ID |
| `case:Purchasing Document` | SAP document number |
| `case:Vendor` | Vendor ID |
| `case:Item Category` | Material group category |
| `case:Item Type` | PO item type (Standard, Consignment, etc.) |
| `case:Spend area text` | Department/spend area |
| `case:Company` | Legal entity |
| `case:Document Type` | PO document type (Standard, Framework, etc.) |
| `case:Sub spend area text` | Sub-department |
| `case:Goods Receipt` | Whether goods receipt required |
| `Cumulative net worth (EUR)` | Financial value |

### What You'll See in Nexus

**Process Map:** Classic procure-to-pay flow: Create PO → Approve → Record Goods Receipt → Record Invoice Receipt → Clear Invoice → Payment. Many "maverick" paths (goods received before PO approval).

**Key Insights:**
- 3-way matching: PO vs Goods Receipt vs Invoice — conformance check
- Maverick buying: ~15% of cases skip approval
- Invoice-before-goods-receipt pattern in ~8% of cases
- Top 5 vendors account for 60% of spend
- Average PO cycle: 45 days (high variance by Item Category)
- "Framework" document types process 3x faster than "Standard"

**Dashboard Ideas:**
- Spend analytics: total by vendor, by category, by company
- PO cycle time distribution
- 3-way match compliance rate
- Maverick buying rate trend over time

### Step-by-Step

1. **Connector:** `BPIC 2019 - SAP Purchase Orders` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2019-purchase-orders/records`)
2. **Test:** `/stats` — see vendor list, spend areas, document types
3. **Schema inference:** Claude detects Vendor as IDENTIFIER, Cumulative net worth as CURRENCY, Item Category as CATEGORY, Company as CATEGORY
4. **Object type:** `PurchaseOrder`
5. **Pipeline:** Add a **FILTER** node to remove test/cancelled POs, then SINK_OBJECT
6. **Process Mining:**
   - **Process Map:** Highlight the standard procure-to-pay path
   - **Conformance:** Define golden path: Create PO → Record Goods Receipt → Record Invoice Receipt → Clear Invoice
   - **Show violations:** Goods receipt before PO approval (maverick buying)
   - **Bottlenecks:** Invoice clearing step shows longest delays
   - **Benchmark:** Compare `Document Type = "Framework"` vs `Document Type = "Standard"`
7. **Dashboard:** `Spend by vendor (top 20 bar chart), PO cycle time by item category, 3-way match compliance gauge, monthly PO volume trend, data table of recent POs`
8. **Agent:**
   - Name: `Procurement Compliance Auditor`
   - Prompt: `Audit purchase orders for maverick buying (goods receipt before approval), duplicate invoices, and vendor concentration risk. Flag violations via action_propose.`
   - Tools: query_records, count_records, action_propose
9. **Logic Studio:**
   - Block 1: `ontology_query` — POs where `Goods Receipt = true` AND no "Approve" event
   - Block 2: `llm_call` — "Summarize these maverick purchasing violations"
   - Block 3: `action` — propose "Flag for compliance review"
   - Schedule: Weekly

---

# Demo 4: Healthcare — Hospital Gynaecology (BPIC 2011)

**Dataset:** BPI Challenge 2011 — Dutch Academic Hospital patient journeys
**Source:** https://data.4tu.nl/articles/dataset/Hospital_log/12691105
**Size:** ~1,143 cases, ~150,291 events
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Patient case ID |
| `concept:name` | Medical activity (e.g., "administratief tarief - Loss blood panel", "TEE") |
| `time:timestamp` | Event timestamp |
| `org:group` | Department/medical group |
| `case:Diagnosis` | ICD diagnosis code |
| `case:Treatment code` | Treatment classification |
| `case:Diagnosis code` | Numeric diagnosis code |
| `case:Specialism code` | Medical specialty |
| `case:Age` | Patient age at admission |
| `Activity code` | Coded activity ID |

### What You'll See in Nexus

**Process Map:** Highly unstructured — medical processes are inherently variable. Many parallel activities (lab tests, imaging, consultations happening simultaneously). Very "spaghetti-like" process map.

**Key Insights:**
- ~624 unique activities (very high cardinality)
- Average case has 131 events (many lab tests/procedures)
- Patient age correlates with complexity (older → more events)
- Top diagnoses by case count reveal department load
- Some patients have >500 events (complex multi-month treatments)
- "administratief tarief" activities dominate (billing/admin)

**Dashboard Ideas:**
- Patient pathway complexity (events per case histogram)
- Department workload (events by org:group)
- Diagnosis distribution pie chart
- Average treatment duration by diagnosis
- Age distribution of patients

### Step-by-Step

1. **Connector:** `BPIC 2011 - Hospital Gynaecology` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2011-hospital/records`)
2. **Test:** `/schema` — see 10 fields including age, diagnosis, specialism_code
3. **Schema inference:** Claude detects Age as QUANTITY, Diagnosis as CATEGORY, timestamp as DATETIME
4. **Object type:** `HospitalPatient`
5. **Process Mining:**
   - **Settings:** Exclude "administratief tarief" activities (administrative noise) using the excluded activities filter
   - **Process Map:** Initially very complex — use the exclusion filter to simplify
   - **Variants:** Show top 10 variants — each representing a distinct care pathway
   - **Cases:** Browse individual patient journeys — click to see full timeline
   - **Filter:** by `Diagnosis code` to isolate specific conditions
   - **Insights:** AI detects: "HIGH: Patient cases with >200 events show 3x longer total duration"
6. **Dashboard:** `Patient count by diagnosis (bar), treatment duration distribution (histogram), department workload (pie), age vs event count scatter, case timeline table`
7. **PII Note:** Age and diagnosis codes are sensitive → show PII detection in Schema inference (should flag Age as LOW PII, Diagnosis as MEDIUM PII)

---

# Demo 5: IT Service Management — Rabobank ITIL (BPIC 2014)

**Dataset:** BPI Challenge 2014 — Rabobank IT incident & change management
**Source:** https://data.4tu.nl/collections/BPI_Challenge_2014/5065469
**Sub-logs:** Incident Activity, Incident, Change, Interaction
**Size:** ~46,616 incidents, ~466,737 events (across all sub-logs)
**Key columns (Incident Activity log):**
| Column | Description |
|--------|------------|
| `Incident ID` | Unique incident identifier |
| `DateStamp` | Event timestamp |
| `IncidentActivity_Type` | Activity (Assignment, In Progress, Awaiting, Closed, etc.) |
| `Assignment Group` | IT team assigned |
| `KM number` | Knowledge article referenced |
| `Interaction ID` | Link to user interaction |

**Key columns (Change log):**
| Column | Description |
|--------|------------|
| `Change ID` | Change request ID |
| `Change Type` | Normal, Standard, Emergency |
| `Risk Assessment` | Risk level |
| `CI Name` | Configuration Item affected |
| `Status` | Change status |

### What You'll See in Nexus

**Process Map (Incidents):** Classic ITIL flow: Opened → Assigned → In Progress → Resolved → Closed. Escalation loops visible (re-assignment between groups).

**Key Insights:**
- Average resolution time: varies by priority (P1: hours, P4: days)
- Reassignment rate: ~35% of incidents reassigned at least once
- Top assignment groups by incident volume
- Change-related incidents (linked via CI Name)
- Knowledge article usage correlates with faster resolution

**Multi-Object Type Demo:** This is perfect for showing **ontology links** — upload all 4 sub-logs as separate object types, then link them:
- `Incident` → `IncidentActivity` (has_many)
- `Incident` → `Interaction` (belongs_to)
- `Incident` → `Change` (many_to_many via CI Name)

### Step-by-Step

1. **Create 2 connectors** (REST API):
   - `BPIC 2014 - Incidents` → base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2014-incidents/records`
   - `BPIC 2014 - Changes` → base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2014-changes/records`
2. **Test** each: `/records?limit=5`
3. **Create 2 object types** via schema inference:
   - `ITIncident`, `ITChange`
4. **Define ontology links:**
   - Go to **Ontology** graph → click `ITIncident` node → **Links** tab
   - Add link: `ITIncident` → `ITIncidentActivity` (has_many, join on `Incident ID`)
   - Add link: `ITIncident` → `ITInteraction` (belongs_to, join on `Interaction ID`)
   - Add link: `ITIncident` → `ITChange` (many_to_many, join on `CI Name`)
   - See the links visualized as edges in the graph
5. **Process Mining** on `ITIncidentActivity`:
   - Case ID: `Incident ID`, Activity: `IncidentActivity_Type`, Timestamp: `DateStamp`
   - **Process Map:** ITIL lifecycle with escalation loops
   - **Bottlenecks:** "Awaiting User Info" is the longest wait state
   - **Benchmark:** Compare incidents by Assignment Group
6. **Dashboard:** `Incident volume trend, MTTR by priority, assignment group workload (bar), escalation rate metric, open incidents table with status`
7. **Agent:**
   - Name: `IT Service Desk Analyst`
   - Prompt: `Monitor IT incidents for SLA breaches, identify frequently reassigned tickets, and correlate incidents with recent changes. Propose escalation for aging P1/P2 incidents.`

---

# Demo 6: Government — Road Traffic Fines

**Dataset:** Road Traffic Fine Management Process
**Source:** https://data.4tu.nl/articles/dataset/Road_Traffic_Fine_Management_Process/12683249
**Size:** ~150,370 cases, ~561,470 events
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Fine case ID |
| `concept:name` | Activity (Create Fine, Send Fine, Insert Fine Notification, Add penalty, Payment, etc.) |
| `time:timestamp` | Event timestamp |
| `org:resource` | Processing resource (often numeric codes like 561) |
| `case:totalPaymentAmount` | Total amount (fine + penalties) |
| `case:amount` | Original fine amount |
| `case:vehicleClass` | Vehicle type (A=car, C=truck, M=motorcycle, etc.) |
| `case:article` | Traffic violation article |
| `case:points` | License points deducted |
| `case:notificationType` | How offender was notified |
| `case:lastSent` | Last notification sent |
| `dismissal` | Whether fine was dismissed |
| `paymentAmount` | Individual payment amount |

### What You'll See in Nexus

**Process Map:** Very structured government process: Create Fine → Send Fine → (Payment | Insert Fine Notification → Add penalty → Send for Credit Collection). Clear branches for payment vs non-payment.

**Key Insights:**
- ~53% of fines are paid directly after first notification
- Penalty addition happens after 60-90 days of non-payment
- Average fine: €70-120, with penalties growing to €300+
- Vehicle class A (cars) = 85% of all fines
- Article distribution shows most common violations
- Credit collection route: ~12% of cases
- Appeal/dismissal rate: ~4%

### Step-by-Step

1. **Connector:** `Road Traffic Fines` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/traffic-fines/records`)
2. **Test:** `/stats` — see activity list, date range, total cases
3. **Object type:** `TrafficFine`
4. **Schema inference highlights:**
   - `totalPaymentAmount` → CURRENCY
   - `vehicleClass` → CATEGORY
   - `points` → QUANTITY
   - `article` → CATEGORY
5. **Process Mining:**
   - **Process Map:** Clean, structured flow — great for demos (not spaghetti)
   - **Conformance:** Golden path = Create Fine → Send Fine → Payment (53% compliance)
   - **Variants:** Top 3 variants cover ~70% of cases
   - **Bottlenecks:** "Send for Credit Collection" has the longest cycle (months)
   - **Benchmark:** Compare `vehicleClass = A` vs `vehicleClass = C` (cars vs trucks)
   - **Root Cause:** Why do some fines go to credit collection? (Higher amounts, specific articles)
6. **Dashboard:** `Fine collection rate (metric), total revenue (metric), payment funnel (bar chart), fines by vehicle class (pie), fines by article (bar top 15), monthly fine volume trend, unpaid fines table`
7. **Logic Studio:**
   - Block 1: `ontology_query` — fines where Payment event missing AND age > 90 days
   - Block 2: `llm_call` — "Prioritize these overdue fines for collection based on amount and age"
   - Block 3: `action` — propose "Escalate to credit collection"

---

# Demo 7: Government — Building Permits (BPIC 2015)

**Dataset:** BPI Challenge 2015 — Building permit applications from 5 Dutch municipalities
**Source:** https://data.4tu.nl/collections/BPI_Challenge_2015/5065424
**Sub-logs:** 5 separate municipality logs
**Size:** ~1,199 cases, ~52,217 events (per municipality, 5 files total)
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Permit application ID |
| `concept:name` | Activity (e.g., "01_HOOFD_010", phase/milestone codes) |
| `time:timestamp` | Event timestamp |
| `org:resource` | Government employee |
| `case:Responsible_actor` | Responsible department |
| `case:SUMleges` | Total permit fees |
| `case:parts` | Number of permit parts/sections |
| `lifecycle:transition` | Event lifecycle stage |

### What You'll See in Nexus

**Process Map:** Long sequential government process with many milestones. Each activity is a regulatory step (coded). Processes span months to years.

**Key Insights:**
- Average permit processing: 6-18 months
- 5 municipalities show different processing patterns — perfect for benchmarking
- Fee (`SUMleges`) correlates with permit complexity
- Some permits require 20+ regulatory steps, others only 5
- Bottleneck: environmental review phase (weeks to months)

**Multi-Municipality Demo:** Upload all 5 as separate object types to compare:

### Step-by-Step

1. **Create 5 connectors** (REST API) — one per municipality:
   - `BPIC 2015 - Municipality 1` → base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2015-permits-m1/records`
   - `BPIC 2015 - Municipality 2` → endpoint: `/datasets/bpic2015-permits-m2/records`
   - `BPIC 2015 - Municipality 3` → endpoint: `/datasets/bpic2015-permits-m3/records`
   - `BPIC 2015 - Municipality 4` → endpoint: `/datasets/bpic2015-permits-m4/records`
   - `BPIC 2015 - Municipality 5` → endpoint: `/datasets/bpic2015-permits-m5/records`
2. **Create 5 object types** → `BuildingPermit_M1` through `BuildingPermit_M5`
3. **Ontology:** Show all 5 nodes in the graph — no links between them (independent municipalities)
4. **Process Mining:**
   - Analyze each municipality separately
   - **Benchmark tab:** Compare Municipality 1 vs Municipality 3 — different processing times for same permit types
   - **Conformance:** Define expected regulatory sequence → see which municipality deviates most
5. **Dashboard (multi-source):**
   - Use **multiple data sources** on the Chat widget: check all 5 BuildingPermit types
   - Ask: *"Which municipality processes permits fastest on average?"*
   - Metric cards: Total permits per municipality
   - Bar chart: Average processing time by municipality
6. **This demo showcases:** Multi-object-type dashboards + cross-dataset chat queries

---

# Demo 8: Healthcare — Sepsis ICU Pathways

**Dataset:** Sepsis Cases Event Log — ICU patient pathways
**Source:** https://data.4tu.nl/articles/dataset/Sepsis_Cases_-_Event_Log/12707639
**Size:** ~1,050 cases, ~15,214 events, **39 attributes** (richest per-event attributes)
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Patient case ID |
| `concept:name` | Activity (ER Registration, Leucocytes, CRP, IV Liquid, IV Antibiotics, Release, Return ER, etc.) |
| `time:timestamp` | Event timestamp |
| `org:group` | Department (ER, IC, General Ward, etc.) |
| `case:Diagnose` | Sepsis subtype diagnosis |
| `case:DiagnosticArtAstworworworwor` | Diagnostic category |
| `case:Age` | Patient age |
| `case:InfectionSuspected` | Boolean |
| `Leucocytes` | White blood cell count (numeric) |
| `CRP` | C-Reactive Protein level (numeric) |
| `LacticAcid` | Lactic acid level |
| `SIRSCritTachworworwor` | SIRS criteria met (boolean) |

### What You'll See in Nexus

**Process Map:** ER Registration → Triage → Lab tests (Leucocytes, CRP, LacticAcid) → IV Treatment → ICU admission (some) → Release/Death. Compact but medically meaningful.

**Key Insights:**
- 39 clinical attributes per event — richest dataset for AI analysis
- CRP > 100 correlates with ICU admission
- Lactic acid > 2.0 correlates with worse outcomes
- Average ER-to-release: 8-14 days for survivors
- "Return ER" events indicate readmission (quality metric)
- Age strongly predicts outcome severity

**This is the best dataset for AI agent demos** because of the rich clinical attributes.

### Step-by-Step

1. **Connector:** `Sepsis Cases - ICU` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/sepsis-icu/records`)
2. **Test:** `/schema` — see 11 fields including leucocytes, crp, lactic_acid, sirs_criteria_met
3. **Schema inference:** 39 fields — Claude labels clinical values:
   - `Leucocytes` → QUANTITY (lab value)
   - `CRP` → QUANTITY (lab value)
   - `Age` → QUANTITY, PII: LOW
   - `Diagnose` → CATEGORY, PII: MEDIUM (medical)
   - `InfectionSuspected` → BOOLEAN
4. **Object type:** `SepsisCase`
5. **PII Scan demo:**
   - Go to Ontology → `SepsisCase` → **PII Scan** tab
   - Show detected PII fields: Age (LOW), Diagnose (MEDIUM)
   - This is healthcare data — demonstrate the compliance features
6. **Process Mining:**
   - **Process Map:** Clear ER → Lab → Treatment → Outcome flow
   - **Filter:** by `InfectionSuspected = true` to focus on confirmed sepsis
   - **Benchmark:** Compare patients with `CRP > 100` vs `CRP <= 100`
   - **Root Cause:** Why do some patients return to ER? (high lactic acid, early release)
   - **Cases:** Click individual patient → see full clinical timeline with lab values at each step
7. **Dashboard:** `Patient outcomes (metric), avg length of stay (metric), CRP distribution (bar), lab value trends (line chart), patient case table with clinical attributes, chat widget with all widgets selected`
8. **Agent — Clinical Analyst:**
   - Name: `Sepsis Clinical Analyst`
   - Prompt: `Analyze sepsis patient pathways. Identify patients at high risk of readmission based on lab values (CRP, LacticAcid, Leucocytes) and treatment patterns. Flag cases where treatment protocol may have been delayed.`
   - Tools: query_records, count_records, process_mining, action_propose
   - **Run agent** → it queries lab values, identifies high-risk patients, proposes alerts
   - **Check Human Actions** → review proposed clinical alerts

---

# Demo 9: Manufacturing — Smart Factory IoT

**Dataset:** IoT-Enriched Event Log for Smart Factories
**Source:** https://figshare.com/articles/dataset/Dataset_An_IoT-Enriched_Event_Log_for_Process_Mining_in_Smart_Factories/20130794
**Size:** Varies (typically ~5,000-50,000 events)
**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Production order ID |
| `concept:name` | Manufacturing step (Cut, Weld, Assemble, QA Inspect, Pack, etc.) |
| `time:timestamp` | Event timestamp |
| `org:resource` | Machine/station ID |
| `Temperature` | IoT sensor: machine temperature |
| `Vibration` | IoT sensor: vibration level |
| `Power` | IoT sensor: power consumption |
| `Humidity` | IoT sensor: ambient humidity |
| `Pressure` | IoT sensor: pressure reading |
| `Quality_Score` | QA inspection result |
| `Defect_Type` | Type of defect found (if any) |

### What You'll See in Nexus

**Process Map:** Linear manufacturing flow: Raw Material → Cut → Weld → Assemble → QA Inspect → Pack → Ship. Some rework loops (QA fail → Rework → Re-inspect).

**Key Insights:**
- IoT sensor data (Temperature, Vibration, Power) at each manufacturing step
- Temperature > threshold at Welding correlates with defects
- Vibration anomalies at Assembly predict QA failures
- Rework rate by machine station
- Power consumption patterns indicate machine health
- Quality score distribution by production line

### Step-by-Step

1. **Connector:** `Smart Factory IoT` (REST API, base URL: `http://demo-service:8024`, endpoint: `/datasets/smart-factory-iot/records`)
2. **Test:** `/records?limit=5` — see temperature, vibration, power_kw, quality_score fields
3. **Object type:** `ProductionOrder`
4. **Process Mining:**
   - **Process Map:** Clean linear flow with QA rework loop
   - **Bottlenecks:** QA Inspection + Rework are the bottlenecks
   - **Filter:** by `Defect_Type != null` to see only defective production runs
   - **Conformance:** Golden path = Cut → Weld → Assemble → QA Pass → Pack → Ship
   - **Insights:** "HIGH: Machine Station M-007 shows 3x rework rate — vibration readings abnormal"
5. **Dashboard:** `Production throughput (metric), defect rate (metric), temperature by station (line chart), quality score distribution (bar), defect types (pie), production table with IoT readings`
6. **Agent — Predictive Maintenance:**
   - Name: `Factory Equipment Monitor`
   - Prompt: `Monitor production line IoT sensor data. Identify machines with abnormal temperature, vibration, or power patterns that predict failures or quality issues. Propose maintenance actions for at-risk equipment.`

---

# Demo 10: Travel & Expenses — University Declarations (BPIC 2020)

**Dataset:** BPI Challenge 2020 — University travel declarations & permits
**Source:** https://data.4tu.nl/collections/BPI_Challenge_2020/5065541
**Sub-logs:** 5 sub-logs:
1. **Domestic Declarations** (~10,500 cases)
2. **International Declarations** (~6,449 cases)
3. **Prepaid Travel Costs** (~2,099 cases)
4. **Travel Permits** (~7,065 cases)
5. **Request for Payment** (~6,886 cases)

**Key columns:**
| Column | Description |
|--------|------------|
| `case:concept:name` | Declaration/permit ID |
| `concept:name` | Activity (Declaration SUBMITTED, APPROVED, REJECTED, Payment Handled, etc.) |
| `time:timestamp` | Event timestamp |
| `org:resource` | Employee or approver |
| `case:Amount` | Declaration amount |
| `case:DeclarationNumber` | Official declaration number |
| `case:Permit BudgetNumber` | Budget code |
| `case:Permit OrganizationalEntity` | Department |
| `case:Permit ProjectNumber` | Project code |
| `case:travel permit number` | Linked travel permit |
| `case:OverspentAmount` | Amount over budget |

### What You'll See in Nexus

**Process Map:** Classic approval workflow: Submit → Supervisor Approve → Budget Owner Approve → Director Approve → Administration → Payment. Rejection loops at each approval stage.

**Key Insights:**
- Multi-level approval chain with different approval thresholds
- Domestic declarations: faster, simpler (1-2 approvals)
- International declarations: more approvals, longer processing
- ~15% rejection rate at first approval level
- Resubmission after rejection adds 5-10 days
- Over-budget declarations (`OverspentAmount > 0`) require extra approval
- Average processing: Domestic 12 days, International 25 days

**This is the best dataset for showing the full platform with multiple related object types.**

### Step-by-Step

1. **Create 5 connectors** (REST API):
   - `Domestic Declarations` → base URL: `http://demo-service:8024`, endpoint: `/datasets/bpic2020-domestic/records`
   - `International Declarations` → endpoint: `/datasets/bpic2020-international/records`
   - `Prepaid Travel Costs` → endpoint: `/datasets/bpic2020-prepaid/records`
   - `Travel Permits` → endpoint: `/datasets/bpic2020-permits/records`
   - `Payment Requests` → endpoint: `/datasets/bpic2020-payments/records`
2. **Create 5 object types:**
   - `DomesticDeclaration`
   - `InternationalDeclaration`
   - `PrepaidTravelCost`
   - `TravelPermit`
   - `PaymentRequest`
3. **Define ontology links:**
   - `DomesticDeclaration` → `TravelPermit` (belongs_to, via `travel permit number`)
   - `InternationalDeclaration` → `TravelPermit` (belongs_to, via `travel permit number`)
   - `PrepaidTravelCost` → `TravelPermit` (belongs_to, via `travel permit number`)
   - `PaymentRequest` → `DomesticDeclaration` (belongs_to, via `DeclarationNumber`)
4. **Process Mining:**
   - Analyze `DomesticDeclaration`:
     - **Process Map:** Submit → Approve → Payment (clean)
     - **Conformance:** 75%+ follow happy path
   - Analyze `InternationalDeclaration`:
     - **Process Map:** Longer approval chain, more loops
     - **Conformance:** Lower (~50%)
   - **Benchmark:** Domestic vs International approval times
5. **Dashboard (multi-source demo):**
   - **Generate with Claude:** `Travel expense dashboard: total declarations by type, approval rate, average processing time, over-budget declarations, monthly volume trend, recent declarations table`
   - **Select ALL 5 data sources**
   - **Chat widget:** Select all 5 data sources + all dashboard widgets
   - Ask: *"What's the total travel spend across all declaration types?"*
   - Ask: *"Which department has the most over-budget declarations?"*
6. **Logic Studio — Expense Compliance:**
   - Block 1: `ontology_query` — declarations where `OverspentAmount > 0`
   - Block 2: `conditional` — if OverspentAmount > 1000, then:
   - Block 3: `llm_call` — "Flag this high over-budget declaration with explanation"
   - Block 4: `action` — propose review for budget officer
   - Schedule: Daily
7. **Alerts (Process Mining):**
   - Go to **Alerts** tab
   - Create rule: "If avg approval time > 20 days, trigger alert"
   - Create rule: "If rejection rate > 25%, trigger alert"

---

# Feature Highlight Demos

These are cross-cutting features to demonstrate using any of the datasets above.

---

## Feature: AI Schema Inference + PII Detection

**Best dataset:** Demo 8 (Sepsis) or Demo 4 (Hospital)

1. Upload CSV
2. Run Schema Inference → show Claude labeling 39 fields with semantic types
3. Show confidence scores (98% for timestamps, 85% for clinical values)
4. Go to **PII Scan** tab → show detected sensitive fields
5. Show PII levels: Age (LOW), Diagnosis (MEDIUM)
6. Explain: Nexus auto-detects compliance-relevant fields

---

## Feature: Ontology Graph + Links

**Best dataset:** Demo 5 (BPIC 2014) or Demo 10 (BPIC 2020)

1. Upload multiple related sub-logs as separate object types
2. Go to **Ontology** → see all nodes in graph
3. Click a node → **Links** tab → add relationships
4. Show graph edges appear between linked types
5. Click a link → see join key configuration
6. Explain: Nexus understands relationships between data sources

---

## Feature: Multi-Source Chat Widget

**Best dataset:** Demo 10 (BPIC 2020) — 5 related data sources

1. Create dashboard with widgets from different object types
2. Add Chat widget
3. In config panel → **DATA SOURCES:** Check all 5 object types
4. Under **Dashboard Widgets:** Check all sibling widgets
5. Ask cross-dataset questions:
   - *"How do domestic and international declarations compare?"*
   - *"What's the total spend across all travel types?"*
   - *"Which widget shows the highest values?"*

---

## Feature: Agent Studio + Human Actions

**Best dataset:** Demo 8 (Sepsis) — rich attributes for AI analysis

1. Create agent with clinical analysis prompt
2. Enable: query_records, count_records, action_propose, process_mining
3. Run agent → watch tool calls in real-time
4. Agent proposes: "Flag patient #1043 — CRP=180, LacticAcid=4.2, no antibiotics for 6 hours"
5. Go to **Human Actions** → see pending proposal
6. Review agent's reasoning
7. Approve → action executed
8. Explain: Human-in-the-loop AI with full audit trail

---

## Feature: Logic Studio Workflows

**Best dataset:** Demo 6 (Traffic Fines) — clear business rules

1. Create function: `Overdue Fine Escalator`
2. Block 1: `ontology_query` — fines > 90 days old without Payment
3. Block 2: `transform` — calculate penalty amount (fine * 1.5)
4. Block 3: `conditional` — if penalty > €500:
5. Block 4: `action` — propose credit collection escalation
6. Block 5: `send_email` — notify collections team
7. Test run → see results
8. Schedule: Weekly on Mondays

---

## Feature: Process Mining Benchmark

**Best dataset:** Demo 7 (Building Permits) — 5 municipalities to compare

1. Upload 2+ municipality datasets
2. Open Process Mining → **Benchmark** tab
3. Segment A: `Municipality = 1`
4. Segment B: `Municipality = 3`
5. Click **Compare** → see side-by-side:
   - Case count, avg duration, variant count, rework rate
   - Top 5 variants per segment with frequency bars
   - Green/red highlighting for better/worse metrics

---

## Feature: Nexus Assistant (Global AI)

**Any dataset — use after loading 2-3 object types**

1. Click the **Nexus Assistant** panel (right sidebar)
2. It auto-loads context: all connectors, object types, pipelines, agents
3. Ask: *"What data do I have loaded?"* → lists all object types with record counts
4. Ask: *"Create a pipeline to filter traffic fines over €200"* → suggests pipeline config
5. Ask: *"Which object type has the most records?"* → analyzes across all types
6. Ask: *"Help me build a compliance dashboard"* → suggests widgets and layout

---

## Feature: Settings + API Gateway

1. Go to **Settings** → **API Keys** tab
2. Create a new API key → show it (prefix visible, rest hidden)
3. Go to **API Gateway** tab → show how ontology data is exposed via REST
4. `curl http://localhost:8004/object-types/{id}/records?limit=10` with API key header
5. Show: External systems can consume Nexus data programmatically

---

# Recommended Demo Recording Order

For a coherent video series:

| Video # | Title | Datasets | Duration | Key Features |
|---------|-------|----------|----------|-------------|
| 1 | **Getting Started: Your First Connector** | Traffic Fines | 8 min | Connector creation, file upload, schema inference |
| 2 | **Building Your Ontology** | Traffic Fines | 6 min | Object types, properties, semantic types, PII |
| 3 | **Data Pipelines** | Traffic Fines | 7 min | Pipeline builder, nodes, run/sync |
| 4 | **Process Mining Deep Dive** | Traffic Fines | 12 min | All PM tabs: map, variants, bottlenecks, conformance |
| 5 | **AI-Powered Dashboards** | Loan Apps (2012) | 10 min | Claude generation, widget config, chart types |
| 6 | **Multi-Source Analytics** | BPIC 2020 (5 logs) | 10 min | Multiple connectors, ontology links, multi-source chat |
| 7 | **AI Agents & Human Actions** | Sepsis Cases | 8 min | Agent Studio, tool selection, human-in-the-loop |
| 8 | **Logic Studio Workflows** | Traffic Fines | 8 min | Block builder, scheduling, email notifications |
| 9 | **Healthcare Compliance** | Hospital + Sepsis | 10 min | PII detection, clinical analysis, audit trail |
| 10 | **Enterprise Procurement** | SAP POs (2019) | 10 min | Large dataset, spend analytics, compliance agent |
| 11 | **Benchmarking & Comparison** | Building Permits | 8 min | Multi-municipality comparison, benchmark tab |
| 12 | **Advanced: IoT + Manufacturing** | Smart Factory | 8 min | Sensor data, predictive maintenance agent |
