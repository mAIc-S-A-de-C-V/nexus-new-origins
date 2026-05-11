/**
 * In-product developer onboarding for the Apps platform.
 *
 * Everything a developer needs to get from zero to a published app, without
 * leaving the host UI:
 *   - 60-second quick-start (copy-pastable shell commands)
 *   - Live scope catalog (pulled from /apps/scopes/catalog)
 *   - SDK method reference with required scopes + examples
 *   - Manifest schema, annotated
 *   - Surface taxonomy (page / widget / object_action / slash_command)
 *   - Server-side function recipes (schedule / webhook / http)
 *   - Troubleshooting + links into the codebase
 */
import React, { useEffect, useMemo, useState } from 'react';
import { scopeCatalog, downloadAiContext, fetchAiContext } from './api';
import type { ScopeCatalogEntry } from './types';

const PURPLE = '#7C3AED';
const BORDER = '#E2E8F0';
const CARD_BG = '#FFFFFF';

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      style={{ marginLeft: 8, padding: '2px 8px', fontSize: 10, background: done ? '#DCFCE7' : '#F1F5F9', color: done ? '#15803D' : '#475569', border: `1px solid ${BORDER}`, borderRadius: 3, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em' }}>
      {done ? 'COPIED' : label}
    </button>
  );
};

const Code: React.FC<{ children: string; lang?: string }> = ({ children }) => (
  <div style={{ position: 'relative', margin: '8px 0' }}>
    <pre style={{ background: '#0D1117', color: '#E2E8F0', padding: '12px 14px', borderRadius: 4, fontSize: 12, lineHeight: 1.55, overflow: 'auto', margin: 0, fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace' }}>
      {children}
    </pre>
    <div style={{ position: 'absolute', top: 6, right: 6 }}>
      <CopyButton text={children} />
    </div>
  </div>
);

const Section: React.FC<{ id?: string; title: string; subtitle?: string; children: React.ReactNode }> = ({ id, title, subtitle, children }) => (
  <section id={id} style={{ marginBottom: 32, scrollMarginTop: 56 }}>
    <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0D1117', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h2>
    {subtitle && <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 14px' }}>{subtitle}</p>}
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 16 }}>{children}</div>
  </section>
);

// ── Step list (numbered) ─────────────────────────────────────────────────────
const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
    <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 13, background: PURPLE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{n}</div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>{children}</div>
    </div>
  </div>
);

const Sidebar: React.FC<{ active: string; onSelect: (id: string) => void }> = ({ active, onSelect }) => {
  const items = [
    { id: 'quickstart',  label: 'Quick start' },
    { id: 'sdk',         label: 'SDK reference' },
    { id: 'manifest',    label: 'Manifest schema' },
    { id: 'scopes',      label: 'Scope catalog' },
    { id: 'surfaces',    label: 'Surface types' },
    { id: 'functions',   label: 'Server-side functions' },
    { id: 'lifecycle',   label: 'Versioning & lifecycle' },
    { id: 'security',    label: 'Security model' },
    { id: 'troubleshoot',label: 'Troubleshooting' },
    { id: 'ai-brief',    label: 'Building with an AI' },
  ];
  return (
    <aside style={{ width: 220, borderRight: `1px solid ${BORDER}`, background: '#fff', padding: '20px 0', position: 'sticky', top: 0, height: '100%', overflowY: 'auto' }}>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => { e.preventDefault(); onSelect(it.id); document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              fontWeight: active === it.id ? 600 : 500,
              color: active === it.id ? PURPLE : '#475569',
              textDecoration: 'none',
              borderLeft: active === it.id ? `2px solid ${PURPLE}` : '2px solid transparent',
              background: active === it.id ? '#F8F5FF' : 'transparent',
            }}
          >{it.label}</a>
        ))}
      </nav>
    </aside>
  );
};

