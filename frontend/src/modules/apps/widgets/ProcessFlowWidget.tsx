/**
 * ProcessFlowWidget — visual editor for "how does this happen today".
 *
 * Renders a small ReactFlow canvas inside a form-like app. Each node is one
 * step of an existing manual process: name, role, medium (excel/paper/email…),
 * estimated minutes, optional pain note. Edges express order (from → to).
 *
 * The serialized flow JSON is written to an app variable on every change.
 * The form action references that variable via a field mapping with
 * transform='fromVariable', and the value lands on the created object as a
 * single string column (e.g. `current_process_flow`).
 *
 * Auto-derived totals at the top:
 *   • Steps count
 *   • Total minutes (sum)
 *   • Manual minutes (sum, excluding role='system')
 *   • Distinct mediums touched
 *
 * Read-only mode: pass readOnly=true. Used by the staff dashboard's object
 * editor to display a captured flow without letting reviewers mutate it.
 *
 * Implementation note: uses xyflow's useNodesState/useEdgesState as the
 * source of truth for the canvas, then mirrors out to the variable via a
 * serialization effect. Earlier version held the source of truth externally
 * and rebuilt nodes on every change, which broke xyflow's drag tracking.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus,
  X,
  FileSpreadsheet,
  FileText,
  Mail,
  Database,
  Phone,
  Users as UsersIcon,
  Globe,
  MessageCircle,
  HelpCircle,
  Server,
} from 'lucide-react';

import type { AppComponent } from '../../../types/app';
import { useVariableValue } from '../AppVariableContext';

// ── Vocabulary ──────────────────────────────────────────────────────────────

const DEFAULT_ROLES = ['student', 'faculty', 'staff', 'admin', 'system'];
const DEFAULT_MEDIUMS = [
  'excel', 'paper', 'email', 'sharepoint', 'erp', 'saas',
  'phone', 'in_person', 'whatsapp', 'web', 'other',
];

const MEDIUM_ICON: Record<string, React.ReactNode> = {
  excel:     <FileSpreadsheet size={12} />,
  paper:     <FileText size={12} />,
  email:     <Mail size={12} />,
  sharepoint:<Database size={12} />,
  erp:       <Server size={12} />,
  saas:      <Globe size={12} />,
  phone:     <Phone size={12} />,
  in_person: <UsersIcon size={12} />,
  whatsapp:  <MessageCircle size={12} />,
  web:       <Globe size={12} />,
  other:     <HelpCircle size={12} />,
};

const ROLE_COLOR: Record<string, string> = {
  student: '#0EA5E9',
  faculty: '#7C3AED',
  staff:   '#16A34A',
  admin:   '#DC2626',
  system:  '#64748B',
};

// ── Step / flow data shape ─────────────────────────────────────────────────

interface ProcessStep {
  id: string;
  label: string;
  role: string;
  medium: string;
  minutes: number;
  pain?: string;
  x: number;
  y: number;
}

interface SerializedFlow {
  steps: ProcessStep[];
  edges: Array<{ id: string; from: string; to: string }>;
}

const EMPTY_FLOW: SerializedFlow = { steps: [], edges: [] };

function parseFlow(raw: unknown): SerializedFlow {
  if (!raw) return { ...EMPTY_FLOW };
  if (typeof raw === 'string') {
    if (!raw.trim()) return { ...EMPTY_FLOW };
    try {
      const parsed = JSON.parse(raw);
      return normalizeFlow(parsed);
    } catch {
      return { ...EMPTY_FLOW };
    }
  }
  return normalizeFlow(raw);
}

function normalizeFlow(obj: unknown): SerializedFlow {
  const o = (obj || {}) as Record<string, unknown>;
  const steps = Array.isArray(o.steps) ? (o.steps as ProcessStep[]) : [];
  const edges = Array.isArray(o.edges) ? (o.edges as SerializedFlow['edges']) : [];
  return {
    steps: steps.map((s, i) => ({
      id: s.id || `s-${i}`,
      label: s.label || `Step ${i + 1}`,
      role: s.role || 'staff',
      medium: s.medium || 'other',
      minutes: typeof s.minutes === 'number' ? s.minutes : 0,
      pain: s.pain || '',
      x: typeof s.x === 'number' ? s.x : 60 + i * 240,
      y: typeof s.y === 'number' ? s.y : 80,
    })),
    edges: edges
      .filter((e) => e?.from && e?.to)
      .map((e, i) => ({
        id: e.id || `e-${i}`,
        from: e.from,
        to: e.to,
      })),
  };
}

// ── Node + edge serialization helpers ──────────────────────────────────────

interface StepNodeData extends Record<string, unknown> {
  step: ProcessStep;
}

type FlowNode = Node<StepNodeData>;

function stepsToNodes(steps: ProcessStep[]): FlowNode[] {
  return steps.map((s) => ({
    id: s.id,
    type: 'step',
    position: { x: s.x, y: s.y },
    data: { step: s },
  }));
}

function flowEdgesToRfEdges(flowEdges: SerializedFlow['edges']): Edge[] {
  return flowEdges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    style: { stroke: '#7C3AED', strokeWidth: 2 },
    markerEnd: { type: 'arrowclosed' as const, color: '#7C3AED', width: 20, height: 20 },
  }));
}

function nodesToSteps(nodes: FlowNode[]): ProcessStep[] {
  return nodes.map((n) => ({
    ...n.data.step,
    x: n.position.x,
    y: n.position.y,
  }));
}

function edgesToFlowEdges(edges: Edge[]): SerializedFlow['edges'] {
  return edges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
  }));
}

// ── Custom node ────────────────────────────────────────────────────────────

const StepNode: React.FC<NodeProps<FlowNode>> = ({ data, selected }) => {
  const { step } = data;
  const roleColor = ROLE_COLOR[step.role] || '#64748B';
  const icon = MEDIUM_ICON[step.medium] || MEDIUM_ICON.other;
  return (
    <div
      style={{
        width: 200,
        backgroundColor: '#FFFFFF',
        border: `2px solid ${selected ? '#7C3AED' : '#E2E8F0'}`,
        borderRadius: 8,
        padding: 10,
        boxShadow: selected ? '0 4px 14px rgba(124, 58, 237, 0.18)' : '0 1px 3px rgba(0,0,0,0.06)',
        fontFamily: 'inherit',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={handleStyle()}
      />
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', marginBottom: 6, lineHeight: 1.2 }}>
        {step.label || 'Untitled step'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 10,
          backgroundColor: `${roleColor}1A`, color: roleColor, fontWeight: 600,
        }}>
          {step.role}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 10,
          backgroundColor: '#F1F5F9', color: '#475569',
        }}>
          {icon} {step.medium}
        </span>
        <span style={{
          padding: '2px 6px', borderRadius: 10,
          backgroundColor: '#F1F5F9', color: '#475569', fontWeight: 600,
        }}>
          {step.minutes}m
        </span>
      </div>
      {step.pain && (
        <div style={{
          marginTop: 6, fontSize: 10, color: '#B45309',
          backgroundColor: '#FEF3C7', padding: '3px 6px', borderRadius: 4,
          lineHeight: 1.2,
        }}>
          ⚠ {step.pain}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={handleStyle()}
      />
    </div>
  );
};

function handleStyle(): React.CSSProperties {
  return {
    background: '#7C3AED',
    width: 14,
    height: 14,
    border: '2px solid #FFFFFF',
    boxShadow: '0 0 0 1px #7C3AED',
  };
}

const NODE_TYPES = { step: StepNode };

// ── Inner widget ──────────────────────────────────────────────────────────

interface InnerProps {
  comp: AppComponent;
  readOnly?: boolean;
}

const ProcessFlowInner: React.FC<InnerProps> = ({ comp, readOnly }) => {
  const variableId = comp.flowOutputVariableId;
  const [stored, setStored] = useVariableValue(variableId);

  // Initial flow comes from the bound variable. After mount, xyflow's hooks
  // own the source of truth — we serialize back out via an effect.
  const initialFlow = useMemo(() => parseFlow(stored), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(stepsToNodes(initialFlow.steps));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flowEdgesToRfEdges(initialFlow.edges));

  const roleOptions = (comp.flowRoleOptions && comp.flowRoleOptions.length)
    ? comp.flowRoleOptions
    : DEFAULT_ROLES;
  const mediumOptions = (comp.flowMediumOptions && comp.flowMediumOptions.length)
    ? comp.flowMediumOptions
    : DEFAULT_MEDIUMS;

  // ── Serialize on change ────────────────────────────────────────────────
  // Hash the serialized form so positional drags during a single gesture
  // don't fire dozens of identical writes.
  const lastSerializedRef = useRef<string>('');
  useEffect(() => {
    if (!variableId) return;
    const flow: SerializedFlow = {
      steps: nodesToSteps(nodes),
      edges: edgesToFlowEdges(edges),
    };
    const json = JSON.stringify(flow);
    if (json === lastSerializedRef.current) return;
    lastSerializedRef.current = json;
    setStored(json);
  }, [nodes, edges, variableId, setStored]);

  // ── Connection ─────────────────────────────────────────────────────────

  const onConnect = useCallback(
    (conn: Connection) => {
      if (readOnly) return;
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      setEdges((curr) =>
        addEdge(
          {
            ...conn,
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            style: { stroke: '#7C3AED', strokeWidth: 2 },
            markerEnd: { type: 'arrowclosed' as const, color: '#7C3AED', width: 20, height: 20 },
          },
          curr,
        ),
      );
    },
    [readOnly, setEdges],
  );

  // ── Add / mutate / delete steps ────────────────────────────────────────

  const addStep = () => {
    const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const stepCount = nodes.length;
    const newStep: ProcessStep = {
      id,
      label: `Step ${stepCount + 1}`,
      role: roleOptions[0],
      medium: mediumOptions[0],
      minutes: 5,
      pain: '',
      x: 60 + stepCount * 240,
      y: 80 + (stepCount % 3) * 30,
    };
    const newNode: FlowNode = {
      id,
      type: 'step',
      position: { x: newStep.x, y: newStep.y },
      data: { step: newStep },
      selected: true,
    };
    setNodes((curr) => [
      ...curr.map((n): FlowNode => ({ ...n, selected: false })),
      newNode,
    ]);
  };

  const updateStep = (id: string, patch: Partial<ProcessStep>) => {
    setNodes((curr) =>
      curr.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, step: { ...n.data.step, ...patch } } }
          : n,
      ),
    );
  };

  const deleteStep = (id: string) => {
    setNodes((curr) => curr.filter((n) => n.id !== id));
    setEdges((curr) => curr.filter((e) => e.source !== id && e.target !== id));
  };

  // ── Selected node (xyflow tracks selection internally) ─────────────────

  const selectedNode = nodes.find((n) => n.selected);
  const selectedStep = selectedNode?.data.step ?? null;

  // ── Auto-derived totals ────────────────────────────────────────────────

  const steps = nodes.map((n) => n.data.step);
  const totalMinutes = steps.reduce((acc, s) => acc + (s.minutes || 0), 0);
  const manualMinutes = steps
    .filter((s) => s.role !== 'system')
    .reduce((acc, s) => acc + (s.minutes || 0), 0);
  const distinctMediums = new Set(steps.map((s) => s.medium));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
      backgroundColor: '#FFFFFF',
    }}>
      {/* Header / totals */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '10px 14px', borderBottom: '1px solid #E2E8F0',
        backgroundColor: '#F8FAFC',
      }}>
        <strong style={{ fontSize: 12, color: '#0D1117' }}>{comp.title || 'Current process'}</strong>
        <span style={pillStyle()}>{steps.length} step{steps.length === 1 ? '' : 's'}</span>
        <span style={pillStyle()}>{totalMinutes} min total</span>
        <span style={pillStyle()}>{manualMinutes} min manual</span>
        <span style={pillStyle()}>{distinctMediums.size} medium{distinctMediums.size === 1 ? '' : 's'}</span>
        {!readOnly && (
          <button onClick={addStep} style={addBtnStyle()}>
            <Plus size={11} /> Add step
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', height: 380 }}>
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            connectionLineStyle={{ stroke: '#7C3AED', strokeWidth: 2 }}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            deleteKeyCode={readOnly ? null : 'Backspace'}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} color="#E2E8F0" />
            {!readOnly && <Controls showInteractive={false} />}
          </ReactFlow>
          {steps.length === 0 && (
            <div style={emptyStateStyle()}>
              <div style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>No steps yet</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                Click "Add step" to start mapping the current process.
              </div>
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 8, lineHeight: 1.4 }}>
                Tip: drag from a step's purple right-side dot to another step's left-side dot to connect them.
              </div>
            </div>
          )}
        </div>

        {!readOnly && selectedStep && (
          <StepDetailPanel
            key={selectedStep.id}
            step={selectedStep}
            roleOptions={roleOptions}
            mediumOptions={mediumOptions}
            onChange={(patch) => updateStep(selectedStep.id, patch)}
            onDelete={() => deleteStep(selectedStep.id)}
            onClose={() => setNodes((curr) => curr.map((n) => ({ ...n, selected: false })))}
          />
        )}
      </div>
    </div>
  );
};

