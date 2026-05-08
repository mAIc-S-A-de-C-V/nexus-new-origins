# Frontend overview

**Stack:** React 18 + Vite + TypeScript + Zustand + React Flow + Recharts + Tailwind CSS.
**Entry:** `frontend/src/App.tsx`. Lazy-loaded modules + `AppShell` layout.
**Routing:** **String-based, NOT react-router.** State in `navigationStore.currentPage`. URL doesn't change as you navigate.
**Auth header injection:** Global `window.fetch` interceptor in `main.tsx` adds `Authorization: Bearer <token>` and `x-tenant-id` to every fetch (works for axios + raw fetch alike).

## Top-level files (`src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | Routing hub. Lazy-loads modules; `renderPage(page)` switch; mounts `TenantProvider → ThemeSync → AuthGate → AppShell + SearchModal`. Hidden route `/pminingv2` (Process Mining v2). Public share viewer at `/s/<token>`. |
| `main.tsx` | Vite entry. Installs global `fetch` interceptor (skip in share mode). Reads token/tenant from `authStore` helpers. |
| `index.css` | Global Tailwind + CSS variables. Light/dark theme via `data-theme`. Comfortable/compact via `data-density`. Custom animations (spin, slideInRight, fadeIn, impersonatePulse). |
| `plotly-shim.d.ts` | Minimal Plotly type stubs so we don't pull `@types/plotly.js` (heavy). |

## Sub-directories

| Path | Doc | Notes |
|------|-----|-------|
| `src/api/` | [api-clients.md](api-clients.md) | 4 axios clients with interceptors. |
| `src/store/` | [stores.md](stores.md) | ~27 Zustand stores. |
| `src/shell/` | [shell.md](shell.md) | AppShell, NavRail, Assistant, Notifications, etc. |
| `src/design-system/` | [design-system.md](design-system.md) | tokens.ts + 8 reusable components. |
| `src/modules/` | [modules.md](modules.md) | All 33 modules. |
| `src/pages/` | [pages.md](pages.md) | LoginPage, ChangePasswordPage, SSOCallbackPage. |
| `src/lib/` | (this doc) | uuid, timezone, exportTable, shareMode, i18n config. |
| `src/hooks/` | (this doc) | usePermission, useGlobalKeyboard, useEventStream. |
| `src/types/` | (this doc) | TypeScript contracts mirroring backend. |
| `src/i18n/` | (this doc) | i18next config (English, Spanish). |

## `src/lib/`

| File | Purpose |
|------|---------|
| `uuid.ts` | `uuid()` helper. |
| `timezone.ts` | `useTimezone()` → `[tz, setTz]` with localStorage. |
| `exportTable.ts` | CSV/JSON export helpers for tables. |
| `shareMode.ts` | Detects public share viewer (`/s/...` path). Disables fetch interceptor + auth gate. |

## `src/hooks/`

| File | Purpose |
|------|---------|
| `usePermission.ts` | Reads role + `allowed_modules` from auth store. Exports `isAdmin()`, `isSuperAdmin()`, `canAccess(moduleId)`, `modules[]`. |
| `useGlobalKeyboard.ts` | Cmd+K (command palette), `?` (shortcuts), other globals. |
| `useEventStream.ts` | SSE handler. |

## `src/types/`

Types mirror backend Pydantic models — keep them in sync:
- `app.ts` — `NexusApp`, `AppComponent`, `AppAction`, `AppEvent`, `AppVariable`.
- `connector.ts` — `ConnectorConfig`, `ConnectorHealth`, `RawSchema`.
- `ontology.ts` — `ObjectType`, `ObjectTypeVersion`, `SchemaDiff`, `EnrichmentProposal`, `FieldConflict`, `OntologyLink`, `SimilarityScore`.
- `pipeline.ts` — `Pipeline`, `PipelineNode`, `PipelineEdge`, `PipelineRun`, `NodeType`, `EventLogQualityScore`.
- `event.ts`, `inference.ts`, `notebook.ts`, `project.ts`.

## Routing model

`App.tsx:renderPage(page)` is a switch on string identifiers:
```
'connectors', 'ontology'/'graph', 'pipelines', 'apps'/'apps-app', 'workbench',
'projects', 'finance', 'logic', 'agents', 'human-actions', 'utilities',
'settings', 'evals', 'value', 'activity', 'operations', 'data', 'admin', 'platform'
```

Special URL paths (handled outside `AuthGate`):
- `/auth/callback?token=...&provider=...` → `SSOCallbackPage`
- `/s/<token>` → `SharePage` (public viewer, no auth)
- `/pminingv2` → `ProcessMiningV2` (hidden; type URL to access)

## Adding a new top-level module

1. Create `src/modules/<name>/<Name>Page.tsx` (or Studio).
2. Lazy-import in `App.tsx`: `const NewPage = lazy(() => import('./modules/<name>/<Name>Page'))`.
3. Add a `case '<id>': return <Suspense ...><NewPage /></Suspense>;` in `renderPage()`.
4. Add a NavRail entry in `shell/NavRail.tsx` (icon, i18n key, permission gate).
5. (If state) Add a Zustand store in `store/`.
6. (If new backend endpoints) Add to `src/api/<service>.ts`.

## Theme + density

`App.tsx:ThemeSync` sets `data-theme` and `data-density` on `<html>` from `useUiStore`. Tokens live in `src/design-system/tokens.ts` and CSS variables in `index.css`. See [design-system.md](design-system.md).
