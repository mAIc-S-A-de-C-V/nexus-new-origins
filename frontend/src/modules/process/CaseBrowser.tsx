import React, { useEffect, useState } from 'react';
import { useProcessStore, ProcessCase } from '../../store/processStore';
import { CaseTimeline } from './CaseTimeline';

interface Props {
  objectTypeId: string;
  filterVariantId?: string;
}

function DurationBar({ days, maxDays, stuckThreshold = 30 }: { days: number; maxDays: number; stuckThreshold?: number }) {
  const pct = Math.min((days / Math.max(maxDays, 1)) * 100, 100);
  const color = days > stuckThreshold ? '#DC2626' : days > stuckThreshold * 0.5 ? '#D97706' : '#1E3A5F';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color }}>{days.toFixed(1)}d</div>
      <div style={{ width: 80, height: 3, backgroundColor: '#E2E8F0', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

export const CaseBrowser: React.FC<Props> = ({ objectTypeId, filterVariantId }) => {
  const { cases, fetchCases, loading } = useProcessStore();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  useEffect(() => {
    if (objectTypeId) fetchCases(objectTypeId);
  }, [objectTypeId]);

  useEffect(() => {
    if (filterVariantId) setSelectedCase(null);
  }, [filterVariantId]);

  const filtered = cases.filter(c => {
    if (search && !c.case_id.toLowerCase().includes(search.toLowerCase()) &&
        !(c.current_activity || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (stateFilter !== 'all' && c.state !== stateFilter) return false;
    if (filterVariantId && c.variant_id !== filterVariantId) return false;
    return true;
  });

  const maxDays = Math.max(...filtered.map(c => c.total_duration_days), 1);
  const stuckCount = cases.filter(c => c.state === 'stuck').length;
  const reworkCount = cases.filter(c => c.is_rework).length;

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, backgroundColor: '#F8FAFC' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search case ID or activity..."
            style={{ height: 28, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, width: 220, outline: 'none', backgroundColor: '#FFFFFF' }}
          />
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
            style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, backgroundColor: '#FFFFFF' }}>
            <option value="all">All States</option>
            <option value="active">Active</option>
            <option value="stuck">Stuck</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 11, color: '#64748B' }}>
            <span><strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{filtered.length}</strong> cases</span>
            {stuckCount > 0 && <span style={{ color: '#DC2626' }}><strong>{stuckCount}</strong> stuck</span>}
            {reworkCount > 0 && <span style={{ color: '#D97706' }}><strong>{reworkCount}</strong> rework</span>}
          </div>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 140px 100px 60px 80px 100px',
          padding: '6px 16px', backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0', flexShrink: 0,
        }}>
          {['Case ID', 'Current Activity', 'Duration', 'Events', 'Variant', 'Last Active'].map(h => (
            <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>Loading cases...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>No cases match the current filters.</div>
          ) : filtered.map(c => {
            const isSelected = selectedCase === c.case_id;
            const rowBg = c.state === 'stuck' ? '#FFFBEB' : isSelected ? '#EFF6FF' : '#FFFFFF';
            const lastActive = c.last_activity_at ? new Date(c.last_activity_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

            return (
              <div
                key={c.case_id}
                onClick={() => setSelectedCase(isSelected ? null : c.case_id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 140px 100px 60px 80px 100px',
                  padding: '8px 16px', borderBottom: '1px solid #F1F5F9',
                  cursor: 'pointer', backgroundColor: rowBg,
                  transition: 'background 80ms',
                }}
              >
                {/* Case ID */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#1D4ED8' }}>{c.case_id}</span>
                  {c.is_rework && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, backgroundColor: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', fontWeight: 700 }}>↩</span>}
                  {c.state === 'stuck' && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, backgroundColor: '#FEFCE8', color: '#92400E', border: '1px solid #FDE68A', fontWeight: 700 }}>STUCK</span>}
                </div>

                {/* Current activity */}
                <div style={{ fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingTop: 2 }}>
                  {(c.current_activity || '—').replace(/_/g, ' ')}
                </div>

                {/* Duration bar */}
                <DurationBar days={c.total_duration_days} maxDays={maxDays} />

                {/* Events */}
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#64748B', paddingTop: 2 }}>{c.event_count}</div>

                {/* Variant */}
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#94A3B8', paddingTop: 2 }}>{c.variant_id.slice(0, 8)}</div>

                {/* Last active */}
                <div style={{ fontSize: 11, color: '#94A3B8', paddingTop: 2 }}>{lastActive}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Case Timeline panel */}
      {selectedCase && (
        <CaseTimeline
          caseId={selectedCase}
          objectTypeId={objectTypeId}
          onClose={() => setSelectedCase(null)}
        />
      )}
    </div>
  );
};
