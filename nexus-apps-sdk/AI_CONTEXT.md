# Nexus Apps — AI build context

You are about to build a **Nexus app**: a sandboxed iframe app that runs inside the Nexus platform (Palantir-style data + agents stack). This document is everything you need: SDK surface, security model, manifest schema, design tokens, and code patterns. Read it fully before writing code.

> **Live tenant overlay**: If a section is marked `<!--TENANT-LIVE-->`, the values in it were filled in at download time from the actual platform — they reflect the real object types, actions, and agents available right now. Trust those over anything you'd otherwise guess.

---

## 1. What you're building

A Nexus app is:

- **A single-page React + TypeScript app.** Vite for dev, esbuild server-side for production bundling.
- **Loaded in a sandboxed iframe** on a separate origin (`localhost:8028` for the apps service in dev).
- **Connected to the host via postMessage RPC** through `@nexus/app-sdk`. That's the *only* way to reach platform data — no direct fetch to other backends.
- **Capability-scoped.** Every method you call requires a scope declared in the manifest and granted by a tenant admin.
- **Audited.** Every RPC call is logged with method, scope used, latency, outcome.

## 2. SDK surface — every method

Import the React surface:
```ts
import { NexusProvider, useNexus, useNexusReady, useNexusContext, useAutoResize, useNexusQuery } from "@nexus/app-sdk/react";
```

Always wrap the app root in `<NexusProvider>`. Gate UI with `useNexusReady` before calling `useNexus()`.

### `useNexus()` returns a typed client with these methods

| Method | Signature | Required scope | Notes |
|---|---|---|---|
| `nexus.host.ping()` | `() → { pong, now }` | (none) | Liveness check. |
| `nexus.host.getConfig()` | `() → { config }` | `host:config:read` | Per-install JSON config admin set at install time. |
| `nexus.refreshToken()` | `() → void` | `host:refresh` | Rarely needed; SDK auto-refreshes. |
| `nexus.ontology.listTypes()` | `() → { id, name, display_name }[]` | `ontology:list_types` | All object types in the tenant's ontology. |
| `nexus.ontology.query({ object_type, filter?, limit?, offset?, order_by?, search? })` | → `{ records, count, total }` | `ontology:read:<type>` or `ontology:read:*` | Paginated query. |
| `nexus.ontology.get(object_type, record_id)` | → record \| null | `ontology:read:<type>` | Fetch one by id. |
| `nexus.ontology.aggregate({ object_type, group_by?, time_bucket?, aggregations, filters?, limit? })` | → `{ rows, total_groups }` | `ontology:aggregate:<type>` | Server-side GROUP BY / time bucket. |
| `nexus.ontology.create({ object_type, data, pk_field? })` | → `{ ok, record_id, ingested }` | `ontology:create:<type>` | Upsert one record. If `data.id` is set it becomes the record_id. Use this instead of `actions.propose` for plain CRUD; reserve actions for workflows with approval. |
| `nexus.ontology.update({ object_type, record_id, fields })` | → `{ ok, record_id }` | `ontology:update:<type>` | Merge `fields` into an existing record. Errors if not found. |
| `nexus.ontology.delete({ object_type, record_id })` | → `{ ok, record_id }` | `ontology:delete:<type>` | Delete by id. |
| `nexus.actions.list()` | → `{ name, description, input_schema, requires_confirmation }[]` | `actions:list` | All available action definitions. |
| `nexus.actions.propose({ action_name, inputs, reasoning? })` | → `{ execution_id, status }` | `actions:propose:<name>` | **Proposes**; admin confirms if `requires_confirmation`. |
| `nexus.agents.list()` | → `{ name, description }[]` | `agents:list` | |
| `nexus.agents.run(agent_name, inputs)` | → result | `agents:run:<name>` | Trigger an agent run. |
| `nexus.workflow.listMine()` | → assignments[] | `workflow:read:my` | This user's assigned items. |
| `nexus.storage.kv.get(key, { scope? })` | → value \| null | `storage:kv:read` | `scope: "install" \| "user"`. |
| `nexus.storage.kv.set(key, value, opts?)` | → `{ ok, size_bytes }` | `storage:kv:write` | Max 64KB / value, 10MB / install. |
| `nexus.storage.kv.delete(key, opts?)` | → `{ ok }` | `storage:kv:write` | |
| `nexus.storage.kv.list(prefix?, opts?)` | → `{ items }` | `storage:kv:read` | |

### Host UI primitives (no scope, just postMessages)

| Method | Purpose |
|---|---|
| `nexus.resize(heightPx)` | Tell the host how tall the iframe should be. Prefer the `useAutoResize` hook. |
| `nexus.toast(level, message)` | Show a host-level toast (`info\|success\|warning\|error`). |
| `nexus.navigate(path, { newTab? })` | Navigate the host shell. |
| `nexus.closeMe()` | Close a side-sheet surface. |
| `nexus.crash(error)` | Tell the host the app has crashed → renders fallback. |
| `nexus.hasScope(scope)` | Local check (does the install have this scope granted?). |

