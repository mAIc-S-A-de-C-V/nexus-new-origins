# Course U1 · Nexus 101

**Tier:** Nexus User (Bronze) · **Duration:** ~45 minutes · **Prerequisites:** None

**You'll need:** Access to `tenant-learn` (your trainer provisions this via `scripts/seed_tenant_learn.py`) and a browser.

---

## What you'll be able to do by the end

- Explain in one sentence what Nexus is and what makes it different from a dashboard tool or a database.
- Open the Ontology Explorer, locate a record, and read its history.
- Name the four surfaces you'll spend time in (Ontology Explorer, Apps, Dashboards, Assistant) and what each is for.
- Find your own tenant ID and know why tenants matter.

---

## 1. What is Nexus

Nexus is a data platform. That's three things at once:

1. **A single, governed model of your operations** — every customer, vendor, ticket, purchase order, or whatever your business runs on, modeled once, stored once, queried by everything.
2. **A safe way to mutate that model** — changes happen through *Actions*, not raw SQL, so every change is audited, validated, and replayable.
3. **A place where apps run on top of both** — small apps your team builds (or installs) that read the model and trigger the Actions.

The shorthand most people use: *Ontology + Actions + Apps*.

That's it. The rest of this course unpacks what each of those means in practice.

### Why not just use a dashboard tool

A BI tool (Tableau, Looker, Power BI) is read-only. It shows you what already happened. Nexus is read-*and-write*: you can also act on what you see — assign a ticket, approve an invoice, dispatch a tech — and the action propagates through the model with the same governance the read path has. That round-trip is the thing.

### Why not just use a database

A database trusts whoever has credentials. Nexus does the opposite: nothing reaches the database except through Actions, every Action is logged with who/when/why, and Actions can chain other Actions through *Operations* (you'll meet those in the Builder track). It's a database with a contract.

> **Quick check.** A teammate edits a `Vendor` row directly in the underlying database. Does that change show up in Nexus's Action history?
>
> **No.** That's the point — Nexus only sees what flows through its Actions. Direct DB writes are invisible to it.

---

## 2. The Ontology — your operational model

The Ontology is the model of your world. Three concepts make it up:

| Concept | What it is | Example |
|---|---|---|
| **Object type** | A kind of thing | `Vendor`, `PurchaseOrder`, `LineItem` |
| **Object** | A specific thing of that type | "Vendor #4471, ACME Supply Co." |
| **Link** | A typed relationship between objects | A `PurchaseOrder` *belongs to* a `Vendor` |

Object types have **properties** (fields): a `Vendor` has a name, address, tier, etc. Properties have a **data type** (string, number, datetime, currency) and a **semantic type** (e.g., `EMAIL`, `IDENTIFIER`, `STATUS`, `CURRENCY`) that the platform uses for formatting and security rules.

You don't write SQL against the Ontology. You query it through the SDK or click around it in the **Ontology Explorer**.

> **Try it.** Open the Ontology Explorer in `tenant-learn`. You should see three object types: `Vendor`, `PurchaseOrder`, `LineItem`. Click `Vendor` and pick any record. The right panel shows properties on top and **Action history** below.
>
> ![Ontology Explorer — Vendor record view](shots/u1-ontology-explorer-vendor.png)

---

## 3. Actions — the only legitimate way to change anything

If the Ontology says *what is*, Actions say *how it changes*. An Action is a named, validated, audited operation:

- `createVendor`
- `approvePurchaseOrder`
- `addNote`

Every Action has:

- **Inputs** the caller must supply (and the platform validates).
- **Pre-conditions** — rules about when it can fire (e.g., "you can only `approvePurchaseOrder` if status = 'pending'").
- **Effects** — what gets created, mutated, or linked.
- **An audit entry** — who fired it, when, with what inputs, and what state the object ended up in.

Actions surface in three places:
1. Buttons inside apps.
2. The **Actions** tab on any object.
3. Under the hood, when the Assistant patches an app or fires an Action on your behalf.

> **Try it.** Find a `Vendor` from the previous step. Click **Actions → Add Note**, type a short note, and submit. A new entry appears in the Action history with your user ID and a timestamp.
>
> ![Add Note action — modal](shots/u1-action-add-note.png)

---

## 4. Apps, Dashboards, and the Assistant — three surfaces

Three surfaces sit on top of the Ontology. You'll use all three day-to-day.

### Apps

An app is a small React UI that reads the Ontology and exposes Actions. Apps live in the **Apps catalog**. You install one by clicking **Install**, after which it shows up in your dashboards.

Apps are **sandboxed**: they can only do what they declared they'd do in their `manifest.json`. An app that didn't ask for PII scope can't read PII fields — the platform redacts those values before they ever reach the app.

### Dashboards

A dashboard is a configurable grid of apps and widgets. You arrange components in **edit mode**, save, then return to **view mode** for daily use. Saved component positions persist — if you re-open the dashboard tomorrow, it looks the same as you left it.

Any dashboard can be set as your **Home** — the first thing you see when you sign in.

### The Assistant

The Assistant is the conversational layer. You can ask it to find data, summarize a record, draft a patch to an app, or fire an Action. It speaks the same Action vocabulary an app does, so anything it does is just as audited.

> **Try it.** Open the Apps catalog. Install **Vendor Tracker** (pre-published in `tenant-learn`). Pin it to your dashboard. Set this dashboard as Home.
>
> ![Apps catalog — Vendor Tracker](shots/u1-apps-catalog.png)
>
> ![Dashboard with Vendor Tracker pinned](shots/u1-dashboard-pinned.png)

---

## 5. Tenants — why isolation matters

A *tenant* is a strong isolation boundary. Two tenants on the same Nexus deployment cannot see each other's Ontology, read each other's audit logs, or fire each other's Actions.

Concretely:
- Every API call carries an `x-tenant-id` header.
- Every Ontology object, every Action history entry, every app install is scoped to a tenant.
- Cross-tenant sharing is possible but requires explicit governance — not the default.

In production you might have one tenant per department, one per customer, or a single tenant for everything; your architects decide. For this course you're working in `tenant-learn`.

> **Find your tenant ID.** Open **Settings → Profile**. Your tenant ID will look like `tenant-learn` (shared course tenant) or `tenant-learn-<your-name>` (your personal subtenant). Write it down — you'll need it for the lab.
>
> ![Settings profile showing tenant ID](shots/u1-profile-tenant.png)

---

## Lab — "Find Your Way"

Four tasks, then submit your answers to the grader.

**Setup:** Sign in to your assigned `tenant-learn` subtenant.

**Tasks:**

1. **Identify your tenant.** Copy your tenant ID from Settings → Profile.
2. **Map the Ontology.** In Ontology Explorer, list the names of the three object types you find.
3. **Open a record.** Click into any `Vendor`. Copy its object ID (top of the right panel).
4. **Run an Action.** From that Vendor's **Actions** tab, run **Add Note** with the text `cert-u1-<your-name>`. Then locate the new entry in the Action history and copy its history-entry ID.

**Submit:** Run `python3 scripts/grade_cert_u1.py --tenant <your-tenant-id> --vendor <id> --history <id> --candidate <your-name>`. The grader checks your tenant has the expected state and emits a pass/fail report.

---

## Theory test — 10 questions

> Passing score: **8 / 10**. Answers at the bottom — don't peek.

1. **Which best describes Nexus?**  
   a) A BI tool that visualizes data warehouses.  
   b) A data platform that combines a governed model, actioned mutations, and apps.  
   c) A workflow engine for triggering Slack messages.  
   d) A database with built-in dashboards.

