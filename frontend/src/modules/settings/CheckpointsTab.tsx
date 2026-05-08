import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B',
  success: '#059669', error: '#DC2626',
  warn: '#D97706', warnDim: '#FEF3C7',
};

interface Checkpoint {
  id: string;
  name: string;
  prompt_text: string;
  applies_to: { resource_type: string; operations: string[] }[];
  applies_to_roles: string[];
  enabled: boolean;
}

const RESOURCE_TYPES = ['object_type', 'pipeline', 'agent', 'connector', 'logic_function', 'app'];
const OPERATIONS = ['delete', 'update', 'export', 'bulk_run', 'bulk_delete'];
const ROLES = ['superadmin', 'admin', 'analyst', 'viewer'];

const fetchJSON = async (url: string, opts: RequestInit = {}) => {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId(), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

const CheckpointsTab: React.FC = () => {
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Checkpoint> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchJSON(`${AUDIT_API}/audit/checkpoints`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name || !editing.prompt_text) return;
    try {
      const body = {
        name: editing.name,
        prompt_text: editing.prompt_text,
        applies_to: editing.applies_to || [{ resource_type: 'object_type', operations: ['delete'] }],
        applies_to_roles: editing.applies_to_roles || [],
        enabled: editing.enabled ?? true,
      };
      if (editing.id) {
        await fetchJSON(`${AUDIT_API}/audit/checkpoints/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await fetchJSON(`${AUDIT_API}/audit/checkpoints`, { method: 'POST', body: JSON.stringify(body) });
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this checkpoint? Users will no longer be prompted.')) return;
    try {
      await fetchJSON(`${AUDIT_API}/audit/checkpoints/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleArr = <T,>(arr: T[], v: T): T[] => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const updateAppliesTo = (idx: number, patch: Partial<Checkpoint['applies_to'][0]>) => {
    const next = [...(editing?.applies_to || [])];
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, applies_to: next });
  };
  const removeAppliesTo = (idx: number) => {
    const next = (editing?.applies_to || []).filter((_, i) => i !== idx);
    setEditing({ ...editing, applies_to: next });
  };
  const addAppliesTo = () => {
    setEditing({ ...editing, applies_to: [...(editing?.applies_to || []), { resource_type: 'object_type', operations: ['delete'] }] });
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Justification Checkpoints</div>
          <div style={{ fontSize: 12, color: C.muted }}>Force users to type a reason before performing sensitive operations. Logged in the audit trail.</div>
        </div>
        <button
          onClick={() => setEditing({ name: '', prompt_text: '', applies_to: [{ resource_type: 'object_type', operations: ['delete'] }], applies_to_roles: [], enabled: true })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}
        >
          <Plus size={13} /> New checkpoint
        </button>
      </div>

      {error && <div style={{ padding: 10, marginBottom: 16, backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4, color: C.error, fontSize: 12 }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}><RefreshCw size={14} style={{ animation: 'spin 0.6s linear infinite', verticalAlign: 'middle' }} /> Loading…</div>}

      {!loading && items.length === 0 && !editing && (
        <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13, backgroundColor: C.panel, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
          <AlertTriangle size={28} color={C.muted} style={{ marginBottom: 8 }} />
          <div>No checkpoints configured.</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Define gates that prompt users for justification before destructive actions.</div>
        </div>
      )}

      {items.map(cp => (
        <div key={cp.id} style={{ padding: 16, marginBottom: 12, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>{cp.name}</div>
              <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 8 }}>"{cp.prompt_text}"</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {cp.applies_to?.map((a, i) => (
                  <span key={i} style={{ display: 'inline-block', marginRight: 12, padding: '2px 8px', backgroundColor: C.warnDim, color: C.warn, borderRadius: 3 }}>
                    {a.resource_type} · {a.operations.join(', ')}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                {cp.applies_to_roles?.length ? `Applies to: ${cp.applies_to_roles.join(', ')}` : 'Applies to all roles'}
                {' · '}
                <span style={{ color: cp.enabled ? C.success : C.muted }}>{cp.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setEditing(cp)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 6 }}><Edit2 size={14} /></button>
              <button onClick={() => remove(cp.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.error, padding: 6 }}><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <div style={{ marginTop: 24, padding: 20, backgroundColor: C.panel, border: `1px solid ${C.accent}`, borderRadius: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>{editing.id ? 'Edit checkpoint' : 'New checkpoint'}</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Name</label>
            <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Confirm OT deletion" style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Prompt shown to user</label>
            <textarea value={editing.prompt_text || ''} onChange={e => setEditing({ ...editing, prompt_text: e.target.value })} placeholder="Why are you deleting this object type?" style={{ width: '100%', minHeight: 60, padding: 10, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.text }}>Applies to (resource + operations)</label>
              <button onClick={addAppliesTo} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, color: C.accent, backgroundColor: C.accentDim, border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                <Plus size={11} /> Add
              </button>
            </div>
            {(editing.applies_to || []).map((entry, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 8, padding: 8, backgroundColor: C.bg, borderRadius: 4 }}>
                <select value={entry.resource_type} onChange={e => updateAppliesTo(idx, { resource_type: e.target.value })} style={{ height: 28, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 12 }}>
                  {RESOURCE_TYPES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {OPERATIONS.map(op => {
                    const active = entry.operations.includes(op);
                    return (
                      <button key={op} onClick={() => updateAppliesTo(idx, { operations: toggleArr(entry.operations, op) })}
                        style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, backgroundColor: active ? C.accentDim : '#FFF', color: active ? C.accent : C.muted, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 3, cursor: 'pointer' }}>
                        {op}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => removeAppliesTo(idx)} style={{ background: 'none', border: 'none', color: C.error, cursor: 'pointer', padding: 4 }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Roles affected (empty = all roles)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ROLES.map(r => {
                const active = (editing.applies_to_roles || []).includes(r);
                return (
                  <button key={r} onClick={() => setEditing({ ...editing, applies_to_roles: toggleArr(editing.applies_to_roles || [], r) })}
                    style={{ padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: active ? C.accentDim : C.bg, color: active ? C.accent : C.muted, border: `1px solid ${active ? C.accent : C.border}`, cursor: 'pointer' }}>
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text, marginBottom: 16 }}>
            <input type="checkbox" checked={editing.enabled ?? true} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
            Enabled
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={!editing.name || !editing.prompt_text}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer', opacity: editing.name && editing.prompt_text ? 1 : 0.5 }}>
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

export default CheckpointsTab;
