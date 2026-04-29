import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2, Activity, BarChart3, Users, RefreshCw,
  Shield, Globe, Trash2, Plus, UserPlus, X,
} from 'lucide-react';
import { getAccessToken } from '../../store/authStore';
import { usePermission } from '../../hooks/usePermission';
import PlatformHealthPage from '../health/PlatformHealthPage';

const ADMIN_API = import.meta.env.VITE_ADMIN_SERVICE_URL || 'http://localhost:8022';
const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';

type Tab = 'tenants' | 'tokens' | 'health' | 'impersonate';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  bucket_tier?: 'S' | 'M' | 'L' | 'XL' | 'XXL';
  allowed_modules: string[];
  created_at: string;
  updated_at: string;
}

const BUCKET_TIERS: ('S' | 'M' | 'L' | 'XL' | 'XXL')[] = ['S', 'M', 'L', 'XL', 'XXL'];
const BUCKET_LABELS: Record<string, string> = { S: 'Pilot', M: 'Growth', L: 'Scale', XL: 'Production', XXL: 'Enterprise' };
const BUCKET_MONTHLY: Record<string, number> = { S: 2_667, M: 5_333, L: 10_583, XL: 26_500, XXL: 291_083 };

interface TenantUsage {
  object_types: number;
  records: number;
  pipelines: number;
  pipeline_runs: number;
  connectors: number;
  agents: number;
  logic_functions: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface TokenSummary {
  by_tenant: { tenant_id: string; input_tokens: number; output_tokens: number; calls: number }[];
  by_service: { service: string; input_tokens: number; output_tokens: number; calls: number }[];
  by_model: { model: string; input_tokens: number; output_tokens: number; calls: number }[];
  daily: { day: string; input_tokens: number; output_tokens: number; calls: number }[];
}

interface TenantUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  is_active: boolean;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  page: { display: 'flex', flexDirection: 'column' as const, height: '100%', backgroundColor: '#F8FAFC' },
  header: {
    height: 52, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
    display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16,
  },
  title: { fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 },
  badge: {
    fontSize: 10, backgroundColor: '#7C3AED', color: '#fff',
    padding: '2px 8px', borderRadius: 4, fontWeight: 600, letterSpacing: '0.06em',
  },
  tabs: {
    display: 'flex', gap: 0, borderBottom: '1px solid #E2E8F0',
    backgroundColor: '#fff', padding: '0 24px',
  },
  tab: (active: boolean) => ({
    padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
    color: active ? '#7C3AED' : '#64748B', borderBottom: active ? '2px solid #7C3AED' : '2px solid transparent',
    display: 'flex', alignItems: 'center', gap: 6,
    transition: 'color 0.15s, border-color 0.15s',
  }),
  content: { flex: 1, overflow: 'auto', padding: 24 },
  card: {
    backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
    padding: 20, marginBottom: 16,
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: {
    textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid #E2E8F0',
    color: '#64748B', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', color: '#334155' },
  metric: {
    display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '12px 16px',
    backgroundColor: '#F8FAFC', borderRadius: 6, minWidth: 140,
  },
  metricLabel: { fontSize: 11, color: '#64748B', fontWeight: 500 },
  metricValue: { fontSize: 20, fontWeight: 700, color: '#0D1117' },
  btn: (variant: 'primary' | 'danger' | 'ghost' = 'primary') => ({
    padding: '6px 12px', fontSize: 12, fontWeight: 500, borderRadius: 6,
    border: variant === 'ghost' ? '1px solid #E2E8F0' : 'none',
    backgroundColor: variant === 'primary' ? '#7C3AED' : variant === 'danger' ? '#DC2626' : '#fff',
    color: variant === 'ghost' ? '#334155' : '#fff',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
  }),
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ── Bucket Picker (superadmin-only inline editor) ─────────────────────────────

const BucketPicker: React.FC<{
  tenantId: string;
  current: 'S' | 'M' | 'L' | 'XL' | 'XXL';
  onChanged: (tier: 'S' | 'M' | 'L' | 'XL' | 'XXL') => void;
}> = ({ tenantId, current, onChanged }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTier = e.target.value as 'S' | 'M' | 'L' | 'XL' | 'XXL';
    if (newTier === current) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${ADMIN_API}/admin/tenants/${tenantId}/bucket`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ bucket_tier: newTier }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      onChanged(newTier);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select
        value={current}
        onChange={handleChange}
        disabled={saving}
        style={{
          fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
          border: `1px solid ${error ? '#FCA5A5' : '#E2E8F0'}`,
          backgroundColor: '#FFF', color: '#7C3AED',
          fontFamily: 'monospace', cursor: saving ? 'wait' : 'pointer',
        }}
      >
        {BUCKET_TIERS.map(t => (
          <option key={t} value={t}>
            {t} · {BUCKET_LABELS[t]} (${BUCKET_MONTHLY[t].toLocaleString()}/mo)
          </option>
        ))}
      </select>
      {saving && <RefreshCw size={11} style={{ animation: 'spin 0.6s linear infinite', color: '#94A3B8' }} />}
      {error && <span title={error} style={{ fontSize: 10, color: '#DC2626' }}>!</span>}
    </div>
  );
};

// ── Tenants Tab ───────────────────────────────────────────────────────────────

const inputStyle = {
  padding: '8px 12px', fontSize: 12, borderRadius: 6,
  border: '1px solid #E2E8F0', width: '100%', boxSizing: 'border-box' as const,
};

const TenantsTab: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [usage, setUsage] = useState<Record<string, TenantUsage>>({});
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'free' });
  const [creating, setCreating] = useState(false);

  const loadUsage = useCallback(async (tid: string) => {
    const res = await fetch(`${ADMIN_API}/admin/tenants/${tid}/usage`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      setUsage(prev => ({ ...prev, [tid]: data }));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${ADMIN_API}/admin/tenants`, { headers: authHeaders() });
      if (!res.ok) return;
      const data: Tenant[] = await res.json();
      setTenants(data);
      // Fan out usage fetches for every tenant in parallel — N is small.
      data.forEach(t => loadUsage(t.id));
    } finally { setLoading(false); }
  }, [loadUsage]);

  useEffect(() => { load(); }, [load]);

  const createTenant = async () => {
    if (!form.name || !form.slug) return;
    setCreating(true);
    try {
      const res = await fetch(`${ADMIN_API}/admin/tenants`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed: ${err.detail || 'Unknown error'}`);
        return;
      }
      setShowCreate(false);
      setForm({ name: '', slug: '', plan: 'free' });
      load();
    } finally { setCreating(false); }
  };

  const statusColor = (s: string) =>
    s === 'active' ? '#16A34A' : s === 'suspended' ? '#DC2626' : '#D97706';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>
          {tenants.length} Tenant{tenants.length !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn('primary')} onClick={() => setShowCreate(v => !v)}>
            <Plus size={12} /> New Tenant
          </button>
          <button style={S.btn('ghost')} onClick={load} disabled={loading}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {showCreate && (
        <div style={{ ...S.card, borderColor: '#7C3AED', borderWidth: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Create Tenant</div>
            <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Name</label>
              <input style={inputStyle} placeholder="Acme Corp" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Slug</label>
              <input style={inputStyle} placeholder="acme-corp" value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Plan</label>
              <select style={inputStyle} value={form.plan}
                onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <button style={S.btn('primary')} onClick={createTenant} disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>ID</th>
            <th style={S.th}>Name</th>
            <th style={S.th}>Plan</th>
            <th style={S.th}>Bucket</th>
            <th style={S.th}>Status</th>
            <th style={{ ...S.th, textAlign: 'right' as const }}>Records</th>
            <th style={{ ...S.th, textAlign: 'right' as const }}>Agents</th>
            <th style={{ ...S.th, textAlign: 'right' as const }}>Pipelines</th>
            <th style={{ ...S.th, textAlign: 'right' as const }}>Tokens (in/out)</th>
            <th style={S.th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => {
            const u = usage[t.id];
            const loaded = !!u;
            return (
              <React.Fragment key={t.id}>
                <tr>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{t.id}</td>
                  <td style={{ ...S.td, fontWeight: 500 }}>{t.name}</td>
                  <td style={S.td}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      backgroundColor: t.plan === 'enterprise' ? '#F5F3FF' : '#F1F5F9',
                      color: t.plan === 'enterprise' ? '#7C3AED' : '#64748B',
                    }}>{t.plan.toUpperCase()}</span>
                  </td>
                  <td style={S.td}>
                    <BucketPicker
                      tenantId={t.id}
                      current={t.bucket_tier || 'S'}
                      onChanged={(newTier) => setTenants(prev => prev.map(x => x.id === t.id ? { ...x, bucket_tier: newTier } : x))}
                    />
                  </td>
                  <td style={S.td}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      color: statusColor(t.status), backgroundColor: `${statusColor(t.status)}15`,
                    }}>{t.status.toUpperCase()}</span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 12 }}>
                    {loaded ? fmtNum(u.records) : <span style={{ color: '#CBD5E1' }}>…</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 12 }}>
                    {loaded ? fmtNum(u.agents) : <span style={{ color: '#CBD5E1' }}>…</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 12 }}>
                    {loaded ? fmtNum(u.pipelines) : <span style={{ color: '#CBD5E1' }}>…</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>
                    {loaded ? (
                      <span title={`${fmtNum(u.total_input_tokens)} input · ${fmtNum(u.total_output_tokens)} output`}>
                        {fmtTokens(u.total_input_tokens)} <span style={{ color: '#94A3B8' }}>/</span> {fmtTokens(u.total_output_tokens)}
                      </span>
                    ) : <span style={{ color: '#CBD5E1' }}>…</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94A3B8' }}>
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
                {loaded && (u.object_types > 0 || u.connectors > 0) && (
                  <tr>
                    <td colSpan={10} style={{ padding: '4px 16px 10px 16px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#64748B' }}>
                        <span><strong style={{ color: '#0D1117' }}>{fmtNum(u.object_types)}</strong> object types</span>
                        <span>·</span>
                        <span><strong style={{ color: '#0D1117' }}>{fmtNum(u.connectors)}</strong> connectors</span>
                        <span>·</span>
                        <span><strong style={{ color: '#0D1117' }}>{fmtNum(u.pipeline_runs)}</strong> pipeline runs</span>
                        <span>·</span>
                        <span><strong style={{ color: '#0D1117' }}>{fmtNum(u.logic_functions)}</strong> logic fns</span>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── Token Usage Tab ───────────────────────────────────────────────────────────

interface PlatformUsage {
  range_days: number;
  llm: { input_tokens: number; output_tokens: number; calls: number };
  gateway: { calls: number; errors: number; bytes_out: number; avg_ms: number; p95_ms: number; active_keys: number; keys_used_in_window: number; keys_total: number };
  pipelines: { runs: number; errors: number; rows_in: number; rows_out: number; avg_ms: number; p95_ms: number; currently_running: number };
  records: { total: number; bytes: number };
  agents: { runs: number; errors: number; iterations: number; chars_out: number };
  logic: { runs: number; errors: number; avg_ms: number; p95_ms: number };
  correlation_scans: number;
  logins: number;
  events: number;
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const TokenUsageTab: React.FC = () => {
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [platform, setPlatform] = useState<PlatformUsage | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenRes, platformRes] = await Promise.all([
        fetch(`${ADMIN_API}/admin/token-usage/summary?days=${days}`, { headers: authHeaders() }),
        fetch(`${ADMIN_API}/admin/platform-usage/summary?days=${days}`, { headers: authHeaders() }),
      ]);
      if (tokenRes.ok) setSummary(await tokenRes.json());
      if (platformRes.ok) setPlatform(await platformRes.json());
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (!summary) return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Loading token usage...</div>;

  const totalInput = summary.by_tenant.reduce((s, t) => s + t.input_tokens, 0);
  const totalOutput = summary.by_tenant.reduce((s, t) => s + t.output_tokens, 0);
  const totalCalls = summary.by_tenant.reduce((s, t) => s + t.calls, 0);

  const tiles: { label: string; value: string; sub?: string; tone?: 'error' | 'warn' | undefined }[] = [
    { label: 'Input Tokens', value: fmtTokens(totalInput) },
    { label: 'Output Tokens', value: fmtTokens(totalOutput) },
    { label: 'LLM Calls', value: fmtNum(totalCalls) },
    { label: 'Gateway Pulls', value: fmtNum(platform?.gateway.calls || 0), sub: platform ? `${platform.gateway.errors} errors · p95 ${platform.gateway.p95_ms}ms` : undefined },
    { label: 'Pipeline Runs', value: fmtNum(platform?.pipelines.runs || 0), sub: platform ? `${platform.pipelines.errors} failed · ${platform.pipelines.currently_running} running` : undefined },
    { label: 'Records Ingested', value: fmtNum(platform?.pipelines.rows_out || 0) },
    { label: 'Events Logged', value: fmtNum(platform?.events || 0) },
    { label: 'Records Stored', value: fmtNum(platform?.records.total || 0), sub: platform ? fmtBytes(platform.records.bytes) : undefined },
    { label: 'Agent Runs', value: fmtNum(platform?.agents.runs || 0), sub: platform ? `${platform.agents.iterations} iterations · ${platform.agents.errors} errors` : undefined },
    { label: 'Logic Runs', value: fmtNum(platform?.logic.runs || 0), sub: platform ? `p95 ${platform.logic.p95_ms}ms · ${platform.logic.errors} errors` : undefined },
    { label: 'Correlation Scans', value: fmtNum(platform?.correlation_scans || 0) },
    { label: 'Logins', value: fmtNum(platform?.logins || 0) },
    { label: 'Active API Keys', value: `${platform?.gateway.keys_used_in_window || 0} / ${platform?.gateway.keys_total || 0}`, sub: 'used this window / total' },
    { label: 'Gateway Bytes Out', value: fmtBytes(platform?.gateway.bytes_out || 0) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#64748B' }}>Platform-wide activity over the last {days} day{days === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #E2E8F0' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button style={S.btn('ghost')} onClick={load} disabled={loading}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 20 }}>
        {tiles.map(t => (
          <div key={t.label} style={{ padding: '12px 14px', backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#0D1117', marginTop: 4 }}>{t.value}</div>
            {t.sub && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* By Tenant */}
      <div style={S.card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>By Tenant</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Tenant</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Input Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Output Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {summary.by_tenant.map(r => (
              <tr key={r.tenant_id}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{r.tenant_id}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.input_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.output_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By Service */}
      <div style={S.card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>By Service</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Service</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Input Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Output Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {summary.by_service.map(r => (
              <tr key={r.service}>
                <td style={S.td}>{r.service}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.input_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.output_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By Model */}
      <div style={S.card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>By Model</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Model</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Input Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Output Tokens</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {summary.by_model.map(r => (
              <tr key={r.model}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{r.model}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.input_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.output_tokens)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtNum(r.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily */}
      {summary.daily.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Daily Usage (last {days} days)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
            {summary.daily.map(d => {
              const total = d.input_tokens + d.output_tokens;
              const maxTotal = Math.max(...summary.daily.map(x => x.input_tokens + x.output_tokens), 1);
              const h = Math.max((total / maxTotal) * 100, 2);
              return (
                <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{
                    width: '100%', height: h, backgroundColor: '#7C3AED', borderRadius: '2px 2px 0 0',
                    minWidth: 4, opacity: 0.8,
                  }} title={`${d.day}: ${fmtNum(total)} tokens, ${d.calls} calls`} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: '#94A3B8' }}>{summary.daily[0]?.day}</span>
            <span style={{ fontSize: 10, color: '#94A3B8' }}>{summary.daily[summary.daily.length - 1]?.day}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Impersonate Tab ───────────────────────────────────────────────────────────

const ImpersonateTab: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ email: '', name: '', role: 'viewer', password: '' });
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    fetch(`${ADMIN_API}/admin/tenants`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setTenants);
  }, []);

  const loadUsers = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${AUTH_API}/auth/users`, {
        headers: { ...authHeaders(), 'x-tenant-id': tid },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedTenant) loadUsers(selectedTenant);
    else setUsers([]);
  }, [selectedTenant, loadUsers]);

  const impersonate = async (userId: string, tenantId: string) => {
    try {
      const res = await fetch(`${AUTH_API}/auth/impersonate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ target_user_id: userId, target_tenant_id: tenantId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Impersonation failed: ${err.detail || 'Unknown error'}`);
        return;
      }
      const data = await res.json();
      const originalToken = getAccessToken();
      if (originalToken) sessionStorage.setItem('_nexus_original_token', originalToken);
      sessionStorage.setItem('_nexus_impersonation_token', data.access_token);
      window.location.reload();
    } catch (e) {
      alert(`Impersonation error: ${e}`);
    }
  };

  const createUser = async () => {
    if (!userForm.email || !userForm.name || !userForm.password || !selectedTenant) return;
    setCreatingUser(true);
    try {
      const res = await fetch(`${AUTH_API}/auth/users`, {
        method: 'POST', headers: { ...authHeaders(), 'x-tenant-id': selectedTenant },
        body: JSON.stringify({
          email: userForm.email,
          name: userForm.name,
          role: userForm.role,
          password: userForm.password,
          tenant_id: selectedTenant,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed: ${err.detail || 'Unknown error'}`);
        return;
      }
      setShowCreateUser(false);
      setUserForm({ email: '', name: '', role: 'viewer', password: '' });
      loadUsers(selectedTenant);
    } finally { setCreatingUser(false); }
  };

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Account Impersonation & User Management</div>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
          Select a tenant to view users, create new users, or impersonate. All actions are audited.
        </p>
        <select
          value={selectedTenant}
          onChange={e => setSelectedTenant(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #E2E8F0', minWidth: 300 }}
        >
          <option value="">Select a tenant...</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
          ))}
        </select>
      </div>

      {selectedTenant && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>
            Users in {selectedTenant}
          </div>
          <button style={S.btn('primary')} onClick={() => setShowCreateUser(v => !v)}>
            <UserPlus size={12} /> New User
          </button>
        </div>
      )}

      {showCreateUser && selectedTenant && (
        <div style={{ ...S.card, borderColor: '#7C3AED', borderWidth: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Create User in {selectedTenant}</div>
            <button onClick={() => setShowCreateUser(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Email</label>
              <input style={inputStyle} placeholder="user@example.com" value={userForm.email}
                onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Name</label>
              <input style={inputStyle} placeholder="Full Name" value={userForm.name}
                onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Role</label>
              <select style={inputStyle} value={userForm.role}
                onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                <option value="viewer">Viewer</option>
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Password</label>
              <input style={inputStyle} type="password" placeholder="Min 12 chars" value={userForm.password}
                onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <button style={S.btn('primary')} onClick={createUser} disabled={creatingUser}>
              {creatingUser ? 'Creating...' : 'Create'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 8 }}>
            Password: min 12 chars, uppercase, lowercase, digit, special char
          </div>
        </div>
      )}

      {selectedTenant && !loading && (
        <div style={S.card}>
          {users.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
              No users in this tenant yet. Click "New User" above to create one.
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Email</th>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Active</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{u.email}</td>
                    <td style={S.td}>{u.name}</td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: u.role === 'admin' ? '#F5F3FF' : '#F1F5F9',
                        color: u.role === 'admin' ? '#7C3AED' : '#64748B',
                      }}>{u.role.toUpperCase()}</span>
                    </td>
                    <td style={S.td}>{u.is_active !== false ? 'Yes' : 'No'}</td>
                    <td style={S.td}>
                      <button
                        style={{ ...S.btn('primary'), fontSize: 11, padding: '4px 10px' }}
                        onClick={() => impersonate(u.id, selectedTenant)}
                      >
                        Impersonate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {loading && <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8' }}>Loading users...</div>}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const SuperAdminPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('tenants');
  const { isSuperAdmin } = usePermission();

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#DC2626' }}>
        <Shield size={20} /> <span style={{ marginLeft: 8 }}>Superadmin access required</span>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <Globe size={18} color="#7C3AED" />
        <h1 style={S.title}>Platform Management</h1>
        <span style={S.badge}>SUPERADMIN</span>
      </div>

      <div style={S.tabs}>
        <div style={S.tab(tab === 'tenants')} onClick={() => setTab('tenants')}>
          <Building2 size={14} /> Tenants
        </div>
        <div style={S.tab(tab === 'tokens')} onClick={() => setTab('tokens')}>
          <BarChart3 size={14} /> Token Usage
        </div>
        <div style={S.tab(tab === 'health')} onClick={() => setTab('health')}>
          <Activity size={14} /> Health
        </div>
        <div style={S.tab(tab === 'impersonate')} onClick={() => setTab('impersonate')}>
          <Users size={14} /> Impersonate
        </div>
      </div>

      <div style={S.content}>
        {tab === 'tenants' && <TenantsTab />}
        {tab === 'tokens' && <TokenUsageTab />}
        {tab === 'health' && <PlatformHealthPage />}
        {tab === 'impersonate' && <ImpersonateTab />}
      </div>
    </div>
  );
};

export default SuperAdminPage;
