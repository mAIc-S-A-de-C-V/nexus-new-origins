import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Eye, EyeOff, Globe, Key, RefreshCw, Activity, BarChart3, AlertTriangle } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const GW_API = import.meta.env.VITE_API_GATEWAY_URL || `${window.location.protocol}//${window.location.hostname}:8021`;
const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || `${window.location.protocol}//${window.location.hostname}:8004`;

type Scope = 'read:records' | 'read:events' | 'read:all';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: Scope[];
  enabled: boolean;
  rate_limit_per_min: number;
  ip_allowlist: string[];
  last_used_at: string | null;
  created_at: string;
}

interface ApiEndpoint {
  id: string;
  object_type_id: string;
  object_type_name: string;
  slug: string;
  resource_type: 'records' | 'events';
  enabled: boolean;
  created_at: string;
}

interface ObjectType {
  id: string;
  name: string;
  displayName: string;
}

interface UsageSummary {
  range: string;
  totals: { calls: number; errors: number; bytes_out: number; avg_ms: number; p95_ms: number };
  by_key: { key_id: string; key_prefix: string; name: string; calls: number; errors: number; last_call: string | null }[];
  by_endpoint: { endpoint_slug: string; resource_type: string; calls: number; errors: number; avg_ms: number; p95_ms: number }[];
  timeseries: { bucket: string; calls: number; errors: number }[];
}

interface KeyUsageDetail {
  key: ApiKey;
  range: string;
  totals: { calls: number; errors: number; bytes_out: number; avg_ms: number; p95_ms: number };
  by_endpoint: { endpoint_slug: string; calls: number; errors: number; avg_ms: number }[];
  recent_calls: { method: string; path: string; status_code: number; duration_ms: number; bytes_out: number; client_ip: string; error: string | null; ts: string }[];
}

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#2563EB', accentPurple: '#7C3AED',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#16A34A', successDim: '#DCFCE7',
  error: '#DC2626', errorDim: '#FEE2E2',
  warn: '#D97706', warnDim: '#FEF3C7',
};

