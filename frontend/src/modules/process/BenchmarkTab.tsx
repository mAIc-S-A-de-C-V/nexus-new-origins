import React, { useEffect, useState } from 'react';
import { useProcessStore, BenchmarkSegment } from '../../store/processStore';

interface Props {
  objectTypeId: string;
}

const fmtDuration = (d: number) => d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`;

const SegmentPanel: React.FC<{ segment: BenchmarkSegment; other: BenchmarkSegment; showMore: boolean }> = ({ segment, other, showMore }) => {
  const { stats, top_variants } = segment;
  const displayed = showMore ? top_variants : top_variants.slice(0, 3);
  const maxCases = Math.max(...displayed.map(v => v.case_count), 1);

  const diffColor = (val: number, otherVal: number, lowerIsBetter = false) => {
    if (val === otherVal) return '#64748B';
    const better = lowerIsBetter ? val < otherVal : val > otherVal;
    return better ? '#10B981' : '#DC2626';
  };

  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: 8, backgroundColor: '#FFFFFF', overflow: 'hidden',
    }}>
      {/* Label */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #E2E8F0',
        backgroundColor: '#F8FAFC', fontSize: 12, fontWeight: 600, color: '#1E3A5F',
      }}>
        {segment.label}
      </div>

      {/* Mini KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, backgroundColor: '#E2E8F0' }}>
        {[
          { label: 'Cases', value: stats.total_cases.toLocaleString(), raw: stats.total_cases, otherRaw: other.stats.total_cases, lowerBetter: false },
          { label: 'Avg Duration', value: fmtDuration(stats.avg_duration_days), raw: stats.avg_duration_days, otherRaw: other.stats.avg_duration_days, lowerBetter: true },
          { label: 'Variants', value: String(stats.variant_count), raw: stats.variant_count, otherRaw: other.stats.variant_count, lowerBetter: true },
          { label: 'Stuck', value: String(stats.stuck_cases), raw: stats.stuck_cases, otherRaw: other.stats.stuck_cases, lowerBetter: true },
        ].map(kpi => (
          <div key={kpi.label} style={{ backgroundColor: '#FFFFFF', padding: '10px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {kpi.label}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2,
              color: diffColor(kpi.raw, kpi.otherRaw, kpi.lowerBetter),
            }}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Variant frequency bars */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Top Variants ({displayed.length})
        </div>
        {displayed.map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < displayed.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
            <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)', width: 18, flexShrink: 0 }}>
              {v.rank}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#1E3A5F',
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {v.activities.slice(0, 4).map((act, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <span style={{ color: '#CBD5E1' }}>→</span>}
                    <span>{act.replace(/_/g, ' ').slice(0, 14)}</span>
                  </React.Fragment>
                ))}
                {v.activities.length > 4 && <span style={{ color: '#94A3B8' }}>+{v.activities.length - 4}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <div style={{ flex: 1, maxWidth: 160, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${(v.case_count / maxCases) * 100}%`, backgroundColor: '#6366F1', borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                  {v.case_count.toLocaleString()} ({v.frequency_pct}%)
                </span>
              </div>
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#64748B', flexShrink: 0 }}>
              {fmtDuration(v.avg_duration_days)}
            </span>
          </div>
        ))}
        {!displayed.length && (
          <div style={{ fontSize: 11, color: '#94A3B8', padding: '12px 0' }}>No variants found</div>
        )}
      </div>
    </div>
  );
};

export const BenchmarkTab: React.FC<Props> = ({ objectTypeId }) => {
  const { benchmarkData, availableSegments, fetchBenchmark, fetchAttributeValues } = useProcessStore();
  const [segAKey, setSegAKey] = useState('');
  const [segAVal, setSegAVal] = useState('');
  const [segBKey, setSegBKey] = useState('');
  const [segBVal, setSegBVal] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (objectTypeId) fetchAttributeValues(objectTypeId);
  }, [objectTypeId]);

  useEffect(() => {
    if (availableSegments.length > 0 && !segAKey) {
      const first = availableSegments[0];
      setSegAKey(first.key);
      setSegBKey(first.key);
      if (first.values.length >= 2) {
        setSegAVal(first.values[0]);
        setSegBVal(first.values[1]);
      } else if (first.values.length === 1) {
        setSegAVal(first.values[0]);
      }
    }
  }, [availableSegments]);

  const handleCompare = async () => {
    if (!segAKey || !segAVal || !segBKey || !segBVal) return;
    setLoading(true);
    await fetchBenchmark(objectTypeId, { key: segAKey, value: segAVal }, { key: segBKey, value: segBVal });
    setLoading(false);
  };

  const valuesForKey = (key: string) => availableSegments.find(s => s.key === key)?.values || [];

  const selectStyle: React.CSSProperties = {
    height: 30, padding: '0 24px 0 10px', borderRadius: 6,
    border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
    color: '#0D1117', fontSize: 12, cursor: 'pointer', outline: 'none',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Selector bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
        borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Segment A:</span>
        <select value={segAKey} onChange={e => { setSegAKey(e.target.value); setSegAVal(''); }} style={selectStyle}>
          <option value="">Select attribute</option>
          {availableSegments.map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select>
        <select value={segAVal} onChange={e => setSegAVal(e.target.value)} style={selectStyle}>
          <option value="">Select value</option>
          {valuesForKey(segAKey).map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        <div style={{ width: 1, height: 20, backgroundColor: '#E2E8F0' }} />

        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Segment B:</span>
        <select value={segBKey} onChange={e => { setSegBKey(e.target.value); setSegBVal(''); }} style={selectStyle}>
          <option value="">Select attribute</option>
          {availableSegments.map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select>
        <select value={segBVal} onChange={e => setSegBVal(e.target.value)} style={selectStyle}>
          <option value="">Select value</option>
          {valuesForKey(segBKey).map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        <button
          onClick={handleCompare}
          disabled={!segAKey || !segAVal || !segBKey || !segBVal || loading}
          style={{
            height: 30, padding: '0 16px', borderRadius: 6,
            border: 'none', backgroundColor: '#1E3A5F', color: '#FFFFFF',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            opacity: (!segAKey || !segAVal || !segBKey || !segBVal || loading) ? 0.5 : 1,
          }}
        >
          {loading ? 'Comparing...' : 'Compare'}
        </button>

        {benchmarkData && (
          <button
            onClick={() => setShowMore(!showMore)}
            style={{
              marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 4,
              border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
              color: '#64748B', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {showMore ? 'Show Less' : 'Show More'}
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        {!benchmarkData && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            {availableSegments.length === 0
              ? 'No attribute data available for segmentation. Ensure events have record_snapshot attributes.'
              : 'Select two segments and click Compare to see side-by-side analysis.'
            }
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            Loading benchmark data...
          </div>
        )}

        {benchmarkData && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <SegmentPanel segment={benchmarkData.segment_a} other={benchmarkData.segment_b} showMore={showMore} />
            <SegmentPanel segment={benchmarkData.segment_b} other={benchmarkData.segment_a} showMore={showMore} />
          </div>
        )}
      </div>
    </div>
  );
};
