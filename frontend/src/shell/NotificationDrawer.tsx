import React, { useEffect, useState } from 'react';
import {
  X, CheckCheck, AlertTriangle, AlertCircle, Trash2,
  CheckCircle2, XCircle, ChevronDown, ChevronRight, Activity,
} from 'lucide-react';
import { useAlertStore, AlertNotification } from '../store/alertStore';
import { useRunLogStore, RunLog, NodeAudit } from '../store/runLogStore';

interface Props {
  onClose: () => void;
}

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ─── Alert tab ───────────────────────────────────────────────────────────────

const SeverityIcon: React.FC<{ severity: AlertNotification['severity'] }> = ({ severity }) =>
  severity === 'critical'
    ? <AlertCircle size={13} style={{ color: '#EF4444', flexShrink: 0 }} />
    : <AlertTriangle size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />;

const AlertRow: React.FC<{
  notification: AlertNotification;
  onRead: () => void;
  onDelete: () => void;
}> = ({ notification: n, onRead, onDelete }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onClick={onRead}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid #131C2E',
        backgroundColor: n.read ? 'transparent' : '#111926',
        cursor: n.read ? 'default' : 'pointer',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}
    >
      <SeverityIcon severity={n.severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: n.severity === 'critical' ? '#FCA5A5' : '#FCD34D',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {n.rule_name}
          </span>
          {!n.read && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#EF4444', flexShrink: 0 }} />
          )}
        </div>
        <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {n.message}
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {timeAgo(n.fired_at)}
        </div>
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}
          title="Dismiss"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};

// ─── Logs tab ─────────────────────────────────────────────────────────────────