// ── SDK method catalog (hand-written, matches client.ts) ─────────────────────
const SDK_METHODS: { group: string; name: string; signature: string; scope: string; example: string }[] = [
  // host
  { group: 'host', name: 'host.ping',         signature: 'nexus.host.ping()', scope: '(no scope)', example: 'const { pong, now } = await nexus.host.ping();' },
  { group: 'host', name: 'host.getConfig',    signature: 'nexus.host.getConfig()', scope: 'host:config:read', example: 'const { config } = await nexus.host.getConfig();' },
  { group: 'host', name: 'refreshToken',      signature: 'nexus.refreshToken()', scope: 'host:refresh', example: 'await nexus.refreshToken(); // rarely needed — SDK does it automatically' },
  // ontology
  { group: 'ontology', name: 'ontology.listTypes', signature: 'nexus.ontology.listTypes()', scope: 'ontology:list_types',
    example: 'const types = await nexus.ontology.listTypes();' },
  { group: 'ontology', name: 'ontology.query', signature: 'nexus.ontology.query({ object_type, filter?, limit?, offset?, order_by? })', scope: 'ontology:read:<type>  (or  ontology:read:*)',
    example: "const { records } = await nexus.ontology.query({\n  object_type: 'vendors',\n  limit: 50,\n  filter: { tier: 'gold' },\n});" },
  { group: 'ontology', name: 'ontology.get', signature: 'nexus.ontology.get(object_type, record_id)', scope: 'ontology:read:<type>',
    example: "const r = await nexus.ontology.get('vendors', 'v-123');" },
  { group: 'ontology', name: 'ontology.aggregate', signature: 'nexus.ontology.aggregate({ object_type, group_by?, time_bucket?, aggregations, ... })', scope: 'ontology:aggregate:<type>',
    example: "const { rows } = await nexus.ontology.aggregate({\n  object_type: 'invoices',\n  group_by: 'vendor',\n  aggregations: [{ method: 'sum', field: 'amount', alias: 'total' }],\n});" },
  // actions
  { group: 'actions', name: 'actions.list', signature: 'nexus.actions.list()', scope: 'actions:list',
    example: 'const actions = await nexus.actions.list();' },
  { group: 'actions', name: 'actions.propose', signature: 'nexus.actions.propose({ action_name, inputs, reasoning? })', scope: 'actions:propose:<name>',
    example: "await nexus.actions.propose({\n  action_name: 'create_po_memo',\n  inputs: { vendor_id: 'v-1', amount: 500 },\n  reasoning: 'auto-flagged by quote review widget',\n});" },
  // agents
  { group: 'agents', name: 'agents.list', signature: 'nexus.agents.list()', scope: 'agents:list',
    example: 'const agents = await nexus.agents.list();' },
  { group: 'agents', name: 'agents.run', signature: 'nexus.agents.run(agent_name, inputs)', scope: 'agents:run:<name>',
    example: "const result = await nexus.agents.run('po_researcher', { vendor_id: 'v-1' });" },
  // workflow
  { group: 'workflow', name: 'workflow.listMine', signature: 'nexus.workflow.listMine()', scope: 'workflow:read:my',
    example: 'const assignments = await nexus.workflow.listMine();' },
  // storage
  { group: 'storage', name: 'storage.kv.get', signature: "nexus.storage.kv.get(key, { scope?: 'install'|'user' })", scope: 'storage:kv:read',
    example: "const v = await nexus.storage.kv.get('last_seen');" },
  { group: 'storage', name: 'storage.kv.set', signature: 'nexus.storage.kv.set(key, value, opts?)', scope: 'storage:kv:write',
    example: "await nexus.storage.kv.set('last_seen', { ts: Date.now() });" },
  { group: 'storage', name: 'storage.kv.delete', signature: 'nexus.storage.kv.delete(key, opts?)', scope: 'storage:kv:write',
    example: "await nexus.storage.kv.delete('draft');" },
  { group: 'storage', name: 'storage.kv.list', signature: "nexus.storage.kv.list(prefix?, opts?)", scope: 'storage:kv:read',
    example: "const { items } = await nexus.storage.kv.list('user:');" },
  // host-shell helpers (no scope)
  { group: 'shell', name: 'resize',            signature: 'nexus.resize(heightPx)', scope: '(no scope)', example: 'nexus.resize(800); // or use the useAutoResize hook' },
  { group: 'shell', name: 'toast',             signature: 'nexus.toast(level, message)', scope: '(no scope)', example: "nexus.toast('success', 'Saved');" },
  { group: 'shell', name: 'navigate',          signature: "nexus.navigate(path, { newTab? })", scope: '(no scope)', example: "nexus.navigate('/operations');" },
  { group: 'shell', name: 'closeMe',           signature: 'nexus.closeMe()', scope: '(no scope)', example: 'nexus.closeMe(); // dismisses a side-sheet surface' },
  { group: 'shell', name: 'hasScope',          signature: 'nexus.hasScope(scope)', scope: '(client-side check)', example: "if (nexus.hasScope('actions:propose:create_po_memo')) { ... }" },
];