### React hooks

| Hook | What it does |
|---|---|
| `NexusProvider` | Wrap root. Bootstraps the postMessage bridge or mock mode in dev. |
| `useNexus()` | Returns the typed client. Throws if called before provider ready. |
| `useNexusReady()` | `{ ready, error }`. Gate UI on this. |
| `useNexusContext()` | Live `{ tenant_id, user, theme, locale, density, scopes_granted, config }`. Mutable across host changes. |
| `useAutoResize(ref)` | Auto-posts height to host when content size changes. Pass a ref to your top-level container. |
| `useNexusQuery(factory, deps, { refetchInterval? })` | SWR-like fetcher. Returns `{ data, loading, error, refetch }`. |

### Error handling

```ts
import { ScopeDeniedError, RpcError } from "@nexus/app-sdk";

try { await nexus.actions.propose({ action_name, inputs }); }
catch (e) {
  if (e instanceof ScopeDeniedError) showAccessHint(e.requiredScope);
  else throw e;
}
```

Always handle `ScopeDeniedError` gracefully — admin may have refused a scope without uninstalling.

## 3. Manifest schema

`manifest.json` declares your app to Nexus. Validated on publish.

```json
{
  "id":            "my-app",                                 // [a-z0-9-]{2,64}, unique per publisher
  "version":       "1.0.0",                                   // strict semver, IMMUTABLE — bump every publish
  "publisher_id":  "your-team",
  "display_name":  "My App",
  "description":   "What it does",
  "icon":          "https://api.iconify.design/lucide:sparkles.svg",

  "entry":         "http://localhost:8028/apps/bundles/my-app/1.0.0/index.html",

  "scopes": ["ontology:read:vendors", "storage:kv:read", "storage:kv:write"],

  "surfaces": [
    { "type": "page",          "title": "...", "icon": "lucide-icon-name" },
    { "type": "widget",        "title": "...", "size": "sm|md|lg|xl|full" },
    { "type": "object_action", "object_type": "<system_name>", "label": "..." },
    { "type": "slash_command", "name": "/my", "title": "..." }
  ],

  "config_schema": { "type": "object", "properties": { ... } },

  "functions": [
    {
      "name": "nightly_summary",
      "trigger": { "type": "schedule", "cron": "0 2 * * *" },
      "timeout_ms": 30000,
      "code": "async def handler(nexus, inputs, event):\n    return {'ok': True}\n"
    }
  ],

  "event_subscriptions": [
    { "event": "record.changed", "object_type": "vendors", "function": "nightly_summary" }
  ]
}
```

**Immutability**: once `(id, version)` is published, that exact bundle is frozen. To ship a fix you bump `version`. Installed tenants stay on the version they chose until an admin upgrades.

## 4. Capability scope catalog

| Scope | Description | Sensitive? |
|---|---|---|
<!--SCOPES_TABLE-->

Wildcard form `domain:action:*` satisfies any concrete target (`ontology:read:vendors`). The host flags wildcard grants as **sensitive** in the install UI so admins explicitly approve.

## 5. Surface types

| Type | Where it shows up | Manifest fields |
|---|---|---|
| `page` | Standalone page in the App Studio → Installed tab and as a deep link `/apps/external/<install_id>`. | `title`, `icon` |
| `widget` | Drops into AppEditor dashboards as a tile. | `title`, `size: sm\|md\|lg\|xl\|full` |
| `object_action` | Item in a record's action menu. Opens a side-sheet with the iframe. | `object_type`, `label` |
| `slash_command` | Entry in the global command palette (Cmd+K). | `name` (starts with `/`), `title` |

## 6. Server-side functions

Sandboxed async-Python that runs without an open browser tab.

```python
async def handler(nexus, inputs, event):
    # `nexus` is the same client as the browser SDK (same scopes apply)
    types = await nexus.list_types()
    await nexus.kv_set('summary', {'count': len(types)})
    return {'types': len(types)}
```

**Runtime restrictions** (enforced at compile + run time):
- No `import` / `__import__` / dynamic loading.
- No filesystem, subprocess, network outside the `nexus` client.
- Curated builtins (`len`, `range`, `min`, `max`, list/dict/set/tuple, exceptions, `print` captured).
- Available modules: `json`, `datetime`.
- All RPC methods are available on `nexus.*` — same surface as the JS SDK.

Triggers:
- `{"type": "schedule", "cron": "0 2 * * *"}` — APScheduler cron.
- `{"type": "webhook", "event": "record.changed", "object_type": "..."}` — fired by event_subscriptions.
- `{"type": "http"}` — manual run only.

