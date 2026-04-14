import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlaskConical, Plus, Play, Trash2, ChevronRight, ChevronDown,
  CheckCircle2, XCircle, Loader2, BarChart2, Settings2,
  ArrowLeft, RefreshCw, Sparkles, Beaker, TestTube2, Grid3X3,
  ClipboardList, AlertTriangle, Trophy,
} from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const EVAL_API = import.meta.env.VITE_EVAL_SERVICE_URL || 'http://localhost:8016';
const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';
const LOGIC_API = import.meta.env.VITE_LOGIC_SERVICE_URL || 'http://localhost:8012';

// ── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  hover: '#F1F5F9', success: '#059669', successLight: '#ECFDF5',
  warning: '#D97706', warningLight: '#FFFBEB',
  error: '#DC2626', errorLight: '#FEF2F2',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface EvaluatorConfig { type: string; weight: number; config: Record<string, unknown>; }
interface Suite {
  id: string; name: string; description?: string;
  target_type: string; target_id: string; target_name?: string;
  evaluator_configs: EvaluatorConfig[];
  pass_threshold: number; case_count: number;
  last_run?: { id: string; summary: RunSummary; started_at: string } | null;
  created_at: string;
}
interface TestCase {
  id: string; suite_id: string; name: string;
  inputs: Record<string, unknown>;
  expected_outputs: Record<string, unknown> | null;
  tags: string[];
}
interface RunSummary { pass_rate: number; avg_score: number; passed: number; failed: number; total: number; }
interface CaseResult {
  case_id: string; case_name: string; passed: boolean; score: number;
  output: unknown; execution_error?: string;
  evaluator_details: { type: string; score: number; passed: boolean; weight: number; details: Record<string, unknown> }[];
}
interface Run {
  id: string; suite_id: string; status: string;
  config_overrides: Record<string, unknown>;
  results: CaseResult[]; summary?: RunSummary; error?: string;
  started_at: string; completed_at?: string;
}
interface Experiment {
  id: string; suite_id: string; name: string;
  param_grid: Record<string, unknown[]>;
  run_ids: string[]; best_run_id?: string; status: string;
  comparison?: { run_id: string; config_overrides: Record<string, unknown>; status: string; summary?: RunSummary; is_best: boolean }[];
}

