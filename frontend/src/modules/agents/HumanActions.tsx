import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Bot, User, ChevronDown, ChevronUp } from 'lucide-react';
import { useHumanActionsStore, ActionExecution } from '../../store/humanActionsStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  accent: '#7C3AED', accentDim: '#EDE9FE',
  success: '#059669', successDim: '#ECFDF5', successBorder: '#6EE7B7',
  error: '#DC2626', errorDim: '#FEF2F2', errorBorder: '#FCA5A5',
  warn: '#D97706', warnDim: '#FFFBEB', warnBorder: '#FDE68A',
};

const SourceBadge: React.FC<{ source?: string; sourceId?: string }> = ({ source, sourceId }) => {
  const isAgent = source === 'agent';
  const isLogic = source === 'logic_function';
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 500,
      backgroundColor: isAgent ? C.accentDim : isLogic ? '#EFF6FF' : '#F1F5F9',
      color: isAgent ? C.accent : isLogic ? '#2563EB' : C.muted,
      border: `1px solid ${isAgent ? '#DDD6FE' : isLogic ? '#BFDBFE' : C.border}`,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {isAgent ? <Bot size={9} /> : <User size={9} />}
      {isAgent ? `Agent` : isLogic ? 'Logic' : source || 'manual'}
      {sourceId && <span style={{ opacity: 0.6 }}>· {sourceId.slice(-6)}</span>}
    </span>
  );
};