## 7. Theme — Palantir-like aesthetic

Match the host's look. Don't ship custom themes unless asked.

### Tokens

```css
--color-brand:           #7C3AED   /* purple, primary action */
--color-bg:              #F8FAFC   /* light page background */
--color-surface:         #FFFFFF   /* card / panel */
--color-border:          #E2E8F0
--color-text:            #0D1117
--color-text-muted:      #475569
--color-text-subtle:     #64748B
--color-text-placeholder:#94A3B8

/* dark mode (data-theme="dark") */
--color-bg-dark:         #0D1117
--color-surface-dark:    #111827
--color-border-dark:     #1F2937
--color-text-dark:       #E2E8F0
```

### Type

- System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif`.
- Section headings: 11–12px, uppercase, letter-spacing `0.06em`, weight 600, color `#475569`.
- Body: 12–13px, line-height 1.5.
- Monospace: `ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace`.

### Spacing + density

- Base unit 4px. Standard padding: 8 / 12 / 16 / 24.
- Inputs: 6–8px vertical padding, 1px borders, 4px radius. No drop shadows.
- Tables: alternating row backgrounds avoided; use single 1px border per row.
- Buttons: 6/14 padding, 12px font, primary uses `--color-brand`.
- Cards: 1px border, 4–6px radius, no shadows; rely on contrast.

### React + theme

The SDK pushes theme/locale/density into your app via `useNexusContext()`. Read `ctx.theme === "dark"` and swap CSS variables on the `<html>` element via `data-theme`. Example:

```tsx
const ctx = useNexusContext();
const isDark = ctx.theme === "dark";
const colors = {
  bg:      isDark ? "#0D1117" : "#FFFFFF",
  fg:      isDark ? "#E2E8F0" : "#0D1117",
  sub:     isDark ? "#94A3B8" : "#64748B",
  border:  isDark ? "#1F2937" : "#E2E8F0",
};
```

The host listens for theme changes mid-session and pushes them to you. Keep your styles reactive to `ctx.theme`.

## 8. Lifecycle: dev → publish → install

### Dev mode

`<NexusProvider>` auto-switches to mock mode when no parent window is detected (e.g. running `npm run dev` directly). Provide seed data:

```tsx
<NexusProvider mockData={{
  ontology: { vendors: { records: [{ id: "v1", name: "Acme" }] } },
  actions:  [{ name: "approve_quote" }],
}}>
  <App />
</NexusProvider>
```

### Publish

Two paths:

1. **In-product Studio** — edit + Validate + Publish & install, all in the UI. No terminal.
2. **CLI** — `node nexus-apps-sdk/cli/index.mjs publish` from inside the app directory. Same publish endpoint.

Both produce the same immutable, content-hashed version row in the registry.

### Install

Tenant admin reviews scopes (can grant a subset) and clicks Install. Your app appears at `/apps/external/<install_id>` plus any other surfaces declared.

## 9. Security model — what's enforced for you

- **Cross-origin iframe**. App runs on a separate origin from the host.
- **App-context JWT** bound to `install_id`, 5-min TTL, never appears in URL.
- **postMessage origin** strictly matched on every message. No `*` targetOrigin.
- **Scope check** on every RPC call. Result is `scope_denied` if missing.
- **Rate limit**: 100 RPS / 200 burst per install.
- **Payload caps**: 1MB request, 5MB response, 64KB KV value, 10MB KV total per install.
- **Audit**: every RPC + every function run logged with latency, scope used, outcome.

What's on you:
- Treat data received via RPC as belonging to the current user — don't leak across tenants.
- Catch `ScopeDeniedError` and degrade gracefully (hide UI, show hint, etc).
- Validate inputs you pass to `actions.propose` — the platform passes them through.

### 9.1 Superadmin tenant impersonation

apps-service honours an `x-impersonate-tenant` header on every endpoint
(`/app-registry/*`, `/app-installs/*`, `/app-studio/*`, `/cli/*`,
`/sdk/*`, `/apps/scopes/*`, `/apps/functions/*`). When the
authenticated user is a **superadmin** and the header carries a
different tenant id than their home tenant, the request is processed
as if the caller belonged to that tenant — they see that tenant's
catalog, installs, brief overlay, audit log, etc.

Non-superadmins get a silent no-op (the header is ignored, not 403).
That way honest clients can always include the header without breaking
when they're not authorised.

Every audit row written while impersonating still records the real
caller's `user_id` and the impersonated tenant in `tenant_id` — the
trail shows both halves cleanly.

The CLI exposes this via `--as-tenant=<id>` on any command, or
`NEXUS_IMPERSONATE_TENANT=<id>` in the environment. When active, the
CLI prints `[impersonating tenant: <id>]` to stderr so it's never
silent.

