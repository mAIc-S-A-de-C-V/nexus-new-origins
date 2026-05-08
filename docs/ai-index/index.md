# Nexus AI Editor Index

**Audience:** AI agents (Claude, Cursor, etc.) editing this codebase.
**Purpose:** One-page map of every service, every module, every script — pointing at the file you should open *before* you change anything.
**Generated from:** Deep file-by-file exploration on 2026-05-08.

If you are asked to add a feature, fix a bug, or modify behavior — start here, find the matching service file, then open the file paths it lists. Don't grep blind.

---

## Repo layout (top level)

```
nexus-new-origins/
├── frontend/                    React 18 + Vite + TypeScript SPA (port 3000)
├── backend/                     27 Python FastAPI microservices (ports 8001–8027)
│   └── shared/                  Cross-service libs (auth, llm_router, query_cache, …)
├── nexus-apps/                  Domain apps (Finance 9001, Project Mgmt 9000)
├── caddy/                       Caddy reverse proxy + auto-TLS
├── nginx/                       nginx reverse proxy (alternative)
├── scripts/                     Backup, restore, demo seeding, replay, log shipping
├── qa/                          Playwright E2E tests
├── docs/                        All documentation (this index lives in docs/ai-index/)
├── .github/workflows/           CI/CD (build-and-deploy.yml)
└── docker-compose.yml           Full stack orchestration
```

---

## Backend services (27)

Group by responsibility. Click a row to open its full doc.

### Identity & platform
| Port | Service | Doc | Owns |
|------|---------|-----|------|
| 8011 | auth-service | [backend/auth-service.md](backend/auth-service.md) | JWT (RS256), SSO (Google/Okta/Azure AD), MFA, tenants, impersonation, JWKS |
| 8022 | admin-service | [backend/admin-service.md](backend/admin-service.md) | Tenant CRUD, plans, token-usage aggregation, Bedrock model gating |
| 8006 | audit-service | [backend/audit-service.md](backend/audit-service.md) | Audit events (ISO 27001 A.8.15), checkpoints (justification gates), multi-step approvals |
| 8014 | utility-service | [backend/utility-service.md](backend/utility-service.md) | Reusable utilities: HTTP, PDF, OCR, Excel, scrape, RSS, geocode, QR, Slack |
| 8015 | analytics-service | [backend/analytics-service.md](backend/analytics-service.md) | AIP Analyst (Claude), data exploration, scenario modeling, value tracker |
| 8020 | collaboration-service | [backend/collaboration-service.md](backend/collaboration-service.md) | Comments, threaded replies, resolution on any entity |
| 8021 | api-gateway-service | [backend/api-gateway-service.md](backend/api-gateway-service.md) | External `/v1/{slug}` REST APIs, API key issuance, rate limiting, usage logs |

### Data plane
| Port | Service | Doc | Owns |
|------|---------|-----|------|
| 8001 | connector-service | [backend/connector-service.md](backend/connector-service.md) | Data source connectors (REST/DB/Email/Webhook/WhatsApp), AES-encrypted creds, schema discovery |
| 8002 | pipeline-service | [backend/pipeline-service.md](backend/pipeline-service.md) | DAG orchestration, 11 node types, poll + cron schedulers, run history |
| 8007 | schema-registry | [backend/schema-registry.md](backend/schema-registry.md) | Connector schema versioning (in-memory, hash-deduped) |
| 8017 | lineage-service | [backend/lineage-service.md](backend/lineage-service.md) | Read-only 6-layer lineage graph (connector → pipeline → ot → logic → agent → action) + health |
| 8019 | data-quality-service | [backend/data-quality-service.md](backend/data-quality-service.md) | Property-level profiling: null-rate, uniqueness, top values, quality score |