const ApiGatewayPage: React.FC = () => {
  const [tab, setTab] = useState<'endpoints' | 'keys' | 'usage'>('endpoints');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [detailKey, setDetailKey] = useState<KeyUsageDetail | null>(null);
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<Scope[]>(['read:records']);
  const [newKeyRate, setNewKeyRate] = useState(60);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [newEpOtId, setNewEpOtId] = useState('');
  const [newEpSlug, setNewEpSlug] = useState('');
  const [newEpType, setNewEpType] = useState<'records' | 'events'>('records');

  const [loading, setLoading] = useState(false);

  const h = { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [keysRes, epRes, otRes] = await Promise.all([
        fetch(`${GW_API}/gateway/keys`, { headers: h }),
        fetch(`${GW_API}/gateway/manage`, { headers: h }),
        fetch(`${ONTOLOGY_API}/object-types`, { headers: h }),
      ]);
      if (keysRes.ok) setKeys(await keysRes.json());
      if (epRes.ok) setEndpoints(await epRes.json());
      if (otRes.ok) {
        const data = await otRes.json();
        setObjectTypes(Array.isArray(data) ? data : data.object_types || []);
      }
    } finally { setLoading(false); }
  };

  const loadUsage = async () => {
    const r = await fetch(`${GW_API}/gateway/usage/summary?range=${range}`, { headers: h });
    if (r.ok) setUsage(await r.json());
  };

  const loadKeyDetail = async (keyId: string) => {
    const r = await fetch(`${GW_API}/gateway/usage/keys/${keyId}?range=${range}`, { headers: h });
    if (r.ok) setDetailKey(await r.json());
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (tab === 'usage') loadUsage(); }, [tab, range]);

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    const res = await fetch(`${GW_API}/gateway/keys`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes, rate_limit_per_min: newKeyRate }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName('');
      setNewKeyScopes(['read:records']);
      setNewKeyRate(60);
      await loadAll();
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Delete this API key? Consumers using it will immediately lose access.')) return;
    await fetch(`${GW_API}/gateway/keys/${id}`, { method: 'DELETE', headers: h });
    await loadAll();
  };

  const toggleKey = async (id: string) => {
    await fetch(`${GW_API}/gateway/keys/${id}/toggle`, { method: 'PATCH', headers: h });
    await loadAll();
  };

  const createEndpoint = async () => {
    if (!newEpSlug.trim()) return;
    const ot = objectTypes.find(o => o.id === newEpOtId);
    const body: any = {
      object_type_id: newEpOtId || null,
      object_type_name: ot?.displayName || (newEpType === 'events' ? 'Event Log' : newEpSlug),
      slug: newEpSlug.trim().toLowerCase().replace(/\s+/g, '-'),
      resource_type: newEpType,
    };
    const res = await fetch(`${GW_API}/gateway/manage`, {
      method: 'POST', headers: h, body: JSON.stringify(body),
    });
    if (res.ok) { setNewEpOtId(''); setNewEpSlug(''); setNewEpType('records'); await loadAll(); }
  };

  const deleteEndpoint = async (id: string) => {
    await fetch(`${GW_API}/gateway/manage/${id}`, { method: 'DELETE', headers: h });
    await loadAll();
  };

  const baseUrl = `${GW_API}/gateway`;

  const TabBtn: React.FC<{ id: typeof tab; label: string; icon: React.ReactNode }> = ({ id, label, icon }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
        backgroundColor: 'transparent', fontWeight: tab === id ? 500 : 400,
        color: tab === id ? C.accent : C.muted,
        borderBottom: tab === id ? `2px solid ${C.accent}` : '2px solid transparent',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      {icon} {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>API Gateway</h1>
            <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0' }}>
              Expose data as REST APIs · Base URL: <code style={{ fontSize: 11, backgroundColor: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>{baseUrl}/v1/&#123;slug&#125;</code>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'usage' && (
              <select value={range} onChange={e => setRange(e.target.value as any)} style={{ height: 32, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, backgroundColor: '#fff' }}>
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            )}
            <button onClick={() => { loadAll(); if (tab === 'usage') loadUsage(); }} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 32, padding: '0 12px', border: `1px solid ${C.border}`, borderRadius: 5, backgroundColor: '#fff', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
          <TabBtn id="endpoints" label="Endpoints" icon={<Globe size={12} />} />
          <TabBtn id="keys" label="API Keys" icon={<Key size={12} />} />
          <TabBtn id="usage" label="Usage" icon={<BarChart3 size={12} />} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {createdKey && (
          <div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: C.successDim, border: '1px solid #86EFAC', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 6 }}>API Key Created — copy it now, it won't be shown again</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: 1, fontSize: 11, backgroundColor: '#fff', padding: '6px 10px', borderRadius: 4, border: '1px solid #86EFAC', wordBreak: 'break-all', color: C.text }}>{createdKey}</code>
              <button onClick={() => navigator.clipboard.writeText(createdKey)} style={{ padding: '5px 10px', border: '1px solid #86EFAC', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Copy size={11} /> Copy
              </button>
              <button onClick={() => setCreatedKey(null)} style={{ padding: '5px 10px', border: '1px solid #86EFAC', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: '#166534' }}>Dismiss</button>
            </div>
          </div>
        )}

        {tab === 'endpoints' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '14px 16px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Publish an Endpoint</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={newEpType} onChange={e => setNewEpType(e.target.value as any)} style={{ height: 32, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 }}>
                  <option value="records">Object Records</option>
                  <option value="events">Event Log</option>
                </select>
                {newEpType === 'records' && (
                  <select value={newEpOtId} onChange={e => { setNewEpOtId(e.target.value); const ot = objectTypes.find(o => o.id === e.target.value); if (ot) setNewEpSlug(ot.name.toLowerCase().replace(/\s+/g, '-')); }} style={{ height: 32, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, flex: 1, minWidth: 160 }}>
                    <option value="">Select object type...</option>
                    {objectTypes.map(ot => <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>)}
                  </select>
                )}
                {newEpType === 'events' && (
                  <select value={newEpOtId} onChange={e => setNewEpOtId(e.target.value)} style={{ height: 32, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, flex: 1, minWidth: 160 }}>
                    <option value="">All events (any object type)</option>
                    {objectTypes.map(ot => <option key={ot.id} value={ot.id}>Scope to: {ot.displayName || ot.name}</option>)}
                  </select>
                )}
                <input placeholder="URL slug" value={newEpSlug} onChange={e => setNewEpSlug(e.target.value)} style={{ height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, flex: 1, minWidth: 160, outline: 'none' }} />
                <button onClick={createEndpoint} disabled={!newEpSlug.trim() || (newEpType === 'records' && !newEpOtId)} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 4, backgroundColor: C.accent, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={12} /> Publish
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                Event endpoints accept <code>?since=</code>, <code>?until=</code>, <code>?activity=</code>, <code>?case_id=</code>. Record endpoints accept <code>?filter[field]=value</code>, <code>?cursor=</code>, <code>?format=csv</code>.
              </div>
            </div>

            {endpoints.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.dim, fontSize: 13, padding: 32 }}>No endpoints published yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {endpoints.map(ep => (
                  <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    {ep.resource_type === 'events' ? <Activity size={14} style={{ color: C.warn, flexShrink: 0 }} /> : <Globe size={14} style={{ color: C.accent, flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
                        {ep.object_type_name}
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, backgroundColor: ep.resource_type === 'events' ? C.warnDim : '#EFF6FF', color: ep.resource_type === 'events' ? C.warn : C.accent, marginLeft: 8 }}>
                          {ep.resource_type}
                        </span>
                      </div>
                      <code style={{ fontSize: 11, color: C.muted }}>{baseUrl}/v1/{ep.slug}</code>
                    </div>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, backgroundColor: ep.enabled ? C.successDim : '#F1F5F9', color: ep.enabled ? C.success : C.muted }}>
                      {ep.enabled ? 'Active' : 'Disabled'}
                    </span>
                    <button onClick={() => navigator.clipboard.writeText(`${baseUrl}/v1/${ep.slug}`)} style={{ padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Copy size={10} /> Copy
                    </button>
                    <button onClick={() => deleteEndpoint(ep.id)} style={{ padding: '4px 8px', border: `1px solid ${C.errorDim}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', color: C.error, display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
              OpenAPI spec: <code>{baseUrl}/v1/openapi.json</code>
            </div>
          </div>
        )}

        {tab === 'keys' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '14px 16px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Create API Key</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Key name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createKey()} style={{ flex: 1, minWidth: 160, height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, outline: 'none' }} />
                <select multiple value={newKeyScopes} onChange={e => setNewKeyScopes(Array.from(e.target.selectedOptions).map(o => o.value as Scope))} style={{ height: 52, padding: 4, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11, minWidth: 140 }}>
                  <option value="read:records">read:records</option>
                  <option value="read:events">read:events</option>
                  <option value="read:all">read:all</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={newKeyRate} onChange={e => setNewKeyRate(parseInt(e.target.value) || 60)} min={0} style={{ width: 80, height: 32, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, outline: 'none' }} />
                  <span style={{ fontSize: 11, color: C.muted }}>req/min</span>
                </div>
                <button onClick={createKey} disabled={!newKeyName.trim()} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 4, backgroundColor: C.accent, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={12} /> Create
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                Hold Cmd/Ctrl to pick multiple scopes. Rate limit of 0 = unlimited.
              </div>
            </div>

            {keys.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.dim, fontSize: 13, padding: 32 }}>No API keys yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {keys.map(k => (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <Key size={14} style={{ color: C.accentPurple, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{k.name}</div>
                      <div style={{ fontSize: 11, color: C.muted, display: 'flex', gap: 10 }}>
                        <code>{k.key_prefix}••••••••••••••••••</code>
                        <span>· {k.rate_limit_per_min > 0 ? `${k.rate_limit_per_min}/min` : 'unlimited'}</span>
                        {k.last_used_at && <span>· last used {new Date(k.last_used_at).toLocaleString()}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {k.scopes.map(s => <span key={s} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, backgroundColor: '#EFF6FF', color: C.accent }}>{s}</span>)}
                    </div>
                    <button onClick={() => { setTab('usage'); loadKeyDetail(k.id); }} style={{ padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <BarChart3 size={11} /> Usage
                    </button>
                    <button onClick={() => toggleKey(k.id)} style={{ padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: k.enabled ? C.successDim : '#F1F5F9', cursor: 'pointer', fontSize: 11, color: k.enabled ? C.success : C.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                      {k.enabled ? <Eye size={10} /> : <EyeOff size={10} />} {k.enabled ? 'Active' : 'Disabled'}
                    </button>
                    <button onClick={() => deleteKey(k.id)} style={{ padding: '4px 8px', border: `1px solid ${C.errorDim}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', color: C.error, display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'usage' && (
          <UsageView
            usage={usage} detailKey={detailKey} onClearDetail={() => setDetailKey(null)}
            onKeyClick={(id) => loadKeyDetail(id)}
          />
        )}
      </div>
    </div>
  );
};

const UsageView: React.FC<{
  usage: UsageSummary | null;
  detailKey: KeyUsageDetail | null;
  onClearDetail: () => void;
  onKeyClick: (id: string) => void;
}> = ({ usage, detailKey, onClearDetail, onKeyClick }) => {
  const sparkMax = useMemo(() => Math.max(1, ...(usage?.timeseries.map(t => t.calls) || [1])), [usage]);

  if (detailKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button onClick={onClearDetail} style={{ alignSelf: 'flex-start', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: C.muted }}>
          ← Back to summary
        </button>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{detailKey.key.name}</div>
        <StatsGrid totals={detailKey.totals} />
        <SectionTitle>By endpoint</SectionTitle>
        <Table
          headers={['Endpoint', 'Calls', 'Errors', 'Avg ms']}
          rows={detailKey.by_endpoint.map(e => [e.endpoint_slug || '—', e.calls, e.errors, e.avg_ms])}
        />
        <SectionTitle>Recent calls</SectionTitle>
        <Table
          headers={['Time', 'Method', 'Path', 'Status', 'Dur ms', 'Bytes', 'IP']}
          rows={detailKey.recent_calls.map(r => [
            new Date(r.ts).toLocaleString(), r.method, r.path,
            <span key={r.ts + r.path} style={{ color: r.status_code >= 400 ? C.error : C.success }}>{r.status_code}</span>,
            r.duration_ms, r.bytes_out, r.client_ip || '—',
          ])}
        />
      </div>
    );
  }

  if (!usage) {
    return <div style={{ textAlign: 'center', color: C.dim, fontSize: 13, padding: 40 }}>Loading usage…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatsGrid totals={usage.totals} />

      <SectionTitle>Calls over time</SectionTitle>
      <div style={{ padding: 16, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, height: 120, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        {usage.timeseries.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 12, margin: 'auto' }}>No data in this range</div>
        ) : usage.timeseries.map(t => {
          const h = Math.max(2, Math.round((t.calls / sparkMax) * 90));
          const eh = Math.round((t.errors / sparkMax) * 90);
          return (
            <div key={t.bucket} title={`${new Date(t.bucket).toLocaleString()} · ${t.calls} calls · ${t.errors} errors`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 2 }}>
              {eh > 0 && <div style={{ height: eh, backgroundColor: C.error, opacity: 0.8 }} />}
              <div style={{ height: h - eh, backgroundColor: C.accent }} />
            </div>
          );
        })}
      </div>

      <SectionTitle>By key</SectionTitle>
      <div style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              {['Key', 'Prefix', 'Calls', 'Errors', 'Last call', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {usage.by_key.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: C.dim }}>No calls yet</td></tr>
            ) : usage.by_key.map(k => (
              <tr key={k.key_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px', color: C.text }}>{k.name}</td>
                <td style={{ padding: '8px 12px', color: C.muted, fontFamily: 'monospace' }}>{k.key_prefix}</td>
                <td style={{ padding: '8px 12px', color: C.text }}>{k.calls}</td>
                <td style={{ padding: '8px 12px', color: k.errors > 0 ? C.error : C.muted }}>
                  {k.errors > 0 && <AlertTriangle size={10} style={{ display: 'inline', marginRight: 4 }} />}
                  {k.errors}
                </td>
                <td style={{ padding: '8px 12px', color: C.muted }}>{k.last_call ? new Date(k.last_call).toLocaleString() : '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  {k.key_id !== '-' && (
                    <button onClick={() => onKeyClick(k.key_id)} style={{ padding: '2px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: C.muted }}>Detail</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>By endpoint</SectionTitle>
      <Table
        headers={['Endpoint', 'Type', 'Calls', 'Errors', 'Avg ms', 'P95 ms']}
        rows={usage.by_endpoint.map(e => [
          e.endpoint_slug || '—',
          <span key={e.endpoint_slug} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: e.resource_type === 'events' ? C.warnDim : '#EFF6FF', color: e.resource_type === 'events' ? C.warn : C.accent }}>{e.resource_type}</span>,
          e.calls, e.errors, e.avg_ms, e.p95_ms,
        ])}
      />
    </div>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{children}</div>
);

const StatsGrid: React.FC<{ totals: { calls: number; errors: number; bytes_out: number; avg_ms: number; p95_ms: number } }> = ({ totals }) => {
  const items = [
    { label: 'Calls', value: totals.calls?.toLocaleString() || 0, color: C.accent },
    { label: 'Errors', value: totals.errors?.toLocaleString() || 0, color: (totals.errors || 0) > 0 ? C.error : C.muted },
    { label: 'Avg latency', value: `${totals.avg_ms || 0}ms` },
    { label: 'P95 latency', value: `${totals.p95_ms || 0}ms` },
    { label: 'Bytes out', value: formatBytes(totals.bytes_out || 0) },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
      {items.map(i => (
        <div key={i.label} style={{ padding: '12px 14px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{i.label}</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: i.color || C.text }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
};

const Table: React.FC<{ headers: string[]; rows: (string | number | React.ReactNode)[][] }> = ({ headers, rows }) => (
  <div style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ backgroundColor: C.bg }}>
          {headers.map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={headers.length} style={{ textAlign: 'center', padding: 20, color: C.dim }}>No data</td></tr>
        ) : rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
            {r.map((c, j) => <td key={j} style={{ padding: '8px 12px', color: C.text }}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default ApiGatewayPage;