// ── Side panel — edit a single step ─────────────────────────────────────

const StepDetailPanel: React.FC<{
  step: ProcessStep;
  roleOptions: string[];
  mediumOptions: string[];
  onChange: (patch: Partial<ProcessStep>) => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ step, roleOptions, mediumOptions, onChange, onDelete, onClose }) => {
  return (
    <aside style={{
      width: 260, borderLeft: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
      display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #E2E8F0',
      }}>
        <strong style={{ fontSize: 12, color: '#0D1117' }}>Step details</strong>
        <button onClick={onClose} style={iconBtnStyle()}><X size={14} /></button>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Label">
          <input
            value={step.label}
            onChange={(e) => onChange({ label: e.target.value })}
            style={inputStyle()}
          />
        </Field>
        <Field label="Role">
          <select
            value={step.role}
            onChange={(e) => onChange({ role: e.target.value })}
            style={inputStyle()}
          >
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Medium / data source">
          <select
            value={step.medium}
            onChange={(e) => onChange({ medium: e.target.value })}
            style={inputStyle()}
          >
            {mediumOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Estimated minutes">
          <input
            type="number"
            min={0}
            value={step.minutes}
            onChange={(e) => onChange({ minutes: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle()}
          />
        </Field>
        <Field label="Pain note (optional)">
          <textarea
            value={step.pain || ''}
            onChange={(e) => onChange({ pain: e.target.value })}
            placeholder="What goes wrong here today?"
            style={{ ...inputStyle(), height: 60, fontFamily: 'inherit' }}
          />
        </Field>
        <button onClick={onDelete} style={dangerBtnStyle()}>Delete step</button>
      </div>
    </aside>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
    {children}
  </label>
);

// ── Styles ────────────────────────────────────────────────────────────────

function pillStyle(): React.CSSProperties {
  return {
    fontSize: 11, color: '#475569', backgroundColor: '#F1F5F9',
    padding: '2px 8px', borderRadius: 10, fontWeight: 500,
  };
}

function addBtnStyle(): React.CSSProperties {
  return {
    marginLeft: 'auto',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '5px 10px', fontSize: 11, fontWeight: 600,
    border: 'none', borderRadius: 4, backgroundColor: '#7C3AED', color: '#fff',
    cursor: 'pointer',
  };
}

function iconBtnStyle(): React.CSSProperties {
  return {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#64748B',
    borderRadius: 4,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '6px 8px', fontSize: 12, color: '#0D1117',
    border: '1px solid #E2E8F0', borderRadius: 4, backgroundColor: '#FFFFFF',
  };
}

function dangerBtnStyle(): React.CSSProperties {
  return {
    marginTop: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600,
    border: '1px solid #FECACA', borderRadius: 4,
    backgroundColor: '#FEE2E2', color: '#B91C1C', cursor: 'pointer',
  };
}

function emptyStateStyle(): React.CSSProperties {
  return {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20,
    pointerEvents: 'none',
  };
}

// ── Public widget ─────────────────────────────────────────────────────────
// Wraps the inner component in a ReactFlowProvider so multiple instances on
// the same canvas don't fight over store state.

const ProcessFlowWidget: React.FC<{ comp: AppComponent; readOnly?: boolean }> = ({ comp, readOnly }) => (
  <ReactFlowProvider>
    <ProcessFlowInner comp={comp} readOnly={readOnly} />
  </ReactFlowProvider>
);

export default ProcessFlowWidget;