const SDK_HOOKS: { name: string; signature: string; example: string }[] = [
  { name: 'NexusProvider', signature: '<NexusProvider mockData={...}>{children}</NexusProvider>', example: 'Wrap your app root. Bootstraps the postMessage bridge.' },
  { name: 'useNexus',       signature: 'const nexus = useNexus()', example: 'Returns the typed client. Throws if called before provider ready.' },
  { name: 'useNexusContext',signature: 'const ctx = useNexusContext()', example: 'Live context (tenant, user, theme, locale, scopes_granted).' },
  { name: 'useNexusReady',  signature: 'const { ready, error } = useNexusReady()', example: 'Gate your UI on this before calling useNexus().' },
  { name: 'useAutoResize',  signature: 'useAutoResize(ref)', example: 'Pass a ref to your root container — SDK posts new heights to the host as the iframe content grows or shrinks.' },
  { name: 'useNexusQuery',  signature: 'useNexusQuery(factory, deps, { refetchInterval? })', example: 'SWR-like fetcher. Returns { data, loading, error, refetch }.' },
];

// ── The page ─────────────────────────────────────────────────────────────────
const DevelopTab: React.FC = () => {
  const [scopes, setScopes] = useState<ScopeCatalogEntry[]>([]);
  const [active, setActive] = useState('quickstart');

  useEffect(() => { scopeCatalog().then(setScopes).catch(() => setScopes([])); }, []);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar active={active} onSelect={setActive} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#F8FAFC' }}>
        {/* Hero */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0D1117', margin: 0 }}>Build a Nexus app</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 6, maxWidth: 720 }}>
            Apps run in a sandboxed iframe and talk to Nexus exclusively through a capability-scoped RPC bridge.
            You can write them in any framework — the SDK ships with first-class React bindings.
          </p>
        </div>

        {/* Quick start */}
        <Section id="quickstart" title="Quick start" subtitle="From zero to a published app in under five minutes.">
          <Step n={1} title="Scaffold the app">
            Run from the repo root. Creates a Vite + React + TypeScript starter with the SDK pre-wired.
            <Code>{`node nexus-apps-sdk/cli/index.mjs init my-first-app`}</Code>
          </Step>
          <Step n={2} title="Run it in dev mode (mock SDK)">
            <Code>{`cd my-first-app
npm install
npm run dev   # opens http://localhost:5174 — iterate without a host`}</Code>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: -4 }}>
              In dev mode the SDK auto-switches to mock mode: <code>useNexus()</code> returns a synthetic
              client backed by in-memory data so you can iterate without round-tripping through the platform.
              Provide your own seed via <code>{`<NexusProvider mockData={...}>`}</code>.
            </div>
          </Step>
          <Step n={3} title="Edit your code">
            Open <code>src/main.tsx</code>. Call any SDK method — see the reference below.
            Edit <code>manifest.json</code> to declare scopes, surfaces (where the app shows up), and optional server-side functions.
          </Step>
          <Step n={4} title="Build and publish">
            <Code>{`npm run build
NEXUS_APPS_URL=http://localhost:8028 NEXUS_TENANT_ID=tenant-001 \\
  node ../nexus-apps-sdk/cli/index.mjs publish`}</Code>
            The CLI tarballs <code>dist/</code>, uploads it to apps-service, and the version becomes available in the Catalog tab.
          </Step>
          <Step n={5} title="Install and use">
            Switch to <strong>Catalog</strong> → find your app → <strong>Install</strong> → review scopes →
            land on the Installed tab with the iframe rendered.
          </Step>
        </Section>

        {/* SDK reference */}
        <Section id="sdk" title="SDK reference" subtitle="Every method available inside an app.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Method</th>
                  <th style={{ padding: 8 }}>Signature</th>
                  <th style={{ padding: 8 }}>Required scope</th>
                </tr>
              </thead>
              <tbody>
                {SDK_METHODS.map((m) => (
                  <tr key={m.name} style={{ borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.name}</td>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', color: '#0D1117' }}>{m.signature}</td>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', color: m.scope.startsWith('(') ? '#64748B' : '#7C3AED' }}>{m.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569' }}>React hooks</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Hook</th>
                  <th style={{ padding: 8 }}>Signature</th>
                  <th style={{ padding: 8 }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {SDK_HOOKS.map((h) => (
                  <tr key={h.name} style={{ borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.name}</td>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace' }}>{h.signature}</td>
                    <td style={{ padding: 8, color: '#475569' }}>{h.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569' }}>Example: a minimal viable app</h3>
          <Code>{`import React from "react";
import ReactDOM from "react-dom/client";
import { NexusProvider, useNexus, useNexusReady, useAutoResize, useNexusQuery } from "@nexus/app-sdk/react";

const App = () => {
  const { ready, error } = useNexusReady();
  if (error) return <pre>{String(error)}</pre>;
  if (!ready) return <div>Loading…</div>;
  return <Body />;
};

const Body = () => {
  const nexus = useNexus();
  const ref = React.useRef<HTMLDivElement>(null);
  useAutoResize(ref);

  const { data: vendors } = useNexusQuery(
    () => nexus.ontology.query({ object_type: "vendors", limit: 20 }),
    [],
  );

  return (
    <div ref={ref} style={{ padding: 16 }}>
      <h1>Hi {nexus.ctx.user.email}</h1>
      <ul>{vendors?.records.map(v => <li key={v.id}>{v.name}</li>)}</ul>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider><App /></NexusProvider>
);`}</Code>
        </Section>

        {/* Manifest */}
        <Section id="manifest" title="Manifest schema" subtitle="manifest.json declares your app to Nexus. Validated on publish.">
          <Code>{`{
  "id":            "procurement-cockpit",   // a-z, digits, dashes; must be unique per publisher
  "version":       "1.0.0",                  // strict semver, immutable once published
  "publisher_id":  "maic-platform",          // your team/publisher identifier
  "display_name":  "Procurement Cockpit",
  "description":   "Daily PO review widget",
  "icon":          "https://.../icon.svg",
  "homepage":      "https://...",

  "entry":         "http://localhost:8028/apps/bundles/procurement-cockpit/1.0.0/index.html",
                   // The URL the host iframes. apps-service serves your bundle here automatically.

  "scopes": [
    "ontology:read:ordenes_de_compra",
    "ontology:read:vendors",
    "actions:propose:create_research_memo",
    "storage:kv:read",
    "storage:kv:write"
  ],

  "surfaces": [
    { "type": "page",          "path": "/cockpit", "title": "Procurement", "icon": "shopping-cart" },
    { "type": "widget",        "id": "po_kanban", "title": "PO Kanban", "size": "lg" },
    { "type": "object_action", "object_type": "ordenes_de_compra", "label": "Research" },
    { "type": "slash_command", "name": "/proc", "title": "Procurement search" }
  ],

  "config_schema": {                      // optional — admin will see a form to fill this in on install
    "type": "object",
    "properties": {
      "default_priority": { "type": "string", "enum": ["LOW","MED","HIGH"] }
    }
  },

  "functions": [                          // optional server-side code
    {
      "name": "nightly_summary",
      "description": "Aggregate POs once a day",
      "trigger": { "type": "schedule", "cron": "0 2 * * *" },
      "timeout_ms": 30000,
      "code": "async def handler(nexus, inputs, event):\\n    return {'ok': True}\\n"
    }
  ],

  "event_subscriptions": [                // optional — fan out platform events to your functions
    { "event": "record.changed", "object_type": "ordenes_de_compra", "function": "nightly_summary" }
  ]
}`}</Code>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 8 }}>
            Versions are <strong>immutable</strong>. To ship a fix you must bump <code>version</code> and republish.
            Tenants stay on whatever version they have installed until an admin upgrades them.
          </div>
        </Section>

        {/* Live scope catalog */}
        <Section id="scopes" title="Scope catalog" subtitle="What you can declare in manifest.scopes. Wildcards (*) match any concrete target.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Scope</th>
                  <th style={{ padding: 8 }}>Description</th>
                  <th style={{ padding: 8 }}>Sensitive?</th>
                </tr>
              </thead>
              <tbody>
                {scopes.map((s) => (
                  <tr key={s.name} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: 8 }}>{s.description}</td>
                    <td style={{ padding: 8 }}>{s.sensitive
                      ? <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>SENSITIVE</span>
                      : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 12 }}>
            Templates like <code>ontology:read:&lt;type&gt;</code> can be instantiated as <code>ontology:read:vendors</code>,
            or as the wildcard <code>ontology:read:*</code>. The wildcard form is shown as <em>sensitive</em> in the install UI
            and a tenant admin can deny it without uninstalling.
          </div>
        </Section>

        {/* Surfaces */}
        <Section id="surfaces" title="Surface types" subtitle="Where your app shows up inside Nexus.">
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Where it renders</th>
                <th style={{ padding: 8 }}>Manifest entry</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: 8, fontWeight: 600 }}>page</td>
                <td style={{ padding: 8 }}>Standalone full-screen page in the Apps section. One per app.</td>
                <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontSize: 11 }}>{'{ "type":"page", "title":"...", "icon":"..." }'}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: 8, fontWeight: 600 }}>widget</td>
                <td style={{ padding: 8 }}>Drops into AppEditor dashboards. Sized by <code>size</code>: sm/md/lg/xl/full.</td>
                <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontSize: 11 }}>{'{ "type":"widget", "id":"...", "title":"...", "size":"md" }'}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: 8, fontWeight: 600 }}>object_action</td>
                <td style={{ padding: 8 }}>Adds an item to a record's actions menu. Side-sheet opens with the iframe.</td>
                <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontSize: 11 }}>{'{ "type":"object_action", "object_type":"vendors", "label":"Research" }'}</td>
              </tr>
              <tr>
                <td style={{ padding: 8, fontWeight: 600 }}>slash_command</td>
                <td style={{ padding: 8 }}>Adds an entry to the global command palette (Cmd+K).</td>
                <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace', fontSize: 11 }}>{'{ "type":"slash_command", "name":"/proc", "title":"..." }'}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* Server-side functions */}
        <Section id="functions" title="Server-side functions" subtitle="Code that runs without an open browser tab. Triggered by cron, platform events, or HTTP.">
          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12px' }}>
            Functions live in the manifest and run in a sandboxed async-Python runtime (no <code>import</code>, no filesystem,
            no network except through the same <code>nexus</code> client your browser code uses).
          </p>
          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569' }}>Schedule (cron)</h3>
          <Code>{`{
  "name": "nightly_summary",
  "trigger": { "type": "schedule", "cron": "0 2 * * *" },
  "timeout_ms": 30000,
  "code": "async def handler(nexus, inputs, event):\\n    types = await nexus.list_types()\\n    counts = {}\\n    for t in types:\\n        r = await nexus.query(object_type=t['name'], limit=1)\\n        counts[t['name']] = (r or {}).get('total') or 0\\n    await nexus.kv_set('latest_summary', counts)\\n    return counts\\n"
}`}</Code>
          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569' }}>Webhook (platform events)</h3>
          <Code>{`{
  "name": "on_po_change",
  "trigger": { "type": "webhook", "event": "record.changed", "object_type": "ordenes_de_compra" },
  "code": "async def handler(nexus, inputs, event):\\n    return {'changed': event.get('record_id')}\\n"
}

// then declare a subscription so the dispatcher routes events to it:
"event_subscriptions": [
  { "event": "record.changed", "object_type": "ordenes_de_compra", "function": "on_po_change" }
]`}</Code>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
            Function logs, output, and any errors appear in the Function runs tab.
          </div>
        </Section>

        {/* Lifecycle */}
        <Section id="lifecycle" title="Versioning &amp; lifecycle" subtitle="How versions work and what an upgrade looks like.">
          <ul style={{ fontSize: 12, color: '#475569', paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>Versions are <strong>immutable</strong> — publishing the same <code>(app_id, version)</code> twice is a 409.</li>
            <li>The bundle is content-hashed; republishing the exact same tarball is a no-op.</li>
            <li>Installs pin to a specific version. Upgrades are <strong>explicit</strong> — admin picks the new version and re-grants any newly required scopes.</li>
            <li>Yanking a version blocks new installs but leaves existing installs running. Yanked versions show "[YANKED]" in <code>nexus-app versions</code>.</li>
            <li>Uninstall cascade-deletes the install row, KV data, function registrations, and audit history for that install.</li>
          </ul>
        </Section>

        {/* Security */}
        <Section id="security" title="Security model" subtitle="What the platform enforces vs what your app is responsible for.">
          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 0, marginBottom: 6, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platform enforces</h3>
          <ul style={{ fontSize: 12, color: '#475569', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>iframe is cross-origin, sandboxed (<code>allow-scripts allow-forms</code>, no <code>allow-same-origin</code>).</li>
            <li>App-context JWT bound to <code>install_id</code>, 5-min TTL, never in URL.</li>
            <li>postMessage origin strictly matched to the install's resolved app origin.</li>
            <li>Per-method scope check before any backend call. Tenant admin can refuse any subset.</li>
            <li>Per-install rate limit: 100 RPS sustained, 200 burst. Payload caps: 1MB req / 5MB resp.</li>
            <li>KV quota: 64KB per value, 10MB per install.</li>
            <li>Every RPC is audited (method, scope used, latency, outcome).</li>
          </ul>
          <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>You're responsible for</h3>
          <ul style={{ fontSize: 12, color: '#475569', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Treating data you receive via RPC as belonging to the current user — do not leak across installs or tenants.</li>
            <li>Catching <code>ScopeDeniedError</code> and degrading gracefully when an admin refuses a scope.</li>
            <li>Validating inputs inside <code>actions.propose</code> — the platform passes them through.</li>
            <li>Versioning your manifest accurately so admins can audit upgrades.</li>
          </ul>
        </Section>

        {/* Troubleshooting */}
        <Section id="troubleshoot" title="Troubleshooting" subtitle="Common pitfalls and how to fix them.">
          <ul style={{ fontSize: 12, color: '#475569', paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li><strong>Iframe is blank</strong> → open browser devtools console, look for "postMessage origin mismatch". Usually means <code>manifest.entry</code> doesn't match where apps-service serves it. Run <code>curl http://localhost:8028/app-registry/apps/&lt;your-app&gt;</code> and compare <code>entry_url</code> to the iframe's <code>src</code>.</li>
            <li><strong>RPC returns <code>scope_denied</code></strong> → admin didn't grant that scope on install. Go to Installed → your app → Scopes pane → tick it → Save.</li>
            <li><strong>RPC returns <code>rate_limited</code></strong> → you're calling too fast. Batch reads, increase <code>refetchInterval</code>, or coalesce.</li>
            <li><strong>Server function fails with <code>sandbox_violation</code></strong> → you used <code>import</code>, <code>__import__</code>, or a forbidden dunder. Stick to the curated builtins + <code>json</code>, <code>datetime</code>, and the <code>nexus</code> client.</li>
            <li><strong>Publish fails with 409</strong> → that version already exists. Bump the version in <code>manifest.json</code>.</li>
            <li><strong>Token refresh failing</strong> → check the user is still authenticated on the host. App-context tokens expire after 5 minutes; the SDK refreshes automatically, but a stale parent session breaks the chain.</li>
          </ul>
        </Section>

        {/* AI brief — placed at the foot, low-key */}
        <Section id="ai-brief" title="Building with an AI" subtitle="Download a single Markdown file with the SDK reference, manifest schema, scope catalog, and your tenant's live object types, actions, and agents.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
              Paste this brief into Claude, Cursor, or ChatGPT as context and ask it to generate the TSX for your app.
              Because it includes your tenant's live ontology and action list, the LLM uses real names — no hallucinated APIs.
            </div>
            <button onClick={() => downloadAiContext()}
              style={{ padding: '8px 14px', fontSize: 12, background: PURPLE, color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 4, fontWeight: 600, whiteSpace: 'nowrap' }}>
              Download brief
            </button>
            <button onClick={async () => { const t = await fetchAiContext(); await navigator.clipboard.writeText(t); }}
              style={{ padding: '8px 14px', fontSize: 12, background: '#fff', color: '#475569', border: `1px solid ${BORDER}`, cursor: 'pointer', borderRadius: 4, whiteSpace: 'nowrap' }}>
              Copy
            </button>
          </div>
        </Section>

        {/* Footer pointers */}
        <div style={{ marginTop: 32, padding: 16, background: '#F1F5F9', borderRadius: 6, fontSize: 12, color: '#475569' }}>
          <div style={{ fontWeight: 600, color: '#0D1117', marginBottom: 6 }}>Reference reading inside the repo</div>
          <ul style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li><code>nexus-apps/hello-nexus/</code> — fully working reference app (all SDK surfaces exercised)</li>
            <li><code>nexus-apps-sdk/src/client.ts</code> — SDK source if you want to see what the RPC envelope actually looks like</li>
            <li><code>backend/apps_service/routers/rpc.py</code> — the host-side dispatcher (scope checks, rate limits, audit)</li>
            <li><code>backend/apps_service/scopes.py</code> — the canonical scope catalog</li>
            <li><code>backend/apps_service/smoke_test.py</code> — end-to-end test script you can crib from</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default DevelopTab;