### Ontology & process
| Port | Service | Doc | Owns |
|------|---------|-----|------|
| 8004 | ontology-service | [backend/ontology-service.md](backend/ontology-service.md) | **Hub.** Object types, records (JSONB), aggregate, apps/dashboards, actions, workflows, shares, MinIO, query cache, rollups |
| 8005 | event-log-service | [backend/event-log-service.md](backend/event-log-service.md) | TimescaleDB hypertable for events, time-series queries, retention |
| 8008 | correlation-engine | [backend/correlation-engine.md](backend/correlation-engine.md) | Stateless similarity scorer (field/semantic/sample/PK), suggests enrich/link/new |
| 8009 | process-engine | [backend/process-engine.md](backend/process-engine.md) | Process mining: variants, transitions, bottlenecks, conformance, multi-object processes |
| 8010 | alert-engine | [backend/alert-engine.md](backend/alert-engine.md) | Rule-based alerts (stuck_case, slow_transition, rework_spike), Slack/email/webhook channels |
| 8018 | search-service | [backend/search-service.md](backend/search-service.md) | Unified search across object types, records, pipelines, connectors, agents |

### AI & inference
| Port | Service | Doc | Owns |
|------|---------|-----|------|
| 8003 | inference-service | [backend/inference-service.md](backend/inference-service.md) | Claude proxy: schema inference, similarity, conflicts, app/widget gen, PII scan, vision OCR |
| 8013 | agent-service | [backend/agent-service.md](backend/agent-service.md) | **Agents + tool registry + model_providers table** (read by `shared/llm_router.py`) |
| 8016 | eval-service | [backend/eval-service.md](backend/eval-service.md) | Eval suites (agents/logic), 5 evaluators, experiment grids |
| 8012 | logic-service | [backend/logic-service.md](backend/logic-service.md) | Visual function builder: blocks (ontology_query, llm_call, action, transform, email, conditional) |
| 8026 | kernel-service | [backend/kernel-service.md](backend/kernel-service.md) | Jupyter-style notebook execution (workbench), per-tenant kernels |
| 8027 | scraping-service | [backend/scraping-service.md](backend/scraping-service.md) | DuckDuckGo search + URL scrape via Scrapling (used by agent tools) |

### Demo & channels
| Port | Service | Doc | Owns |
|------|---------|-----|------|
| 8023 | sepsis-service | [backend/sepsis-service.md](backend/sepsis-service.md) | Real hospital sepsis XES dataset (~1K cases, ~15K events) |
| 8024 | demo-service | [backend/demo-service.md](backend/demo-service.md) | 16 BPI Challenge datasets generated in-memory (BPIC2019 PO is main demo) |
| 8025 | whatsapp-service | [backend/whatsapp-service.md](backend/whatsapp-service.md) | TypeScript Fastify, Baileys WhatsApp Business API, sessions/chats/messages |

---

## Nexus apps (2)

Domain-specific apps for MAIC's own ops.

| Port | App | Doc | Owns |
|------|-----|-----|------|
| 9000 | project-management | [apps/project-management.md](apps/project-management.md) | Companies, team members, projects, kanban stages, tasks, default 5 stages |
| 9001 | finance-service | [apps/finance-service.md](apps/finance-service.md) | Expense ledger, revenue, A/R aging, summary endpoints, Excel upload |

---

## Frontend (34 modules)

| Doc | Covers |
|-----|--------|
| [frontend/overview.md](frontend/overview.md) | App.tsx, main.tsx, routing model (string-based, no react-router), top-level dirs |
| [frontend/api-clients.md](frontend/api-clients.md) | `src/api/` — axios clients with interceptors, env-driven service URLs |
| [frontend/stores.md](frontend/stores.md) | All ~27 Zustand stores: state, actions, consumers |
| [frontend/shell.md](frontend/shell.md) | AppShell, NavRail, NexusAssistant, CommandPalette, Search, Notifications, TenantContext |
| [frontend/design-system.md](frontend/design-system.md) | `tokens.ts` color palette + 8 reusable components |
| [frontend/modules.md](frontend/modules.md) | Every one of the 33 modules with entry component, sub-components, store, when-to-edit |
| [frontend/pages.md](frontend/pages.md) | LoginPage, ChangePasswordPage, SSOCallbackPage |

