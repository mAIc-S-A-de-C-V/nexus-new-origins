import React, { useState, useEffect } from 'react';
import {
  Play, Square, Plus, Save, Trash2, ChevronUp, ChevronDown,
  Plug, Filter, ArrowRightLeft, Repeat, Sparkles,
  Layers, Copy, ShieldCheck, Database, Activity, X, Bot, Clock, MessageSquare,
} from 'lucide-react';
import { CommentsPanel } from '../../components/CommentsPanel';
import { Button } from '../../design-system/components/Button';
import { usePipelineStore } from '../../store/pipelineStore';
import { useNavigationStore } from '../../store/navigationStore';
import { useConnectorStore } from '../../store/connectorStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { getTenantId } from '../../store/authStore';
import { PipelineNode, NodeType } from '../../types/pipeline';
import { NODE_TYPE_DEFS } from './pipelineTypes';

const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, React.ReactNode> = {
  Plug: <Plug size={13} />,
  Filter: <Filter size={13} />,
  ArrowRightLeft: <ArrowRightLeft size={13} />,
  Repeat: <Repeat size={13} />,
  Sparkles: <Sparkles size={13} />,
  Layers: <Layers size={13} />,
  Copy: <Copy size={13} />,
  ShieldCheck: <ShieldCheck size={13} />,
  Database: <Database size={13} />,
  Activity: <Activity size={13} />,
  Bot: <Bot size={13} />,
};

const CONNECTOR_FIELDS = new Set(['connectorId', 'lookupConnectorId']);
const OBJECT_TYPE_FIELDS = new Set(['objectTypeId']);
const AGENT_FIELDS = new Set(['agentId']);
const MODEL_FIELDS = new Set(['model']);

interface TenantModel { id: string; label: string; provider: string }

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  RUNNING:   { label: 'Running',   bg: '#FFF7ED', text: '#92400E' },
  IDLE:      { label: 'Idle',      bg: '#F8FAFC', text: '#475569' },
  FAILED:    { label: 'Failed',    bg: '#FEF2F2', text: '#991B1B' },
  PAUSED:    { label: 'Paused',    bg: '#FEFCE8', text: '#713F12' },
  DRAFT:     { label: 'Draft',     bg: '#F8FAFC', text: '#64748B' },
  COMPLETED: { label: 'Completed', bg: '#F0FDF4', text: '#166534' },
};

// ─── Field renderer ──────────────────────────────────────────────────────────

interface FieldProps {
  stepId: string;
  fieldKey: string;
  fieldType: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  defaultVal?: unknown;
  value: unknown;
  connectors: { id: string; name: string }[];
  objectTypes: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  tenantModels: TenantModel[];
  onChange: (stepId: string, key: string, value: unknown) => void;
}

