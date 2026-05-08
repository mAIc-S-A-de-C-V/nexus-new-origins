// Stage chain editor — surfaces in the Action Catalog when you edit a template.
// Each stage is an explicit form (no drag-drop in v1; up/down buttons reorder).
//
// Design choices for v1:
//   - JSONLogic `when` field is a free-form JSON textarea. Power users can type
//     `{">=":[{"*":[{"var":"unit_price"},{"var":"quantity"}]},10000]}`. We
//     show a small example below the field. A guided builder is a future iter.
//   - Assignee picker fetches /workflow/users and renders a select. Falls
//     back to email-text-input when the user wants someone outside the dir.
//   - Parallel groups are first-class: type=parallel_group exposes a multi-
//     select of branch stage names (must be other stage names in this chain).

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import type { WorkflowStage, AssigneeSpec, DirectoryUser, StageType } from './types';
import { listUsers } from './api';

const STAGE_TYPES: { value: StageType; label: string; help: string }[] = [
  { value: 'approval',       label: 'Approval (whole payload)', help: 'Reviewer approves or rejects the full action.' },
  { value: 'option_review',  label: 'Option review (subset)',  help: 'Reviewer ticks which options remain. Survivors flow to next stage.' },
  { value: 'option_select',  label: 'Option select (final)',   help: 'Reviewer picks N of the surviving options. Picks become the action.' },
  { value: 'parallel_group', label: 'Parallel group',          help: 'All listed branches must complete (all approve = approve, any reject = reject).' },
];

const DEFAULT_WHEN_HINT = '{">=":[{"*":[{"var":"unit_price"},{"var":"quantity"}]},10000]}';

interface Props {
  stages: WorkflowStage[];
  onChange: (next: WorkflowStage[]) => void;
}

const c = {
  border:'#E2E8F0', borderLight:'#EEF1F5', muted:'#64748B', dim:'#94A3B8',
  panel:'#FFFFFF', accent:'#2563EB', accentDim:'#EFF6FF', error:'#DC2626',
  text:'#0D1117', warn:'#D97706',
};

const inputStyle: React.CSSProperties = {
  height: 30, padding: '0 10px', fontSize: 12,
  border: `1px solid ${c.border}`, borderRadius: 4, backgroundColor: c.panel,
};

function emptyStage(name: string): WorkflowStage {
  return {
    name,
    type: 'approval',
    when: undefined,
    assignee: { kind: 'user_email', value: '' },
    on_approve: 'completed',
    on_reject: 'rejected',
  };
}

