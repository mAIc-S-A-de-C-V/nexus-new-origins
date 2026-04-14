import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, TrendingUp, ChevronRight, Check, Clock, BarChart2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { getTenantId } from '../../store/authStore';

const API = import.meta.env.VITE_ANALYTICS_SERVICE_URL || 'http://localhost:8015';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number, currency = 'USD'): string {
  if (val === 0) return `0 ${currency}`;
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M ${currency}`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K ${currency}`;
  return `${val.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;
}

function sourceLabel(type: string): string {
  const m: Record<string, string> = {
    pipeline: 'Pipeline', automation: 'Automation', agent: 'Agent',
    logic: 'Logic Function', manual: 'Manual',
  };
  return m[type] || type;
}

function statusColor(status: string) {
  if (status === 'realized') return { bg: '#D1FAE5', text: '#065F46' };
  if (status === 'framed') return { bg: '#EFF6FF', text: '#1D4ED8' };
  return { bg: '#F1F5F9', text: '#64748B' };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': getTenantId(),
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string; name: string; color: string; currency: string;
  total_identified: number; total_framed: number; total_realized: number;
  use_case_count: number;
}

interface UseCase {
  id: string; category_id: string; category_name: string; category_color: string;
  currency: string; name: string; description: string; source_type: string;
  source_id: string; status: string;
  identified_value: number; framed_value: number; realized_value: number;
  improvement_potential_pct: number;
  formula_description: string; formula_params: Record<string, any>;
}

interface ValueEvent {
  id: string; use_case_id: string; amount: number; notes: string; occurred_at: string;
}

// ── Add Category Modal ─────────────────────────────────────────────────────────

const AddCategoryModal: React.FC<{ onClose: () => void; onSave: () => void }> = ({ onClose, onSave }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#7C3AED');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/value/categories', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description, color, currency }),
      });
      onSave();
    } finally { setSaving(false); }
  };

  return (
    <div style={OVERLAY}>
      <div style={{ ...MODAL, width: 440 }}>
        <div style={MODAL_HDR}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>New Value Category</span>
          <button onClick={onClose} style={ICON_BTN}><X size={14} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={LABEL}>
            Category Name
            <input style={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cost Reduction" autoFocus />
          </label>
          <label style={LABEL}>
            Description
            <input style={INPUT} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...LABEL, flex: 1 }}>
              Currency
              <select style={INPUT} value={currency} onChange={e => setCurrency(e.target.value)}>
                {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ ...LABEL, flex: 1 }}>
              Color
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {['#7C3AED', '#2563EB', '#059669', '#DC2626', '#D97706', '#0891B2'].map(c => (
                  <div key={c} onClick={() => setColor(c)} style={{
                    width: 22, height: 22, borderRadius: 4, backgroundColor: c, cursor: 'pointer',
                    border: color === c ? '2px solid #0D1117' : '2px solid transparent',
                  }} />
                ))}
              </div>
            </label>
          </div>
        </div>
        <div style={MODAL_FTR}>
          <button style={BTN_GHOST} onClick={onClose}>Cancel</button>
          <button style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Source fetchers ───────────────────────────────────────────────────────────

const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';
const AGENT_API    = import.meta.env.VITE_AGENT_SERVICE_URL    || 'http://localhost:8013';
const LOGIC_API    = import.meta.env.VITE_LOGIC_SERVICE_URL    || 'http://localhost:8012';

async function fetchSources(type: string): Promise<{ id: string; name: string }[]> {
  try {
    if (type === 'pipeline') {
      const res = await fetch(`${PIPELINE_API}/pipelines`, { headers: { 'x-tenant-id': getTenantId() } });
      const data = await res.json();
      return (Array.isArray(data) ? data : data.items || []).map((p: any) => ({ id: p.id, name: p.name }));
    }
    if (type === 'agent') {
      const res = await fetch(`${AGENT_API}/agents`, { headers: { 'x-tenant-id': getTenantId() } });
      const data = await res.json();
      return (Array.isArray(data) ? data : data.items || []).map((a: any) => ({ id: a.id, name: a.name }));
    }
    if (type === 'logic') {
      const res = await fetch(`${LOGIC_API}/logic/functions`, { headers: { 'x-tenant-id': getTenantId() } });
      const data = await res.json();
      return (Array.isArray(data) ? data : data.items || []).map((f: any) => ({ id: f.id, name: f.name }));
    }
  } catch { /* silent */ }
  return [];
}

async function fetchPipelineRuns(pipelineId: string): Promise<any[]> {
  try {
    const res = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/runs`, { headers: { 'x-tenant-id': getTenantId() } });
    const data = await res.json();
    return Array.isArray(data) ? data : data.items || [];
  } catch { return []; }
}

