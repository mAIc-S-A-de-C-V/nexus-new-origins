# `src/store/` — Zustand stores (~27)

State management is per-feature. Many use `persist` middleware for localStorage. Most translate API snake_case → frontend camelCase via shared converters in pipeline/ontology stores.

## Auth & navigation (3)

| Store | LOC | Purpose | Key helpers |
|-------|-----|---------|-------------|
| `authStore.ts` | 197 | User, accessToken, login/logout/refresh/OIDC | `getAccessToken()`, `getTenantId()`, `getUserId()`, `getModules()` (in-memory only; sessionStorage for impersonation) |
| `navigationStore.ts` | 38 | currentPage, breadcrumbs, pendingPipeline | `navigateTo(page)`, `setBreadcrumbs(items)` |
| `uiStore.ts` | 61 | theme, density, command palette, shortcuts overlay, active object panel | `toggleTheme()`, `toggleDensity()` (persisted under `nexus-ui-prefs`) |

## Module state (18+)

| Store | LOC | Module | State highlights |
|-------|-----|--------|------------------|
| `pipelineStore.ts` | 328 | pipeline | pipelines[], schedules[], snake↔camel converters with OPAQUE_KEYS |
| `ontologyStore.ts` | 188 | ontology | objectTypes[], links[], versions/diffs |
| `connectorStore.ts` | 174 | connectors | connectors[], joins pipeline data for `activePipelineCount` |
| `appStore.ts` | 164 | apps | apps[], `toNexusApp()` marshaling, ephemeral handling |
| `agentStore.ts` | 477 | agents | agents[], availableTools[], tenantModels[], schedules, triggers (LARGEST) |
| `operationsStore.ts` | 691 | operations | runs[], selected RunDetails, EntityHistory (LARGEST overall) |
| `workbenchStore.ts` | 283 | workbench | notebooks[], cells[], cellOutputs |
| `processStore.ts` | 395 | process (legacy) | cases[], events[], conformanceScores, deviations |
| `alertStore.ts` | 253 | alerts/notifications | rules[], notifications[], channels, webhooks[] |
| `logicStore.ts` | 209 | logic | functions[], schedules[] |
| `assistantStore.ts` | 4.9 KB | shell.NexusAssistant | open, conversations[], messages[] |
| `approvalStore.ts` | 4.4 KB | shell.NotificationDrawer | pendingApprovals[], approvedApprovals[] |
| `humanActionsStore.ts` | 155 | agents.HumanActions | actions[], executions[] |
| `explorerStore.ts` | 174 | explorer | filters, records[] |
| `graphStore.ts` | 158 | graph | selectedNodeId, depth, relationshipFilter |
| `runLogStore.ts` | 1.9 KB | shell | logs[], unreadCount |
| `searchStore.ts` | 1.5 KB | shell.SearchModal | query, results[] |
| `shortcutStore.ts` | 747 lines | shell.ShortcutsOverlay | shortcuts[] |

## Smaller (6)

| Store | Purpose |
|-------|---------|
| `checkpointStore.ts` | Audit checkpoint gates |
| `conformanceStore.ts` | Conformance scoring |
| `inferenceStore.ts` | Schema inference cache |
| `utilityStore.ts` | Utilities module state |
| `dashboardStackStore.ts` | Dashboard breadcrumb stack |
| (no `valueStore`) | ValuePage is stateless |

## Patterns

- `create<StateType>((set, get) => ({...}))` factory.
- Persist middleware for UI preferences only — never tokens.
- `snakeToCamel` / `camelToSnake` converters with `OPAQUE_KEYS` set to skip user-data dicts (avoid corrupting nested record JSON).

## When to edit

| Intent | File |
|--------|------|
| Add a feature with state | new `store/<feature>Store.ts`. |
| Add an action that calls backend | the matching store, hit `/api/<service>` or fetch directly. |
| Add localStorage persistence | wrap with `persist(create(...), { name: 'nexus-<feature>' })`. |
| Reset state on logout | clear in `authStore.logout()`. |
| Migrate a snake_case key | `OPAQUE_KEYS` set in `pipelineStore.ts` / `ontologyStore.ts`. |
