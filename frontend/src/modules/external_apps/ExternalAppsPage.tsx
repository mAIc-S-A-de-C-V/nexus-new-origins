/**
 * Tenant Apps page: catalog | installed | audit | functions.
 *
 * The TL;DR for an admin:
 *   - browse the marketplace catalog
 *   - install with per-scope toggle review
 *   - see the iframed app at /apps/external/:installId
 *   - inspect audit log + RPC activity per install
 *   - manually trigger server-side functions, see run history
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AppCatalogEntry, AppVersionEntry, AppInstallEntry,
  ScopeCatalogEntry, AuditEntry,
} from './types';
import {
  listCatalog, listInstalls, getAppWithVersions, installApp, patchInstall,
  uninstallApp, scopeCatalog, installAudit,
  listFunctions, runFunctionNow, listFunctionRuns, FunctionEntry, FunctionRun,
} from './api';
import ExternalApp from './ExternalApp';
import DevelopTab from './DevelopTab';
import Studio from './Studio';

type Tab = 'catalog' | 'installed' | 'function-runs' | 'studio' | 'develop';

const PURPLE = '#7C3AED';
const BORDER = '#E2E8F0';

const ExternalAppsPage: React.FC<{ initialInstallId?: string }> = ({ initialInstallId }) => {
  const [tab, setTab] = useState<Tab>(initialInstallId ? 'installed' : 'catalog');
  const [catalog, setCatalog] = useState<AppCatalogEntry[]>([]);
  const [installs, setInstalls] = useState<AppInstallEntry[]>([]);
  const [scopes, setScopes] = useState<ScopeCatalogEntry[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [installerOpen, setInstallerOpen] = useState<{ app: AppCatalogEntry; versions: AppVersionEntry[] } | null>(null);
  const [activeInstallId, setActiveInstallId] = useState<string | null>(initialInstallId ?? null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = () => setRefreshTick((t) => t + 1);

  useEffect(() => {
    listCatalog().then(setCatalog).catch(() => setCatalog([]));
    listInstalls().then(setInstalls).catch(() => setInstalls([]));
    scopeCatalog().then(setScopes).catch(() => setScopes([]));
  }, [refreshTick]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8FAFC' }}>
      <Header tab={tab} setTab={setTab} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'catalog' && (
          <CatalogView
            catalog={catalog}
            installs={installs}
            onInstall={async (app) => {
              const detail = await getAppWithVersions(app.app_id);
              setInstallerOpen(detail);
            }}
            onSelect={setSelectedAppId}
            onCreateApp={() => setTab('studio')}
          />
        )}
        {tab === 'installed' && (
          <InstalledView
            installs={installs}
            catalog={catalog}
            scopes={scopes}
            activeInstallId={activeInstallId}
            setActiveInstallId={setActiveInstallId}
            onChange={refresh}
          />
        )}
        {tab === 'function-runs' && <FunctionRunsView installs={installs} />}
        {tab === 'studio' && (
          <Studio
            onPublished={(installId) => {
              setActiveInstallId(installId);
              setTab('installed');
              refresh();
            }}
          />
        )}
        {tab === 'develop' && <DevelopTab />}
      </div>
      {installerOpen && (
        <InstallerModal
          detail={installerOpen}
          scopes={scopes}
          onClose={() => setInstallerOpen(null)}
          onComplete={async (installed) => {
            setInstallerOpen(null);
            setTab('installed');
            setActiveInstallId(installed.id);
            refresh();
          }}
        />
      )}
    </div>
  );
};

// ── Header ──────────────────────────────────────────────────────────────────
const Header: React.FC<{ tab: Tab; setTab: (t: Tab) => void }> = ({ tab, setTab }) => (
  <div style={{ height: 52, background: '#fff', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 24 }}>
    <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 }}>Apps</h1>
    <nav style={{ display: 'flex', gap: 16 }}>
      {(['catalog', 'installed', 'function-runs', 'studio', 'develop'] as Tab[]).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 12,
            fontWeight: tab === t ? 600 : 500,
            color: tab === t ? PURPLE : '#475569',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '6px 0',
            borderBottom: tab === t ? `2px solid ${PURPLE}` : '2px solid transparent',
          }}
        >
          {t.replace('-', ' ')}
        </button>
      ))}
    </nav>
    <button
      onClick={() => setTab('studio')}
      style={{
        marginLeft: 'auto',
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        background: PURPLE,
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      + Create app
    </button>
  </div>
);

// ── Catalog ─────────────────────────────────────────────────────────────────
const CatalogView: React.FC<{ catalog: AppCatalogEntry[]; installs: AppInstallEntry[]; onInstall: (app: AppCatalogEntry) => void; onSelect: (id: string) => void; onCreateApp?: () => void }> = ({ catalog, installs, onInstall, onCreateApp }) => {
  const installedIds = new Set(installs.map((i) => i.app_id));
  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {catalog.length === 0 && (
        <div style={{
          gridColumn: '1 / -1',
          padding: 32,
          background: '#fff',
          border: `1px dashed ${BORDER}`,
          borderRadius: 6,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', marginBottom: 4 }}>No apps in the catalog yet</div>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>Build your first one in the Studio, or read the SDK docs in Develop.</div>
          <button
            onClick={onCreateApp}
            style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, background: PURPLE, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Open Studio
          </button>
        </div>
      )}
      {catalog.map((app) => (
        <div key={app.app_id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {app.icon_url && <img src={app.icon_url} alt="" style={{ width: 32, height: 32, borderRadius: 4 }} />}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{app.display_name}</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>{app.publisher_id} · v{app.latest_version}</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#475569', minHeight: 36, lineHeight: 1.5, margin: '12px 0' }}>{app.description || '—'}</p>
          {installedIds.has(app.app_id) ? (
            <button disabled style={{ width: '100%', padding: '8px 0', fontSize: 12, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 4 }}>Installed</button>
          ) : (
            <button onClick={() => onInstall(app)} style={{ width: '100%', padding: '8px 0', fontSize: 12, background: PURPLE, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Install</button>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Installer modal ────────────────────────────────────────────────────────
const InstallerModal: React.FC<{
  detail: { app: AppCatalogEntry; versions: AppVersionEntry[] };
  scopes: ScopeCatalogEntry[];
  onClose: () => void;
  onComplete: (i: AppInstallEntry) => void;
}> = ({ detail, scopes, onClose, onComplete }) => {
  const versions = detail.versions.filter((v) => !v.yanked);
  const [version, setVersion] = useState(versions[0]?.version || '');
  const v = versions.find((x) => x.version === version);
  const required = v?.scopes_required || [];
  const [granted, setGranted] = useState<string[]>(required);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setGranted(required), [version]); // eslint-disable-line

  const scopeDesc = (s: string) =>
    scopes.find((x) => x.name === s)?.description ||
    (() => {
      const tpl = scopes.find((x) => {
        const parts = s.split(':');
        if (parts.length !== 3) return false;
        return x.name.startsWith(parts.slice(0, 2).join(':') + ':<');
      });
      return tpl?.description || s;
    })();
  const isSensitive = (s: string) => {
    const exact = scopes.find((x) => x.name === s);
    if (exact) return exact.sensitive;
    const tpl = scopes.find((x) => {
      const parts = s.split(':');
      if (parts.length !== 3) return false;
      return x.name.startsWith(parts.slice(0, 2).join(':') + ':<');
    });
    return tpl?.sensitive ?? false;
  };

  return (
    <Modal onClose={onClose} title={`Install ${detail.app.display_name}`}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Version
          <select value={version} onChange={(e) => setVersion(e.target.value)} style={{ marginLeft: 8 }}>
            {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} · {v.bundle_size_bytes}B · {new Date(v.published_at).toLocaleDateString()}</option>)}
          </select>
        </label>
        <div style={{ fontSize: 13, color: '#0D1117', fontWeight: 600 }}>This app is requesting:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }}>
          {required.map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, border: `1px solid ${BORDER}`, borderRadius: 4 }}>
              <input
                type="checkbox"
                checked={granted.includes(s)}
                onChange={(e) => setGranted((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s))}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{s}</div>
                <div style={{ fontSize: 11, color: '#64748B' }}>{scopeDesc(s)}</div>
              </div>
              {isSensitive(s) && <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>sensitive</span>}
            </label>
          ))}
          {required.length === 0 && <div style={{ fontSize: 12, color: '#64748B' }}>No special scopes requested.</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: '#B91C1C' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, background: '#fff', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>Cancel</button>
          <button
            disabled={busy || !v}
            onClick={async () => {
              if (!v) return;
              setBusy(true); setErr(null);
              try {
                const installed = await installApp({ app_id: detail.app.app_id, version: v.version, scopes_granted: granted, config: {} });
                onComplete(installed);
              } catch (e) {
                setErr((e as Error).message);
              } finally { setBusy(false); }
            }}
            style={{ padding: '6px 12px', fontSize: 12, background: PURPLE, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Install
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ── Installed ──────────────────────────────────────────────────────────────
const InstalledView: React.FC<{
  installs: AppInstallEntry[]; catalog: AppCatalogEntry[]; scopes: ScopeCatalogEntry[];
  activeInstallId: string | null; setActiveInstallId: (id: string | null) => void;
  onChange: () => void;
}> = ({ installs, catalog, scopes, activeInstallId, setActiveInstallId, onChange }) => {
  const active = installs.find((i) => i.id === activeInstallId) || installs[0];
  useEffect(() => {
    if (!activeInstallId && installs[0]) setActiveInstallId(installs[0].id);
  }, [installs]); // eslint-disable-line

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, borderRight: `1px solid ${BORDER}`, background: '#fff', overflow: 'auto' }}>
        {installs.length === 0 && <div style={{ padding: 16, color: '#94A3B8', fontSize: 13 }}>Nothing installed yet.</div>}
        {installs.map((i) => {
          const cat = catalog.find((c) => c.app_id === i.app_id);
          return (
            <button
              key={i.id}
              onClick={() => setActiveInstallId(i.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 16px', border: 'none', background: i.id === active?.id ? '#F1F5F9' : '#fff',
                borderLeft: i.id === active?.id ? `2px solid ${PURPLE}` : '2px solid transparent',
                fontSize: 12, cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600 }}>{cat?.display_name || i.app_id}</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>v{i.version_pinned} · {i.enabled ? 'enabled' : 'disabled'}</div>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {active ? <InstallDetail install={active} scopes={scopes} onChange={onChange} /> : null}
      </div>
    </div>
  );
};

const InstallDetail: React.FC<{ install: AppInstallEntry; scopes: ScopeCatalogEntry[]; onChange: () => void }> = ({ install, scopes, onChange }) => {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pane, setPane] = useState<'app' | 'audit' | 'scopes'>('app');

  useEffect(() => {
    if (pane === 'audit') installAudit(install.id, { limit: 50 }).then(setAudit);
  }, [pane, install.id]);

  return (
    <>
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: '0 24px', height: 44, display: 'flex', alignItems: 'center', gap: 16 }}>
        {(['app', 'audit', 'scopes'] as const).map((p) => (
          <button key={p} onClick={() => setPane(p)} style={{
            background: 'none', border: 'none', fontSize: 11,
            color: pane === p ? PURPLE : '#475569', fontWeight: pane === p ? 600 : 500,
            textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', padding: '4px 0',
            borderBottom: pane === p ? `2px solid ${PURPLE}` : '2px solid transparent',
          }}>{p}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={async () => { await patchInstall(install.id, { enabled: !install.enabled }); onChange(); }}
            style={{ padding: '4px 10px', fontSize: 11, background: '#fff', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
            {install.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={async () => {
              if (!confirm('Uninstall? This also deletes the app\'s KV data + audit history.')) return;
              await uninstallApp(install.id);
              onChange();
            }}
            style={{ padding: '4px 10px', fontSize: 11, background: '#fff', border: `1px solid #FCA5A5`, color: '#B91C1C', cursor: 'pointer' }}>
            Uninstall
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {pane === 'app' && <ExternalApp installId={install.id} height="auto" />}
        {pane === 'audit' && <AuditPane entries={audit} />}
        {pane === 'scopes' && <ScopesPane install={install} scopes={scopes} onChange={onChange} />}
      </div>
    </>
  );
};

const AuditPane: React.FC<{ entries: AuditEntry[] }> = ({ entries }) => (
  <div style={{ padding: 16 }}>
    {entries.length === 0 && <div style={{ color: '#64748B', fontSize: 13 }}>No activity yet.</div>}
    {entries.length > 0 && (
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#F1F5F9', color: '#0D1117', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Event</th>
            <th style={{ padding: 8 }}>Method</th>
            <th style={{ padding: 8 }}>Scope</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Latency</th>
            <th style={{ padding: 8 }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ padding: 8 }}>{new Date(e.occurred_at).toLocaleString()}</td>
              <td style={{ padding: 8 }}>{e.event_type}</td>
              <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace' }}>{e.method || '—'}</td>
              <td style={{ padding: 8, fontFamily: 'ui-monospace,monospace' }}>{e.scope_used || '—'}</td>
              <td style={{ padding: 8 }}>
                <span style={{ padding: '2px 6px', background: e.status === 'ok' ? '#DCFCE7' : e.status === 'denied' ? '#FEF3C7' : '#FECACA', color: e.status === 'ok' ? '#15803D' : e.status === 'denied' ? '#92400E' : '#B91C1C', fontSize: 10, fontWeight: 600, borderRadius: 4 }}>{e.status}</span>
              </td>
              <td style={{ padding: 8 }}>{e.latency_ms != null ? `${e.latency_ms} ms` : '—'}</td>
              <td style={{ padding: 8, color: '#B91C1C' }}>{e.error_message || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const ScopesPane: React.FC<{ install: AppInstallEntry; scopes: ScopeCatalogEntry[]; onChange: () => void }> = ({ install, scopes, onChange }) => {
  const all = Array.from(new Set([...(install.scopes_granted || []), ...(install.scopes_denied || [])]));
  const [granted, setGranted] = useState<string[]>(install.scopes_granted);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {all.map((s) => (
        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
          <input type="checkbox" checked={granted.includes(s)} onChange={(e) => setGranted((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s))} />
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{s}</span>
        </label>
      ))}
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); await patchInstall(install.id, { scopes_granted: granted, scopes_denied: all.filter((s) => !granted.includes(s)) }); onChange(); setBusy(false); }}
        style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12, background: PURPLE, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
        Save scope grants
      </button>
    </div>
  );
};

const FunctionRunsView: React.FC<{ installs: AppInstallEntry[] }> = ({ installs }) => {
  const [fns, setFns] = useState<FunctionEntry[]>([]);
  const [runs, setRuns] = useState<Record<string, FunctionRun[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { listFunctions().then(setFns); }, []);

  return (
    <div style={{ padding: 16 }}>
      {fns.length === 0 && <div style={{ color: '#94A3B8', fontSize: 13 }}>No server-side functions registered.</div>}
      {fns.map((fn) => (
        <div key={fn.id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 4, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontFamily: 'ui-monospace,monospace', fontSize: 13 }}>{fn.function_name}</span>
            <span style={{ fontSize: 10, color: '#64748B' }}>{fn.trigger_type}</span>
            <span style={{ fontSize: 10, color: '#64748B' }}>{installs.find((i) => i.id === fn.install_id)?.app_id}</span>
            <button
              disabled={busy === fn.id}
              onClick={async () => { setBusy(fn.id); await runFunctionNow(fn.id); const r = await listFunctionRuns(fn.id, 10); setRuns((p) => ({ ...p, [fn.id]: r })); setBusy(null); }}
              style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 11, background: PURPLE, color: '#fff', border: 'none', cursor: 'pointer' }}>
              Run now
            </button>
            <button
              onClick={async () => { const r = await listFunctionRuns(fn.id, 10); setRuns((p) => ({ ...p, [fn.id]: r })); }}
              style={{ padding: '4px 8px', fontSize: 11, background: '#fff', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              Load runs
            </button>
          </div>
          {(runs[fn.id] || []).map((r) => (
            <div key={r.id} style={{ borderTop: `1px solid ${BORDER}`, marginTop: 8, paddingTop: 8, fontSize: 11 }}>
              <div>{r.started_at} · {r.trigger} · <b>{r.status}</b> · {r.duration_ms ?? '—'} ms</div>
              {r.error_message && <div style={{ color: '#B91C1C' }}>{r.error_message}</div>}
              {r.logs && <pre style={{ background: '#F8FAFC', padding: 6, borderRadius: 3, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{r.logs}</pre>}
              {r.output != null && <pre style={{ background: '#F8FAFC', padding: 6, borderRadius: 3, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(r.output, null, 2)}</pre>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
    <div style={{ background: '#fff', width: 540, maxHeight: '80vh', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ overflow: 'auto' }}>{children}</div>
    </div>
  </div>
);

export default ExternalAppsPage;
