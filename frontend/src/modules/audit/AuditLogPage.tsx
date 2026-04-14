import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollText, RefreshCw, Download, ChevronDown, ChevronRight,
  Filter, X, Search, CheckCircle2, XCircle,
} from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

// ── Types ──────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  tenant_id: string;
  actor_id?: string;
  actor_role?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  ip_address?: string;
  user_agent?: string;
  occurred_at: string;
  success: boolean;
  error_message?: string | null;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', card: '#F8FAFC',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', successDim: '#ECFDF5',
  error: '#DC2626', errorDim: '#FEF2F2',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function actionMeta(action: string): { bg: string; color: string } {
  if (action.includes('delete') || action.includes('remove')) return { bg: '#FEE2E2', color: '#DC2626' };
  if (action.includes('create') || action.includes('register')) return { bg: '#DCFCE7', color: '#15803D' };
  if (action.includes('update') || action.includes('patch')) return { bg: '#FEF9C3', color: '#854D0E' };
  if (action.includes('login') || action.includes('auth')) return { bg: '#DBEAFE', color: '#1D4ED8' };
  if (action.includes('execute') || action.includes('run')) return { bg: '#EDE9FE', color: '#6D28D9' };
  return { bg: '#F1F5F9', color: '#475569' };
}

// ── StateDiff ──────────────────────────────────────────────────────────────

