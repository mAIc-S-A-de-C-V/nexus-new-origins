/**
 * Studio — build, publish, and install a Nexus app entirely from the host UI.
 *
 * The UI manages a draft (autosaved to localStorage) consisting of:
 *   - identity (id, version, display_name, description, icon, publisher_id)
 *   - declared scopes (multi-select against the live catalog)
 *   - declared surfaces (page / widget / object_action / slash_command)
 *   - main TSX source (free-form code editor)
 *   - optional extra CSS
 *   - optional server-side functions (name + trigger + Python code)
 *
 * "Validate" hits POST /app-studio/validate-code → server-side esbuild
 * (no publish). "Publish & install" hits POST /app-studio/publish with
 * `install_after_publish: true` and then jumps the user to the running
 * iframe of the newly installed app.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getAccessToken, getTenantId } from '../../store/authStore';
import { scopeCatalog, downloadAiContext, fetchAiContext } from './api';
import type { ScopeCatalogEntry } from './types';

const PURPLE = '#7C3AED';
const BORDER = '#E2E8F0';
const APPS_API = import.meta.env.VITE_APPS_SERVICE_URL || 'http://localhost:8028';

const STARTER_TSX = `import React from "react";
import ReactDOM from "react-dom/client";
import { NexusProvider, useNexus, useNexusReady, useAutoResize, useNexusQuery, useNexusContext } from "@nexus/app-sdk/react";

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
  const { data: types } = useNexusQuery(() => nexus.ontology.listTypes(), []);

  return (
    <div ref={ref} style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Hello, {ctx.user.email}!</h1>
      <p>Tenant: <code>{ctx.tenant_id}</code></p>
      <h2 style={{ fontSize: 14, marginTop: 24 }}>Object types in your ontology</h2>
      <ul>{(types || []).map((t) => <li key={t.id}>{t.display_name || t.name}</li>)}</ul>
      <button
        onClick={() => nexus.toast("success", "From your new app!")}
        style={{ marginTop: 16, padding: "6px 12px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
      >Send a toast to the host</button>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider><App /></NexusProvider>
);
`;

interface SurfaceDraft {
  type: 'page' | 'widget' | 'object_action' | 'slash_command';
  title?: string;
  icon?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  object_type?: string;
  label?: string;
  name?: string;
}

interface FunctionDraft {
  name: string;
  description?: string;
  trigger_type: 'schedule' | 'webhook' | 'http';
  cron?: string;
  event?: string;
  object_type?: string;
  code: string;
  timeout_ms: number;
}

interface Draft {
  app_id: string;
  version: string;
  display_name: string;
  description: string;
  icon: string;
  publisher_id: string;
  scopes: string[];
  surfaces: SurfaceDraft[];
  main_tsx: string;
  extra_css: string;
  functions: FunctionDraft[];
}

const STORAGE_KEY = 'nexus.external_apps.studio.drafts';

function loadDrafts(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveDrafts(drafts: Record<string, Draft>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)); } catch { /* quota */ }
}

function newDraft(): Draft {
  const slug = `my-app-${Math.random().toString(36).slice(2, 6)}`;
  return {
    app_id: slug,
    version: '0.1.0',
    display_name: 'My App',
    description: 'Built in the Studio',
    icon: '',
    publisher_id: 'me',
    scopes: ['ontology:list_types', 'storage:kv:read', 'storage:kv:write'],
    surfaces: [{ type: 'page', title: 'My App', icon: 'sparkles' }],
    main_tsx: STARTER_TSX,
    extra_css: '',
    functions: [],
  };
}

interface BuildOutcome {
  ok: boolean;
  error?: string;
  warnings?: string[];
  app_id?: string;
  version?: string;
  install_id?: string;
  size_bytes?: number;
  bundle_js_size?: number;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${APPS_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': getTenantId(),
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await r.json(); } catch { parsed = await r.text(); }
  if (!r.ok) {
    const detail = typeof parsed === 'string' ? parsed : (parsed as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail ?? parsed));
  }
  return parsed as T;
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  onPublished?: (installId: string) => void;
}

