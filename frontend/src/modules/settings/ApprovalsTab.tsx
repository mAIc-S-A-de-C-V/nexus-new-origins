import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X, RefreshCw, ShieldCheck } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B',
  success: '#059669', error: '#DC2626',
};

interface ApprovalWorkflow {
  id: string;
  name: string;
  resource_type: 'object_type' | 'pipeline' | 'agent';
  operations: string[];
  required_approvers: number;
  eligible_roles: string[];
  expiry_hours: number;
  enabled: boolean;
}

const RESOURCE_TYPES = ['object_type', 'pipeline', 'agent'] as const;
const OPERATIONS = ['delete', 'export', 'bulk_run'];
const ROLES = ['superadmin', 'admin', 'analyst', 'viewer'];

const fetchJSON = async (url: string, opts: RequestInit = {}) => {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId(), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

const ApprovalsTab: React.FC = () => {
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<ApprovalWorkflow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchJSON(`${AUDIT_API}/audit/approvals/workflows`);
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name) return;
    try {
      const body = {
        name: editing.name,
        resource_type: editing.resource_type || 'object_type',
        operations: editing.operations || ['delete'],
        required_approvers: editing.required_approvers || 1,
        eligible_roles: editing.eligible_roles || ['admin'],
        expiry_hours: editing.expiry_hours || 72,
        enabled: editing.enabled ?? true,
      };
      if (editing.id) {
        await fetchJSON(`${AUDIT_API}/audit/approvals/workflows/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await fetchJSON(`${AUDIT_API}/audit/approvals/workflows`, { method: 'POST', body: JSON.stringify(body) });
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this approval workflow?')) return;
    try {
      await fetchJSON(`${AUDIT_API}/audit/approvals/workflows/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleArr = <T,>(arr: T[], v: T): T[] => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Approval Workflows</div>
          <div style={{ fontSize: 12, color: C.muted }}>Require multi-step approval before sensitive operations (delete, export, bulk run).</div>
        </div>
        <button
          onClick={() => setEditing({ name: '', resource_type: 'object_type', operations: ['delete'], required_approvers: 1, eligible_roles: ['admin'], expiry_hours: 72, enabled: true })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}
        >
          <Plus size={13} /> New workflow
        </button>
      </div>

      {error && <div style={{ padding: 10, marginBottom: 16, backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4, color: C.error, fontSize: 12 }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}><RefreshCw size={14} style={{ animation: 'spin 0.6s linear infinite', verticalAlign: 'middle' }} /> Loading…</div>}

      {!loading && workflows.length === 0 && !editing && (
        <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13, backgroundColor: C.panel, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
          <ShieldCheck size={28} color={C.muted} style={{ marginBottom: 8 }} />
          <div>No approval workflows yet.</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Create one to require sign-off on destructive operations.</div>
        </div>
      )}

      {workflows.map(wf => (
        <div key={wf.id} style={{ padding: 16, marginBottom: 12, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>{wf.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
              On <strong>{wf.resource_type}</strong> · {wf.operations.join(', ')}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted }}>
              <span>Approvers: <strong>{wf.required_approvers}</strong></span>
              <span>Roles: {wf.eligible_roles.join(', ')}</span>
              <span>Expires after: {wf.expiry_hours}h</span>
              <span style={{ color: wf.enabled ? C.success : C.muted }}>{wf.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setEditing(wf)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 6 }}><Edit2 size={14} /></button>
            <button onClick={() => remove(wf.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.error, padding: 6 }}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}

      {editing && (
        <div style={{ marginTop: 24, padding: 20, backgroundColor: C.panel, border: `1px solid ${C.accent}`, borderRadius: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>{editing.id ? 'Edit workflow' : 'New approval workflow'}</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Name</label>
            <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Delete object type approvals" style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Resource type</label>
              <select value={editing.resource_type || 'object_type'} onChange={e => setEditing({ ...editing, resource_type: e.target.value as any })} style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}>
                {RESOURCE_TYPES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Required approvers</label>
              <input type="number" min={1} max={10} value={editing.required_approvers || 1} onChange={e => setEditing({ ...editing, required_approvers: Number(e.target.value) })} style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Operations</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {OPERATIONS.map(op => {
                const active = (editing.operations || []).includes(op);
                return (
                  <button key={op} onClick={() => setEditing({ ...editing, operations: toggleArr(editing.operations || [], op) })}
                    style={{ padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: active ? C.accentDim : C.bg, color: active ? C.accent : C.muted, border: `1px solid ${active ? C.accent : C.border}`, cursor: 'pointer' }}>
                    {op}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Eligible approver roles</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ROLES.map(r => {
                const active = (editing.eligible_roles || []).includes(r);
                return (
                  <button key={r} onClick={() => setEditing({ ...editing, eligible_roles: toggleArr(editing.eligible_roles || [], r) })}
                    style={{ padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: active ? C.accentDim : C.bg, color: active ? C.accent : C.muted, border: `1px solid ${active ? C.accent : C.border}`, cursor: 'pointer' }}>
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Expires after (hours)</label>
              <input type="number" min={1} value={editing.expiry_hours || 72} onChange={e => setEditing({ ...editing, expiry_hours: Number(e.target.value) })} style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-end', gap: 6, fontSize: 12, color: C.text, paddingBottom: 8 }}>
              <input type="checkbox" checked={editing.enabled ?? true} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={!editing.name || !(editing.operations?.length) || !(editing.eligible_roles?.length)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer', opacity: editing.name ? 1 : 0.5 }}>
              <Check size={13} /> Save
            </button>
            <button onClick={() => setEditing(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: '#FFF', color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalsTab;