---

## Cross-cutting

| Doc | Covers |
|-----|--------|
| [architecture.md](architecture.md) | Networking, multi-tenancy, JWT/JWKS flow, Docker Compose, Postgres + TimescaleDB + Redis + MinIO + Caddy |
| [shared-modules.md](shared-modules.md) | `backend/shared/` — auth_middleware, llm_router, models, token_tracker, pricing, query_cache, rollup_promoter, index_advisor, nexus_logging, enums |
| [scripts.md](scripts.md) | backup/restore, seed_demo_tenants, seed_finance_*, replay-po-events, setup-mac-mini-bridge, log shipping, grafana backfill |
| [qa.md](qa.md) | Playwright E2E test suite |
| [cicd.md](cicd.md) | `.github/workflows/build-and-deploy.yml`, ghcr.io registry, EC2 deploy |

---

## How to use this index

1. **Locate the affected surface.** Frontend change → `frontend/modules.md` or `frontend/shell.md`. Backend behavior → service doc in `backend/`. Cross-cutting (auth, caching) → `shared-modules.md`.
2. **Read the service doc end-to-end.** Each doc lists every file, every endpoint, every cross-service call, and a "When to edit" table mapping intents → file paths.
3. **Verify before editing.** Memory entries can drift; open the actual file referenced in the doc to confirm structure before changing.
4. **Update this index when you add or rename services / modules.** It is mechanical — find the row, edit the line.

## 2026-05 expansion (gap-fill release)

The platform's reachability through the UI and the in-site Assistant was significantly expanded in May 2026:

- **`backend/agent_service/tools.py`** grew from **20 → 121 tools**. CRUD/test/schedule/approve verbs are now first-class for every resource (connector, pipeline, object_type, logic function, agent, app, alert rule, eval suite, approval workflow, checkpoint, user, model provider, API key, …) plus read-side tools for search, lineage, data quality, audit log, PII scan results.
- **`frontend/src/shell/NexusAssistant.tsx`** is now **table-driven**: a single `GENERIC_ACTION_REGISTRY` declares ~70 new action types in one place. The 10 original custom actions remain. New mutating actions are now one-line registry rows.
- **`backend/inference_service/routers/inference.py`** system prompt was extended with full payload documentation for every new action — Claude proposes them when asked.
- **New frontend modules / tabs:**
  - `modules/scenarios/ScenariosPage.tsx` — promoted from prototype to top-level "Scenarios" module (in NavRail under Value Monitor).
  - `modules/process_v2/ConformancePanel.tsx` — conformance-model authoring + one-click check, surfaced as a new "Conformance" tab inside Process Mining v2.
  - `modules/settings/ApprovalsTab.tsx` — Settings → "Approval Workflows" CRUD.
  - `modules/settings/CheckpointsTab.tsx` — Settings → "Compliance Gates" (justification checkpoints) CRUD.
  - `modules/settings/PiiScanTab.tsx` — Settings → "PII Scanner" — drives `/scan-pii` and `/scan-all`, renders per-OT hits with PII level badges.
- **Power-user buttons added:** OpenAPI download in API Gateway page; assistant can now propose `discover_processes`, `backfill_process_case_key`, `scan_all_pii`, `extract_document_fields`, `test_alert_rule`, `test_fire_trigger`, `test_model_provider`, `run_pipeline_schedule_now` directly.

## Conventions used in service docs

Every backend service doc follows this template:

- **Purpose** — 1-line description
- **Port** + **stack** (Python FastAPI / TypeScript Fastify / etc.)
- **Directory tree** with per-file purposes
- **Endpoints table** — every route with method, path, purpose
- **Database tables** — columns + indexes (when applicable)
- **Cross-service HTTP calls** — what it calls, what calls it
- **External libraries** — non-stdlib deps that matter (anthropic, scrapling, baileys, …)
- **Background jobs** — schedulers, retention loops, refreshers
- **When to edit** — intent → file mapping