const StateDiff: React.FC<{
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}> = ({ before, after }) => {
  const allKeys = Array.from(new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]));

  if (allKeys.length === 0) {
    return <span style={{ color: C.dim, fontSize: 11 }}>No state recorded</span>;
  }

  const changed = allKeys.filter(k => {
    const bv = JSON.stringify((before || {})[k]);
    const av = JSON.stringify((after || {})[k]);
    return bv !== av;
  });

  const unchanged = allKeys.filter(k => !changed.includes(k));

  return (
    <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
      {changed.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Changed fields
          </div>
          {changed.map(k => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 8, marginBottom: 3, alignItems: 'start' }}>
              <span style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
              <span style={{ color: '#DC2626', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {before ? String(JSON.stringify((before)[k]) ?? '∅') : '∅'}
              </span>
              <span style={{ color: '#059669', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {after ? String(JSON.stringify((after)[k]) ?? '∅') : '∅'}
              </span>
            </div>
          ))}
        </div>
      )}
      {unchanged.length > 0 && unchanged.length <= 8 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Unchanged
          </div>
          {unchanged.map(k => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, marginBottom: 3, alignItems: 'start' }}>
              <span style={{ color: C.dim }}>{k}</span>
              <span style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {String(JSON.stringify((before || after || {})[k]) ?? '—')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── EventRow ───────────────────────────────────────────────────────────────

const EventRow: React.FC<{ event: AuditEvent; expanded: boolean; onToggle: () => void }> = ({
  event, expanded, onToggle,
}) => {
  const am = actionMeta(event.action);
  const hasDiff = event.before_state || event.after_state;

  return (
    <>
      <tr
        onClick={hasDiff ? onToggle : undefined}
        style={{
          cursor: hasDiff ? 'pointer' : 'default',
          backgroundColor: expanded ? '#F8F5FF' : C.panel,
          transition: 'background-color 80ms',
        }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.backgroundColor = C.bg; }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.backgroundColor = C.panel; }}
      >
        <td style={{ padding: '9px 12px', width: 28 }}>
          {hasDiff
            ? (expanded
              ? <ChevronDown size={13} color={C.muted} />
              : <ChevronRight size={13} color={C.dim} />)
            : null}
        </td>
        <td style={{ padding: '9px 12px', fontSize: 12, color: C.dim, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }}>
          {fmtDate(event.occurred_at)}
        </td>
        <td style={{ padding: '9px 12px', fontSize: 12, color: C.text, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.actor_id || '—'}
        </td>
        <td style={{ padding: '9px 8px' }}>
          <span style={{
            display: 'inline-block', padding: '2px 7px', borderRadius: 4,
            fontSize: 11, fontWeight: 500,
            backgroundColor: am.bg, color: am.color,
          }}>
            {event.action}
          </span>
        </td>
        <td style={{ padding: '9px 12px', fontSize: 12, color: C.muted, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.resource_type}
        </td>
        <td style={{ padding: '9px 12px', fontSize: 11, color: C.dim, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }}>
          {event.resource_id || '—'}
        </td>
        <td style={{ padding: '9px 12px' }}>
          {event.success
            ? <CheckCircle2 size={14} color={C.success} />
            : <XCircle size={14} color={C.error} />}
        </td>
      </tr>
      {expanded && (
        <tr style={{ backgroundColor: '#FDFBFF' }}>
          <td colSpan={7} style={{ padding: '0 12px 12px 52px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ paddingTop: 10 }}>
              {event.error_message && (
                <div style={{
                  marginBottom: 10, padding: '8px 12px',
                  backgroundColor: C.errorDim, border: `1px solid #FECACA`, borderRadius: 4,
                  fontSize: 12, color: C.error,
                }}>
                  {event.error_message}
                </div>
              )}
              {event.ip_address && (
                <div style={{ marginBottom: 8, fontSize: 11, color: C.muted }}>
                  IP: <span style={{ fontFamily: 'var(--font-mono, monospace)', color: C.text }}>{event.ip_address}</span>
                  {event.actor_role && <span style={{ marginLeft: 16 }}>Role: <span style={{ color: C.text }}>{event.actor_role}</span></span>}
                </div>
              )}
              {hasDiff && <StateDiff before={event.before_state} after={event.after_state} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────

const RESOURCE_TYPES = [
  'connector', 'pipeline', 'agent', 'logic_function', 'ontology',
  'user', 'action', 'alert', 'process', 'utility',
];

const ACTIONS = [
  'create', 'update', 'delete', 'execute', 'login', 'logout',
  'approve', 'reject', 'run', 'restore',
];

export const AuditLogPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [actorFilter, setActorFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (actorFilter) params.set('actor_id', actorFilter);
      if (resourceTypeFilter) params.set('resource_type', resourceTypeFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (fromDate) params.set('from_time', new Date(fromDate).toISOString());
      if (toDate) params.set('to_time', new Date(toDate + 'T23:59:59').toISOString());

      const res = await fetch(`${AUDIT_API}/audit?${params}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!res.ok) throw new Error(await res.text());
      const data: AuditEvent[] = await res.json();
      setEvents(data);
      setTotal(data.length < PAGE_SIZE ? page * PAGE_SIZE + data.length : (page + 1) * PAGE_SIZE + 1);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [actorFilter, resourceTypeFilter, actionFilter, fromDate, toDate, page]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const filteredEvents = events.filter(e => {
    if (successFilter === 'success' && !e.success) return false;
    if (successFilter === 'failure' && e.success) return false;
    if (search) {
      const q = search.toLowerCase();
      return (e.actor_id || '').toLowerCase().includes(q)
        || e.action.toLowerCase().includes(q)
        || e.resource_type.toLowerCase().includes(q)
        || (e.resource_id || '').toLowerCase().includes(q);
    }
    return true;
  });

  const exportCSV = () => {
    const rows = [
      ['Timestamp', 'Actor', 'Role', 'Action', 'Resource Type', 'Resource ID', 'Status', 'Error'],
      ...filteredEvents.map(e => [
        e.occurred_at, e.actor_id || '', e.actor_role || '',
        e.action, e.resource_type, e.resource_id || '',
        e.success ? 'success' : 'failure', e.error_message || '',
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_log_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setActorFilter(''); setResourceTypeFilter(''); setActionFilter('');
    setSuccessFilter('all'); setFromDate(''); setToDate(''); setSearch(''); setPage(0);
  };
  const hasFilters = actorFilter || resourceTypeFilter || actionFilter || successFilter !== 'all' || fromDate || toDate;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>

      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0,
      }}>
        <ScrollText size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Audit Log</h1>
        <span style={{
          fontSize: 10, backgroundColor: C.accentDim, color: C.accent,
          padding: '2px 7px', fontWeight: 600, letterSpacing: '0.06em', borderRadius: 3,
          border: `1px solid ${C.border}`,
        }}>
          ADMIN
        </span>
        <div style={{ flex: 1 }} />
        {loading && <div style={{ width: 14, height: 14, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
        <button onClick={exportCSV} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 4,
          color: C.muted, fontSize: 12, cursor: 'pointer',
        }}>
          <Download size={12} /> Export CSV
        </button>
        <button onClick={fetchEvents} title="Refresh" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 4,
          backgroundColor: C.panel, cursor: 'pointer', color: C.muted,
        }}>
          <RefreshCw size={13} />
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* Filter bar */}
      <div style={{
        backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0,
      }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: C.dim }} />
          <input
            placeholder="Search actor, action, resource..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', height: 30, paddingLeft: 26, paddingRight: 8,
              border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: C.text,
              backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        <select value={resourceTypeFilter} onChange={e => { setResourceTypeFilter(e.target.value); setPage(0); }}
          style={{ height: 30, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: resourceTypeFilter ? C.text : C.dim, backgroundColor: C.bg }}>
          <option value="">All resource types</option>
          {RESOURCE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          style={{ height: 30, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: actionFilter ? C.text : C.dim, backgroundColor: C.bg }}>
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <select value={successFilter} onChange={e => { setSuccessFilter(e.target.value as 'all' | 'success' | 'failure'); setPage(0); }}
          style={{ height: 30, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: successFilter !== 'all' ? C.text : C.dim, backgroundColor: C.bg }}>
          <option value="all">All statuses</option>
          <option value="success">Success only</option>
          <option value="failure">Failures only</option>
        </select>

        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
          style={{ height: 30, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: fromDate ? C.text : C.dim, backgroundColor: C.bg }} />
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
          style={{ height: 30, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: toDate ? C.text : C.dim, backgroundColor: C.bg }} />

        {hasFilters && (
          <button onClick={clearFilters} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            height: 30, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 12, color: C.muted, backgroundColor: C.bg, cursor: 'pointer',
          }}>
            <X size={11} /> Clear
          </button>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>
          <Filter size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {filteredEvents.length} events
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredEvents.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: C.dim }}>
            <ScrollText size={32} color={C.border} />
            <div style={{ fontSize: 13 }}>No audit events found</div>
            {hasFilters && <button onClick={clearFilters} style={{ fontSize: 12, color: C.accent, background: 'none', border: 'none', cursor: 'pointer' }}>Clear filters</button>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: C.bg, position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ width: 28, padding: '8px 12px', borderBottom: `1px solid ${C.border}` }} />
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>Timestamp</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Actor</th>
                <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Action</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Resource Type</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Resource ID</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map(event => (
                <EventRow
                  key={event.id}
                  event={event}
                  expanded={expandedId === event.id}
                  onToggle={() => setExpandedId(prev => prev === event.id ? null : event.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {(page > 0 || events.length === PAGE_SIZE) && (
        <div style={{
          borderTop: `1px solid ${C.border}`, backgroundColor: C.panel,
          padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            style={{
              padding: '5px 12px', border: `1px solid ${C.border}`, borderRadius: 4,
              fontSize: 12, color: page === 0 ? C.dim : C.text,
              backgroundColor: C.bg, cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: C.muted }}>Page {page + 1}</span>
          <button
            disabled={events.length < PAGE_SIZE}
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '5px 12px', border: `1px solid ${C.border}`, borderRadius: 4,
              fontSize: 12, color: events.length < PAGE_SIZE ? C.dim : C.text,
              backgroundColor: C.bg, cursor: events.length < PAGE_SIZE ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>
            Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + events.length}
          </span>
        </div>
      )}
    </div>
  );
};

export default AuditLogPage;