const Studio: React.FC<Props> = ({ onPublished }) => {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => loadDrafts());
  const [activeKey, setActiveKey] = useState<string>(() => {
    const ks = Object.keys(loadDrafts());
    return ks[0] || '';
  });
  const draft = activeKey ? drafts[activeKey] : null;

  const [scopes, setScopes] = useState<ScopeCatalogEntry[]>([]);
  const [pane, setPane] = useState<'identity' | 'scopes' | 'surfaces' | 'code' | 'functions' | 'json'>('code');
  const [busy, setBusy] = useState<'validate' | 'publish' | null>(null);
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null);

  useEffect(() => { scopeCatalog().then(setScopes).catch(() => setScopes([])); }, []);

  // Autosave
  useEffect(() => {
    if (!activeKey || !draft) return;
    const id = setTimeout(() => {
      const next = { ...drafts, [activeKey]: draft };
      setDrafts(next); saveDrafts(next);
    }, 300);
    return () => clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const createNew = () => {
    const d = newDraft();
    const key = `${d.app_id}@${d.version}`;
    const next = { ...drafts, [key]: d };
    setDrafts(next); saveDrafts(next); setActiveKey(key);
    setOutcome(null);
  };

  const deleteDraft = (key: string) => {
    const next = { ...drafts };
    delete next[key];
    setDrafts(next); saveDrafts(next);
    if (key === activeKey) setActiveKey(Object.keys(next)[0] || '');
  };

  const updateDraft = (patch: Partial<Draft>) => {
    if (!draft) return;
    const updated = { ...draft, ...patch };
    setDrafts((p) => ({ ...p, [activeKey]: updated }));
  };

  // If no drafts at all, prompt user to start one
  if (!draft) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: '#F8FAFC', height: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>No drafts yet</div>
        <div style={{ fontSize: 12, color: '#64748B', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
          Drafts autosave to your browser as you type. Publishing creates an immutable version in the registry; bump the version field to ship a fix.
        </div>
        <button onClick={createNew} style={{ marginTop: 8, padding: '8px 16px', background: PURPLE, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          New app draft
        </button>
      </div>
    );
  }

  const onValidate = async () => {
    setBusy('validate'); setOutcome(null);
    try {
      const r = await apiPost<BuildOutcome>('/app-studio/validate-code', { main_tsx: draft.main_tsx, extra_css: draft.extra_css });
      setOutcome(r);
    } catch (e) {
      setOutcome({ ok: false, error: (e as Error).message });
    } finally { setBusy(null); }
  };

  const onPublishAndInstall = async () => {
    setBusy('publish'); setOutcome(null);
    try {
      const body = {
        app_id: draft.app_id,
        version: draft.version,
        display_name: draft.display_name,
        description: draft.description,
        icon: draft.icon,
        publisher_id: draft.publisher_id,
        scopes: draft.scopes,
        surfaces: draft.surfaces,
        functions: draft.functions.map((f) => ({
          name: f.name,
          description: f.description || '',
          trigger: {
            type: f.trigger_type,
            ...(f.cron ? { cron: f.cron } : {}),
            ...(f.event ? { event: f.event } : {}),
            ...(f.object_type ? { object_type: f.object_type } : {}),
          },
          timeout_ms: f.timeout_ms,
          code: f.code,
        })),
        main_tsx: draft.main_tsx,
        extra_css: draft.extra_css,
        minify: true,
        install_after_publish: true,
      };
      const r = await apiPost<BuildOutcome>('/app-studio/publish', body);
      setOutcome(r);
      if (r.install_id && onPublished) {
        onPublished(r.install_id);
      }
    } catch (e) {
      setOutcome({ ok: false, error: (e as Error).message });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#F8FAFC' }}>
      {/* Draft list */}
      <aside style={{ width: 220, background: '#fff', borderRight: `1px solid ${BORDER}`, overflowY: 'auto' }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Drafts</span>
          <button onClick={createNew} style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 11, background: PURPLE, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>+ New</button>
        </div>
        {Object.entries(drafts).map(([k, d]) => (
          <div key={k} onClick={() => setActiveKey(k)} style={{
            padding: '10px 12px', borderLeft: k === activeKey ? `2px solid ${PURPLE}` : '2px solid transparent',
            background: k === activeKey ? '#F8F5FF' : '#fff', cursor: 'pointer',
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{d.display_name}</div>
            <div style={{ fontSize: 10, color: '#64748B', fontFamily: 'ui-monospace,monospace' }}>{d.app_id}@{d.version}</div>
            <button onClick={(e) => { e.stopPropagation(); deleteDraft(k); }}
              style={{ marginTop: 4, fontSize: 10, color: '#B91C1C', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              delete
            </button>
          </div>
        ))}
      </aside>

      {/* Main editor */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header row — display name + actions */}
        <div style={{ background: '#fff', borderBottom: `1px solid ${BORDER}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="text"
            value={draft.display_name}
            onChange={(e) => updateDraft({ display_name: e.target.value })}
            style={{ fontSize: 15, fontWeight: 600, padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 4, flex: 1, minWidth: 0 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B', flexShrink: 0 }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>v</span>
            <input
              type="text"
              value={draft.version}
              onChange={(e) => updateDraft({ version: e.target.value })}
              placeholder="1.0.0"
              style={{ fontSize: 12, fontFamily: 'ui-monospace,monospace', padding: '6px 8px', border: `1px solid ${BORDER}`, borderRadius: 4, width: 80 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={onValidate} disabled={busy !== null}
              style={{ padding: '6px 12px', fontSize: 12, background: '#fff', color: '#475569', border: `1px solid ${BORDER}`, cursor: busy ? 'wait' : 'pointer', borderRadius: 4 }}>
              {busy === 'validate' ? 'Compiling' : 'Validate'}
            </button>
            <button onClick={onPublishAndInstall} disabled={busy !== null}
              style={{ padding: '6px 14px', fontSize: 12, background: PURPLE, color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', borderRadius: 4, fontWeight: 600 }}>
              {busy === 'publish' ? 'Publishing' : 'Publish'}
            </button>
          </div>
        </div>

        {/* Secondary row — app_id + tabs + utilities */}
        <div style={{ borderBottom: `1px solid ${BORDER}`, background: '#fff', display: 'flex', gap: 16, padding: '0 20px', height: 36, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>id</span>
            <input
              type="text"
              value={draft.app_id}
              onChange={(e) => updateDraft({ app_id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', padding: '2px 6px', border: `1px solid ${BORDER}`, borderRadius: 3, width: 160, color: '#475569' }}
            />
          </div>
          {(['code', 'identity', 'scopes', 'surfaces', 'functions', 'json'] as const).map((p) => (
            <button key={p} onClick={() => setPane(p)} style={{
              background: 'none', border: 'none', fontSize: 11, fontWeight: pane === p ? 600 : 500,
              color: pane === p ? PURPLE : '#475569', textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '6px 0', borderBottom: pane === p ? `2px solid ${PURPLE}` : '2px solid transparent', cursor: 'pointer',
            }}>{p}</button>
          ))}
          <button onClick={() => downloadAiContext()}
            title="Download a Markdown brief with the SDK reference, scopes, and your tenant's live object types/actions/agents. Paste into Claude or Cursor."
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, background: '#F1F5F9', color: '#475569', border: `1px solid ${BORDER}`, cursor: 'pointer', borderRadius: 3 }}>
            AI context
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: pane === 'code' ? 0 : 20 }}>
          {pane === 'code' && (
            <CodeEditor value={draft.main_tsx} onChange={(v) => updateDraft({ main_tsx: v })} />
          )}
          {pane === 'identity' && <IdentityPane draft={draft} update={updateDraft} />}
          {pane === 'scopes' && <ScopesPane draft={draft} update={updateDraft} catalog={scopes} />}
          {pane === 'surfaces' && <SurfacesPane draft={draft} update={updateDraft} />}
          {pane === 'functions' && <FunctionsPane draft={draft} update={updateDraft} />}
          {pane === 'json' && <JsonPane draft={draft} />}
        </div>

        {outcome && (
          <div style={{
            position: 'sticky', bottom: 0, padding: '12px 20px',
            background: outcome.ok ? '#DCFCE7' : '#FEF2F2',
            borderTop: `1px solid ${outcome.ok ? '#86EFAC' : '#FCA5A5'}`,
            color: outcome.ok ? '#15803D' : '#B91C1C', fontSize: 12,
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              {outcome.ok ? (
                <>
                  <div style={{ fontWeight: 600 }}>
                    {outcome.install_id ? 'Published & installed.' : 'Compiled successfully.'}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {outcome.bundle_js_size != null && <span>JS bundle: {(outcome.bundle_js_size / 1024).toFixed(1)} KB. </span>}
                    {outcome.size_bytes != null && <span>Total: {(outcome.size_bytes / 1024).toFixed(1)} KB. </span>}
                  </div>
                  {outcome.warnings && outcome.warnings.length > 0 && (
                    <pre style={{ marginTop: 4, fontSize: 11, color: '#854D0E', background: '#FEF3C7', padding: 8, borderRadius: 3, whiteSpace: 'pre-wrap' }}>
                      {outcome.warnings.join('\n')}
                    </pre>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>Failed.</div>
                  <pre style={{ marginTop: 4, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {outcome.error}
                  </pre>
                </>
              )}
            </div>
            <button onClick={() => setOutcome(null)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </main>
    </div>
  );
};

// ── Code editor (styled textarea with tab handling) ─────────────────────────
const CodeEditor: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const next = value.slice(0, s) + '  ' + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      wrap="off"
      style={{
        width: '100%', height: '100%', fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
        fontSize: 12, lineHeight: 1.6, padding: 16, border: 'none', resize: 'none', outline: 'none',
        background: '#0D1117', color: '#E2E8F0', boxSizing: 'border-box',
        whiteSpace: 'pre',
        overflow: 'auto',
        tabSize: 2,
      }}
    />
  );
};

// ── Identity ────────────────────────────────────────────────────────────────
const IdentityPane: React.FC<{ draft: Draft; update: (p: Partial<Draft>) => void }> = ({ draft, update }) => (
  <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
    <Field label="Description"><textarea value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={3}
      style={inputStyle} /></Field>
    <Field label="Icon URL"><input value={draft.icon} onChange={(e) => update({ icon: e.target.value })} style={inputStyle} placeholder="https://api.iconify.design/lucide:sparkles.svg" /></Field>
    <Field label="Publisher ID"><input value={draft.publisher_id} onChange={(e) => update({ publisher_id: e.target.value })} style={inputStyle} /></Field>
    <Field label="Extra CSS (injected into the iframe's <head>)"><textarea value={draft.extra_css} onChange={(e) => update({ extra_css: e.target.value })} rows={4} style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace' }} placeholder="body { background: #FAFAFA; }" /></Field>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
    {children}
  </label>
);
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 4, fontFamily: 'inherit',
};

// ── Scopes ───────────────────────────────────────────────────────────────────
const ScopesPane: React.FC<{ draft: Draft; update: (p: Partial<Draft>) => void; catalog: ScopeCatalogEntry[] }> = ({ draft, update, catalog }) => {
  const declared = new Set(draft.scopes);
  const allScopes = useMemo(() => {
    // Catalog entries are either literal (`ontology:list_types`) or
    // templates (`ontology:read:<type>`). For the user's selection we
    // surface both literal and wildcard forms.
    const out: { name: string; description: string; sensitive: boolean }[] = [];
    for (const s of catalog) {
      if (s.name.includes('<')) {
        const wc = s.name.replace(/<[^>]+>/g, '*');
        out.push({ name: wc, description: s.description + ' (any target)', sensitive: true });
      } else {
        out.push(s);
      }
    }
    return out;
  }, [catalog]);

  const toggle = (s: string) => update({
    scopes: declared.has(s) ? draft.scopes.filter((x) => x !== s) : [...draft.scopes, s],
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 720 }}>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
        Choose which platform capabilities your app needs. Tenant admins approve or reject each one at install time.
      </div>
      {allScopes.map((s) => (
        <label key={s.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, border: `1px solid ${BORDER}`, borderRadius: 4, background: '#fff' }}>
          <input type="checkbox" checked={declared.has(s.name)} onChange={() => toggle(s.name)} style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{s.name}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>{s.description}</div>
          </div>
          {s.sensitive && <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>SENSITIVE</span>}
        </label>
      ))}
    </div>
  );
};

// ── Surfaces ────────────────────────────────────────────────────────────────
const SurfacesPane: React.FC<{ draft: Draft; update: (p: Partial<Draft>) => void }> = ({ draft, update }) => {
  const setSurface = (idx: number, patch: Partial<SurfaceDraft>) =>
    update({ surfaces: draft.surfaces.map((s, i) => i === idx ? { ...s, ...patch } : s) });
  const remove = (idx: number) => update({ surfaces: draft.surfaces.filter((_, i) => i !== idx) });
  const add = (t: SurfaceDraft['type']) => update({
    surfaces: [...draft.surfaces, {
      type: t,
      ...(t === 'page' ? { title: draft.display_name, icon: 'sparkles' } : {}),
      ...(t === 'widget' ? { title: draft.display_name, size: 'md' } : {}),
      ...(t === 'object_action' ? { object_type: '', label: 'Open in ' + draft.display_name } : {}),
      ...(t === 'slash_command' ? { name: '/' + draft.app_id, title: draft.display_name } : {}),
    }],
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['page', 'widget', 'object_action', 'slash_command'] as const).map((t) => (
          <button key={t} onClick={() => add(t)} style={{ padding: '4px 10px', fontSize: 11, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 3, cursor: 'pointer' }}>+ {t.replace('_', ' ')}</button>
        ))}
      </div>
      {draft.surfaces.length === 0 && <div style={{ fontSize: 12, color: '#64748B' }}>No surfaces declared — your app won't appear anywhere. Add at least one.</div>}
      {draft.surfaces.map((s, idx) => (
        <div key={idx} style={{ padding: 12, border: `1px solid ${BORDER}`, borderRadius: 4, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.type.replace('_', ' ')}</span>
            <button onClick={() => remove(idx)} style={{ marginLeft: 'auto', fontSize: 10, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            {s.type === 'page' && <>
              <Field label="Title"><input value={s.title || ''} onChange={(e) => setSurface(idx, { title: e.target.value })} style={inputStyle} /></Field>
              <Field label="Icon name (lucide)"><input value={s.icon || ''} onChange={(e) => setSurface(idx, { icon: e.target.value })} style={inputStyle} /></Field>
            </>}
            {s.type === 'widget' && <>
              <Field label="Title"><input value={s.title || ''} onChange={(e) => setSurface(idx, { title: e.target.value })} style={inputStyle} /></Field>
              <Field label="Size">
                <select value={s.size || 'md'} onChange={(e) => setSurface(idx, { size: e.target.value as SurfaceDraft['size'] })} style={inputStyle}>
                  {['sm', 'md', 'lg', 'xl', 'full'].map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                </select>
              </Field>
            </>}
            {s.type === 'object_action' && <>
              <Field label="Object type (system name)"><input value={s.object_type || ''} onChange={(e) => setSurface(idx, { object_type: e.target.value })} style={inputStyle} placeholder="vendors" /></Field>
              <Field label="Menu label"><input value={s.label || ''} onChange={(e) => setSurface(idx, { label: e.target.value })} style={inputStyle} /></Field>
            </>}
            {s.type === 'slash_command' && <>
              <Field label="Command"><input value={s.name || ''} onChange={(e) => setSurface(idx, { name: e.target.value })} style={inputStyle} placeholder="/my-app" /></Field>
              <Field label="Title"><input value={s.title || ''} onChange={(e) => setSurface(idx, { title: e.target.value })} style={inputStyle} /></Field>
            </>}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Functions ────────────────────────────────────────────────────────────────
const FunctionsPane: React.FC<{ draft: Draft; update: (p: Partial<Draft>) => void }> = ({ draft, update }) => {
  const setFn = (idx: number, patch: Partial<FunctionDraft>) =>
    update({ functions: draft.functions.map((f, i) => i === idx ? { ...f, ...patch } : f) });
  const remove = (idx: number) => update({ functions: draft.functions.filter((_, i) => i !== idx) });
  const add = () => update({
    functions: [...draft.functions, {
      name: 'my_function',
      description: '',
      trigger_type: 'schedule',
      cron: '0 2 * * *',
      timeout_ms: 30000,
      code: `async def handler(nexus, inputs, event):
    return {'ok': True, 'tenant': nexus.tenant_id}
`,
    }],
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900 }}>
      <button onClick={add} style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 3, cursor: 'pointer' }}>+ Add server-side function</button>
      {draft.functions.length === 0 && <div style={{ fontSize: 12, color: '#64748B' }}>No server-side functions. Add one to handle cron triggers, ontology events, or HTTP calls.</div>}
      {draft.functions.map((f, idx) => (
        <div key={idx} style={{ padding: 12, border: `1px solid ${BORDER}`, borderRadius: 4, background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Name"><input value={f.name} onChange={(e) => setFn(idx, { name: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace' }} /></Field>
            <Field label="Trigger">
              <select value={f.trigger_type} onChange={(e) => setFn(idx, { trigger_type: e.target.value as FunctionDraft['trigger_type'] })} style={inputStyle}>
                <option value="schedule">schedule (cron)</option>
                <option value="webhook">webhook (event)</option>
                <option value="http">http (manual)</option>
              </select>
            </Field>
            <Field label="Timeout (ms)"><input type="number" value={f.timeout_ms} onChange={(e) => setFn(idx, { timeout_ms: Number(e.target.value) || 30000 })} style={inputStyle} /></Field>
          </div>
          {f.trigger_type === 'schedule' && (
            <div style={{ marginTop: 8 }}>
              <Field label="Cron expression"><input value={f.cron || ''} onChange={(e) => setFn(idx, { cron: e.target.value })} style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace' }} placeholder="0 2 * * *" /></Field>
            </div>
          )}
          {f.trigger_type === 'webhook' && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Event"><input value={f.event || ''} onChange={(e) => setFn(idx, { event: e.target.value })} style={inputStyle} placeholder="record.changed" /></Field>
              <Field label="Object type (optional)"><input value={f.object_type || ''} onChange={(e) => setFn(idx, { object_type: e.target.value })} style={inputStyle} /></Field>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Field label="Python code (async def handler(nexus, inputs, event))">
              <textarea value={f.code} onChange={(e) => setFn(idx, { code: e.target.value })} rows={10}
                style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace', whiteSpace: 'pre', tabSize: 4 }} />
            </Field>
          </div>
          <button onClick={() => remove(idx)} style={{ marginTop: 8, fontSize: 11, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer' }}>remove function</button>
        </div>
      ))}
    </div>
  );
};

// ── JSON ────────────────────────────────────────────────────────────────────
const JsonPane: React.FC<{ draft: Draft }> = ({ draft }) => {
  const manifest = useMemo(() => ({
    id: draft.app_id, version: draft.version, publisher_id: draft.publisher_id,
    display_name: draft.display_name, description: draft.description,
    ...(draft.icon ? { icon: draft.icon } : {}),
    scopes: draft.scopes, surfaces: draft.surfaces,
    functions: draft.functions.map((f) => ({
      name: f.name, description: f.description,
      trigger: { type: f.trigger_type, ...(f.cron ? { cron: f.cron } : {}), ...(f.event ? { event: f.event } : {}), ...(f.object_type ? { object_type: f.object_type } : {}) },
      timeout_ms: f.timeout_ms, code: f.code,
    })),
  }), [draft]);
  return (
    <pre style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, background: '#0D1117', color: '#E2E8F0', padding: 16, borderRadius: 4, overflow: 'auto', whiteSpace: 'pre' }}>
      {JSON.stringify(manifest, null, 2)}
    </pre>
  );
};

export default Studio;