// ── Add Use Case Modal ─────────────────────────────────────────────────────────

const AddUseCaseModal: React.FC<{
  categories: Category[]; defaultCategoryId?: string;
  onClose: () => void; onSave: () => void;
}> = ({ categories, defaultCategoryId, onClose, onSave }) => {
  const [sourceType, setSourceType] = useState('pipeline');
  const [sourceId, setSourceId]     = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sources, setSources]       = useState<{ id: string; name: string }[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const [categoryId, setCategoryId]   = useState(defaultCategoryId || categories[0]?.id || '');
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [valuePerRun, setValuePerRun] = useState('');
  const [valuePerRecord, setValuePerRecord] = useState('');
  const [trackRecords, setTrackRecords]     = useState(false);
  const [estRunsPerMonth, setEstRunsPerMonth] = useState('');
  const [improvementPct, setImprovementPct]   = useState('0');
  const [saving, setSaving] = useState(false);

  const currency = categories.find(c => c.id === categoryId)?.currency || 'USD';
  const vpr  = parseFloat(valuePerRun    || '0');
  const vprec = parseFloat(valuePerRecord || '0');
  const runs  = parseFloat(estRunsPerMonth || '0');
  const computedMonthly = runs * vpr;

  // Load sources when type changes
  useEffect(() => {
    if (sourceType === 'manual') { setSources([]); setSourceId(''); setSourceName(''); return; }
    setLoadingSources(true);
    fetchSources(sourceType).then(s => { setSources(s); setLoadingSources(false); });
  }, [sourceType]);

  // Auto-fill name when source selected
  useEffect(() => {
    if (sourceName && !name) setName(sourceName);
  }, [sourceName]);

  const buildFormula = () => {
    const parts = [];
    if (vpr > 0) parts.push(`${currency} ${vpr} per run`);
    if (trackRecords && vprec > 0) parts.push(`${currency} ${vprec} per record processed`);
    return parts.length ? parts.join(' + ') : '';
  };

  const save = async () => {
    if (!name.trim() || !categoryId) return;
    setSaving(true);
    try {
      await apiFetch('/value/use-cases', {
        method: 'POST',
        body: JSON.stringify({
          category_id: categoryId,
          name: name.trim(),
          description,
          source_type: sourceType,
          source_id: sourceId || undefined,
          identified_value: computedMonthly || parseFloat(valuePerRun || '0'),
          improvement_potential_pct: parseFloat(improvementPct || '0'),
          formula_description: buildFormula(),
          formula_params: {
            value_per_run: vpr,
            value_per_record: trackRecords ? vprec : 0,
            track_records: trackRecords,
            est_runs_per_month: runs,
            source_name: sourceName,
          },
        }),
      });
      onSave();
    } finally { setSaving(false); }
  };

  return (
    <div style={OVERLAY}>
      <div style={{ ...MODAL, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={MODAL_HDR}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>New Use Case</span>
          <button onClick={onClose} style={ICON_BTN}><X size={14} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Category */}
          <label style={LABEL}>
            Category
            <select style={INPUT} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          {/* Source type + picker */}
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ ...LABEL, flex: '0 0 140px' }}>
              Source Type
              <select style={INPUT} value={sourceType} onChange={e => { setSourceType(e.target.value); setSourceId(''); setSourceName(''); }}>
                {['pipeline', 'agent', 'logic', 'manual'].map(t => (
                  <option key={t} value={t}>{sourceLabel(t)}</option>
                ))}
              </select>
            </label>
            {sourceType !== 'manual' && (
              <label style={{ ...LABEL, flex: 1 }}>
                {sourceType === 'pipeline' ? 'Pipeline' : sourceType === 'agent' ? 'Agent' : 'Logic Function'}
                <select style={INPUT} value={sourceId}
                  onChange={e => {
                    const s = sources.find(x => x.id === e.target.value);
                    setSourceId(e.target.value);
                    setSourceName(s?.name || '');
                  }}>
                  <option value="">— {loadingSources ? 'Loading…' : 'Select one'} —</option>
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {/* Name + description */}
          <label style={LABEL}>
            Use Case Name
            <input style={INPUT} value={name} onChange={e => setName(e.target.value)}
              placeholder={sourceName || 'e.g. Sepsis Ingest Pipeline'} autoFocus />
          </label>
          <label style={LABEL}>
            Description
            <input style={INPUT} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What value does this automation create?" />
          </label>

          {/* Value config */}
          <div style={{ backgroundColor: '#F8FAFC', borderRadius: 6, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Value per Execution</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...LABEL, flex: 1 }}>
                Value per Run ({currency})
                <input style={INPUT} type="number" value={valuePerRun} onChange={e => setValuePerRun(e.target.value)} placeholder="e.g. 150" />
              </label>
              <label style={{ ...LABEL, flex: 1 }}>
                Est. Runs / Month
                <input style={INPUT} type="number" value={estRunsPerMonth} onChange={e => setEstRunsPerMonth(e.target.value)} placeholder="e.g. 30" />
              </label>
            </div>

            {/* Track records toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div onClick={() => setTrackRecords(v => !v)} style={{
                width: 36, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'background 200ms',
                backgroundColor: trackRecords ? '#7C3AED' : '#CBD5E1', position: 'relative', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: trackRecords ? 18 : 2, width: 16, height: 16,
                  borderRadius: '50%', backgroundColor: '#fff', transition: 'left 200ms',
                }} />
              </div>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>Also track value per record processed</span>
            </div>

            {trackRecords && (
              <label style={LABEL}>
                Value per Record ({currency})
                <input style={INPUT} type="number" value={valuePerRecord} onChange={e => setValuePerRecord(e.target.value)} placeholder="e.g. 0.50" />
              </label>
            )}
          </div>

          {/* Formula preview */}
          {(vpr > 0 || (trackRecords && vprec > 0)) && (
            <div style={{ fontSize: 12, color: '#475569', padding: '8px 12px', backgroundColor: '#EFF6FF', borderRadius: 4 }}>
              <strong>Formula:</strong> {buildFormula()}
              {runs > 0 && <span style={{ color: '#7C3AED', marginLeft: 8 }}>→ ~{fmt(computedMonthly, currency)}/month</span>}
            </div>
          )}

          <label style={LABEL}>
            Improvement Potential %
            <input style={INPUT} type="number" value={improvementPct} onChange={e => setImprovementPct(e.target.value)} placeholder="0" />
          </label>
        </div>

        <div style={MODAL_FTR}>
          <button style={BTN_GHOST} onClick={onClose}>Cancel</button>
          <button style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Create Use Case'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Realize Tab ───────────────────────────────────────────────────────────────

const RealizeTab: React.FC<{
  useCase: UseCase; currency: string; events: ValueEvent[];
  saving: boolean; setSaving: (v: boolean) => void;
  onReload: () => void; onUpdate: () => void;
}> = ({ useCase, currency, events, saving, setSaving, onReload, onUpdate }) => {
  const fp = useCase.formula_params || {};
  const vpr    = fp.value_per_run    ?? 0;
  const vprec  = fp.value_per_record ?? 0;
  const trackR = fp.track_records    ?? false;

  const [recordCount, setRecordCount] = useState('');
  const [eventNotes, setEventNotes]   = useState('');
  const [syncing, setSyncing]         = useState(false);
  const [pendingRuns, setPendingRuns] = useState<any[]>([]);
  const [excluded, setExcluded]       = useState<Set<string>>(new Set());

  const computedAmount = vpr + (trackR ? (parseFloat(recordCount || '0') * vprec) : 0);

  // Sync pipeline runs that haven't been logged yet
  const syncRuns = async () => {
    if (!useCase.source_id || useCase.source_type !== 'pipeline') return;
    setSyncing(true);
    const runs = await fetchPipelineRuns(useCase.source_id);
    // Filter to completed runs not already in events
    const loggedNotes = new Set(events.map(e => e.notes));
    const pending = runs.filter(r =>
      r.status === 'success' && !loggedNotes.has(`Run ${r.id.slice(0,8)}`)
    );
    setPendingRuns(pending);
    setSyncing(false);
  };

  const logRun = async (runId?: string, rows?: number) => {
    const rc = rows ?? parseFloat(recordCount || '0');
    const amount = vpr + (trackR ? rc * vprec : 0);
    if (amount <= 0 && !runId) return;
    setSaving(true);
    try {
      await apiFetch(`/value/use-cases/${useCase.id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          notes: runId ? `Run ${runId.slice(0,8)} · ${rc} records` : (eventNotes || `${rc} records processed`),
        }),
      });
      setRecordCount(''); setEventNotes('');
      onReload(); onUpdate();
      if (runId) setPendingRuns(p => p.filter(r => r.id !== runId));
    } finally { setSaving(false); }
  };

  const logAllPending = async () => {
    for (const run of pendingRuns.filter(r => !excluded.has(r.id))) {
      await logRun(run.id, run.rows_out ?? 0);
    }
    setPendingRuns([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {[
          { label: 'Framed', val: useCase.framed_value, color: '#2563EB' },
          { label: 'Realized', val: useCase.realized_value, color: '#059669' },
          { label: 'Remaining', val: Math.max(0, useCase.framed_value - useCase.realized_value), color: '#D97706' },
        ].map(({ label, val, color }) => (
          <div key={label} style={VALUE_CARD}>
            <div style={VALUE_CARD_LABEL}>{label}</div>
            <div style={{ ...BIG_NUM, color, fontSize: 22 }}>{fmt(val, currency)}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {useCase.framed_value > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B', marginBottom: 4 }}>
            <span>Realization progress</span>
            <span>{Math.min(100, Math.round(useCase.realized_value / useCase.framed_value * 100))}%</span>
          </div>
          <div style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4, backgroundColor: '#059669',
              width: `${Math.min(100, (useCase.realized_value / useCase.framed_value) * 100)}%`,
              transition: 'width 400ms ease',
            }} />
          </div>
        </div>
      )}

      {/* Sync from pipeline */}
      {useCase.source_type === 'pipeline' && useCase.source_id && (
        <div style={{ backgroundColor: '#F8FAFC', borderRadius: 6, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pendingRuns.length > 0 ? 12 : 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Sync from Pipeline</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Pull completed runs and auto-log value</div>
            </div>
            <button style={{ ...BTN_GHOST, opacity: syncing ? 0.6 : 1 }} onClick={syncRuns} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Runs'}
            </button>
          </div>
          {pendingRuns.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
                {pendingRuns.length} unlogged run{pendingRuns.length > 1 ? 's' : ''} found — toggle to include/exclude
              </div>
              {pendingRuns.map(run => {
                const rows = run.rows_out ?? 0;
                const amt  = vpr + (trackR ? rows * vprec : 0);
                const isExcluded = excluded.has(run.id);
                return (
                  <div key={run.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                    borderBottom: '1px solid #F1F5F9', opacity: isExcluded ? 0.4 : 1,
                  }}>
                    <div onClick={() => setExcluded(s => { const n = new Set(s); isExcluded ? n.delete(run.id) : n.add(run.id); return n; })}
                      style={{
                        width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
                        backgroundColor: isExcluded ? '#CBD5E1' : '#7C3AED', position: 'relative', transition: 'background 200ms',
                      }}>
                      <div style={{
                        position: 'absolute', top: 2, left: isExcluded ? 2 : 14, width: 14, height: 14,
                        borderRadius: '50%', backgroundColor: '#fff', transition: 'left 200ms',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#94A3B8', width: 100, flexShrink: 0 }}>
                      {new Date(run.started_at).toLocaleDateString()}
                    </span>
                    <span style={{ fontSize: 12, color: '#475569', flex: 1 }}>
                      Run {run.id.slice(0,8)} · {rows.toLocaleString()} records
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>{fmt(amt, currency)}</span>
                    <button style={{ ...BTN_PRIMARY, height: 26, fontSize: 11, padding: '0 10px' }}
                      onClick={() => logRun(run.id, rows)} disabled={saving || isExcluded}>
                      Log
                    </button>
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button style={BTN_PRIMARY} onClick={logAllPending} disabled={saving}>
                  <Check size={12} /> Log All Included ({pendingRuns.filter(r => !excluded.has(r.id)).length})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Manual log run */}
      <div style={{ backgroundColor: '#F8FAFC', borderRadius: 6, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Log a Run Manually</div>
        <div style={{ display: 'grid', gridTemplateColumns: trackR ? '1fr 2fr' : '1fr', gap: 12 }}>
          {trackR && (
            <label style={LABEL}>
              Records Processed
              <input style={INPUT} type="number" value={recordCount} onChange={e => setRecordCount(e.target.value)} placeholder="0" />
            </label>
          )}
          <label style={LABEL}>
            Notes
            <input style={INPUT} value={eventNotes} onChange={e => setEventNotes(e.target.value)} placeholder="Optional run description" />
          </label>
        </div>
        {computedAmount > 0 && (
          <div style={{ fontSize: 12, color: '#7C3AED', margin: '8px 0 2px 0' }}>
            Computed value: {fmt(vpr, currency)} per run{trackR && vprec > 0 ? ` + ${recordCount || 0} × ${fmt(vprec, currency)} = ` : ' = '}
            <strong>{fmt(computedAmount, currency)}</strong>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            style={{ ...BTN_PRIMARY, opacity: saving || computedAmount <= 0 ? 0.6 : 1 }}
            onClick={() => logRun()} disabled={saving || computedAmount <= 0}>
            <TrendingUp size={13} /> Log Value
          </button>
        </div>
      </div>

      {/* Event history */}
      {events.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {events.map(e => (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', padding: '10px 0',
                borderBottom: '1px solid #F1F5F9', gap: 12,
              }}>
                <Clock size={12} style={{ color: '#94A3B8', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#94A3B8', width: 100, flexShrink: 0 }}>
                  {new Date(e.occurred_at).toLocaleDateString()}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#059669', width: 120, flexShrink: 0 }}>
                  +{fmt(e.amount, currency)}
                </span>
                <span style={{ fontSize: 12, color: '#475569', flex: 1 }}>{e.notes || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Use Case Detail Panel ─────────────────────────────────────────────────────

const UseCaseDetail: React.FC<{
  useCase: UseCase; onClose: () => void; onUpdate: () => void;
}> = ({ useCase, onClose, onUpdate }) => {
  const [tab, setTab] = useState<'identify' | 'frame' | 'realize'>('identify');
  const [events, setEvents] = useState<ValueEvent[]>([]);
  const [timeline, setTimeline] = useState<{ month: string; realized: number }[]>([]);
  const [framedInput, setFramedInput] = useState(String(useCase.framed_value || ''));
  const [ipct, setIpct] = useState(String(useCase.improvement_potential_pct || '0'));
  const [saving, setSaving] = useState(false);

  const currency = useCase.currency || 'USD';
  const computedValue = useCase.identified_value * (parseFloat(ipct) / 100 || 1);

  const loadEvents = useCallback(async () => {
    const [evtsRes, tlRes] = await Promise.all([
      apiFetch(`/value/use-cases/${useCase.id}/events`),
      apiFetch(`/value/timeline?category_id=${useCase.category_id}`),
    ]);
    setEvents(evtsRes?.items || []);
    setTimeline(tlRes?.items || []);
  }, [useCase.id, useCase.category_id]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const saveFrame = async () => {
    setSaving(true);
    try {
      await apiFetch(`/value/use-cases/${useCase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          framed_value: parseFloat(framedInput || '0'),
          improvement_potential_pct: parseFloat(ipct || '0'),
          status: 'framed',
        }),
      });
      onUpdate();
    } finally { setSaving(false); }
  };

  const sc = statusColor(useCase.status);

  return (
    <div style={OVERLAY}>
      <div style={{ ...MODAL, width: 780, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ ...MODAL_HDR, gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#0D1117' }}>{useCase.name}</span>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                backgroundColor: sc.bg, color: sc.text, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{useCase.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
              {useCase.category_name} · {sourceLabel(useCase.source_type)}
            </div>
          </div>
          <button onClick={onClose} style={ICON_BTN}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', padding: '0 24px' }}>
          {(['identify', 'frame', 'realize'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#0D1117' : '#64748B',
              borderBottom: tab === t ? '2px solid #7C3AED' : '2px solid transparent',
              background: 'none', border: 'none', borderRadius: 0, cursor: 'pointer',
              marginBottom: -1,
            }}>
              {t === 'identify' ? 'Identify Value' : t === 'frame' ? 'Frame Value' : 'Realize Value'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* ── Identify tab ── */}
          {tab === 'identify' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Value cards row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={VALUE_CARD}>
                  <div style={VALUE_CARD_LABEL}>Identified Value</div>
                  <div style={{ ...BIG_NUM, color: '#7C3AED' }}>{fmt(useCase.identified_value, currency)}</div>
                </div>
                <div style={VALUE_CARD}>
                  <div style={VALUE_CARD_LABEL}>Adjusted Estimate</div>
                  <div style={BIG_NUM}>{fmt(computedValue, currency)}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>at {ipct}% improvement potential</div>
                </div>
              </div>

              {/* Adjust parameters */}
              <div style={{ backgroundColor: '#F8FAFC', borderRadius: 6, padding: '16px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
                  Adjust Parameters
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={LABEL}>
                    Improvement Potential %
                    <input style={INPUT} type="number" value={ipct} onChange={e => setIpct(e.target.value)} />
                  </label>
                  <label style={LABEL}>
                    Base Identified Value ({currency})
                    <input style={{ ...INPUT, color: '#94A3B8' }} type="number" value={useCase.identified_value} readOnly />
                  </label>
                </div>
                {useCase.formula_description && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#475569', padding: '8px 12px', backgroundColor: '#EFF6FF', borderRadius: 4 }}>
                    <strong>Formula:</strong> {useCase.formula_description}
                  </div>
                )}
              </div>

              {/* Development over time */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Realized Value Over Time</div>
                {timeline.length === 0 ? (
                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12, backgroundColor: '#F8FAFC', borderRadius: 6 }}>
                    No realized events yet — log value in the Realize tab
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={timeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={v => fmt(v, '')} />
                      <Tooltip formatter={(v: unknown) => [fmt(Number(v ?? 0), currency), 'Realized']} />
                      <Bar dataKey="realized" fill="#7C3AED" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* ── Frame tab ── */}
          {tab === 'frame' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={VALUE_CARD}>
                <div style={VALUE_CARD_LABEL}>Currently Framed</div>
                <div style={{ ...BIG_NUM, color: useCase.framed_value > 0 ? '#2563EB' : '#CBD5E1' }}>
                  {fmt(useCase.framed_value, currency)}
                </div>
              </div>
              <div style={{ backgroundColor: '#F8FAFC', borderRadius: 6, padding: '20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Set Framed Value</div>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
                  Framing a value means you're committing to target this amount. It will appear as your goal in summary dashboards.
                </div>
                <label style={LABEL}>
                  Framed Value ({currency})
                  <input style={INPUT} type="number" value={framedInput} onChange={e => setFramedInput(e.target.value)}
                    placeholder={`Max ${fmt(useCase.identified_value, currency)}`} />
                </label>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                  Identified value: {fmt(useCase.identified_value, currency)} · Improvement potential: {ipct}%
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }} onClick={saveFrame} disabled={saving}>
                  <Check size={13} /> {saving ? 'Saving…' : 'Confirm Framed Value'}
                </button>
              </div>
            </div>
          )}

          {/* ── Realize tab ── */}
          {tab === 'realize' && (
            <RealizeTab
              useCase={useCase}
              currency={currency}
              events={events}
              saving={saving}
              setSaving={setSaving}
              onReload={loadEvents}
              onUpdate={onUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main ValuePage ─────────────────────────────────────────────────────────────

const ValuePage: React.FC = () => {
  const [summary, setSummary] = useState<{
    currency: string; total_identified: number; total_framed: number; total_realized: number;
    categories: Category[];
  } | null>(null);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddUseCase, setShowAddUseCase] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, ucs] = await Promise.all([
        apiFetch('/value/summary'),
        apiFetch('/value/use-cases'),
      ]);
      setSummary(sum ?? { currency: 'USD', total_identified: 0, total_framed: 0, total_realized: 0, categories: [] });
      setUseCases(ucs?.items || []);
      if (!selectedCategory && sum?.categories?.length > 0) {
        setSelectedCategory(sum.categories[0].id);
      }
    } catch (e) {
      console.error('Value load error', e);
      setSummary({ currency: 'USD', total_identified: 0, total_framed: 0, total_realized: 0, categories: [] });
    } finally { setLoading(false); }
  }, [selectedCategory]);

  useEffect(() => { load(); }, []);

  const filteredUseCases = selectedCategory
    ? useCases.filter(u => u.category_id === selectedCategory)
    : useCases;

  const currency = summary?.currency || 'USD';
  const activeCategory = summary?.categories.find(c => c.id === selectedCategory);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#F8FAFC' }}>
      {/* Page header */}
      <div style={{
        padding: '20px 28px 0 28px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0D1117', margin: 0 }}>Value Monitor</h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: '3px 0 0 0' }}>
              Track identified, framed, and realized value across all use cases
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN_GHOST} onClick={() => setShowAddCategory(true)}>
              <Plus size={13} /> New Category
            </button>
            <button style={BTN_PRIMARY} onClick={() => setShowAddUseCase(true)}
              disabled={!summary?.categories?.length}>
              <Plus size={13} /> New Use Case
            </button>
          </div>
        </div>

        {/* Category summary cards */}
        {loading ? (
          <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>Loading…</div>
        ) : summary?.categories.length === 0 ? (
          <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#94A3B8' }}>No categories yet.</span>
            <button style={{ fontSize: 13, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => setShowAddCategory(true)}>Create one →</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(summary!.categories.length, 3)}, 1fr)`, gap: 1, marginLeft: -28, marginRight: -28 }}>
            {summary!.categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                padding: '16px 28px 20px 28px',
                borderBottom: selectedCategory === cat.id ? `2px solid ${cat.color}` : '2px solid transparent',
                borderRight: '1px solid #F1F5F9',
                transition: 'background 80ms',
              }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{cat.name}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>View <ChevronRight size={11} /></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: cat.color, lineHeight: 1.1 }}>
                      {fmt(cat.total_framed, cat.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Total framed value</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0D1117', lineHeight: 1.1 }}>
                      {fmt(cat.total_identified, cat.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Total identified value</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Category tabs */}
        {summary && summary.categories.length > 0 && (
          <div style={{ display: 'flex', gap: 0, marginLeft: -28, marginRight: -28, marginTop: 0 }}>
            {summary.categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={{
                padding: '10px 20px', fontSize: 12, fontWeight: selectedCategory === cat.id ? 600 : 400,
                color: selectedCategory === cat.id ? '#0D1117' : '#64748B',
                background: 'none', border: 'none', borderBottom: selectedCategory === cat.id ? `2px solid ${cat.color}` : '2px solid transparent',
                cursor: 'pointer', marginBottom: -1,
              }}>{cat.name}</button>
            ))}
          </div>
        )}
      </div>

      {/* Use cases list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 32px 0' }}>
        {filteredUseCases.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: '#94A3B8' }}>
            <BarChart2 size={32} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {summary?.categories.length === 0 ? 'Create a category to get started' : 'No use cases in this category yet'}
            </div>
            {summary && summary.categories.length > 0 && (
              <button style={{ fontSize: 12, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => setShowAddUseCase(true)}>+ Add a use case</button>
            )}
          </div>
        ) : (
          <div>
            {filteredUseCases.map((uc, i) => {
              const sc = statusColor(uc.status);
              return (
                <div key={uc.id} style={{
                  display: 'grid', gridTemplateColumns: '180px 200px 1fr 120px',
                  alignItems: 'center', padding: '16px 28px', gap: 16,
                  borderBottom: '1px solid #F1F5F9', backgroundColor: '#FFFFFF',
                  transition: 'background 60ms',
                }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FAFBFC')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}>
                  {/* Framed value */}
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: uc.framed_value > 0 ? '#2563EB' : '#CBD5E1', lineHeight: 1 }}>
                      {fmt(uc.framed_value, uc.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>Framed value</div>
                  </div>
                  {/* Identified value */}
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#374151', lineHeight: 1 }}>
                      {fmt(uc.identified_value, uc.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>Identified value</div>
                  </div>
                  {/* Name + status */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 2 }}>{uc.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 10,
                        backgroundColor: sc.bg, color: sc.text, fontWeight: 600, letterSpacing: '0.04em',
                      }}>{uc.status.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>{sourceLabel(uc.source_type)}</span>
                      {uc.realized_value > 0 && (
                        <span style={{ fontSize: 11, color: '#059669' }}>· {fmt(uc.realized_value, uc.currency)} realized</span>
                      )}
                    </div>
                  </div>
                  {/* View button */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setSelectedUseCase(uc)} style={{
                      height: 30, padding: '0 14px', borderRadius: 4,
                      border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
                      fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500,
                    }}>View</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddCategory && (
        <AddCategoryModal onClose={() => setShowAddCategory(false)} onSave={() => { setShowAddCategory(false); load(); }} />
      )}
      {showAddUseCase && summary && (
        <AddUseCaseModal
          categories={summary.categories}
          defaultCategoryId={selectedCategory || undefined}
          onClose={() => setShowAddUseCase(false)}
          onSave={() => { setShowAddUseCase(false); load(); }}
        />
      )}
      {selectedUseCase && (
        <UseCaseDetail
          useCase={selectedUseCase}
          onClose={() => setSelectedUseCase(null)}
          onUpdate={() => { load(); }}
        />
      )}
    </div>
  );
};

export default ValuePage;

// ── Shared styles ─────────────────────────────────────────────────────────────
const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const MODAL: React.CSSProperties = {
  backgroundColor: '#FFFFFF', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const MODAL_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 24px', borderBottom: '1px solid #E2E8F0', flexShrink: 0,
};
const MODAL_FTR: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 24px', borderTop: '1px solid #E2E8F0', flexShrink: 0,
};
const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
  borderRadius: 4, color: '#64748B', display: 'flex', alignItems: 'center',
};
const LABEL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 12, fontWeight: 500, color: '#374151',
};
const INPUT: React.CSSProperties = {
  height: 32, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4,
  fontSize: 13, color: '#0D1117', backgroundColor: '#FFFFFF', outline: 'none',
};
const BTN_PRIMARY: React.CSSProperties = {
  height: 32, padding: '0 14px', borderRadius: 4, border: 'none',
  backgroundColor: '#7C3AED', color: '#FFFFFF', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
};
const BTN_GHOST: React.CSSProperties = {
  height: 32, padding: '0 12px', borderRadius: 4, border: '1px solid #E2E8F0',
  backgroundColor: '#FFFFFF', color: '#374151', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
};
const VALUE_CARD: React.CSSProperties = {
  backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '16px 20px',
};
const VALUE_CARD_LABEL: React.CSSProperties = {
  fontSize: 12, color: '#64748B', marginBottom: 6,
};
const BIG_NUM: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, color: '#0D1117', lineHeight: 1, letterSpacing: '-0.02em',
};
