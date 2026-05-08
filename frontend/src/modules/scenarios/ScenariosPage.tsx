import React, { useState, useEffect } from 'react';
import { Plus, Play, Trash2, RefreshCw, AlertCircle, Sparkles, BarChart2 } from 'lucide-react';
import { getTenantId } from '../../store/authStore';
import { useOntologyStore } from '../../store/ontologyStore';

const ANALYTICS_URL = import.meta.env.VITE_ANALYTICS_SERVICE_URL || 'http://localhost:8015';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B',
  success: '#059669', successDim: '#ECFDF5',
  error: '#DC2626', errorDim: '#FEE2E2',
  warn: '#D97706',
};

interface ScenarioOverride {
  field: string;
  op: 'add' | 'multiply' | 'set';
  value: number | string;
  filter?: { field: string; operator: string; value: string }[];
}

interface DerivedMetric {
  name: string;
  field: string;
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
}

interface Scenario {
  id: string;
  name: string;
  object_type_id: string;
  object_type_name: string | null;
  overrides: ScenarioOverride[];
  derived_metrics: DerivedMetric[];
  created_at: string;
  last_result?: {
    baseline: Record<string, number>;
    simulated: Record<string, number>;
    deltas: Record<string, { absolute: number; percent: number | null }>;
    affected_records: number;
    record_count: number;
  };
}

