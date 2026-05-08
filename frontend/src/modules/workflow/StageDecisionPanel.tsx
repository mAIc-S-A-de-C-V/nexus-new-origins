// Renders the right control set for the active stage on a workflow execution.
// Drops into HumanActions DetailPanel when an execution has current_stage set.

import React, { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import type { WorkflowStage, ExecutionWorkflowState } from './types';
import { submitDecision } from './api';

const c = {
  border:'#E2E8F0', muted:'#64748B', dim:'#94A3B8', panel:'#FFFFFF',
  accent:'#2563EB', success:'#059669', error:'#DC2626', text:'#0D1117',
  successDim:'#ECFDF5', errorDim:'#FEF2F2', warn:'#D97706',
};

interface Props {
  executionId: string;
  state: ExecutionWorkflowState;
  templateStages: WorkflowStage[];
  onChange?: () => void; // refresh callback
}

function _optionId(opt: Record<string, unknown>): string {
  if (opt.id) return String(opt.id);
  if (opt.option_id) return String(opt.option_id);
  return [opt.vendor, opt.source_url, opt.unit_price].map(v => String(v ?? '')).join('|');
}

const StageDecisionPanel: React.FC<Props> = ({ executionId, state, templateStages, onChange }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedSet, setApprovedSet] = useState<Set<string>>(new Set());
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  const stageName = state.current_stage;
  if (!stageName || stageName === 'completed' || stageName === 'rejected') {
    return null;
  }

  const stage = templateStages.find(s => s.name === stageName);
  if (!stage) return null;

  // For parallel groups, decisions actually target the sub-stages. We pick
  // the first active sub-stage that's currently assigned. (UI for fully
  // independent parallel-branch decisions in one place is a future polish;
  // for now both reviewers hit the same Queue card and act on their branch.)
  let decideStage = stage;
  let decidedInName = stageName;
  if (stage.type === 'parallel_group' && stage.branches?.length) {
    const subState = (state.stage_state as Record<string, { branches?: Record<string, { status: string }> }>)?.[stageName]?.branches || {};
    const activeBranch = stage.branches.find(b => {
      const branchState = (state.stage_state as Record<string, { status?: string }>)?.[b];
      return branchState?.status === 'active';
    });
    if (activeBranch) {
      const sub = templateStages.find(s => s.name === activeBranch);
      if (sub) {
        decideStage = sub;
        decidedInName = activeBranch;
      }
    } else {
      return (
        <div style={{ padding: 12, fontSize: 12, color: c.muted }}>
          Parallel group <code>{stageName}</code>: all branches resolved, awaiting routing.
        </div>
      );
    }
  }

  const options = state.options || [];

  async function fire(decision: 'approve' | 'reject' | 'review_options' | 'select_options') {
    setBusy(true);
    setError(null);
    try {
      const body: {
        decision: 'approve' | 'reject' | 'review_options' | 'select_options';
        decided_in_stage: string;
        note: string;
        approved_option_ids?: string[];
        selected_option_ids?: string[];
      } = {
        decision,
        decided_in_stage: decidedInName,
        note,
      };
      if (decision === 'review_options') body.approved_option_ids = Array.from(approvedSet);
      if (decision === 'select_options') body.selected_option_ids = Array.from(selectedSet);
      await submitDecision(executionId, body);
      setNote('');
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stageBadge = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.muted, marginBottom: 12 }}>
      Stage: <code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: 3 }}>{decidedInName}</code>
      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, backgroundColor: '#EFF6FF', color: c.accent }}>
        {decideStage.type}
      </span>
    </div>
  );

  return (
    <div style={{ borderTop: `1px solid ${c.border}`, paddingTop: 14 }}>
      {stageBadge}

      {decideStage.type === 'option_review' && options.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 6 }}>
            Tick which options to keep (≥{decideStage.min_approve ?? 1} required to advance):
          </div>
          <div style={{ border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {options.map((opt, i) => {
              const oid = _optionId(opt as Record<string, unknown>);
              const checked = approvedSet.has(oid);
              return (
                <label key={oid} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  borderBottom: i < options.length - 1 ? `1px solid ${c.border}` : 'none',
                  cursor: 'pointer', backgroundColor: checked ? c.successDim : c.panel,
                }}>
                  <input type="checkbox" checked={checked}
                    onChange={(e) => {
                      const next = new Set(approvedSet);
                      if (e.target.checked) next.add(oid); else next.delete(oid);
                      setApprovedSet(next);
                    }} />
                  <OptionSummary opt={opt as Record<string, unknown>} />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {decideStage.type === 'option_select' && options.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 6 }}>
            Pick {decideStage.min_select ?? 1}–{decideStage.max_select ?? 1} option(s):
          </div>
          <div style={{ border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {options.map((opt, i) => {
              const oid = _optionId(opt as Record<string, unknown>);
              const checked = selectedSet.has(oid);
              const isRadio = (decideStage.max_select ?? 1) === 1;
              return (
                <label key={oid} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  borderBottom: i < options.length - 1 ? `1px solid ${c.border}` : 'none',
                  cursor: 'pointer', backgroundColor: checked ? '#EFF6FF' : c.panel,
                }}>
                  <input type={isRadio ? 'radio' : 'checkbox'} name="select-opt" checked={checked}
                    onChange={(e) => {
                      if (isRadio) {
                        setSelectedSet(new Set([oid]));
                      } else {
                        const next = new Set(selectedSet);
                        if (e.target.checked) next.add(oid); else next.delete(oid);
                        setSelectedSet(next);
                      }
                    }} />
                  <OptionSummary opt={opt as Record<string, unknown>} />
                </label>
              );
            })}
          </div>
        </div>
      )}

      <textarea style={{
        width: '100%', minHeight: 50, padding: 8, fontSize: 12,
        border: `1px solid ${c.border}`, borderRadius: 4, marginBottom: 10,
      }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      {error && (
        <div style={{ padding: 8, fontSize: 11, color: c.error, backgroundColor: c.errorDim, borderRadius: 4, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {decideStage.type === 'approval' && (
          <>
            <button onClick={() => fire('approve')} disabled={busy}
              style={btnSuccess(busy)}>
              <CheckCircle size={14} /> Approve
            </button>
            <button onClick={() => fire('reject')} disabled={busy}
              style={btnDanger(busy)}>
              <XCircle size={14} /> Reject
            </button>
          </>
        )}
        {decideStage.type === 'option_review' && (
          <>
            <button onClick={() => fire('review_options')}
              disabled={busy || approvedSet.size < (decideStage.min_approve ?? 1)}
              style={btnSuccess(busy || approvedSet.size < (decideStage.min_approve ?? 1))}>
              <CheckCircle size={14} /> Approve {approvedSet.size} option(s) → next stage
            </button>
            <button onClick={() => fire('reject')} disabled={busy} style={btnDanger(busy)}>
              <XCircle size={14} /> Reject all
            </button>
          </>
        )}
        {decideStage.type === 'option_select' && (
          <>
            <button onClick={() => fire('select_options')}
              disabled={busy ||
                selectedSet.size < (decideStage.min_select ?? 1) ||
                selectedSet.size > (decideStage.max_select ?? 1)}
              style={btnSuccess(busy ||
                selectedSet.size < (decideStage.min_select ?? 1) ||
                selectedSet.size > (decideStage.max_select ?? 1))}>
              <CheckCircle size={14} /> Confirm selection
            </button>
            <button onClick={() => fire('reject')} disabled={busy} style={btnDanger(busy)}>
              <XCircle size={14} /> Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const OptionSummary: React.FC<{ opt: Record<string, unknown> }> = ({ opt }) => {
  const cells: { label: string; value: string }[] = [];
  for (const k of ['vendor', 'unit_price', 'currency', 'quantity', 'lead_time_days', 'stock', 'source_url']) {
    if (opt[k] !== undefined && opt[k] !== null && opt[k] !== '') {
      cells.push({ label: k, value: String(opt[k]) });
    }
  }
  return (
    <div style={{ flex: 1, fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: c.text }}>
        {String(opt.vendor || opt.source_url || 'Option')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4, color: c.muted, marginTop: 4 }}>
        {cells.filter(c => c.label !== 'vendor').map(({ label, value }) => (
          <div key={label}>
            <span style={{ fontFamily: 'monospace', color: c.dim, fontSize: 10 }}>{label}:</span>{' '}
            {label === 'source_url' ? (
              <a href={value} target="_blank" rel="noreferrer noopener"
                style={{ color: c.accent, textDecoration: 'none' }}>{value.slice(0, 60)}…</a>
            ) : value}
          </div>
        ))}
      </div>
    </div>
  );
};

function btnSuccess(disabled: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 4,
    backgroundColor: c.success, color: '#FFF', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'flex', alignItems: 'center', gap: 6,
  };
}
function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 14px', fontSize: 12, fontWeight: 600,
    border: `1px solid ${c.error}`, borderRadius: 4, backgroundColor: c.errorDim, color: c.error,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    display: 'flex', alignItems: 'center', gap: 6,
  };
}

export default StageDecisionPanel;
