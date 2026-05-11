# Prompt template — finishing a Nexus app the CLI just scaffolded

Use this when you've already run `nexus-app init <name>` + `npm install` and
you want an LLM to fill in the actual code for your app. Replace the `>>>`
block with what your app should do. Attach `AI_CONTEXT.md` from the project
root (the CLI dropped it there) and send.

---

I have a working Nexus app scaffold on disk. Everything below is already set up:

- The Nexus CLI is installed at `~/.nexus/bin/nexus-app` and I'm logged in (credentials in `~/.nexus/credentials.json`).
- I ran `nexus-app init my-app` and `cd my-app && npm install`.
- The project has these files I want you to edit:
  - `src/main.tsx` — the React entry. Currently the starter that just lists object types and shows my email. I want you to replace its `<Body>` component with the real app.
  - `manifest.json` — declares scopes, surfaces, optional server-side functions. I want you to update the scopes and surfaces to match what the new code actually needs.
- I have `AI_CONTEXT.md` from the project root attached / pasted into this chat — that's the full SDK reference, scope catalog, manifest schema, theme tokens, and patterns.
- The SDK is vendored locally at `./vendor/nexus-app-sdk.tgz`, already installed; my code imports from `@nexus/app-sdk/react` and it resolves.
- `npm run dev` already starts a Vite server in mock-SDK mode — I'll iterate there.

When the code is ready I'll bump `manifest.json`'s `version` field, then run:
```
npm run build && nexus-app publish && nexus-app install
```
…which builds, uploads to apps-service, and installs in my tenant.

## >>> What this app should do (REPLACE)

Describe the app in concrete terms:

- **Purpose, one sentence:**
  <e.g. "Operational dashboard for police-novedad incident reports — show prio mix, geo breakdown, 24h timeline, and a filterable table.">

- **Primary object type:**          <e.g. `novedad`>
- **Other object types to read:**   <comma-separated, or "none">
- **Actions to propose:**            <names, or "none">
- **Agents to trigger:**             <names, or "none">

- **Key fields on the primary object** (give me a list — even short — so I don't hallucinate field names):
  - `id`           — record id
  - `<field>`      — <type / what it is>
  - `<field>`      — <type / what it is>
  - ...

- **Look-and-feel notes** (be specific — vague = wrong shape):
  - <e.g. "4 KPI tiles at the top: total in tenant, critical count, last 24h, top departamento">
  - <e.g. "two donuts side-by-side: priority + category">
  - <e.g. "horizontal-bar panels for top departamentos and municipios">
  - <e.g. "filterable table at the bottom with click-row-to-open detail drawer">

- **Per-install config the admin sets** (avoid putting secrets / settings in the code):
  - <e.g. "`api_key` (Bearer key for external Nexus gateway)">
  - <e.g. "`object_slug` (default 'novedad')">
  - <e.g. "`sample_size` (records to load for the dashboard, default 500)">

- **Locale:**     <en / es / both — does the UI need to be Spanish?>
- **Dark mode:**  must work — pull theme from `useNexusContext().theme === "dark"`

## <<<

## Output

Produce **exactly two fenced code blocks** in this order, each with the filename comment on its first line:

````
```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { NexusProvider, useNexus, useNexusReady, useNexusContext, useAutoResize, useNexusQuery } from "@nexus/app-sdk/react";

// ... the full file ...

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider mockData={{ /* realistic seed data */ }}>
    <App />
  </NexusProvider>,
);
```

```json
// manifest.json
{
  "id": "...",
  "version": "0.1.0",
  ...
}
```
````

No prose before, between, or after the blocks. I'll paste both files over the scaffold as-is.

## Hard rules

1. **Imports only from** `react`, `react-dom/client`, `@nexus/app-sdk/react`. Nothing else. No chart library — hand-roll charts as SVG (see the patterns in `AI_CONTEXT.md` and `PROMPT_TEMPLATE.md` if I attached them).
2. **Always** wrap root in `<NexusProvider>` with a `mockData` seed so `npm run dev` works without a host.
3. **Always** gate UI with `useNexusReady()`.
4. **Always** pass a ref to `useAutoResize(ref)` on the top-level container.
5. **Read theme from `useNexusContext()`** and build a `C` colors object — never hardcode light mode.
6. **Read secrets from `useNexusContext().config`** — never put API keys in the code.
7. **Catch `ScopeDeniedError`** from `actions.propose` / `agents.run` and degrade gracefully.
8. **Manifest scopes must be exact** strings from the catalog in `AI_CONTEXT.md`. No wildcards unless I asked for them — they get flagged as sensitive at install time.
9. **Surfaces** in the manifest match where I asked the app to show up (page / widget / object_action / slash_command).
10. **`version` stays at "0.1.0"** in this output — I'll bump it manually each publish.

## Anti-patterns to avoid

- Direct `fetch()` to other Nexus services — bypasses scope checks, CORS will fail.
- Storing JWTs / API keys in localStorage — SDK manages tokens, secrets come from install config.
- Multi-megabyte responses — paginate with cursor (external mode) or offset (local mode).
- Defensive try/catch retry loops — use `useNexusQuery({ refetchInterval })` instead.
- Multiple wildcard scopes "just in case" — admin can refuse and the app breaks.

Now produce the two files for the app described in the `>>> ... <<<` block.

---

## Sidebar — building for a tenant that isn't your home tenant

If you're a superadmin and want the brief / publish / install to operate against another tenant, pass `--as-tenant=<tenant_id>` on any CLI command:

```bash
nexus-app brief    --as-tenant=tenant-mjsp-sv --out=AI_CONTEXT.md
nexus-app publish  --as-tenant=tenant-mjsp-sv
nexus-app install  --as-tenant=tenant-mjsp-sv
```

Or set it for the whole shell:

```bash
export NEXUS_IMPERSONATE_TENANT=tenant-mjsp-sv
nexus-app brief      # prints "[impersonating tenant: tenant-mjsp-sv]" to stderr
```

Non-superadmins get a silent no-op (the header is ignored, not 403) — safe to leave the flag/env in scripts that run as both roles.