const WorkflowEditor: React.FC<Props> = ({ stages, onChange }) => {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  useEffect(() => {
    listUsers().then(setUsers).catch(() => {});
  }, []);

  const stageNames = useMemo(() => stages.map(s => s.name), [stages]);

  const update = (idx: number, patch: Partial<WorkflowStage>) => {
    const next = stages.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange(next);
  };

  const remove = (idx: number) => {
    const removedName = stages[idx].name;
    const next = stages
      .filter((_, i) => i !== idx)
      // Strip references to the removed stage from on_approve / on_reject / branches
      .map(s => ({
        ...s,
        on_approve: s.on_approve === removedName ? 'completed' : s.on_approve,
        on_reject:  s.on_reject  === removedName ? 'rejected'  : s.on_reject,
        branches: s.branches?.filter(b => b !== removedName),
      }));
    onChange(next);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const add = () => {
    const baseName = `stage_${stages.length + 1}`;
    onChange([...stages, emptyStage(baseName)]);
  };

  const updateAssignee = (idx: number, patch: Partial<AssigneeSpec>) => {
    const cur = stages[idx].assignee || { kind: 'user_email' };
    update(idx, { assignee: { ...cur, ...patch } as AssigneeSpec });
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>
        Stages run top-to-bottom. <code>on_approve</code> / <code>on_reject</code> let you skip ahead
        or fork. Use <strong>parallel_group</strong> to require multiple reviewers in parallel.
        Leave <code>when</code> empty for "always enter"; otherwise it's a JSONLogic rule against the
        proposed payload (e.g. <code>{DEFAULT_WHEN_HINT}</code>).
      </div>

      {stages.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: c.dim, fontSize: 12, border: `1px dashed ${c.border}`, borderRadius: 6 }}>
          No stages — this template uses single-step approval (legacy).
          Click "Add stage" to define a multi-stage workflow.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {stages.map((stage, idx) => (
          <div key={idx} style={{ border: `1px solid ${c.border}`, borderRadius: 6, padding: 12, backgroundColor: c.panel }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: c.muted, fontFamily: 'monospace' }}>#{idx + 1}</span>
                <input style={{ ...inputStyle, fontWeight: 600, width: 200 }}
                  value={stage.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="stage_name" />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => move(idx, -1)} disabled={idx === 0}
                  style={{ height: 26, width: 26, border: `1px solid ${c.border}`, borderRadius: 3, backgroundColor: c.panel, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1 }}>
                  <ArrowUp size={12} />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === stages.length - 1}
                  style={{ height: 26, width: 26, border: `1px solid ${c.border}`, borderRadius: 3, backgroundColor: c.panel, cursor: idx === stages.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === stages.length - 1 ? 0.4 : 1 }}>
                  <ArrowDown size={12} />
                </button>
                <button onClick={() => remove(idx)}
                  style={{ height: 26, width: 26, border: '1px solid #FECACA', borderRadius: 3, backgroundColor: '#FEF2F2', color: c.error, cursor: 'pointer' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 11, color: c.muted }}>
                Type
                <select style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  value={stage.type}
                  onChange={(e) => update(idx, { type: e.target.value as StageType })}>
                  {STAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <div style={{ fontSize: 10, color: c.dim, marginTop: 4 }}>
                  {STAGE_TYPES.find(t => t.value === stage.type)?.help}
                </div>
              </label>

              {stage.type !== 'parallel_group' && (
                <AssigneePicker
                  spec={stage.assignee || null}
                  users={users}
                  onChange={(patch) => updateAssignee(idx, patch)}
                />
              )}
            </div>

            {/* Conditional entry */}
            <label style={{ fontSize: 11, color: c.muted, display: 'block', marginTop: 12 }}>
              Enter when (JSONLogic)
              <textarea style={{ ...inputStyle, width: '100%', height: 60, padding: 8, marginTop: 4, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                value={typeof stage.when === 'string' ? stage.when : (stage.when ? JSON.stringify(stage.when) : '')}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) { update(idx, { when: undefined }); return; }
                  try { update(idx, { when: JSON.parse(raw) }); }
                  catch { update(idx, { when: raw }); /* keep raw text; engine will reject if invalid */ }
                }}
                placeholder={`empty = always enter
example: ${DEFAULT_WHEN_HINT}`} />
            </label>

            {/* Type-specific fields */}
            {stage.type === 'option_review' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <label style={{ fontSize: 11, color: c.muted }}>
                  Options field on payload
                  <input style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                    value={stage.options_field || ''}
                    placeholder="options"
                    onChange={(e) => update(idx, { options_field: e.target.value })} />
                </label>
                <label style={{ fontSize: 11, color: c.muted }}>
                  Min approved to advance
                  <input type="number" style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                    value={stage.min_approve ?? 1}
                    min={1}
                    onChange={(e) => update(idx, { min_approve: parseInt(e.target.value) || 1 })} />
                </label>
              </div>
            )}

            {stage.type === 'option_select' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
                <label style={{ fontSize: 11, color: c.muted }}>
                  Options field
                  <input style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                    value={stage.options_field || ''}
                    placeholder="options"
                    onChange={(e) => update(idx, { options_field: e.target.value })} />
                </label>
                <label style={{ fontSize: 11, color: c.muted }}>
                  Min picks
                  <input type="number" style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                    value={stage.min_select ?? 1} min={1}
                    onChange={(e) => update(idx, { min_select: parseInt(e.target.value) || 1 })} />
                </label>
                <label style={{ fontSize: 11, color: c.muted }}>
                  Max picks
                  <input type="number" style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                    value={stage.max_select ?? 1} min={1}
                    onChange={(e) => update(idx, { max_select: parseInt(e.target.value) || 1 })} />
                </label>
              </div>
            )}

            {stage.type === 'parallel_group' && (
              <label style={{ fontSize: 11, color: c.muted, display: 'block', marginTop: 12 }}>
                Branches (other stage names; all must complete)
                <select multiple style={{ ...inputStyle, width: '100%', marginTop: 4, height: 90 }}
                  value={stage.branches || []}
                  onChange={(e) => {
                    const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                    update(idx, { branches: opts });
                  }}>
                  {stageNames.filter((n) => n !== stage.name).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: c.dim, marginTop: 4 }}>
                  Cmd-click / Ctrl-click to multi-select.
                </div>
              </label>
            )}

            {/* Routing */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
              <label style={{ fontSize: 11, color: c.muted }}>
                On approve → next
                <select style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  value={stage.on_approve || 'completed'}
                  onChange={(e) => update(idx, { on_approve: e.target.value })}>
                  <option value="completed">✓ completed (terminal)</option>
                  {stageNames.filter(n => n !== stage.name).map(n => <option key={n} value={n}>→ {n}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11, color: c.muted }}>
                On reject → next
                <select style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  value={stage.on_reject || 'rejected'}
                  onChange={(e) => update(idx, { on_reject: e.target.value })}>
                  <option value="rejected">✗ rejected (terminal)</option>
                  {stageNames.filter(n => n !== stage.name).map(n => <option key={n} value={n}>→ {n}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11, color: c.muted }}>
                SLA (seconds, optional)
                <input type="number" style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  value={stage.sla_seconds ?? ''} min={0}
                  placeholder="86400 = 1d"
                  onChange={(e) => update(idx, { sla_seconds: e.target.value ? parseInt(e.target.value) : null })} />
              </label>
            </div>

            {stage.sla_seconds && (
              <div style={{ marginTop: 8, padding: 8, fontSize: 11, backgroundColor: '#FFFBEB', border: `1px solid #FDE68A`, borderRadius: 4, color: c.warn, display: 'flex', gap: 6, alignItems: 'center' }}>
                <AlertCircle size={11} />
                When SLA elapses: stage auto-{stage.on_timeout?.action || 'reject'}s.
                <button
                  type="button"
                  style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', border: `1px solid ${c.border}`, backgroundColor: c.panel, borderRadius: 3, cursor: 'pointer' }}
                  onClick={() => {
                    const next = (stage.on_timeout?.action || 'reject') === 'approve' ? 'reject' : 'approve';
                    update(idx, { on_timeout: { action: next as 'approve' | 'reject' } });
                  }}>
                  switch to auto-{(stage.on_timeout?.action || 'reject') === 'approve' ? 'reject' : 'approve'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={add}
        style={{ marginTop: 12, height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600,
                 border: `1px dashed ${c.accent}`, borderRadius: 4, backgroundColor: c.accentDim, color: c.accent,
                 cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Plus size={12} /> Add stage
      </button>
    </div>
  );
};

const AssigneePicker: React.FC<{
  spec: AssigneeSpec | null;
  users: DirectoryUser[];
  onChange: (patch: Partial<AssigneeSpec>) => void;
}> = ({ spec, users, onChange }) => {
  const kind = spec?.kind || 'user_email';

  return (
    <div>
      <div style={{ fontSize: 11, color: c.muted }}>Assignee</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, marginTop: 4 }}>
        <select style={inputStyle}
          value={kind}
          onChange={(e) => onChange({ kind: e.target.value as AssigneeSpec['kind'] })}>
          <option value="user_email">By email</option>
          <option value="user_id">User ID</option>
          <option value="role">By role</option>
          <option value="from_payload">From payload</option>
        </select>
        {kind === 'user_email' ? (
          <select style={inputStyle}
            value={spec?.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}>
            <option value="">— pick a user —</option>
            {users.map(u => <option key={u.id} value={u.email}>{u.name} &lt;{u.email}&gt;</option>)}
          </select>
        ) : kind === 'role' ? (
          <select style={inputStyle}
            value={spec?.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}>
            <option value="">— pick role —</option>
            <option value="admin">admin</option>
            <option value="analyst">analyst</option>
            <option value="viewer">viewer</option>
            <option value="superadmin">superadmin</option>
          </select>
        ) : kind === 'from_payload' ? (
          <input style={inputStyle}
            placeholder="payload field, e.g. requester_user_id"
            value={spec?.field || ''}
            onChange={(e) => onChange({ field: e.target.value })} />
        ) : (
          <input style={inputStyle}
            placeholder="user uuid"
            value={spec?.value || ''}
            onChange={(e) => onChange({ value: e.target.value })} />
        )}
      </div>
    </div>
  );
};

export default WorkflowEditor;