## 10. <!--TENANT-LIVE--> Available object types in this tenant

```
<!--OBJECT_TYPES-->
```

## 11. <!--TENANT-LIVE--> Available actions in this tenant

```
<!--ACTIONS-->
```

## 12. <!--TENANT-LIVE--> Available agents in this tenant

```
<!--AGENTS-->
```

## 13. Complete reference app

Minimal but exercises every surface — read this top-to-bottom:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import {
  NexusProvider, useNexus, useNexusReady, useNexusContext,
  useAutoResize, useNexusQuery,
} from "@nexus/app-sdk/react";

const App = () => {
  const { ready, error } = useNexusReady();
  if (error) return <pre style={{ padding: 16, color: "crimson" }}>{String(error)}</pre>;
  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;
  return <Body />;
};

const Body = () => {
  const nexus = useNexus();
  const ctx = useNexusContext();
  const ref = React.useRef<HTMLDivElement>(null);
  useAutoResize(ref);

  // Reactive theme
  const isDark = ctx.theme === "dark";
  const colors = {
    bg: isDark ? "#0D1117" : "#FFFFFF", fg: isDark ? "#E2E8F0" : "#0D1117",
    sub: isDark ? "#94A3B8" : "#64748B", border: isDark ? "#1F2937" : "#E2E8F0",
  };

  // Query the ontology
  const { data: types, loading } = useNexusQuery(
    () => nexus.ontology.listTypes(),
    [],
  );

  // Conditional UI based on granted scopes
  const canPropose = nexus.hasScope("actions:propose:*");

  return (
    <div ref={ref} style={{ padding: 24, background: colors.bg, color: colors.fg, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Hello {ctx.user.email}</h1>
      <p style={{ fontSize: 12, color: colors.sub }}>tenant: <code>{ctx.tenant_id}</code></p>

      <section style={{ marginTop: 16, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 4 }}>
        <h2 style={{ fontSize: 11, fontWeight: 600, color: colors.sub, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ontology</h2>
        {loading ? "loading…" : (
          <ul>{(types || []).map((t) => <li key={t.id}>{t.display_name || t.name}</li>)}</ul>
        )}
      </section>

      {canPropose && (
        <button
          onClick={async () => {
            try {
              const r = await nexus.actions.propose({ action_name: "approve_quote", inputs: {} });
              nexus.toast("success", `Proposed: ${r.execution_id || "ok"}`);
            } catch (e) {
              nexus.toast("error", String(e));
            }
          }}
          style={{ marginTop: 12, padding: "6px 14px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          Propose quote approval
        </button>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider mockData={{
    ontology: { vendors: { records: [{ id: "v1", name: "Acme" }] } },
  }}>
    <App />
  </NexusProvider>,
);
```

## 14. Patterns to follow

- **Always wrap in `<NexusProvider>` and gate with `useNexusReady`.**
- **Pass a ref to `useAutoResize`** — the iframe needs to know how tall to be.
- **Read theme from `useNexusContext`** — don't hardcode light mode.
- **Prefer `useNexusQuery`** for ontology reads — handles loading/error state.
- **Use `nexus.hasScope(...)` to hide UI** when a scope wasn't granted — avoid surfacing buttons that always fail.
- **For long-running work**, use a server-side function with a schedule trigger, write the result to KV, and have the UI read from KV via `nexus.storage.kv.get`.

## 15. Anti-patterns

- ❌ Direct `fetch` to other Nexus services — bypasses scope checks and CORS will fail anyway.
- ❌ Storing JWTs in localStorage — the SDK does this for you and refreshes them.
- ❌ Long-running synchronous work in `handler` (server-side functions have a 30s default timeout).
- ❌ Multi-megabyte responses — you'll hit the 5MB cap. Paginate.
- ❌ Multiple wildcard scopes "just in case" — admin can refuse them and your app breaks.

## 16. Troubleshooting cheatsheet

| Symptom | Cause | Fix |
|---|---|---|
| Iframe blank, console "postMessage origin mismatch" | `manifest.entry` doesn't match where the bundle is served | Re-publish; the Studio fills `entry` automatically |
| `scope_denied` on every call | Admin didn't grant that scope on install | Installed tab → app → Scopes → tick + Save |
| `rate_limited` | Hitting 100 RPS | Coalesce, paginate, increase `refetchInterval` |
| `sandbox_violation` in function run | Used `import`, `__import__`, or a forbidden dunder | Stick to `json`, `datetime`, `nexus.*` |
| Publish returns 409 | Same version already exists | Bump `version` in manifest |

---

If you're building an app, generate the TSX inline matching the style above (system fonts, purple `#7C3AED` brand color, 12–13px body, 1px borders, 4px radii, no drop shadows). Use the **live tenant overlay** sections (10–12) as ground truth for what to query.
