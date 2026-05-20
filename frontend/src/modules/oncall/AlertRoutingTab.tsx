import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import { useRoutingStore, RoutingRule } from '../../store/routingStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  success: '#22C55E',
};

const CHANNELS = ['in_app', 'slack', 'email', 'webhook'];

const AlertRoutingTab: React.FC = () => {
  const { routingRules, fetchRouting, createRouting, updateRouting, deleteRouting } = useRoutingStore();
  const [edit, setEdit] = useState<RoutingRule | null>(null);
  const [draft, setDraft] = useState<Omit<RoutingRule, 'id' | 'tenant_id'> | null>(null);
  const [conditionText, setConditionText] = useState('');

  useEffect(() => { void fetchRouting(); }, [fetchRouting]);

  const startNew = () => {
    setEdit(null);
    setDraft({ name: 'New routing rule', condition: {}, target_user_ids: [], channels: ['in_app'], priority: 100, enabled: true });
    setConditionText('{}');
  };

  const select = (r: RoutingRule) => {
    setEdit(r);
    setDraft({ name: r.name, condition: r.condition, target_user_ids: r.target_user_ids, channels: r.channels, priority: r.priority, enabled: r.enabled });
    setConditionText(JSON.stringify(r.condition || {}, null, 2));
  };

  const save = async () => {
    if (!draft) return;
    let condition: Record<string, unknown> = {};
    try { condition = JSON.parse(conditionText || '{}'); } catch { alert('Condition must be valid JSON'); return; }
    const body = { ...draft, condition };
    if (edit) await updateRouting(edit.id, body); else await createRouting(body);
    await fetchRouting();
    setDraft(null); setEdit(null);
  };

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, maxWidth: 1100 }}>
      <div style={{ flex: '0 0 320px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>Routing rules</div>
          <button onClick={startNew} style={{ padding: '4px 10px', backgroundColor: C.accent, color: '#FFF', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> New
          </button>
        </div>
        {routingRules.map(r => (
          <div key={r.id} onClick={() => select(r)} style={{ padding: 10, border: `1px solid ${C.border}`, backgroundColor: edit?.id === r.id ? C.accentLight : C.panel, borderRadius: 4, marginBottom: 6, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {r.enabled ? <ToggleRight size={12} color={C.success} /> : <ToggleLeft size={12} color={C.subtle} />}
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text, flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: 10, color: C.subtle }}>p{r.priority}</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{(r.channels || []).join(', ')} → {(r.target_user_ids || []).length} user(s)</div>
          </div>
        ))}
        {routingRules.length === 0 && <div style={{ padding: 18, color: C.subtle, fontSize: 12, textAlign: 'center' }}>No routing rules yet</div>}
      </div>

      <div style={{ flex: 1 }}>
        {!draft && <div style={{ color: C.subtle, fontSize: 13 }}>Select or create a routing rule</div>}
        {draft && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>{edit ? 'Edit rule' : 'New rule'}</div>

            <Field label="Name">
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inp({ width: '100%' })} />
            </Field>
            <Field label="Priority (lower = first)">
              <input type="number" value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })} style={inp({ width: 100 })} />
            </Field>
            <Field label="Enabled">
              <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} style={{ accentColor: C.accent }} />
            </Field>

            <Field label="Condition (JSON)" align="top">
              <textarea value={conditionText} onChange={e => setConditionText(e.target.value)} rows={5}
                        placeholder='e.g. {"severity":"critical","rule_type":"metric_deviation"}'
                        style={{ ...inp({ width: '100%' }), height: 'auto', minHeight: 120, fontFamily: 'monospace', fontSize: 12, padding: 8, resize: 'vertical' }} />
            </Field>

            <Field label="Target user IDs (comma-separated, '{on_call}' for rotation)">
              <input value={(draft.target_user_ids || []).join(', ')}
                      onChange={e => setDraft({ ...draft, target_user_ids: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      style={inp({ width: '100%', fontFamily: 'monospace' })}
                      placeholder="{on_call}, user-id-1, user-id-2" />
            </Field>

            <Field label="Channels">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {CHANNELS.map(ch => (
                  <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.text }}>
                    <input type="checkbox" checked={(draft.channels || []).includes(ch)}
                           onChange={e => setDraft({ ...draft,
                             channels: e.target.checked
                               ? [...(draft.channels || []), ch]
                               : (draft.channels || []).filter(c => c !== ch) })}
                           style={{ accentColor: C.accent }} />
                    {ch}
                  </label>
                ))}
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={save} style={{ padding: '7px 14px', backgroundColor: C.accent, color: '#FFF', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Save size={12} /> Save
              </button>
              {edit && <button onClick={async () => { await deleteRouting(edit.id); await fetchRouting(); setDraft(null); setEdit(null); }} style={{ padding: '7px 12px', backgroundColor: '#FEF2F2', border: `1px solid #FECACA`, color: '#DC2626', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Trash2 size={12} /> Delete
              </button>}
              <button onClick={() => { setDraft(null); setEdit(null); }} style={{ padding: '7px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode; align?: 'top' | 'center' }> = ({ label, children, align = 'center' }) => (
  <div style={{ display: 'flex', alignItems: align === 'top' ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
    <span style={{ fontSize: 12, color: C.muted, minWidth: 240, paddingTop: align === 'top' ? 6 : 0 }}>{label}</span>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

const inp = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4,
  fontSize: 13, color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box', ...extra,
});

export default AlertRoutingTab;
