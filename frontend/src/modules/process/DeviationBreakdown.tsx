import React, { useState } from 'react';
import { ConformanceCheckResult, CaseConformance, Deviation } from '../../store/conformanceStore';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  result: ConformanceCheckResult;
}

const DEV_COLORS: Record<string, string> = {
  skip: '#64748B',
  wrong_order: '#F59E0B',
  unauthorized: '#EF4444',
  rework: '#8B5CF6',
};

const DEV_BG: Record<string, string> = {
  skip: '#F8FAFC',
  wrong_order: '#FFFBEB',
  unauthorized: '#FEF2F2',
  rework: '#F5F3FF',
};

export const DeviationBreakdown: React.FC<Props> = ({ result }) => {
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  const nonConformant = result.cases
    .filter(c => !c.is_conformant)
    .sort((a, b) => a.fitness - b.fitness);

  const displayed = showAll ? nonConformant : nonConformant.slice(0, 20);

  const allDeviationTypes = ['skip', 'wrong_order', 'unauthorized', 'rework'];

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Deviation frequency table */}
      {Object.keys(result.aggregate.deviation_summary).length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', marginBottom: 8 }}>
            Most Problematic Stages
          </div>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  <th style={thStyle}>Stage</th>
                  <th style={{ ...thStyle, color: DEV_COLORS.skip }}>Skipped</th>
                  <th style={{ ...thStyle, color: DEV_COLORS.wrong_order }}>Wrong order</th>
                  <th style={{ ...thStyle, color: DEV_COLORS.unauthorized }}>Unauthorized</th>
                  <th style={{ ...thStyle, color: DEV_COLORS.rework }}>Rework</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.aggregate.deviation_summary)
                  .slice(0, 10)
                  .map(([activity, counts]) => {
                    const total = Object.values(counts).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={activity} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ ...tdStyle, fontWeight: 500, color: '#0D1117' }}>
                          {activity.replace(/_/g, ' ')}
                        </td>
                        <td style={{ ...tdStyle, color: DEV_COLORS.skip }}>{counts.skip || 0}</td>
                        <td style={{ ...tdStyle, color: DEV_COLORS.wrong_order }}>{counts.wrong_order || 0}</td>
                        <td style={{ ...tdStyle, color: DEV_COLORS.unauthorized }}>{counts.unauthorized || 0}</td>
                        <td style={{ ...tdStyle, color: DEV_COLORS.rework }}>{counts.rework || 0}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{total}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Non-conformant cases */}
      {nonConformant.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>
              Non-conformant Cases ({nonConformant.length})
            </span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              {['all', ...allDeviationTypes].map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    height: 22, padding: '0 8px', fontSize: 10, fontWeight: 500,
                    borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${filterType === t ? '#1E3A5F' : '#E2E8F0'}`,
                    backgroundColor: filterType === t ? '#1E3A5F' : '#FFFFFF',
                    color: filterType === t ? '#FFFFFF' : '#64748B',
                    textTransform: 'capitalize',
                  }}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {displayed
              .filter(c => filterType === 'all' || c.deviations.some(d => d.type === filterType))
              .map(c => (
                <CaseRow
                  key={c.case_id}
                  caseConformance={c}
                  expanded={expandedCase === c.case_id}
                  onToggle={() => setExpandedCase(prev => prev === c.case_id ? null : c.case_id)}
                  filterType={filterType}
                />
              ))}
          </div>

          {nonConformant.length > 20 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                marginTop: 8, width: '100%', height: 28,
                backgroundColor: '#F8FAFC', color: '#64748B',
                border: '1px solid #E2E8F0', borderRadius: 4,
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Show all {nonConformant.length} cases
            </button>
          )}
        </div>
      )}

      {nonConformant.length === 0 && (
        <div style={{
          padding: 24, textAlign: 'center', border: '1px solid #E2E8F0',
          borderRadius: 6, backgroundColor: '#F0FDF4',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>All cases are conformant</div>
          <div style={{ fontSize: 11, color: '#16A34A', marginTop: 4 }}>
            Every case follows the expected happy path within the threshold.
          </div>
        </div>
      )}
    </div>
  );
};


const CaseRow: React.FC<{
  caseConformance: CaseConformance;
  expanded: boolean;
  onToggle: () => void;
  filterType: string;
}> = ({ caseConformance: c, expanded, onToggle, filterType }) => {
  const deviations = filterType === 'all'
    ? c.deviations
    : c.deviations.filter(d => d.type === filterType);

  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden',
      backgroundColor: '#FAFAFA',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 12px', cursor: 'pointer',
        }}
      >
        {expanded ? <ChevronDown size={12} color="#94A3B8" /> : <ChevronRight size={12} color="#94A3B8" />}

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#475569', flex: 1 }}>
          {c.case_id.length > 30 ? `…${c.case_id.slice(-28)}` : c.case_id}
        </span>

        {/* Fitness bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 60, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', overflow: 'hidden' }}>
            <div style={{
              width: `${c.fitness * 100}%`, height: '100%',
              backgroundColor: c.fitness >= 0.85 ? '#10B981' : c.fitness >= 0.6 ? '#F59E0B' : '#EF4444',
            }} />
          </div>
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
            color: c.fitness >= 0.85 ? '#10B981' : c.fitness >= 0.6 ? '#F59E0B' : '#EF4444',
            minWidth: 36,
          }}>
            {(c.fitness * 100).toFixed(0)}%
          </span>
        </div>

        {/* Deviation badges */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['skip', 'wrong_order', 'unauthorized', 'rework'] as const)
            .filter(t => c.deviations.some(d => d.type === t))
            .map(t => {
              const count = c.deviations.filter(d => d.type === t).length;
              return (
                <span key={t} style={{
                  fontSize: 10, padding: '1px 5px', borderRadius: 10,
                  backgroundColor: DEV_BG[t], color: DEV_COLORS[t],
                  border: `1px solid ${DEV_COLORS[t]}30`,
                  fontWeight: 500,
                }}>
                  {count} {t.replace('_', ' ')}
                </span>
              );
            })}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 10px', borderTop: '1px solid #F1F5F9' }}>
          {deviations.length === 0 ? (
            <div style={{ fontSize: 11, color: '#94A3B8', padding: '6px 0' }}>No deviations of this type.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              {deviations.map((d, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '4px 8px', borderRadius: 4,
                  backgroundColor: DEV_BG[d.type] || '#F8FAFC',
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'capitalize',
                    color: DEV_COLORS[d.type], minWidth: 70,
                  }}>
                    {d.type.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: 11, color: '#475569' }}>{d.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, color: '#64748B',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, color: '#475569',
};