const ExecutionCard: React.FC<{
  exec: ActionExecution;
  mode: 'pending' | 'history';
  onConfirm?: (id: string) => void;
  onReject?: (id: string) => void;
}> = ({ exec, mode, onConfirm, onReject }) => {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);

  const statusColor = exec.status === 'completed' ? C.success : exec.status === 'rejected' ? C.error : C.warn;
  const statusBg = exec.status === 'completed' ? C.successDim : exec.status === 'rejected' ? C.errorDim : C.warnDim;
  const statusBorder = exec.status === 'completed' ? C.successBorder : exec.status === 'rejected' ? C.errorBorder : C.warnBorder;

  return (
    <div style={{
      backgroundColor: C.panel, border: `1px solid ${mode === 'pending' ? C.warnBorder : C.border}`,
      borderRadius: 6, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>
              {exec.action_name}
            </span>
            <SourceBadge source={exec.source} sourceId={exec.source_id} />
            {mode === 'history' && (
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 500,
                backgroundColor: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
              }}>
                {exec.status === 'completed' ? 'Approved' : 'Rejected'}
              </span>
            )}
          </div>
          {exec.reasoning && (
            <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
              "{exec.reasoning}"
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.dim }}>
            {exec.created_at ? new Date(exec.created_at).toLocaleString() : ''}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, lineHeight: 0 }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded inputs */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 16px', backgroundColor: C.bg }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, letterSpacing: '0.06em' }}>PROPOSED INPUTS</div>
          <pre style={{
            fontSize: 12, color: C.text, backgroundColor: C.panel,
            border: `1px solid ${C.border}`, padding: '10px 12px',
            borderRadius: 4, overflowX: 'auto', margin: 0,
          }}>
            {JSON.stringify(exec.inputs, null, 2)}
          </pre>
          {exec.status === 'rejected' && exec.rejection_reason && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.error }}>
              <strong>Rejected:</strong> {exec.rejection_reason}
              {exec.rejected_by && <span style={{ color: C.dim }}> · by {exec.rejected_by}</span>}
            </div>
          )}
          {exec.status === 'completed' && exec.confirmed_by && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.success }}>
              <strong>Approved</strong> by {exec.confirmed_by}
            </div>
          )}
        </div>
      )}

      {/* Action buttons (pending only) */}
      {mode === 'pending' && !rejecting && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', gap: 8 }}>
          <button
            disabled={acting}
            onClick={async () => { setActing(true); onConfirm?.(exec.id); }}
            style={{
              padding: '6px 16px', fontSize: 12, cursor: acting ? 'default' : 'pointer',
              backgroundColor: C.successDim, border: `1px solid ${C.successBorder}`,
              color: C.success, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500,
            }}
          >
            <CheckCircle size={13} /> Approve
          </button>
          <button
            disabled={acting}
            onClick={() => setRejecting(true)}
            style={{
              padding: '6px 16px', fontSize: 12, cursor: acting ? 'default' : 'pointer',
              backgroundColor: C.errorDim, border: `1px solid ${C.errorBorder}`,
              color: C.error, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500,
            }}
          >
            <XCircle size={13} /> Reject
          </button>
        </div>
      )}

      {/* Rejection form */}
      {mode === 'pending' && rejecting && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            style={{
              flex: 1, height: 32, padding: '0 10px', fontSize: 12,
              border: `1px solid ${C.errorBorder}`, borderRadius: 4,
              backgroundColor: C.errorDim, color: C.text, outline: 'none',
            }}
          />
          <button
            disabled={!rejectReason.trim() || acting}
            onClick={async () => {
              setActing(true);
              onReject?.(exec.id);
            }}
            style={{
              padding: '0 14px', fontSize: 12, cursor: rejectReason.trim() ? 'pointer' : 'default',
              backgroundColor: C.error, border: 'none', color: '#FFF', borderRadius: 4,
            }}
          >
            Confirm rejection
          </button>
          <button
            onClick={() => { setRejecting(false); setRejectReason(''); }}
            style={{
              padding: '0 12px', fontSize: 12, cursor: 'pointer',
              backgroundColor: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 4,
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export const HumanActions: React.FC = () => {
  const { pending, history, loading, pendingCount, fetchPending, fetchHistory, confirm, reject } = useHumanActionsStore();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchPending();
  }, []);

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab]);

  const handleConfirm = (id: string) => confirm(id, 'admin');
  const handleReject = (id: string) => {
    setRejectTarget(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 52px 0 24px', gap: 16, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 500, color: C.text, margin: 0 }}>Human Actions</h1>
        {pendingCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            backgroundColor: C.warnDim, color: C.warn, border: `1px solid ${C.warnBorder}`,
          }}>
            {pendingCount} pending
          </span>
        )}
        <div style={{ display: 'flex', gap: 2, marginLeft: 16 }}>
          {(['pending', 'history'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              height: 28, padding: '0 14px', borderRadius: 4,
              border: `1px solid ${tab === t ? '#1E3A5F' : C.border}`,
              backgroundColor: tab === t ? '#1E3A5F' : C.panel,
              color: tab === t ? '#FFFFFF' : C.muted,
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>
              {t === 'pending' ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'History'}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={fetchPending}
            style={{
              fontSize: 12, color: C.muted, backgroundColor: 'transparent',
              border: `1px solid ${C.border}`, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading && (
          <div style={{ color: C.dim, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>Loading...</div>
        )}

        {tab === 'pending' && !loading && (
          pending.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: 200, color: C.dim, gap: 8,
            }}>
              <CheckCircle size={32} color={C.border} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>No pending actions</div>
              <div style={{ fontSize: 12 }}>Agent and Logic Function proposals requiring approval will appear here</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 860 }}>
              {pending.map((exec) => (
                <ExecutionCard
                  key={exec.id}
                  exec={exec}
                  mode="pending"
                  onConfirm={handleConfirm}
                  onReject={(id) => {
                    const reason = window.prompt('Reason for rejection:');
                    if (reason !== null) reject(id, 'admin', reason || 'No reason provided');
                  }}
                />
              ))}
            </div>
          )
        )}

        {tab === 'history' && !loading && (
          history.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              No completed actions yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 860 }}>
              {history.map((exec) => (
                <ExecutionCard key={exec.id} exec={exec} mode="history" />
              ))}
            </div>
          )
        )}
      </div>

      {/* Status bar */}
      <div style={{
        height: 32, backgroundColor: '#0D1117', borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {pendingCount} pending · {history.length} in history
        </span>
      </div>
    </div>
  );
};

export default HumanActions;