// ── API helpers ───────────────────────────────────────────────────────────────
const headers = () => ({ 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() });

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${EVAL_API}${path}`, { headers: headers(), ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
  if (r.status === 204) return null;
  return r.json();
}

// ── Shared UI atoms ──────────────────────────────────────────────────────────
const Btn: React.FC<{ onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; children: React.ReactNode; style?: React.CSSProperties }> = ({
  onClick, disabled, variant = 'primary', size = 'md', children, style,
}) => {
  const bg = disabled ? C.border : variant === 'primary' ? C.accent : variant === 'success' ? C.success : variant === 'danger' ? C.error : 'transparent';
  const color = disabled ? C.muted : (variant === 'ghost' || variant === 'danger' && !disabled) ? (variant === 'danger' ? C.error : C.muted) : '#fff';
  const border = variant === 'ghost' ? `1px solid ${C.border}` : variant === 'danger' ? `1px solid ${C.error}` : 'none';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: size === 'sm' ? '4px 10px' : '0 16px',
      height: size === 'sm' ? 28 : 34,
      borderRadius: 6, border, cursor: disabled ? 'not-allowed' : 'pointer',
      backgroundColor: bg, color, fontSize: size === 'sm' ? 12 : 13,
      fontWeight: 600, transition: 'all 120ms', ...style,
    }}>{children}</button>
  );
};

const ScoreBadge: React.FC<{ score: number; passed: boolean; size?: 'sm' | 'lg' }> = ({ score, passed, size = 'sm' }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: size === 'lg' ? '4px 10px' : '2px 6px',
    borderRadius: 10, fontSize: size === 'lg' ? 13 : 11, fontWeight: 700,
    backgroundColor: passed ? C.successLight : C.errorLight,
    color: passed ? C.success : C.error,
  }}>
    {passed ? <CheckCircle2 size={size === 'lg' ? 13 : 10} /> : <XCircle size={size === 'lg' ? 13 : 10} />}
    {(score * 100).toFixed(0)}%
  </span>
);

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 10px', borderRadius: 6, fontSize: 13,
  border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text,
  outline: 'none', width: '100%',
};

const textareaStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
  border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text,
  outline: 'none', resize: 'vertical', fontFamily: 'var(--font-mono, monospace)',
  width: '100%',
};

// ── Evaluator type metadata ───────────────────────────────────────────────────
const EVALUATOR_META: Record<string, { label: string; description: string; color: string; configFields: { key: string; label: string; type: 'text' | 'number' | 'textarea' | 'boolean' }[] }> = {
  exact_match: {
    label: 'Exact Match', description: 'String equality comparison',
    color: '#2563EB',
    configFields: [
      { key: 'field', label: 'Output field (optional)', type: 'text' },
      { key: 'case_sensitive', label: 'Case sensitive', type: 'boolean' },
    ],
  },
  json_schema_match: {
    label: 'JSON Schema', description: 'Output must conform to a JSON schema',
    color: '#7C3AED',
    configFields: [{ key: 'schema', label: 'JSON Schema (paste object)', type: 'textarea' }],
  },
  rouge_score: {
    label: 'ROUGE-L', description: 'Text similarity (longest common subsequence)',
    color: '#0891B2',
    configFields: [
      { key: 'field', label: 'Output field (optional)', type: 'text' },
      { key: 'min_score', label: 'Minimum score (0–1)', type: 'number' },
    ],
  },
  contains_key_details: {
    label: 'Key Details (Claude)', description: 'Claude checks if output contains required facts',
    color: C.warning,
    configFields: [{ key: 'key_details', label: 'Required details (one per line)', type: 'textarea' }],
  },
  custom_expression: {
    label: 'Custom Expression', description: 'Python expression: output, expected are available',
    color: '#059669',
    configFields: [{ key: 'expression', label: 'Python expression', type: 'textarea' }],
  },
};

// ── Suite List ────────────────────────────────────────────────────────────────
const SuiteList: React.FC<{ onSelect: (s: Suite) => void; onCreate: () => void }> = ({ onSelect, onCreate }) => {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/suites').then(setSuites).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.subtle }}><Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite' }} /></div>;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Eval Suites</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Test and measure every AI output before trusting it in production</div>
        </div>
        <Btn onClick={onCreate}><Plus size={14} /> New Suite</Btn>
      </div>

      {suites.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.subtle }}>
          <TestTube2 size={36} color={C.border} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>No eval suites yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create your first suite to start testing your agents and logic functions</div>
          <Btn onClick={onCreate} style={{ marginTop: 16 }}><Plus size={14} /> Create First Suite</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {suites.map((s) => {
            const passRate = s.last_run?.summary?.pass_rate;
            return (
              <div
                key={s.id}
                onClick={() => onSelect(s)}
                style={{
                  padding: 18, backgroundColor: C.panel, border: `1px solid ${C.border}`,
                  borderRadius: 10, cursor: 'pointer', transition: 'all 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{s.name}</div>
                    {s.description && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.description}</div>}
                  </div>
                  {passRate !== undefined && passRate !== null && (
                    <span style={{
                      fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                      backgroundColor: passRate >= s.pass_threshold ? C.successLight : C.errorLight,
                      color: passRate >= s.pass_threshold ? C.success : C.error,
                    }}>
                      {(passRate * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: C.accentLight, color: C.accent, fontWeight: 600 }}>
                    {s.target_type.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: 11, color: C.subtle }}>{s.case_count} case{s.case_count !== 1 ? 's' : ''}</span>
                  {s.last_run && <span style={{ fontSize: 11, color: C.subtle }}>{s.last_run.summary.passed}/{s.last_run.summary.total} passed</span>}
                  {!s.last_run && <span style={{ fontSize: 11, color: C.subtle, fontStyle: 'italic' }}>never run</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: C.subtle }}>threshold {(s.pass_threshold * 100).toFixed(0)}%</span>
                  <ChevronRight size={14} color={C.subtle} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Suite Editor ──────────────────────────────────────────────────────────────
const SuiteEditor: React.FC<{
  suite?: Suite; onSave: (s: Suite) => void; onCancel: () => void;
}> = ({ suite, onSave, onCancel }) => {
  const isEdit = !!suite;
  const [name, setName] = useState(suite?.name || '');
  const [description, setDescription] = useState(suite?.description || '');
  const [targetType, setTargetType] = useState(suite?.target_type || 'agent');
  const [targetId, setTargetId] = useState(suite?.target_id || '');
  const [targetName, setTargetName] = useState(suite?.target_name || '');
  const [threshold, setThreshold] = useState(suite?.pass_threshold ?? 0.7);
  const [evaluators, setEvaluators] = useState<EvaluatorConfig[]>(
    suite?.evaluator_configs || [{ type: 'contains_key_details', weight: 1.0, config: {} }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Agents/functions lists for picker
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [functions, setFunctions] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch(`${AGENT_API}/agents`, { headers: headers() })
      .then(r => r.json()).then(d => setAgents(Array.isArray(d) ? d : d.agents || [])).catch(() => {});
    fetch(`${LOGIC_API}/logic/functions`, { headers: headers() })
      .then(r => r.json()).then(d => setFunctions(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const targets = targetType === 'agent' ? agents : functions;

  const addEvaluator = () => setEvaluators(v => [...v, { type: 'exact_match', weight: 1.0, config: {} }]);
  const removeEvaluator = (i: number) => setEvaluators(v => v.filter((_, idx) => idx !== i));
  const updateEvaluator = (i: number, patch: Partial<EvaluatorConfig>) =>
    setEvaluators(v => v.map((e, idx) => idx === i ? { ...e, ...patch } : e));

  const updateEvalConfig = (i: number, key: string, value: unknown) => {
    setEvaluators(v => v.map((e, idx) => {
      if (idx !== i) return e;
      const newCfg = { ...e.config };
      if (key === 'key_details' && typeof value === 'string') {
        newCfg[key] = value.split('\n').filter(Boolean);
      } else if (key === 'schema' && typeof value === 'string') {
        try { newCfg[key] = JSON.parse(value); } catch { newCfg[key] = value; }
      } else {
        newCfg[key] = value;
      }
      return { ...e, config: newCfg };
    }));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!targetId.trim()) { setError('Target is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { name, description, target_type: targetType, target_id: targetId, target_name: targetName, evaluator_configs: evaluators, pass_threshold: threshold };
      const saved = isEdit
        ? await apiFetch(`/suites/${suite!.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiFetch('/suites', { method: 'POST', body: JSON.stringify(payload) });
      onSave(saved);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}><ArrowLeft size={16} /></button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{isEdit ? 'Edit Suite' : 'New Eval Suite'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: suite config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>Suite Configuration</div>

          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Denuncias Agent — Regression Suite" style={inputStyle} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this suite test?" style={inputStyle} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Target Type *</label>
            <select value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(''); setTargetName(''); }} style={{ ...inputStyle, height: 32 }}>
              <option value="agent">Agent</option>
              <option value="logic_function">Logic Function</option>
              <option value="logic_flow">Logic Flow</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Target *</label>
            {targets.length > 0 ? (
              <select value={targetId} onChange={e => {
                setTargetId(e.target.value);
                const t = targets.find(t => t.id === e.target.value);
                setTargetName(t?.name || '');
              }} style={{ ...inputStyle, height: 32 }}>
                <option value="">Select {targetType.replace('_', ' ')}…</option>
                {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <input value={targetId} onChange={e => setTargetId(e.target.value)} placeholder={`Enter ${targetType} ID`} style={inputStyle} />
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Pass Threshold: <strong>{(threshold * 100).toFixed(0)}%</strong></label>
            <input type="range" min={0} max={1} step={0.05} value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.subtle }}>
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
        </div>

        {/* Right: evaluators */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Evaluators</div>
            <Btn size="sm" variant="ghost" onClick={addEvaluator}><Plus size={11} /> Add</Btn>
          </div>

          {evaluators.map((ev, i) => {
            const meta = EVALUATOR_META[ev.type];
            return (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: C.hover }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: meta?.color || C.accent, flexShrink: 0 }} />
                  <select value={ev.type} onChange={e => updateEvaluator(i, { type: e.target.value, config: {} })}
                    style={{ ...inputStyle, height: 26, flex: 1, fontSize: 12 }}>
                    {Object.entries(EVALUATOR_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted }}>
                    <span>×</span>
                    <input type="number" min={0.1} max={5} step={0.1} value={ev.weight}
                      onChange={e => updateEvaluator(i, { weight: parseFloat(e.target.value) || 1.0 })}
                      style={{ ...inputStyle, height: 24, width: 50, fontSize: 11 }} />
                  </div>
                  <button onClick={() => removeEvaluator(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, padding: 2 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: C.subtle }}>{meta?.description}</div>
                  {meta?.configFields.map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 2 }}>{f.label}</label>
                      {f.type === 'textarea' ? (
                        <textarea rows={3}
                          value={f.key === 'key_details'
                            ? (Array.isArray(ev.config[f.key]) ? (ev.config[f.key] as string[]).join('\n') : String(ev.config[f.key] || ''))
                            : f.key === 'schema' ? (typeof ev.config[f.key] === 'object' ? JSON.stringify(ev.config[f.key], null, 2) : String(ev.config[f.key] || ''))
                            : String(ev.config[f.key] || '')}
                          onChange={e => updateEvalConfig(i, f.key, e.target.value)}
                          style={{ ...textareaStyle, fontSize: 11 }}
                          placeholder={f.key === 'key_details' ? 'contains count of open cases\nincludes San Salvador\nmentions priority level' : ''}
                        />
                      ) : f.type === 'boolean' ? (
                        <input type="checkbox" checked={!!ev.config[f.key]}
                          onChange={e => updateEvalConfig(i, f.key, e.target.checked)} />
                      ) : (
                        <input type={f.type} value={String(ev.config[f.key] || '')}
                          onChange={e => updateEvalConfig(i, f.key, f.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                          style={{ ...inputStyle, height: 26, fontSize: 11 }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {evaluators.length === 0 && (
            <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
              No evaluators — add at least one
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <Btn onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Saving…</> : isEdit ? 'Save Changes' : 'Create Suite'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        {error && <span style={{ fontSize: 12, color: C.error }}>{error}</span>}
      </div>
    </div>
  );
};

// ── Test Case Table ───────────────────────────────────────────────────────────
const TestCaseTable: React.FC<{ suiteId: string }> = ({ suiteId }) => {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCase, setNewCase] = useState({ name: '', inputs: '{}', expected_outputs: '{}', tags: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', inputs: '', expected_outputs: '', tags: '' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/suites/${suiteId}/cases`).then(setCases).catch(console.error).finally(() => setLoading(false));
  }, [suiteId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setError('');
    try {
      await apiFetch(`/suites/${suiteId}/cases`, {
        method: 'POST',
        body: JSON.stringify({
          name: newCase.name,
          inputs: JSON.parse(newCase.inputs || '{}'),
          expected_outputs: JSON.parse(newCase.expected_outputs || '{}'),
          tags: newCase.tags ? newCase.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        }),
      });
      setNewCase({ name: '', inputs: '{}', expected_outputs: '{}', tags: '' });
      setAdding(false);
      load();
    } catch (e) { setError((e as Error).message); }
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/cases/${id}`, { method: 'DELETE' });
    load();
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await apiFetch(`/cases/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editData.name,
          inputs: JSON.parse(editData.inputs || '{}'),
          expected_outputs: JSON.parse(editData.expected_outputs || '{}'),
          tags: editData.tags ? editData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        }),
      });
      setEditId(null);
      load();
    } catch (e) { setError((e as Error).message); }
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: C.subtle }}><Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /></div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cases.length} Test Case{cases.length !== 1 ? 's' : ''}</div>
        <Btn size="sm" onClick={() => setAdding(true)}><Plus size={11} /> Add Case</Btn>
      </div>

      {error && <div style={{ fontSize: 12, color: C.error, marginBottom: 8 }}>{error}</div>}

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: C.hover }}>
              {['Name', 'Inputs', 'Expected', 'Tags', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cases.map((c, idx) => (
              editId === c.id ? (
                <tr key={c.id} style={{ backgroundColor: '#FAFBFF' }}>
                  <td style={{ padding: '6px 12px' }}>
                    <input value={editData.name} onChange={e => setEditData(v => ({ ...v, name: e.target.value }))} style={{ ...inputStyle, height: 26 }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <textarea value={editData.inputs} onChange={e => setEditData(v => ({ ...v, inputs: e.target.value }))} rows={3} style={{ ...textareaStyle, fontSize: 11 }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <textarea value={editData.expected_outputs} onChange={e => setEditData(v => ({ ...v, expected_outputs: e.target.value }))} rows={3} style={{ ...textareaStyle, fontSize: 11 }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input value={editData.tags} onChange={e => setEditData(v => ({ ...v, tags: e.target.value }))} placeholder="tag1, tag2" style={{ ...inputStyle, height: 26 }} />
                  </td>
                  <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                    <Btn size="sm" onClick={() => handleSaveEdit(c.id)}>Save</Btn>
                    <button onClick={() => setEditId(null)} style={{ marginLeft: 6, fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id} style={{ borderTop: idx > 0 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500, color: C.text }}>{c.name}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 200 }}>
                    <code style={{ fontSize: 10, color: C.muted, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {JSON.stringify(c.inputs)}
                    </code>
                  </td>
                  <td style={{ padding: '8px 12px', maxWidth: 200 }}>
                    <code style={{ fontSize: 10, color: C.muted, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.expected_outputs ? JSON.stringify(c.expected_outputs) : '—'}
                    </code>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 8, backgroundColor: C.accentLight, color: C.accent }}>{t}</span>)}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => { setEditId(c.id); setEditData({ name: c.name, inputs: JSON.stringify(c.inputs, null, 2), expected_outputs: JSON.stringify(c.expected_outputs || {}, null, 2), tags: c.tags.join(', ') }); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, marginRight: 4 }}>
                      <Settings2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              )
            ))}

            {adding && (
              <tr style={{ borderTop: `1px solid ${C.border}`, backgroundColor: '#FAFBFF' }}>
                <td style={{ padding: '6px 12px' }}>
                  <input value={newCase.name} onChange={e => setNewCase(v => ({ ...v, name: e.target.value }))} placeholder="Case name" style={{ ...inputStyle, height: 26 }} />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <textarea value={newCase.inputs} onChange={e => setNewCase(v => ({ ...v, inputs: e.target.value }))} rows={3} style={{ ...textareaStyle, fontSize: 11 }} placeholder='{"message": "..."}' />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <textarea value={newCase.expected_outputs} onChange={e => setNewCase(v => ({ ...v, expected_outputs: e.target.value }))} rows={3} style={{ ...textareaStyle, fontSize: 11 }} placeholder='{"key_details": ["..."]}' />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <input value={newCase.tags} onChange={e => setNewCase(v => ({ ...v, tags: e.target.value }))} placeholder="tag1, tag2" style={{ ...inputStyle, height: 26 }} />
                </td>
                <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                  <Btn size="sm" onClick={handleAdd}>Add</Btn>
                  <button onClick={() => setAdding(false)} style={{ marginLeft: 6, fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                </td>
              </tr>
            )}

            {cases.length === 0 && !adding && (
              <tr>
                <td colSpan={5} style={{ padding: '24px 12px', textAlign: 'center', color: C.subtle, fontSize: 12, fontStyle: 'italic' }}>
                  No test cases yet — add your first case above
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Run Results View ──────────────────────────────────────────────────────────
const RunResultsView: React.FC<{ runId: string; onBack: () => void }> = ({ runId, onBack }) => {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [showFailuresOnly, setShowFailuresOnly] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/runs/${runId}`);
      setRun(data);
      if (data.status === 'complete' || data.status === 'failed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [runId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  if (loading || !run) return (
    <div style={{ padding: 40, textAlign: 'center', color: C.subtle }}>
      <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite' }} />
      <div style={{ marginTop: 8, fontSize: 13 }}>Running evaluations…</div>
    </div>
  );

  const s = run.summary;
  const visibleResults = showFailuresOnly ? run.results.filter(r => !r.passed) : run.results;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}><ArrowLeft size={16} /></button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Run Results</div>
        {run.status === 'running' && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.warning }}><Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> Running…</span>}
        {run.status === 'complete' && <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>Complete</span>}
        {run.status === 'failed' && <span style={{ fontSize: 12, color: C.error, fontWeight: 600 }}>Failed</span>}
      </div>

      {run.status === 'failed' && run.error && (
        <div style={{ padding: 12, backgroundColor: C.errorLight, border: `1px solid #FECACA`, borderRadius: 6, marginBottom: 16, fontSize: 12, color: C.error }}>
          <strong>Error:</strong> {run.error}
        </div>
      )}

      {/* Summary bar */}
      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Pass Rate', value: `${(s.pass_rate * 100).toFixed(1)}%`, color: s.pass_rate >= 0.7 ? C.success : C.error, bg: s.pass_rate >= 0.7 ? C.successLight : C.errorLight },
            { label: 'Avg Score', value: `${(s.avg_score * 100).toFixed(1)}%`, color: C.text, bg: C.hover },
            { label: 'Passed', value: `${s.passed}/${s.total}`, color: C.success, bg: C.successLight },
            { label: 'Failed', value: `${s.failed}/${s.total}`, color: s.failed > 0 ? C.error : C.muted, bg: s.failed > 0 ? C.errorLight : C.hover },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '14px 16px', backgroundColor: stat.bg, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Overrides used */}
      {Object.keys(run.config_overrides || {}).length > 0 && (
        <div style={{ padding: '8px 12px', backgroundColor: C.accentLight, borderRadius: 6, marginBottom: 16, fontSize: 12, color: C.accent }}>
          <strong>Config overrides:</strong> {JSON.stringify(run.config_overrides)}
        </div>
      )}

      {/* Results table */}
      {run.results.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Case Results</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
              <input type="checkbox" checked={showFailuresOnly} onChange={e => setShowFailuresOnly(e.target.checked)} />
              Show failures only
            </label>
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {visibleResults.map((r, i) => (
              <div key={r.case_id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                <div
                  onClick={() => setExpandedCase(expandedCase === r.case_id ? null : r.case_id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', backgroundColor: expandedCase === r.case_id ? C.hover : C.panel }}
                >
                  {r.passed ? <CheckCircle2 size={16} color={C.success} /> : <XCircle size={16} color={C.error} />}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.text }}>{r.case_name}</span>
                  <ScoreBadge score={r.score} passed={r.passed} />
                  {expandedCase === r.case_id ? <ChevronDown size={14} color={C.subtle} /> : <ChevronRight size={14} color={C.subtle} />}
                </div>

                {expandedCase === r.case_id && (
                  <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}`, backgroundColor: '#FAFBFF' }}>
                    {r.execution_error && (
                      <div style={{ padding: '8px 10px', backgroundColor: C.errorLight, borderRadius: 6, fontSize: 12, color: C.error, marginBottom: 10 }}>
                        <strong>Execution error:</strong> {r.execution_error}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>OUTPUT</div>
                        <pre style={{ fontSize: 11, backgroundColor: C.bg, padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 160, margin: 0, color: C.text, border: `1px solid ${C.border}` }}>
                          {typeof r.output === 'string' ? r.output : JSON.stringify(r.output, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>EVALUATOR DETAILS</div>
                        {r.evaluator_details.map((ed, j) => {
                          const meta = EVALUATOR_META[ed.type];
                          return (
                            <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: meta?.color || C.accent, flexShrink: 0 }} />
                              <span style={{ color: C.muted, flex: 1 }}>{meta?.label || ed.type}</span>
                              <ScoreBadge score={ed.score} passed={ed.passed} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {visibleResults.length === 0 && (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: C.subtle, fontSize: 12 }}>
                {showFailuresOnly ? 'No failures — all cases passed!' : 'No results yet'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Experiment View ───────────────────────────────────────────────────────────
const ExperimentView: React.FC<{ suiteId: string }> = ({ suiteId }) => {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newExp, setNewExp] = useState({ name: '', paramGrid: '{\n  "model": ["claude-opus-4-6", "claude-haiku-4-5-20251001"]\n}' });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedExp, setSelectedExp] = useState<Experiment | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/experiments?suite_id=${suiteId}`)
      .then(setExperiments).catch(console.error).finally(() => setLoading(false));
  }, [suiteId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setError('');
    try {
      const grid = JSON.parse(newExp.paramGrid);
      await apiFetch('/experiments', { method: 'POST', body: JSON.stringify({ suite_id: suiteId, name: newExp.name, param_grid: grid }) });
      setCreating(false); setNewExp({ name: '', paramGrid: '{\n  "model": ["claude-opus-4-6", "claude-haiku-4-5-20251001"]\n}' });
      load();
    } catch (e) { setError((e as Error).message); }
  };

  const handleRun = async (id: string) => {
    setRunningId(id);
    try {
      await apiFetch(`/experiments/${id}/run`, { method: 'POST' });
      setTimeout(load, 2000);
    } catch (e) { setError((e as Error).message); } finally { setRunningId(null); }
  };

  const loadExp = async (id: string) => {
    const data = await apiFetch(`/experiments/${id}`);
    setSelectedExp(data);
  };

  if (selectedExp) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => setSelectedExp(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><ArrowLeft size={14} /></button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedExp.name}</div>
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: C.hover, color: C.muted }}>{selectedExp.status}</span>
      </div>
      {selectedExp.comparison && selectedExp.comparison.length > 0 ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: C.hover }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Parameters</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Pass Rate</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Avg Score</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {selectedExp.comparison.map((c, i) => (
                <tr key={c.run_id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none', backgroundColor: c.is_best ? C.successLight : 'transparent' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {Object.entries(c.config_overrides).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, backgroundColor: C.accentLight, color: C.accent, fontWeight: 500 }}>{k}: {String(v)}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {c.summary ? <ScoreBadge score={c.summary.pass_rate} passed={c.summary.pass_rate >= 0.7} /> : <span style={{ color: C.subtle }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 12px', color: C.muted }}>
                    {c.summary ? `${(c.summary.avg_score * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {c.is_best && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.success, fontWeight: 600 }}><Trophy size={12} /> Best</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: C.subtle, fontSize: 12 }}>
          {selectedExp.status === 'running' ? 'Experiment is running…' : 'No results yet — run the experiment to compare parameters'}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Experiments</div>
        <Btn size="sm" onClick={() => setCreating(true)}><Plus size={11} /> New Experiment</Btn>
      </div>

      {error && <div style={{ fontSize: 12, color: C.error, marginBottom: 8 }}>{error}</div>}

      {creating && (
        <div style={{ padding: 14, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>New Grid Search Experiment</div>
          <input value={newExp.name} onChange={e => setNewExp(v => ({ ...v, name: e.target.value }))} placeholder="Experiment name" style={inputStyle} />
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 3 }}>Parameter Grid (JSON)</label>
            <textarea value={newExp.paramGrid} onChange={e => setNewExp(v => ({ ...v, paramGrid: e.target.value }))} rows={5} style={textareaStyle} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={handleCreate}>Create</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: C.subtle }}><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /></div>
      ) : experiments.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: C.subtle, fontSize: 12 }}>
          No experiments yet. Create one to compare models, prompts, or temperatures side-by-side.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {experiments.map(exp => (
            <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: 8, backgroundColor: C.panel }}>
              <Grid3X3 size={14} color={C.accent} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{exp.name}</div>
                <div style={{ fontSize: 11, color: C.subtle, marginTop: 1 }}>
                  {Object.entries(exp.param_grid).map(([k, vs]) => `${k}: ${(vs as unknown[]).length} values`).join(' · ')}
                  {' · '}{exp.run_ids.length} run{exp.run_ids.length !== 1 ? 's' : ''}
                </div>
              </div>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 8, fontWeight: 600,
                backgroundColor: exp.status === 'complete' ? C.successLight : exp.status === 'running' ? C.warningLight : C.hover,
                color: exp.status === 'complete' ? C.success : exp.status === 'running' ? C.warning : C.muted,
              }}>{exp.status}</span>
              {exp.status === 'pending' && (
                <Btn size="sm" onClick={() => handleRun(exp.id)} disabled={runningId === exp.id}>
                  {runningId === exp.id ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Play size={11} />} Run
                </Btn>
              )}
              {exp.status === 'complete' && (
                <Btn size="sm" variant="ghost" onClick={() => loadExp(exp.id)}><BarChart2 size={11} /> Results</Btn>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Suite Detail Page ─────────────────────────────────────────────────────────
type SuiteTab = 'cases' | 'runs' | 'experiments' | 'settings';

const SuiteDetailPage: React.FC<{
  suite: Suite;
  onBack: () => void;
  onRunComplete: () => void;
}> = ({ suite, onBack, onRunComplete }) => {
  const [tab, setTab] = useState<SuiteTab>('cases');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [configOverrides, setConfigOverrides] = useState('{}');
  const [showRunConfig, setShowRunConfig] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentSuite, setCurrentSuite] = useState(suite);
  const [error, setError] = useState('');

  const loadRuns = useCallback(() => {
    setRunsLoading(true);
    apiFetch(`/suites/${currentSuite.id}/runs`).then(setRuns).catch(console.error).finally(() => setRunsLoading(false));
  }, [currentSuite.id]);

  useEffect(() => { if (tab === 'runs') loadRuns(); }, [tab, loadRuns]);

  const handleRun = async () => {
    setRunning(true); setError('');
    try {
      let overrides = {};
      try { overrides = JSON.parse(configOverrides); } catch { /**/ }
      const data = await apiFetch(`/suites/${currentSuite.id}/run`, { method: 'POST', body: JSON.stringify({ config_overrides: overrides }) });
      setRunId(data.run_id);
      setTab('runs');
      onRunComplete();
    } catch (e) { setError((e as Error).message); } finally { setRunning(false); }
  };

  if (runId) return <RunResultsView runId={runId} onBack={() => { setRunId(null); loadRuns(); }} />;
  if (editing) return <SuiteEditor suite={currentSuite} onSave={s => { setCurrentSuite(s); setEditing(false); }} onCancel={() => setEditing(false)} />;

  const targetMeta = EVALUATOR_META;
  const passRate = currentSuite.last_run?.summary?.pass_rate;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}><ArrowLeft size={16} /></button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{currentSuite.name}</div>
              {passRate !== undefined && passRate !== null && (
                <ScoreBadge score={passRate} passed={passRate >= currentSuite.pass_threshold} size="lg" />
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                {currentSuite.target_type.replace('_', ' ')} · {currentSuite.target_name || currentSuite.target_id.slice(0, 16) + '…'}
              </span>
              <span style={{ fontSize: 12, color: C.subtle }}>threshold {(currentSuite.pass_threshold * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={() => setEditing(true)}><Settings2 size={12} /> Edit</Btn>
            <div style={{ position: 'relative' }}>
              <Btn onClick={() => setShowRunConfig(v => !v)} disabled={running}>
                {running ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Running…</> : <><Play size={13} /> Run Suite</>}
              </Btn>
              {showRunConfig && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 280, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Config Overrides (optional)</div>
                  <textarea value={configOverrides} onChange={e => setConfigOverrides(e.target.value)} rows={3}
                    placeholder='{"model": "claude-opus-4-6"}' style={{ ...textareaStyle, marginBottom: 8 }} />
                  <Btn onClick={() => { setShowRunConfig(false); handleRun(); }} style={{ width: '100%', justifyContent: 'center' }}>
                    <Play size={12} /> Run Now
                  </Btn>
                  {error && <div style={{ fontSize: 11, color: C.error, marginTop: 6 }}>{error}</div>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 14 }}>
          {([['cases', 'Test Cases', ClipboardList], ['runs', 'Run History', BarChart2], ['experiments', 'Experiments', Grid3X3], ['settings', 'Evaluators', Beaker]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === id ? 600 : 500, color: tab === id ? C.accent : C.muted, backgroundColor: 'transparent', borderBottom: tab === id ? `2px solid ${C.accent}` : '2px solid transparent', transition: 'all 120ms' }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {tab === 'cases' && <TestCaseTable suiteId={currentSuite.id} />}

        {tab === 'runs' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Run History</div>
              <Btn size="sm" variant="ghost" onClick={loadRuns}><RefreshCw size={11} /> Refresh</Btn>
            </div>
            {runsLoading ? (
              <div style={{ textAlign: 'center', padding: 20, color: C.subtle }}><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /></div>
            ) : runs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: C.subtle, fontSize: 12 }}>No runs yet — click "Run Suite" to start</div>
            ) : (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ backgroundColor: C.hover }}>
                      {['Started', 'Status', 'Pass Rate', 'Avg Score', 'Passed/Total', 'Overrides', ''].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r, i) => (
                      <tr key={r.id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                        <td style={{ padding: '8px 12px', color: C.muted }}>{new Date(r.started_at).toLocaleString()}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, fontWeight: 600, backgroundColor: r.status === 'complete' ? C.successLight : r.status === 'running' ? C.warningLight : C.errorLight, color: r.status === 'complete' ? C.success : r.status === 'running' ? C.warning : C.error }}>{r.status}</span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>{r.summary ? <ScoreBadge score={r.summary.pass_rate} passed={r.summary.pass_rate >= currentSuite.pass_threshold} /> : '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.muted }}>{r.summary ? `${(r.summary.avg_score * 100).toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.muted }}>{r.summary ? `${r.summary.passed}/${r.summary.total}` : '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.subtle, fontSize: 11 }}>{Object.keys(r.config_overrides || {}).length > 0 ? JSON.stringify(r.config_overrides) : '—'}</td>
                        <td style={{ padding: '8px 12px' }}><button onClick={() => setRunId(r.id)} style={{ fontSize: 11, color: C.accent, background: 'none', border: 'none', cursor: 'pointer' }}>View →</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'experiments' && <ExperimentView suiteId={currentSuite.id} />}

        {tab === 'settings' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>Configured Evaluators</div>
            {currentSuite.evaluator_configs.length === 0 ? (
              <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic' }}>No evaluators — edit the suite to add some</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentSuite.evaluator_configs.map((ec, i) => {
                  const meta = EVALUATOR_META[ec.type];
                  const totalWeight = currentSuite.evaluator_configs.reduce((s, e) => s + e.weight, 0);
                  const pct = totalWeight > 0 ? (ec.weight / totalWeight * 100).toFixed(0) : '0';
                  return (
                    <div key={i} style={{ padding: 14, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: meta?.color || C.accent, marginTop: 3, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{meta?.label || ec.type}</span>
                          <span style={{ fontSize: 11, color: C.subtle }}>weight {ec.weight} ({pct}% of score)</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{meta?.description}</div>
                        {Object.keys(ec.config).length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            {Object.entries(ec.config).map(([k, v]) => (
                              <div key={k} style={{ fontSize: 11, color: C.subtle }}>
                                <strong>{k}:</strong> {Array.isArray(v) ? (v as string[]).join(', ') : String(v).slice(0, 80)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main EvalsPage ────────────────────────────────────────────────────────────
type EvalsView = 'list' | 'create' | 'detail';

const EvalsPage: React.FC = () => {
  const [view, setView] = useState<EvalsView>('list');
  const [selectedSuite, setSelectedSuite] = useState<Suite | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {view === 'list' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <SuiteList
            key={refreshKey}
            onSelect={s => { setSelectedSuite(s); setView('detail'); }}
            onCreate={() => setView('create')}
          />
        </div>
      )}

      {view === 'create' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <SuiteEditor
            onSave={() => { setView('list'); setRefreshKey(k => k + 1); }}
            onCancel={() => setView('list')}
          />
        </div>
      )}

      {view === 'detail' && selectedSuite && (
        <SuiteDetailPage
          suite={selectedSuite}
          onBack={() => setView('list')}
          onRunComplete={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
};

export default EvalsPage;
