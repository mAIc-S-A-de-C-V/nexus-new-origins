import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X, Play, ChevronUp, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import {
  listConformanceModels, createConformanceModel, updateConformanceModel,
  deleteConformanceModel, checkConformance,
  type ConformanceModel, type ConformanceCheckCase,
} from './api';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B',
  success: '#059669', successDim: '#ECFDF5',
  error: '#DC2626', errorDim: '#FEE2E2',
  warn: '#D97706', warnDim: '#FEF3C7',
};

interface Props {
  processId: string;
  knownActivities: string[]; // activities seen in this process's transitions
}

const ConformancePanel: React.FC<Props> = ({ processId, knownActivities }) => {
  const [models, setModels] = useState<ConformanceModel[]>([]);
  const [editing, setEditing] = useState<Partial<ConformanceModel> | null>(null);
  const [results, setResults] = useState<{ modelId: string; cases: ConformanceCheckCase[]; rate: number; avg: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listConformanceModels(processId);
      setModels(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [processId]);

  const save = async () => {
    if (!editing?.name || !editing.activities?.length) return;
    try {
      const body = {
        name: editing.name,
        activities: editing.activities,
        is_active: editing.is_active ?? true,
      };
      if (editing.id) {
        await updateConformanceModel(processId, editing.id, body);
      } else {
        await createConformanceModel(processId, body);
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this conformance model?')) return;
    try {
      await deleteConformanceModel(processId, id);
      load();
      if (results?.modelId === id) setResults(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runCheck = async (model: ConformanceModel) => {
    setLoading(true); setError(null);
    try {
      const r = await checkConformance(processId, model.id);
      setResults({ modelId: model.id, cases: r.cases || [], rate: r.conformance_rate, avg: r.avg_fitness, total: r.total_cases });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const moveActivity = (idx: number, dir: -1 | 1) => {
    const next = [...(editing?.activities || [])];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setEditing({ ...editing, activities: next });
  };
  const removeActivity = (idx: number) => {
    setEditing({ ...editing, activities: (editing?.activities || []).filter((_, i) => i !== idx) });
  };
  const addActivity = (act: string) => {
    if (!act || (editing?.activities || []).includes(act)) return;
    setEditing({ ...editing, activities: [...(editing?.activities || []), act] });
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Conformance Models</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Define expected activity sequences. Cases are scored against them.</div>
        </div>
        <button onClick={() => setEditing({ name: '', activities: [], is_active: true })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}>
          <Plus size={12} /> New model
        </button>
      </div>

      {error && <div style={{ padding: 8, marginBottom: 12, backgroundColor: C.errorDim, border: `1px solid ${C.error}`, borderRadius: 4, color: C.error, fontSize: 12 }}>{error}</div>}

      {models.map(model => (
        <div key={model.id} style={{ padding: 12, marginBottom: 10, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                {model.name}
                {model.is_active && <span style={{ marginLeft: 8, padding: '1px 6px', backgroundColor: C.successDim, color: C.success, borderRadius: 3, fontSize: 10, fontWeight: 500 }}>ACTIVE</span>}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {model.activities.length} expected activities: {model.activities.slice(0, 5).join(' → ')}{model.activities.length > 5 ? ' → …' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => runCheck(model)} title="Run conformance check"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', backgroundColor: C.accentDim, color: C.accent, border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
                <Play size={11} /> Check
              </button>
              <button onClick={() => setEditing(model)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 6 }}><Edit2 size={13} /></button>
              <button onClick={() => remove(model.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.error, padding: 6 }}><Trash2 size={13} /></button>
            </div>
          </div>

          {results?.modelId === model.id && (
            <div style={{ marginTop: 12, padding: 10, backgroundColor: C.bg, borderRadius: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 10 }}>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{(results.rate * 100).toFixed(1)}%</div><div style={{ fontSize: 10, color: C.muted }}>Conformance rate</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{(results.avg * 100).toFixed(1)}%</div><div style={{ fontSize: 10, color: C.muted }}>Average fitness</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{results.total}</div><div style={{ fontSize: 10, color: C.muted }}>Cases checked</div></div>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {results.cases.slice(0, 25).map((c, i) => (
                  <div key={i} style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: i < 24 ? `1px solid ${C.border}` : 'none' }}>
                    <span style={{ color: C.text, fontFamily: 'monospace' }}>{c.case_id}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: c.is_compliant ? C.success : C.warn, fontWeight: 500 }}>{(c.fitness * 100).toFixed(0)}%</span>
                      {c.deviations.length > 0 && (
                        <span style={{ padding: '1px 6px', backgroundColor: C.warnDim, color: C.warn, borderRadius: 3, fontSize: 10 }}>
                          {c.deviations.length} deviation{c.deviations.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {!loading && models.length === 0 && !editing && (
        <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12, backgroundColor: C.panel, border: `1px dashed ${C.border}`, borderRadius: 5 }}>
          <AlertCircle size={22} color={C.muted} style={{ marginBottom: 6 }} />
          <div>No conformance models yet for this process.</div>
          <div style={{ fontSize: 10, marginTop: 4 }}>Define an expected activity sequence to score real cases against.</div>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 16, padding: 16, backgroundColor: C.panel, border: `1px solid ${C.accent}`, borderRadius: 5 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>{editing.id ? 'Edit model' : 'New conformance model'}</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: C.text, marginBottom: 4 }}>Name</label>
            <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Standard PO flow"
              style={{ width: '100%', height: 30, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: C.text, marginBottom: 6 }}>Expected activity sequence</label>
            <div style={{ marginBottom: 8 }}>
              {(editing.activities || []).map((act, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: 3, backgroundColor: C.bg, borderRadius: 3 }}>
                  <span style={{ fontSize: 11, color: C.muted, minWidth: 18 }}>{idx + 1}.</span>
                  <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{act}</span>
                  <button onClick={() => moveActivity(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', color: idx === 0 ? '#CBD5E1' : C.muted, padding: 2 }}><ChevronUp size={12} /></button>
                  <button onClick={() => moveActivity(idx, 1)} disabled={idx === (editing.activities || []).length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', color: idx === (editing.activities || []).length - 1 ? '#CBD5E1' : C.muted, padding: 2 }}><ChevronDown size={12} /></button>
                  <button onClick={() => removeActivity(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.error, padding: 2 }}><X size={12} /></button>
                </div>
              ))}
              {(editing.activities || []).length === 0 && (
                <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: C.muted, fontStyle: 'italic' }}>No activities yet. Add from the list below.</div>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Click an activity to add it:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {knownActivities.filter(a => !(editing.activities || []).includes(a)).map(act => (
                <button key={act} onClick={() => addActivity(act)}
                  style={{ padding: '3px 8px', fontSize: 11, color: C.muted, backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, cursor: 'pointer' }}>
                  + {act}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.text, marginBottom: 12 }}>
            <input type="checkbox" checked={editing.is_active ?? true} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
            Active (used as the default model for this process)
          </label>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={save} disabled={!editing.name || !(editing.activities?.length)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer', opacity: (editing.name && editing.activities?.length) ? 1 : 0.5 }}>
              <Check size={12} /> Save
            </button>
            <button onClick={() => setEditing(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: '#FFF', color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ padding: 12, textAlign: 'center', color: C.muted, fontSize: 11 }}><RefreshCw size={12} style={{ animation: 'spin 0.6s linear infinite', verticalAlign: 'middle' }} /> Working…</div>}
    </div>
  );
};

export default ConformancePanel;