const NodeRow: React.FC<{ audit: NodeAudit }> = ({ audit: a }) => {
  const [expanded, setExpanded] = useState(false);
  const stats = a.stats as Record<string, unknown> | undefined;
  const isSource = a.node_type === 'SOURCE';
  const hasDetail = isSource && stats;

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Summary line */}
      <div
        onClick={() => hasDetail && setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: '#94A3B8',
          cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        {a.status === 'ok'
          ? <CheckCircle2 size={11} style={{ color: '#22C55E', flexShrink: 0 }} />
          : a.status === 'error'
          ? <XCircle size={11} style={{ color: '#EF4444', flexShrink: 0 }} />
          : <Activity size={11} style={{ color: '#64748B', flexShrink: 0 }} />}
        <span style={{ flex: 1 }}>
          <span style={{ color: '#CBD5E1', fontWeight: 500 }}>{a.label || a.node_type}</span>
          {' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: '#64748B' }}>
            {a.rows_in}→{a.rows_out}
          </span>
          {a.duration_ms !== undefined && (
            <span style={{ color: '#475569', marginLeft: 6 }}>{a.duration_ms}ms</span>
          )}
          {isSource && stats?.raw_row_count !== undefined && stats.raw_row_count !== a.rows_out && (
            <span style={{ color: '#F59E0B', marginLeft: 6 }}>({stats.raw_row_count as number} from API)</span>
          )}
        </span>
        {a.error && (
          <span style={{ color: '#FCA5A5', fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.error}>
            {a.error}
          </span>
        )}
        {hasDetail && (
          expanded
            ? <ChevronDown size={11} style={{ color: '#475569', flexShrink: 0 }} />
            : <ChevronRight size={11} style={{ color: '#475569', flexShrink: 0 }} />
        )}
      </div>

      {/* SOURCE detail */}
      {expanded && hasDetail && (
        <div style={{
          marginTop: 6, marginLeft: 19, padding: '8px 10px',
          backgroundColor: '#0A1220', borderRadius: 4, border: '1px solid #1E2D42',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* URL */}
          {stats.url && (
            <div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                Endpoint
              </div>
              <div style={{ fontSize: 10, color: '#93C5FD', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                {stats.url as string}
              </div>
            </div>
          )}

          {/* HTTP status */}
          {stats.http_status !== undefined && (
            <div style={{ display: 'flex', gap: 16, fontSize: 10 }}>
              <span>
                <span style={{ color: '#475569' }}>HTTP </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: (stats.http_status as number) < 300 ? '#22C55E' : '#EF4444',
                }}>
                  {stats.http_status as number}
                </span>
              </span>
              {stats.raw_row_count !== undefined && (
                <span>
                  <span style={{ color: '#475569' }}>rows returned </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#E2E8F0' }}>{stats.raw_row_count as number}</span>
                </span>
              )}
            </div>
          )}

          {/* Resolved params */}
          {stats.resolved_params && Object.keys(stats.resolved_params as object).length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                Query Params
              </div>
              {Object.entries(stats.resolved_params as Record<string, string>).map(([k, v]) => (
                <div key={k} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94A3B8' }}>
                  <span style={{ color: '#64748B' }}>{k}</span>=<span style={{ color: '#FCD34D' }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Response error */}
          {stats.response_error && (
            <div style={{ fontSize: 10, color: '#FCA5A5', wordBreak: 'break-word' }}>
              {stats.response_error as string}
            </div>
          )}

          {/* Sample output rows */}
          {a.sample_out && a.sample_out.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                Sample ({a.sample_out.length} of {stats.raw_row_count ?? a.rows_out})
              </div>
              <pre style={{
                fontSize: 9, color: '#94A3B8', margin: 0,
                overflow: 'auto', maxHeight: 160,
                backgroundColor: '#060D18', padding: 6, borderRadius: 3,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {JSON.stringify(a.sample_out[0], null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const LogRow: React.FC<{
  log: RunLog;
  onRead: () => void;
  onDelete: () => void;
}> = ({ log, onRead, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = React.useState(false);
  const failed = log.status === 'FAILED';

  return (
    <div
      style={{
        borderBottom: '1px solid #131C2E',
        backgroundColor: log.read ? 'transparent' : '#111926',
      }}
    >
      <div
        onClick={() => { onRead(); setExpanded((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '10px 16px', cursor: 'pointer',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}
      >
        {failed
          ? <XCircle size={13} style={{ color: '#EF4444', flexShrink: 0, marginTop: 1 }} />
          : <CheckCircle2 size={13} style={{ color: '#22C55E', flexShrink: 0, marginTop: 1 }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: failed ? '#FCA5A5' : '#86EFAC',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {failed ? 'Failed' : 'Completed'}
            </span>
            {!log.read && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: failed ? '#EF4444' : '#22C55E', flexShrink: 0 }} />
            )}
          </div>
          <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.4, marginBottom: 2 }}>
            {log.pipeline_name}
          </div>
          {log.error && (
            <div style={{
              fontSize: 11, color: '#FCA5A5', lineHeight: 1.4,
              marginBottom: 3, wordBreak: 'break-word',
            }}>
              {log.error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
            <span>{log.rows_in} in · {log.rows_out} out</span>
            <span>{timeAgo(log.started_at)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {hovered && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: 2, display: 'flex', alignItems: 'center' }}
              title="Dismiss"
            >
              <Trash2 size={12} />
            </button>
          )}
          {log.node_audits.length > 0 && (
            expanded
              ? <ChevronDown size={13} style={{ color: '#475569' }} />
              : <ChevronRight size={13} style={{ color: '#475569' }} />
          )}
        </div>
      </div>

      {expanded && log.node_audits.length > 0 && (
        <div style={{ padding: '0 16px 10px 38px', display: 'flex', flexDirection: 'column' }}>
          {log.node_audits.map((a, i) => <NodeRow key={i} audit={a} />)}
        </div>
      )}
    </div>
  );
};

// ─── Drawer ───────────────────────────────────────────────────────────────────

export const NotificationDrawer: React.FC<Props> = ({ onClose }) => {
  const {
    notifications, unreadCount: alertUnread,
    fetchNotifications, markRead: markAlertRead, markAllRead: markAllAlertRead,
    deleteNotification,
  } = useAlertStore();

  const {
    logs, unreadCount: logUnread,
    markRead: markLogRead, markAllRead: markAllLogRead,
    deleteLog,
  } = useRunLogStore();

  const [tab, setTab] = useState<'alerts' | 'logs'>('logs');

  useEffect(() => {
    fetchNotifications();
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, textAlign: 'center', padding: '6px 0',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
    backgroundColor: 'transparent',
    color: active ? '#E2E8F0' : '#475569',
    borderBottom: active ? '2px solid #3B82F6' : '2px solid transparent',
    transition: 'color 80ms, border-color 80ms',
  });

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={onClose} />

      <div style={{
        position: 'fixed', top: 0, right: 0,
        width: 380, height: '100vh',
        backgroundColor: '#0F1824',
        borderLeft: '1px solid #1E2D42',
        display: 'flex', flexDirection: 'column',
        zIndex: 201,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 16px',
          borderBottom: '1px solid #1E2D42', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', flex: 1 }}>
            Notifications
          </span>
          {tab === 'alerts' && alertUnread > 0 && (
            <button
              onClick={() => markAllAlertRead()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748B', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
            >
              <CheckCheck size={13} /> All read
            </button>
          )}
          {tab === 'logs' && logUnread > 0 && (
            <button
              onClick={() => markAllLogRead()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748B', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
            >
              <CheckCheck size={13} /> All read
            </button>
          )}
          <button
            onClick={onClose}
            style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1E2D42', flexShrink: 0 }}>
          <button style={tabStyle(tab === 'logs')} onClick={() => setTab('logs')}>
            Pipeline Runs
            {logUnread > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, backgroundColor: '#EF4444', color: '#FFF', borderRadius: 10, padding: '1px 5px' }}>
                {logUnread}
              </span>
            )}
          </button>
          <button style={tabStyle(tab === 'alerts')} onClick={() => setTab('alerts')}>
            Alerts
            {alertUnread > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, backgroundColor: '#EF4444', color: '#FFF', borderRadius: 10, padding: '1px 5px' }}>
                {alertUnread}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'alerts' && (
            notifications.length === 0
              ? <EmptyState message="No alerts yet" hint="Configure alert rules in Process Mining → Alerts" />
              : notifications.map((n) => (
                <AlertRow
                  key={n.id}
                  notification={n}
                  onRead={() => !n.read && markAlertRead(n.id)}
                  onDelete={() => deleteNotification(n.id)}
                />
              ))
          )}
          {tab === 'logs' && (
            logs.length === 0
              ? <EmptyState message="No pipeline runs yet" hint="Run a pipeline to see execution logs here" />
              : logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  onRead={() => !log.read && markLogRead(log.id)}
                  onDelete={() => deleteLog(log.id)}
                />
              ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          height: 40, borderTop: '1px solid #1E2D42', padding: '0 16px',
          display: 'flex', alignItems: 'center',
          fontSize: 11, color: '#334155',
        }}>
          {tab === 'alerts'
            ? `${notifications.length} total · ${alertUnread} unread`
            : `${logs.length} runs · ${logUnread} unread`}
        </div>
      </div>
    </>
  );
};

const EmptyState: React.FC<{ message: string; hint: string }> = ({ message, hint }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: 200, gap: 8,
  }}>
    <span style={{ fontSize: 13, color: '#475569' }}>{message}</span>
    <span style={{ fontSize: 11, color: '#334155', textAlign: 'center', padding: '0 24px' }}>{hint}</span>
  </div>
);