const FieldInput: React.FC<FieldProps> = ({
  stepId, fieldKey, fieldType, placeholder, options, defaultVal,
  value, connectors, objectTypes, agents, tenantModels, onChange,
}) => {
  const raw = value ?? defaultVal ?? '';
  const strVal = (typeof raw === 'object' && raw !== null) ? JSON.stringify(raw, null, 2) : String(raw);
  const inputStyle: React.CSSProperties = {
    width: '100%', height: '30px', border: '1px solid #E2E8F0',
    borderRadius: '4px', padding: '0 8px', fontSize: '12px',
    color: '#0D1117', outline: 'none', boxSizing: 'border-box',
    backgroundColor: '#FFFFFF',
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
  const taStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #E2E8F0', borderRadius: '4px',
    padding: '6px 8px', fontSize: '12px', color: '#0D1117',
    backgroundColor: '#FFFFFF', outline: 'none', resize: 'vertical',
    lineHeight: '1.5', boxSizing: 'border-box',
    fontFamily: fieldType === 'code' ? 'var(--font-mono)' : 'var(--font-interface)',
  };

  if (fieldType === 'text' || fieldType === 'number') {
    return (
      <input
        type={fieldType}
        value={strVal}
        onChange={e => onChange(stepId, fieldKey, fieldType === 'number' ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    );
  }
  if (fieldType === 'select' && AGENT_FIELDS.has(fieldKey)) {
    return (
      <select value={strVal} onChange={e => onChange(stepId, fieldKey, e.target.value)} style={selectStyle}>
        <option value="">Select agent...</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    );
  }
  if (fieldType === 'select' && CONNECTOR_FIELDS.has(fieldKey)) {
    return (
      <select value={strVal} onChange={e => onChange(stepId, fieldKey, e.target.value)} style={selectStyle}>
        <option value="">Select connector...</option>
        {connectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    );
  }
  if (fieldType === 'select' && OBJECT_TYPE_FIELDS.has(fieldKey)) {
    return (
      <select value={strVal} onChange={e => onChange(stepId, fieldKey, e.target.value)} style={selectStyle}>
        <option value="">Select object type...</option>
        {objectTypes.map(ot => <option key={ot.id} value={ot.id}>{ot.name}</option>)}
      </select>
    );
  }
  if (fieldType === 'select' && MODEL_FIELDS.has(fieldKey)) {
    return (
      <select value={strVal} onChange={e => onChange(stepId, fieldKey, e.target.value)} style={selectStyle}>
        {tenantModels.length > 0 && (
          <optgroup label="From your providers">
            {tenantModels.map(m => (
              <option key={`tm-${m.id}`} value={m.id}>{m.label} — {m.provider}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="Built-in defaults">
          {options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </optgroup>
      </select>
    );
  }
  if (fieldType === 'select') {
    return (
      <select value={strVal} onChange={e => onChange(stepId, fieldKey, e.target.value)} style={selectStyle}>
        <option value="">Select...</option>
        {options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (fieldType === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', height: '30px' }}>
        <input
          type="checkbox"
          checked={Boolean(value ?? defaultVal)}
          onChange={e => onChange(stepId, fieldKey, e.target.checked)}
        />
        <span style={{ fontSize: '12px', color: '#64748B' }}>Enabled</span>
      </label>
    );
  }
  // code / textarea
  return (
    <textarea
      value={strVal}
      onChange={e => {
        const v = e.target.value;
        try { onChange(stepId, fieldKey, JSON.parse(v)); } catch { onChange(stepId, fieldKey, v); }
      }}
      placeholder={placeholder}
      rows={4}
      style={taStyle}
    />
  );
};

// ─── Schedule Panel ──────────────────────────────────────────────────────────

const PipelineSchedulePanel: React.FC<{ pipelineId: string }> = ({ pipelineId }) => {
  const { schedules, fetchSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow } = usePipelineStore();
  const [form, setForm] = React.useState({ name: '', cron_expression: '0 * * * *', enabled: true });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { fetchSchedules(pipelineId); }, [pipelineId]);

  const pipelineSchedules = schedules.filter(s => s.pipeline_id === pipelineId);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.cron_expression.trim()) return;
    setSaving(true);
    try { await createSchedule(pipelineId, form); setForm({ name: '', cron_expression: '0 * * * *', enabled: true }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Cron Schedules</div>

      {/* Create form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px', border: '1px solid #E2E8F0', borderRadius: 6, backgroundColor: '#F8FAFC' }}>
        <input
          placeholder="Schedule name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
        />
        <input
          placeholder="Cron expression (e.g. 0 * * * *)"
          value={form.cron_expression}
          onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))}
          style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748B', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enabled
          </label>
          <button
            onClick={handleCreate}
            disabled={saving}
            style={{ marginLeft: 'auto', height: 26, padding: '0 12px', borderRadius: 4, border: 'none', backgroundColor: '#2563EB', color: '#fff', fontSize: 11, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Adding...' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Schedule list */}
      {pipelineSchedules.length === 0 ? (
        <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', margin: '8px 0' }}>No schedules yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pipelineSchedules.map(s => (
            <div key={s.id} style={{ padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 6, backgroundColor: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#1E293B' }}>{s.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => runScheduleNow(pipelineId, s.id)}
                    title="Run now"
                    style={{ padding: '2px 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#2563EB' }}
                  >▶</button>
                  <button
                    onClick={() => updateSchedule(pipelineId, s.id, { enabled: !s.enabled })}
                    style={{ padding: '2px 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3, background: s.enabled ? '#DCFCE7' : '#F1F5F9', cursor: 'pointer', color: s.enabled ? '#16A34A' : '#64748B' }}
                  >{s.enabled ? 'ON' : 'OFF'}</button>
                  <button
                    onClick={() => deleteSchedule(pipelineId, s.id)}
                    title="Delete"
                    style={{ padding: '2px 6px', fontSize: 10, border: '1px solid #FEE2E2', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#DC2626' }}
                  >✕</button>
                </div>
              </div>
              <code style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>{s.cron_expression}</code>
              {s.last_run_at && (
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>
                  Last: {new Date(s.last_run_at).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const PipelineBuilder: React.FC = () => {
  const {
    pipelines, selectedPipelineId, selectPipeline,
    updatePipelineNodes, updatePipeline, fetchPipelines, runPipeline,
    addPipeline, removePipeline,
  } = usePipelineStore();
  const { consumePendingPipeline, setBreadcrumbs } = useNavigationStore();
  const { connectors, fetchConnectors } = useConnectorStore();
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [tenantModels, setTenantModels] = useState<TenantModel[]>([]);

  const [isRunning, setIsRunning]         = useState(false);
  const [showNewModal, setShowNewModal]   = useState(false);
  const [newName, setNewName]             = useState('');
  const [newConnectorId, setNewConnectorId] = useState('');
  const [creating, setCreating]           = useState(false);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [localSteps, setLocalSteps]       = useState<PipelineNode[]>([]);
  const [dirty, setDirty]                 = useState(false);
  const [saving, setSaving]               = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<'schedule' | 'comments' | null>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId) || pipelines[0];

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setBreadcrumbs([{ label: 'Pipelines' }]);
    fetchConnectors();
    fetchObjectTypes();
    fetch(`${AGENT_API}/agents`, { headers: { 'x-tenant-id': getTenantId() } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Pull the tenant's BYOLLM providers so their models show up in the
    // Model dropdowns of pipeline steps (LLM_CLASSIFY, etc.) alongside the
    // built-in Claude defaults.
    fetch(`${AGENT_API}/model-providers`, { headers: { 'x-tenant-id': getTenantId() } })
      .then(r => r.ok ? r.json() : [])
      .then((providers: Array<{ name: string; enabled: boolean; models: Array<{ id: string; label?: string }> }>) => {
        const flat: TenantModel[] = [];
        for (const p of (Array.isArray(providers) ? providers : [])) {
          if (p.enabled === false) continue;
          for (const m of (p.models || [])) {
            flat.push({ id: m.id, label: m.label || m.id, provider: p.name });
          }
        }
        setTenantModels(flat);
      })
      .catch(() => {});
    const pending = consumePendingPipeline();
    fetchPipelines().then(() => {
      if (pending) {
        const now = new Date().toISOString();
        addPipeline({
          id: '', name: pending.name || 'New Pipeline',
          description: pending.description, status: 'DRAFT',
          nodes: pending.nodes || [], edges: pending.edges || [],
          connectorIds: pending.connectorIds || [],
          targetObjectTypeId: pending.targetObjectTypeId,
          createdAt: now, updatedAt: now,
          tenantId: pending.tenantId || getTenantId(), version: 1,
        }).then(created => selectPipeline(created.id));
      }
    });
  }, []);

  // ── Sync local steps when pipeline changes ────────────────────────────────
  useEffect(() => {
    if (currentPipeline) {
      setLocalSteps(currentPipeline.nodes || []);
      setDirty(false);
      setBreadcrumbs([{ label: 'Pipelines', page: 'pipelines' }, { label: currentPipeline.name }]);
      if (currentPipeline.nodes?.length > 0) {
        setExpandedSteps(new Set([currentPipeline.nodes[0].id]));
      } else {
        setExpandedSteps(new Set());
      }
    }
  }, [currentPipeline?.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreatePipeline = async () => {
    const name = newName.trim() || 'New Pipeline';
    setCreating(true);
    const now = new Date().toISOString();
    const created = await addPipeline({
      id: '', name, status: 'DRAFT', nodes: [], edges: [],
      connectorIds: newConnectorId ? [newConnectorId] : [],
      createdAt: now, updatedAt: now, tenantId: getTenantId(), version: 1,
    });
    selectPipeline(created.id);
    setShowNewModal(false);
    setNewName('');
    setNewConnectorId('');
    setCreating(false);
  };

  const addStep = (type: NodeType) => {
    const def = NODE_TYPE_DEFS.find(d => d.type === type)!;
    const newStep: PipelineNode = {
      id: `step-${Date.now()}`,
      type, label: def.label, config: {},
      position: { x: 0, y: localSteps.length * 120 },
    };
    setLocalSteps(prev => [...prev, newStep]);
    setExpandedSteps(prev => new Set([...prev, newStep.id]));
    setShowStepPicker(false);
    setDirty(true);
  };

  const removeStep = (id: string) => {
    setLocalSteps(prev => prev.filter(s => s.id !== id));
    setDirty(true);
  };

  const moveStep = (id: string, dir: 'up' | 'down') => {
    setLocalSteps(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const arr = [...prev];
      const to = dir === 'up' ? idx - 1 : idx + 1;
      if (to < 0 || to >= arr.length) return prev;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return arr;
    });
    setDirty(true);
  };

  const updateStepConfig = (id: string, key: string, value: unknown) => {
    setLocalSteps(prev => prev.map(s =>
      s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s
    ));
    setDirty(true);
  };

  const updateStepLabel = (id: string, label: string) => {
    setLocalSteps(prev => prev.map(s => s.id === id ? { ...s, label } : s));
    setDirty(true);
  };

  const toggleExpand = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!currentPipeline) return;
    setSaving(true);
    const stepsWithPos = localSteps.map((s, i) => ({ ...s, position: { x: 0, y: i * 120 } }));
    await updatePipelineNodes(currentPipeline.id, stepsWithPos, []);

    // Auto-set targetObjectTypeId from the SINK step so the Ontology graph
    // can draw the edge from the last pipeline step to the ObjectType node.
    const sinkStep = localSteps.find(s => s.type === 'SINK_OBJECT' || s.type === 'SINK_EVENT');
    const sinkOtId = sinkStep?.config?.objectTypeId as string | undefined;
    if (sinkOtId && sinkOtId !== currentPipeline.targetObjectTypeId) {
      await updatePipeline(currentPipeline.id, { targetObjectTypeId: sinkOtId });
    }

    // Also declare this pipeline as the authoritative source for the target ObjectType
    // so the ObjectType panel immediately shows "Backed by pipeline: …" without needing a run.
    if (sinkOtId) {
      try {
        const ontologyBase = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
        await fetch(`${ontologyBase}/object-types/${sinkOtId}/set-pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
          body: JSON.stringify({ pipeline_id: currentPipeline.id }),
        });
        // Refresh ontology store so the panel picks up the new sourcePipelineId
        await fetchObjectTypes();
      } catch { /* non-critical */ }
    }

    setDirty(false);
    setSaving(false);
  };

  const handleRun = async () => {
    if (!currentPipeline) return;
    if (dirty) await handleSave();
    setIsRunning(true);
    try {
      await runPipeline(currentPipeline.id);
    } catch (err) {
      console.error('Run pipeline failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const pipelineStatus = currentPipeline?.status || 'DRAFT';
  const statusConf = STATUS_CONFIG[pipelineStatus] || STATUS_CONFIG.DRAFT;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#F8FAFC' }}>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        gap: '12px', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: '15px', fontWeight: 600, color: '#0D1117' }}>Pipeline Builder</h1>

        {/* Pipeline selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
          <select
            value={selectedPipelineId || ''}
            onChange={e => selectPipeline(e.target.value)}
            style={{
              height: '28px', padding: '0 28px 0 10px', borderRadius: '4px',
              border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#0D1117',
              fontSize: '12px', fontWeight: 500, cursor: 'pointer', outline: 'none',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
              minWidth: 160, maxWidth: 260,
            }}
          >
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <Button variant="ghost" size="sm" icon={<Plus size={12} />} onClick={() => setShowNewModal(true)}>New</Button>

          {currentPipeline && (
            <button
              onClick={async () => {
                if (!confirm(`Delete pipeline "${currentPipeline.name}"? This cannot be undone.`)) return;
                const remaining = pipelines.filter(p => p.id !== currentPipeline.id);
                if (remaining.length > 0) selectPipeline(remaining[0].id);
                await removePipeline(currentPipeline.id);
              }}
              title="Delete pipeline"
              style={{
                height: '28px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid #FCA5A5', borderRadius: '4px',
                color: '#DC2626', cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Status badge */}
        {currentPipeline && (
          <span style={{
            fontSize: '11px', backgroundColor: statusConf.bg, color: statusConf.text,
            padding: '2px 8px', borderRadius: '2px', fontWeight: 500,
          }}>
            {statusConf.label}
          </span>
        )}

        {/* Right actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {dirty && <span style={{ fontSize: '11px', color: '#D97706' }}>Unsaved changes</span>}
          {currentPipeline && (
            <span style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
              v{currentPipeline.version}
            </span>
          )}
          <button
            onClick={() => setActiveRightTab(activeRightTab === 'schedule' ? null : 'schedule')}
            title="Schedules"
            style={{
              height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 5,
              borderRadius: 4, border: '1px solid #E2E8F0', fontSize: 12, cursor: 'pointer',
              backgroundColor: activeRightTab === 'schedule' ? '#EFF6FF' : '#FFFFFF',
              color: activeRightTab === 'schedule' ? '#2563EB' : '#64748B',
            }}
          >
            <Clock size={12} />
            Schedule
          </button>
          <button
            onClick={() => setActiveRightTab(activeRightTab === 'comments' ? null : 'comments')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              height: 28, padding: '0 10px', borderRadius: 4, fontSize: 11,
              border: '1px solid #E2E8F0',
              backgroundColor: activeRightTab === 'comments' ? '#EFF6FF' : '#FFFFFF',
              color: activeRightTab === 'comments' ? '#2563EB' : '#64748B',
              cursor: 'pointer',
            }}
          >
            <MessageSquare size={12} /> Comments
          </button>
          <Button
            variant="secondary" size="sm" icon={<Save size={12} />}
            onClick={handleSave} loading={saving} disabled={!dirty || saving}
          >
            Save
          </Button>
          <Button
            variant="primary" size="sm"
            icon={isRunning ? <Square size={12} /> : <Play size={12} />}
            onClick={handleRun} loading={isRunning}
          >
            {isRunning ? 'Running...' : 'Run Pipeline'}
          </Button>
        </div>
      </div>

      {/* ── Content area (steps + optional right panel) ───────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* ── Steps area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 52px' }}>
        <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>

          {/* Empty state */}
          {localSteps.length === 0 && !showStepPicker && (
            <div style={{
              textAlign: 'center', padding: '64px 24px', color: '#94A3B8',
              border: '1px dashed #CBD5E1', borderRadius: '8px', backgroundColor: '#FFFFFF',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '6px' }}>No steps yet</div>
              <div style={{ fontSize: '12px', marginBottom: '18px' }}>
                Add steps to define how data flows through this pipeline
              </div>
              <button
                onClick={() => setShowStepPicker(true)}
                style={{
                  padding: '8px 18px', borderRadius: '4px', backgroundColor: '#7C3AED',
                  color: '#FFF', border: 'none', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                }}
              >
                + Add First Step
              </button>
            </div>
          )}

          {/* Step cards */}
          {localSteps.map((step, idx) => {
            const def = NODE_TYPE_DEFS.find(d => d.type === step.type);
            if (!def) return null;
            const isExpanded = expandedSteps.has(step.id);

            return (
              <React.Fragment key={step.id}>
                {/* Connector arrow */}
                {idx > 0 && (
                  <div style={{
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    height: 20, color: '#CBD5E1', fontSize: '16px', lineHeight: 1,
                  }}>
                    ↓
                  </div>
                )}

                {/* Card */}
                <div style={{
                  backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
                  borderLeft: `3px solid ${def.color}`, borderRadius: '6px', overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  {/* Card header — click to expand */}
                  <div
                    onClick={() => toggleExpand(step.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
                      backgroundColor: isExpanded ? '#FAFBFC' : '#FFFFFF',
                      borderBottom: isExpanded ? '1px solid #F1F5F9' : 'none',
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 28, height: 28, borderRadius: '4px',
                      backgroundColor: def.color, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#FFFFFF',
                    }}>
                      {NODE_ICONS[def.iconName] || <Plug size={13} />}
                    </div>

                    {/* Name + type */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0D1117' }}>{step.label}</div>
                      <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {def.type.replace(/_/g, ' ')}
                        {/* Show target OT name inline for sink steps */}
                        {(step.type === 'SINK_OBJECT' || step.type === 'SINK_EVENT') && !!step.config.objectTypeId && (
                          objectTypes.find(ot => ot.id === (step.config.objectTypeId as string))
                            ? (
                              <span style={{
                                marginLeft: 6, fontSize: '10px', color: '#1A3C6E',
                                backgroundColor: '#EFF6FF', padding: '1px 5px',
                                borderRadius: 2, fontWeight: 600, letterSpacing: 0,
                                textTransform: 'none',
                              }}>
                                → {objectTypes.find(ot => ot.id === (step.config.objectTypeId as string))!.name}
                              </span>
                            ) : null
                        )}
                      </div>
                    </div>

                    {/* Step number */}
                    <span style={{
                      fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-mono)',
                      backgroundColor: '#F1F5F9', padding: '2px 6px', borderRadius: '2px', flexShrink: 0,
                    }}>
                      STEP {idx + 1}
                    </span>

                    {/* Move / delete controls */}
                    <div
                      style={{ display: 'flex', gap: '4px', flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}
                    >
                      {(['up', 'down'] as const).map(dir => {
                        const disabled = dir === 'up' ? idx === 0 : idx === localSteps.length - 1;
                        return (
                          <button
                            key={dir}
                            onClick={() => moveStep(step.id, dir)}
                            disabled={disabled}
                            title={dir === 'up' ? 'Move up' : 'Move down'}
                            style={{
                              width: 24, height: 24, border: '1px solid #E2E8F0', borderRadius: '3px',
                              backgroundColor: 'transparent', display: 'flex', alignItems: 'center',
                              justifyContent: 'center',
                              cursor: disabled ? 'default' : 'pointer',
                              color: disabled ? '#CBD5E1' : '#64748B',
                            }}
                          >
                            {dir === 'up' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => removeStep(step.id)}
                        title="Remove step"
                        style={{
                          width: 24, height: 24, border: '1px solid #FCA5A5', borderRadius: '3px',
                          backgroundColor: 'transparent', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', cursor: 'pointer', color: '#DC2626',
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Inline config */}
                  {isExpanded && (
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ fontSize: '11px', color: '#94A3B8' }}>{def.description}</div>

                      {/* Label field */}
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748B', marginBottom: '4px' }}>
                          Step Label
                        </label>
                        <input
                          value={step.label}
                          onChange={e => updateStepLabel(step.id, e.target.value)}
                          style={{
                            width: '100%', height: '30px', border: '1px solid #E2E8F0',
                            borderRadius: '4px', padding: '0 8px', fontSize: '12px',
                            color: '#0D1117', outline: 'none', boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      {/* Config fields in 2-col grid (wide fields span full width) */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        {def.configFields.map(field => {
                          const isWide = field.type === 'code' || field.type === 'textarea';
                          return (
                            <div key={field.key} style={{ gridColumn: isWide ? '1 / -1' : 'auto' }}>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748B', marginBottom: '4px' }}>
                                {field.label}
                                {field.required && <span style={{ color: '#DC2626', marginLeft: '2px' }}>*</span>}
                              </label>
                              <FieldInput
                                stepId={step.id}
                                fieldKey={field.key}
                                fieldType={field.type}
                                label={field.label}
                                required={field.required}
                                placeholder={field.placeholder}
                                options={field.options}
                                defaultVal={field.default}
                                value={step.config[field.key]}
                                connectors={connectors}
                                objectTypes={objectTypes}
                                agents={agents}
                                tenantModels={tenantModels}
                                onChange={updateStepConfig}
                              />
                            </div>
                          );
                        })}
                      </div>

                      {/* ── SINK_OBJECT extras ── OT preview + filter conditions ── */}
                      {step.type === 'SINK_OBJECT' && ((() => {
                        const targetOT = objectTypes.find(ot => ot.id === step.config.objectTypeId);

                        // Parse filter conditions stored as JSON string
                        let conditions: Array<{ field: string; operator: string; value: string }> = [];
                        try {
                          const raw = step.config.filterConditions as string;
                          if (raw) conditions = JSON.parse(raw);
                        } catch { /* ignore */ }

                        const saveConditions = (conds: typeof conditions) => {
                          updateStepConfig(step.id, 'filterConditions', JSON.stringify(conds));
                        };

                        const COND_OPERATORS = ['eq', 'neq', 'contains', 'not_contains', 'gt', 'lt', 'gte', 'lte', 'is_null', 'not_null', 'exists'];

                        return (
                          <>
                            {/* Target OT preview */}
                            {targetOT && (
                              <div style={{
                                border: '1px solid #BFDBFE', borderRadius: 4, overflow: 'hidden',
                              }}>
                                <div style={{
                                  padding: '7px 12px', backgroundColor: '#1A3C6E',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                }}>
                                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                                    ↳ {targetOT.name}
                                  </div>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    {[
                                      `v${targetOT.version}`,
                                      `${(targetOT as any).sourceConnectorIds?.length ?? 0} src`,
                                      `${(targetOT as any).properties?.length ?? 0} props`,
                                    ].map(label => (
                                      <span key={label} style={{
                                        fontSize: '10px', color: 'rgba(255,255,255,0.75)',
                                        backgroundColor: 'rgba(255,255,255,0.15)',
                                        padding: '1px 6px', borderRadius: 2,
                                      }}>{label}</span>
                                    ))}
                                  </div>
                                </div>
                                <div style={{ padding: '8px 12px', backgroundColor: '#F8FAFC' }}>
                                  {((targetOT as any).properties?.length ?? 0) === 0 ? (
                                    <div style={{ fontSize: '11px', color: '#94A3B8', fontStyle: 'italic' }}>
                                      No properties yet — schema will be inferred from first run
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {((targetOT as any).properties as any[] || []).slice(0, 10).map((p: any) => (
                                        <span key={p.id || p.name} style={{
                                          fontSize: '10px', backgroundColor: '#EFF6FF', color: '#1D4ED8',
                                          padding: '2px 6px', borderRadius: 2,
                                          fontFamily: 'var(--font-mono)',
                                        }}>
                                          {p.name}
                                        </span>
                                      ))}
                                      {((targetOT as any).properties?.length ?? 0) > 10 && (
                                        <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                                          +{((targetOT as any).properties?.length ?? 0) - 10} more
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Filter conditions builder */}
                            <div>
                              <div style={{
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between', marginBottom: 8,
                              }}>
                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                                  Pre-Write Filter Conditions
                                </div>
                                <button
                                  onClick={() => saveConditions([...conditions, { field: '', operator: 'eq', value: '' }])}
                                  style={{
                                    fontSize: '11px', color: '#7C3AED', background: 'none',
                                    border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500,
                                  }}
                                >
                                  + Add Condition
                                </button>
                              </div>

                              {conditions.length === 0 ? (
                                <div style={{
                                  fontSize: '11px', color: '#94A3B8', fontStyle: 'italic',
                                  padding: '8px 10px', border: '1px dashed #E2E8F0',
                                  borderRadius: 4, backgroundColor: '#FAFBFC',
                                }}>
                                  No conditions — all records pass through to the ontology
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {/* Header row */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 3fr 22px', gap: 5 }}>
                                    {['Field', 'Operator', 'Value', ''].map(h => (
                                      <div key={h} style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 500, paddingLeft: 4 }}>{h}</div>
                                    ))}
                                  </div>
                                  {conditions.map((cond, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 3fr 22px', gap: 5, alignItems: 'center' }}>
                                      <input
                                        value={cond.field}
                                        onChange={e => {
                                          const next = conditions.map((c, j) => j === i ? { ...c, field: e.target.value } : c);
                                          saveConditions(next);
                                        }}
                                        placeholder="field name"
                                        style={{ height: 28, border: '1px solid #E2E8F0', borderRadius: 3, padding: '0 6px', fontSize: 11, outline: 'none', color: '#0D1117' }}
                                      />
                                      <select
                                        value={cond.operator}
                                        onChange={e => {
                                          const next = conditions.map((c, j) => j === i ? { ...c, operator: e.target.value } : c);
                                          saveConditions(next);
                                        }}
                                        style={{ height: 28, border: '1px solid #E2E8F0', borderRadius: 3, padding: '0 4px', fontSize: 11, outline: 'none', backgroundColor: '#FFF', color: '#0D1117' }}
                                      >
                                        {COND_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                                      </select>
                                      {['is_null', 'not_null', 'exists'].includes(cond.operator) ? (
                                        <div style={{ height: 28, border: '1px solid #F1F5F9', borderRadius: 3, backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
                                          <span style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>no value needed</span>
                                        </div>
                                      ) : (
                                        <input
                                          value={cond.value}
                                          onChange={e => {
                                            const next = conditions.map((c, j) => j === i ? { ...c, value: e.target.value } : c);
                                            saveConditions(next);
                                          }}
                                          placeholder="value"
                                          style={{ height: 28, border: '1px solid #E2E8F0', borderRadius: 3, padding: '0 6px', fontSize: 11, outline: 'none', color: '#0D1117' }}
                                        />
                                      )}
                                      <button
                                        onClick={() => saveConditions(conditions.filter((_, j) => j !== i))}
                                        style={{
                                          width: 22, height: 22, border: '1px solid #FCA5A5',
                                          borderRadius: 3, backgroundColor: 'transparent',
                                          color: '#DC2626', cursor: 'pointer',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}
                                      >
                                        <X size={10} />
                                      </button>
                                    </div>
                                  ))}
                                  <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: 2 }}>
                                    {conditions.length} condition{conditions.length !== 1 ? 's' : ''} — records not matching all conditions will be dropped before writing
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()) as React.ReactNode}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}

          {/* Add step section */}
          {localSteps.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', height: 20, color: '#CBD5E1', fontSize: '16px', alignItems: 'center' }}>
              ↓
            </div>
          )}

          {showStepPicker ? (
            /* Step type picker grid */
            <div style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
              borderRadius: '6px', padding: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#0D1117' }}>Choose a step type</div>
                <button
                  onClick={() => setShowStepPicker(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', display: 'flex', padding: 0 }}
                >
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                {NODE_TYPE_DEFS.map(def => (
                  <button
                    key={def.type}
                    onClick={() => addStep(def.type)}
                    title={def.description}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                      padding: '10px 6px', border: '1px solid #E2E8F0', borderRadius: '6px',
                      backgroundColor: '#FFFFFF', cursor: 'pointer', transition: 'all 80ms',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = def.color;
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF';
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '4px',
                      backgroundColor: def.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#FFFFFF',
                    }}>
                      {NODE_ICONS[def.iconName] || <Plug size={13} />}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 500, color: '#475569', textAlign: 'center', lineHeight: 1.2 }}>
                      {def.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Add step button */
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => setShowStepPicker(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', border: '1px dashed #CBD5E1',
                  borderRadius: '6px', backgroundColor: 'transparent',
                  color: '#64748B', fontSize: '12px', cursor: 'pointer', transition: 'all 80ms',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#7C3AED';
                  (e.currentTarget as HTMLElement).style.color = '#7C3AED';
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#FAF5FF';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1';
                  (e.currentTarget as HTMLElement).style.color = '#64748B';
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
              >
                <Plus size={13} />
                Add Step
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel (Schedule) ────────────────────────────────────────── */}
      {activeRightTab === 'schedule' && currentPipeline && (
        <div style={{
          width: 300, borderLeft: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
          display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
        }}>
          {/* Panel tab bar */}
          <div style={{
            height: 38, borderBottom: '1px solid #E2E8F0', display: 'flex',
            alignItems: 'center', padding: '0 12px', gap: 4, flexShrink: 0,
          }}>
            <button
              style={{
                height: 26, padding: '0 10px', borderRadius: 4, border: 'none',
                backgroundColor: '#EFF6FF', color: '#2563EB', fontSize: 11,
                fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Clock size={11} />
              Schedule
            </button>
            <button
              onClick={() => setActiveRightTab(null)}
              title="Close panel"
              style={{
                marginLeft: 'auto', width: 22, height: 22, border: 'none',
                background: 'none', cursor: 'pointer', color: '#94A3B8',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3,
              }}
            >
              <X size={13} />
            </button>
          </div>
          <PipelineSchedulePanel pipelineId={currentPipeline.id} />
        </div>
      )}

      {activeRightTab === 'comments' && currentPipeline && (
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontSize: 12, fontWeight: 600, color: '#374151' }}>Comments</div>
          <CommentsPanel entityType="pipeline" entityId={currentPipeline.id} compact />
        </div>
      )}

      </div>{/* end content area */}

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{
        height: 28, backgroundColor: '#F1F5F9', borderTop: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
          {localSteps.length} {localSteps.length === 1 ? 'step' : 'steps'}
        </span>
        {currentPipeline?.lastRunRowCount != null && (
          <span style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
            Last run: {currentPipeline.lastRunRowCount.toLocaleString()} rows
          </span>
        )}
        {isRunning && (
          <span style={{ fontSize: '11px', color: '#D97706', fontFamily: 'var(--font-mono)' }}>
            Pipeline executing...
          </span>
        )}
      </div>

      {/* ── New Pipeline Modal ─────────────────────────────────────────────── */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 500, backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowNewModal(false)}
        >
          <div
            style={{
              width: 420, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
              borderRadius: 6, padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>New Pipeline</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#64748B' }}>Pipeline name</label>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !creating && handleCreatePipeline()}
                placeholder="e.g. Loan Records Sync"
                style={{ height: 32, padding: '0 10px', borderRadius: 4, border: '1px solid #E2E8F0', fontSize: 13, color: '#0D1117', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#64748B' }}>
                Source connector <span style={{ color: '#94A3B8' }}>(optional — can add later)</span>
              </label>
              <select
                value={newConnectorId}
                onChange={e => setNewConnectorId(e.target.value)}
                style={{ height: 32, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0', fontSize: 13, color: '#0D1117', backgroundColor: '#FFFFFF', outline: 'none' }}
              >
                <option value="">— None / choose later —</option>
                {connectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {connectors.length === 0 && (
                <span style={{ fontSize: 11, color: '#94A3B8' }}>No connectors yet — go to Connectors to add one first.</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowNewModal(false)}
                style={{ height: 32, padding: '0 14px', borderRadius: 4, border: '1px solid #E2E8F0', backgroundColor: 'transparent', fontSize: 12, color: '#64748B', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePipeline}
                disabled={creating}
                style={{ height: 32, padding: '0 16px', borderRadius: 4, border: 'none', backgroundColor: '#7C3AED', fontSize: 12, fontWeight: 500, color: '#FFF', cursor: creating ? 'wait' : 'pointer', opacity: creating ? 0.7 : 1 }}
              >
                {creating ? 'Creating…' : 'Create Pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineBuilder;
