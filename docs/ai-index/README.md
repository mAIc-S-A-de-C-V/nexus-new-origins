# Nexus AI Editor Index

This folder is a structured map of the Nexus codebase, written for AI agents that edit the code (Claude, Cursor, Copilot, etc.). It is **not** end-user documentation.

## Start here

[**index.md**](index.md) — top-level index of every service, module, app, and cross-cutting doc. Always navigate from there.

## Structure

```
docs/ai-index/
├── README.md                  ← you are here
├── index.md                   ← MASTER INDEX (start every task here)
│
├── architecture.md            ← Networking, multi-tenancy, JWT, infra, schedulers, CI/CD overview
├── shared-modules.md          ← backend/shared/ (auth, llm_router, query_cache, …)
│
├── backend/                   ← One doc per backend service (27 files)
│   ├── connector-service.md
│   ├── pipeline-service.md
│   ├── inference-service.md
│   ├── ontology-service.md       ← largest service; the hub
│   ├── event-log-service.md
│   ├── audit-service.md
│   ├── schema-registry.md
│   ├── correlation-engine.md
│   ├── process-engine.md
│   ├── alert-engine.md
│   ├── auth-service.md
│   ├── logic-service.md
│   ├── agent-service.md
│   ├── utility-service.md
│   ├── analytics-service.md
│   ├── eval-service.md
│   ├── lineage-service.md
│   ├── search-service.md
│   ├── data-quality-service.md
│   ├── collaboration-service.md
│   ├── api-gateway-service.md
│   ├── admin-service.md
│   ├── demo-service.md
│   ├── sepsis-service.md
│   ├── whatsapp-service.md
│   ├── kernel-service.md
│   └── scraping-service.md
│
├── apps/                      ← Domain-specific apps (Nexus Apps)
│   ├── finance-service.md
│   └── project-management.md
│
├── frontend/                  ← Frontend deep-dive
│   ├── overview.md             routing, top-level files, lib, hooks, types
│   ├── api-clients.md          src/api/
│   ├── stores.md               src/store/ (~27 Zustand stores)
│   ├── shell.md                src/shell/ (AppShell, NavRail, Assistant, Notifications, …)
│   ├── design-system.md        src/design-system/
│   ├── modules.md              all 33 modules with entry, sub-components, store, when-to-edit
│   └── pages.md                Login, ChangePassword, SSOCallback
│
├── scripts.md                 ← scripts/ (backup, restore, seed, replay, …)
├── qa.md                      ← qa/ Playwright suite
└── cicd.md                    ← .github/workflows/build-and-deploy.yml
```

## How an editor agent should use this

1. Read `index.md` to locate the affected service / module.
2. Open the matching service doc — it lists every file with its purpose, every endpoint, every cross-service call, and a "When to edit" intent → file mapping.
3. Open the actual file referenced (these docs can drift; trust the code).
4. Make the change with full context.

## Doc structure (every backend service)

```
- Purpose         ← one line
- Stack           ← language + framework + key libs
- Path            ← absolute path to the directory
- Files           ← annotated tree
- Endpoints       ← method + path + purpose tables
- Database tables ← columns + indexes
- Cross-service calls (in + out)
- External libraries  ← non-stdlib deps that matter
- Background jobs ← schedulers / loops / workers
- Env             ← every env var read
- When to edit    ← intent → file mapping
```

## Maintenance

This index was generated 2026-05-08 from a deep file-by-file pass. To regenerate or extend after substantial code changes, re-run a similar exploration and update the docs in place. The `index.md` master must always be updated when services or modules are added/renamed.