const fetchJSON = async (url: string, opts: RequestInit = {}) => {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId(), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

const ScenariosPage: React.FC = () => {
  const objectTypes = useOntologyStore(s => s.objectTypes);
  const fetchObjectTypes = useOntologyStore(s => s.fetchObjectTypes);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Scenario> | null>(null);
  const [nlQuery, setNlQuery] = useState('');
  const [interpreting, setInterpreting] = useState(false);

  useEffect(() => { fetchObjectTypes(); load(); /* eslint-disable-next-line */ }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchJSON(`${ANALYTICS_URL}/scenarios`);
      setScenarios(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const interpret = async () => {
    if (!nlQuery.trim() || !editing?.object_type_id) return;
    setInterpreting(true); setError(null);
    try {
      const ot = objectTypes.find(o => o.id === editing.object_type_id);
      const data = await fetchJSON(`${ANALYTICS_URL}/scenarios/interpret`, {
        method: 'POST',
        body: JSON.stringify({
          query: nlQuery,
          object_type_id: editing.object_type_id,
          object_type_name: ot?.displayName || ot?.name,
          fields: (ot?.properties || []).map((p: any) => p.name),
        }),
      });
      setEditing({
        ...editing,
        name: editing.name || data.suggested_name || nlQuery.slice(0, 60),
        overrides: data.overrides || [],
        derived_metrics: data.derived_metrics || [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInterpreting(false);
    }
  };

  const save = async () => {
    if (!editing?.name || !editing.object_type_id) return;
    try {
      const ot = objectTypes.find(o => o.id === editing.object_type_id);
      const body = {
        name: editing.name,
        object_type_id: editing.object_type_id,
        object_type_name: ot?.displayName || ot?.name,
        overrides: editing.overrides || [],
        derived_metrics: editing.derived_metrics || [],
      };
      await fetchJSON(`${ANALYTICS_URL}/scenarios`, { method: 'POST', body: JSON.stringify(body) });
      setEditing(null);
      setNlQuery('');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const compute = async (scenarioId: string) => {
    setLoading(true); setError(null);
    try {
      const data = await fetchJSON(`${ANALYTICS_URL}/scenarios/${scenarioId}/compute`, { method: 'POST' });
      setScenarios(s => s.map(x => x.id === scenarioId ? { ...x, last_result: data } : x));
      const sc = scenarios.find(s => s.id === scenarioId);
      if (sc) setSelected({ ...sc, last_result: data });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this scenario?')) return;
    try {
      await fetchJSON(`${ANALYTICS_URL}/scenarios/${id}`, { method: 'DELETE' });
      load();
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      <div style={{ height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 10, flexShrink: 0 }}>
        <BarChart2 size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Scenarios</h1>
        <span style={{ fontSize: 12, color: C.muted, marginLeft: 6 }}>What-if modeling on your data</span>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => setEditing({ name: '', overrides: [], derived_metrics: [] })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}>
            <Plus size={12} /> New scenario
          </button>
        </div>
      </div>

      {error && <div style={{ margin: 16, padding: 10, backgroundColor: C.errorDim, border: `1px solid ${C.error}`, borderRadius: 4, color: C.error, fontSize: 12 }}>{error}</div>}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* List */}
        <div style={{ width: 320, borderRight: `1px solid ${C.border}`, backgroundColor: C.panel, overflowY: 'auto' }}>
          {loading && scenarios.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: C.muted, fontSize: 12 }}><RefreshCw size={14} style={{ animation: 'spin 0.6s linear infinite', verticalAlign: 'middle' }} /> Loading…</div>}
          {!loading && scenarios.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>
              <Sparkles size={22} color={C.muted} style={{ marginBottom: 6 }} />
              <div>No scenarios yet.</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Create one to model "what if X changes?"</div>
            </div>
          )}
          {scenarios.map(s => (
            <div key={s.id} onClick={() => setSelected(s)}
              style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', backgroundColor: selected?.id === s.id ? C.accentDim : 'transparent' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{s.object_type_name || s.object_type_id} · {s.overrides.length} override{s.overrides.length !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>

        {/* Detail / editor */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {editing && (
            <div style={{ marginBottom: 24, padding: 20, backgroundColor: C.panel, border: `1px solid ${C.accent}`, borderRadius: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>{editing.id ? 'Edit scenario' : 'New scenario'}</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Name</label>
                  <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Reduce pricing 10%"
                    style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 4 }}>Object type</label>
                  <select value={editing.object_type_id || ''} onChange={e => setEditing({ ...editing, object_type_id: e.target.value })}
                    style={{ width: '100%', height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}>
                    <option value="">Select…</option>
                    {objectTypes.map((o: any) => <option key={o.id} value={o.id}>{o.displayName || o.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 12, padding: 12, backgroundColor: C.bg, borderRadius: 4, border: `1px dashed ${C.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  <Sparkles size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Describe the scenario in plain English (Claude will generate overrides)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={nlQuery} onChange={e => setNlQuery(e.target.value)} placeholder='e.g. "What if we reduce all prices by 10% for products in category Electronics?"'
                    style={{ flex: 1, height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }} />
                  <button onClick={interpret} disabled={!nlQuery.trim() || !editing.object_type_id || interpreting}
                    style={{ padding: '0 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: (nlQuery.trim() && editing.object_type_id) ? 'pointer' : 'not-allowed', opacity: (nlQuery.trim() && editing.object_type_id) ? 1 : 0.5 }}>
                    {interpreting ? <RefreshCw size={12} style={{ animation: 'spin 0.6s linear infinite' }} /> : 'Interpret'}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Overrides ({(editing.overrides || []).length})</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', backgroundColor: C.bg, padding: 8, borderRadius: 4, maxHeight: 120, overflowY: 'auto' }}>
                  {JSON.stringify(editing.overrides || [], null, 2)}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Derived metrics ({(editing.derived_metrics || []).length})</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', backgroundColor: C.bg, padding: 8, borderRadius: 4, maxHeight: 80, overflowY: 'auto' }}>
                  {JSON.stringify(editing.derived_metrics || [], null, 2)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save} disabled={!editing.name || !editing.object_type_id}
                  style={{ padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: (editing.name && editing.object_type_id) ? 'pointer' : 'not-allowed', opacity: (editing.name && editing.object_type_id) ? 1 : 0.5 }}>
                  Save scenario
                </button>
                <button onClick={() => { setEditing(null); setNlQuery(''); }}
                  style={{ padding: '7px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: '#FFF', color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selected && !editing && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{selected.object_type_name || selected.object_type_id}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => compute(selected.id)} disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}>
                    <Play size={12} /> Compute
                  </button>
                  <button onClick={() => remove(selected.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: '#FFF', color: C.error, border: `1px solid ${C.error}`, cursor: 'pointer' }}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>

              {selected.last_result ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
                    <div style={{ padding: 16, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Records affected</div>
                      <div style={{ fontSize: 22, fontWeight: 600, color: C.text }}>{selected.last_result.affected_records.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>of {selected.last_result.record_count.toLocaleString()} total</div>
                    </div>
                    <div style={{ padding: 16, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Metrics computed</div>
                      <div style={{ fontSize: 22, fontWeight: 600, color: C.text }}>{Object.keys(selected.last_result.deltas).length}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Metrics: baseline → simulated</div>
                  <div style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 14px', backgroundColor: C.bg, fontSize: 11, fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                      <div>Metric</div><div>Baseline</div><div>Simulated</div><div>Δ</div>
                    </div>
                    {Object.entries(selected.last_result.deltas).map(([k, d]) => (
                      <div key={k} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 14px', fontSize: 12, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ fontWeight: 500 }}>{k}</div>
                        <div>{(selected.last_result!.baseline[k] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        <div>{(selected.last_result!.simulated[k] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        <div style={{ color: d.absolute === 0 ? C.muted : (d.absolute > 0 ? C.success : C.error) }}>
                          {d.absolute > 0 ? '+' : ''}{d.absolute.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          {d.percent !== null && <span style={{ marginLeft: 6, fontSize: 11 }}>({d.percent > 0 ? '+' : ''}{d.percent.toFixed(1)}%)</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13, backgroundColor: C.panel, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
                  <AlertCircle size={22} color={C.muted} style={{ marginBottom: 6 }} />
                  Click Compute to run this scenario.
                </div>
              )}

              <details style={{ marginTop: 24 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: C.muted, marginBottom: 6 }}>Definition</summary>
                <pre style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', backgroundColor: C.panel, padding: 12, borderRadius: 4, overflow: 'auto', border: `1px solid ${C.border}` }}>
{JSON.stringify({ overrides: selected.overrides, derived_metrics: selected.derived_metrics }, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {!selected && !editing && scenarios.length > 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>Select a scenario from the list, or create a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScenariosPage;
