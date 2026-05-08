# `src/shell/` — App shell (10 files)

The top-level layout, navigation, AI assistant, command palette, search, notifications, and tenant context. The shell is what wraps every authenticated module.

## Files

| File | LOC | Purpose |
|------|-----|---------|
| `AppShell.tsx` | ~100 | Root layout. 3-column (NavRail \| main \| NexusAssistant). Mounts ImpersonationBanner, breadcrumb bar, global keyboard. |
| `NavRail.tsx` | 25KB | Left sidebar. 19 top-level items + sub-groups (Apps, MAIC). User menu (logout, timezone, language, theme). Permission gates via `isAdmin()`/`isSuperAdmin()`. |
| `TenantContext.tsx` | 9.4KB | Auth provider. Types: `MaicUser`, `Tenant`, `UserRole = 'SUPERADMIN'\|'ADMIN'\|'DATA_ENGINEER'\|'ANALYST'\|'VIEWER'`. Exposes `useAuth()` returning `{tenant, currentUser, users, isAuthenticated, login, logout, changePassword, addUser, updateUser, deleteUser}`. Maps API role ↔ enum (`mapRole`/`mapRoleToApi`/`mapApiUser`). |
| `NexusAssistant.tsx` | 60KB+ | Right-side AI assistant. **Largest** shell component. `fetchLiveContext()` gathers functions/object types/connectors/pipelines/providers from many services; messages → `inference-service /infer/stream-help`. **Action dispatch is table-driven** via `GENERIC_ACTION_REGISTRY` (~70 entries) — each entry maps an action type to `{label, icon, method, url, body}`. New action types only require a row in that table; no new code branches. The 10 original "custom" actions (`create_connector`, `create_object_type`, `create_pipeline`, `create_logic`, `run_pipeline`, `create_ontology_link`, `ingest_records`, `create_app`, `create_app_action`, `register_model_provider`) keep their hand-rolled executors for type-specific transforms; the rest fall through to the generic dispatcher. |
| `CommandPalette.tsx` | 10.6KB | Cmd+K menu. Categories: nav, pipelines, agents, connectors, logic. |
| `NotificationBell.tsx` | 75 | Top-right bell. Polls alert/run-log/approval stores every 30s. Toggles drawer. |
| `NotificationDrawer.tsx` | 29KB | 3-tab drawer: Alerts, Run Logs, Approvals. `ApprovalRow` renderer for approve/reject. |
| `ObjectContextPanel.tsx` | 297 | Right panel showing details of selected object (objectType, pipeline, agent, connector). Driven by `uiStore.activeObjectPanel`. |
| `SearchModal.tsx` | 8.7KB | Global search overlay (Cmd+K). Result groups by type with TYPE_META. Navigates to `result.path`. |
| `ShortcutsOverlay.tsx` | 5.8KB | `?` overlay listing shortcuts grouped by category. |

## NavRail items (`shell/NavRail.tsx`)

19 top-level: connectors, ontology/graph, pipelines, workbench, logic, agents, human-actions, evals, apps, projects (MAIC), finance (MAIC), event log, alerts, utilities, users, settings, activity/audit, admin, platform (superadmin), data quality, value monitor.

Permission gates use `usePermission()` hook reading `currentUser.role` + `allowed_modules`.

## NexusAssistant (most complex)

Pulls live context from all services to give the assistant rich grounding. Key endpoints called:

- LOGIC_URL `/logic/functions`
- ONTOLOGY_URL `/object-types`
- CONNECTOR_URL `/connectors`
- PIPELINE_URL `/pipelines`
- AGENT_URL `/agents`, `/model-providers`

Tool calls parsed from assistant response are sent back; chat persists in `assistantStore`.

## When to edit

| Intent | File |
|--------|------|
| Add nav item | `shell/NavRail.tsx:NAV_ITEMS` array (with i18n key, icon, path, optional admin gate). |
| Change layout structure | `shell/AppShell.tsx`. |
| Add new approval action / notification type | `shell/NotificationDrawer.tsx` + corresponding store. |
| Extend assistant with new live context | `shell/NexusAssistant.tsx:fetchLiveContext()`. |
| Add a new assistant action (mutating tool) | `shell/NexusAssistant.tsx:GENERIC_ACTION_REGISTRY` — one row: `{label, icon, method, url, body}`. Then teach Claude about it by adding the documentation to `backend/inference_service/routers/inference.py:NEXUS_HELP_SYSTEM`. Also add the matching tool in `backend/agent_service/tools.py:TOOL_DEFINITIONS` + dispatcher branch so Agent Studio agents can use it. |
| Add a new searchable type | `shell/SearchModal.tsx:TYPE_META` + matching backend in `search-service`. |
| Modify auth flow / role mapping | `shell/TenantContext.tsx` (`mapRole`, `mapApiUser`). |
| Change shortcut categories | `shell/ShortcutsOverlay.tsx` + `store/shortcutStore.ts` registrations. |
| Add a new object panel type | `shell/ObjectContextPanel.tsx:TYPE_META` + open via `uiStore.openObjectPanel(type, id)`. |