2. **An Action's audit entry includes which of the following?** *(select all that apply)*  
   a) Who fired it  
   b) When it ran  
   c) The inputs supplied  
   d) The user's browser version

3. **A teammate runs an `UPDATE` statement directly against the Postgres instance backing the Ontology. Does Nexus log it in the Action history?**  
   a) Yes — Nexus watches the database.  
   b) No — Nexus only sees Actions.  
   c) Only if the table is audited.  
   d) Only the schema change is logged.

4. **The relationship between a `PurchaseOrder` and the `Vendor` it belongs to is called a:**  
   a) Foreign key  
   b) Property  
   c) Link  
   d) Join

5. **What's the difference between view mode and edit mode on a dashboard?**  
   a) Edit mode shows extra data.  
   b) View mode is read-only for components; edit mode lets you rearrange and save layout.  
   c) Edit mode is for admins only.  
   d) View mode hides Actions.

6. **You install an app that doesn't declare access to PII. Can it read PII-tagged fields?**  
   a) Yes, after install.  
   b) No — scopes are enforced; it gets a redacted or null value.  
   c) Yes, but the read is logged.  
   d) Only if the user explicitly grants it.

7. **A tenant boundary protects:**  
   a) Only Ontology objects.  
   b) Ontology, Actions, audit logs, and app installs.  
   c) Only the database; apps cross tenants freely.  
   d) Network access only.

8. **You ask the Assistant to "close all open tickets older than 30 days." Under the hood, the Assistant:**  
   a) Runs SQL directly.  
   b) Fires the same `closeTicket` Action that buttons fire.  
   c) Updates the database without an audit entry.  
   d) Asks the admin to do it manually.

9. **A property's `semantic_type` (e.g., `EMAIL`, `IDENTIFIER`) primarily affects:**  
   a) Storage cost.  
   b) Display formatting and security policy.  
   c) Whether it's indexable.  
   d) Sort order.

10. **Which is *not* a surface in Nexus?**  
    a) Apps catalog  
    b) Ontology Explorer  
    c) Assistant  
    d) PostgreSQL admin console

<details>
<summary>Answer key</summary>

1. b · 2. a, b, c · 3. b · 4. c · 5. b · 6. b · 7. b · 8. b · 9. b · 10. d
</details>

---

## Practical test — auto-graded

You'll be given a fresh ephemeral tenant (`tenant-learn-exam-<your-id>`), seeded for the exam. You have **30 minutes**.

**Tasks:**

1. Confirm your tenant ID.
2. Find the **third-most-recent** `PurchaseOrder` (by `created_at` descending). Submit its object ID.
3. Submit the **name** of the `Vendor` that PO is linked to.
4. Run **Add Note** on that vendor with text exactly `exam-u1`.

The grader queries your tenant — no screenshots required.

**Pass criteria** (3 of 4):

- Tenant ID matches your assigned exam tenant.
- PO object ID matches the canonical answer for your seeded scenario.
- Vendor name matches.
- A `noteAdded` Action history entry exists on the correct vendor with text exactly `exam-u1`, fired within the last 30 minutes.

Run: `python3 scripts/grade_cert_u1.py --exam --tenant <your-tenant-id> --po <id> --vendor-name "<name>" --candidate <your-name>`.
