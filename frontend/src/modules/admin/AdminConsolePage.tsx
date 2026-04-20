import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Shield, Users, Database, Activity, Trash2, Building2 } from 'lucide-react';
import { usePermission } from '../../hooks/usePermission';
import { getAccessToken } from '../../store/authStore';

const ADMIN_API = import.meta.env.VITE_ADMIN_SERVICE_URL || 'http://localhost:8022';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'trial';
  allowed_modules: string[];
  created_at: string;
  updated_at: string;
}

interface TenantUsage {
  object_types: number;
  records: number;
  pipelines: number;
  pipeline_runs: number;
  connectors: number;
  agents: number;
  logic_functions: number;
  comments: number;
  api_keys: number;
}

const PLAN_META = {
  free:       { color: '#64748B', bg: '#F1F5F9' },
  pro:        { color: '#2563EB', bg: '#EFF6FF' },
  enterprise: { color: '#7C3AED', bg: '#F5F3FF' },
};

const STATUS_META = {
  active:    { color: '#16A34A', bg: '#DCFCE7' },
  suspended: { color: '#DC2626', bg: '#FEE2E2' },
  trial:     { color: '#D97706', bg: '#FEF3C7' },
};

const AdminConsolePage: React.FC = () => {
  const { isAdmin } = usePermission();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'free' });
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) h['Authorization'] = `Bearer ${token}`;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${ADMIN_API}/admin/tenants`, { headers: h });
      if (res.ok) setTenants(await res.json());
    } finally { setLoading(false); }
  };

  const loadUsage = async (tid: string) => {
    setUsageLoading(true);
    setUsage(null);
    try {
      const res = await fetch(`${ADMIN_API}/admin/tenants/${tid}/usage`, { headers: h });
      if (res.ok) setUsage(await res.json());
    } finally { setUsageLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selectedId) {
      const t = tenants.find(t => t.id === selectedId);
      if (t) { setEditPlan(t.plan); setEditStatus(t.status); }
      loadUsage(selectedId);
    }
  }, [selectedId]);

  const createTenant = async () => {
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${ADMIN_API}/admin/tenants`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ name: form.name, slug: form.slug, plan: form.plan }),
      });
      if (res.ok) { setForm({ name: '', slug: '', plan: 'free' }); setShowCreate(false); await load(); }
    } finally { setSaving(false); }
  };

  const updateTenant = async (tid: string) => {
    setSaving(true);
    try {
      await fetch(`${ADMIN_API}/admin/tenants/${tid}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({ plan: editPlan, status: editStatus }),
      });
      await load();
    } finally { setSaving(false); }
  };

  const deleteTenant = async (tid: string) => {
    if (!window.confirm('Delete this tenant? This cannot be undone.')) return;
    await fetch(`${ADMIN_API}/admin/tenants/${tid}`, { method: 'DELETE', headers: h });
    if (selectedId === tid) setSelectedId(null);
    await load();
  };

  const selected = tenants.find(t => t.id === selectedId);

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8, color: '#94A3B8' }}>
        <Shield size={32} />
        <p style={{ fontSize: 14 }}>Admin access required</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#F8FAFC', overflow: 'hidden' }}>
      {/* Left panel — tenant list */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>Tenants</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>{tenants.length} total</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, display: 'flex' }}>
              <RefreshCw size={13} />
            </button>
            <button onClick={() => setShowCreate(!showCreate)} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', border: 'none', borderRadius: 4, backgroundColor: '#2563EB', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
              <Plus size={11} /> New
            </button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div style={{ padding: '12px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input placeholder="Tenant name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))} style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }} />
            <input placeholder="Slug (e.g. acme-corp)" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
            <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12 }}>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={createTenant} disabled={saving || !form.name.trim()} style={{ flex: 1, height: 28, border: 'none', borderRadius: 4, backgroundColor: '#2563EB', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                {saving ? 'Creating...' : 'Create Tenant'}
              </button>
              <button onClick={() => setShowCreate(false)} style={{ height: 28, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4, backgroundColor: '#fff', fontSize: 11, cursor: 'pointer', color: '#64748B' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Tenant list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tenants.map(tenant => {
            const planMeta = PLAN_META[tenant.plan] || PLAN_META.free;
            const statusMeta = STATUS_META[tenant.status] || STATUS_META.active;
            return (
              <div
                key={tenant.id}
                onClick={() => setSelectedId(tenant.id)}
                style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', backgroundColor: selectedId === tenant.id ? '#EFF6FF' : 'transparent', transition: 'background-color 80ms' }}
                onMouseEnter={e => { if (selectedId !== tenant.id) (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'; }}
                onMouseLeave={e => { if (selectedId !== tenant.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{tenant.name}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, backgroundColor: statusMeta.bg, color: statusMeta.color, fontWeight: 500 }}>{tenant.status}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 10, color: '#64748B' }}>{tenant.slug}</code>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: planMeta.bg, color: planMeta.color }}>{tenant.plan}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {!selected && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#94A3B8' }}>
            <Building2 size={32} />
            <p style={{ fontSize: 13 }}>Select a tenant to view details</p>
          </div>
        )}

        {selected && (
          <>
            {/* Header */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0D1117' }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                  ID: <code style={{ fontSize: 11 }}>{selected.id}</code> · Created {new Date(selected.created_at).toLocaleDateString()}
                </div>
              </div>
              {selected.id !== 'tenant-001' && (
                <button onClick={() => deleteTenant(selected.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #FEE2E2', borderRadius: 5, backgroundColor: '#fff', cursor: 'pointer', fontSize: 12, color: '#DC2626' }}>
                  <Trash2 size={11} /> Delete
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Usage stats */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Usage</div>
                {usageLoading ? (
                  <div style={{ color: '#94A3B8', fontSize: 12 }}>Loading usage...</div>
                ) : usage ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    {[
                      { label: 'Object Types', value: usage.object_types, icon: <Database size={14} /> },
                      { label: 'Records', value: usage.records, icon: <Database size={14} /> },
                      { label: 'Pipelines', value: usage.pipelines, icon: <Activity size={14} /> },
                      { label: 'Pipeline Runs', value: usage.pipeline_runs, icon: <Activity size={14} /> },
                      { label: 'Connectors', value: usage.connectors, icon: <Activity size={14} /> },
                      { label: 'Agents', value: usage.agents, icon: <Users size={14} /> },
                      { label: 'Logic Functions', value: usage.logic_functions, icon: <Activity size={14} /> },
                      { label: 'Comments', value: usage.comments, icon: <Users size={14} /> },
                      { label: 'API Keys', value: usage.api_keys, icon: <Shield size={14} /> },
                    ].map(stat => (
                      <div key={stat.label} style={{ padding: '10px 12px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>{stat.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#0D1117' }}>{stat.value.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Edit plan/status */}
              <div style={{ padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Settings</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Plan</label>
                    <select value={editPlan} onChange={e => setEditPlan(e.target.value)} style={{ height: 32, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, minWidth: 120 }}>
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)} style={{ height: 32, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, minWidth: 120 }}>
                      <option value="active">Active</option>
                      <option value="trial">Trial</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <button onClick={() => updateTenant(selected.id)} disabled={saving} style={{ height: 32, padding: '0 16px', border: 'none', borderRadius: 4, backgroundColor: '#2563EB', color: '#fff', fontSize: 12, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminConsolePage;
