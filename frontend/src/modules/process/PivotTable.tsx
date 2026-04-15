import React, { useState } from 'react';
import { getTenantId } from '../../store/authStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

const DIMENSION_OPTIONS = ['activity', 'resource', 'month', 'day_of_week'];
const METRIC_OPTIONS = ['count', 'avg_duration', 'rework_rate'];

interface PivotResult {
  columns: string[];
  rows: { row_keys: string[]; values: number[] }[];
  totals: number[];
}

interface Props {
  objectTypeId: string;
}

function heatColor(value: number, min: number, max: number): string {
  if (max === min) return '#F8FAFC';
  const ratio = (value - min) / (max - min);
  if (ratio < 0.25) return '#F0F9FF';
  if (ratio < 0.5) return '#BFDBFE';
  if (ratio < 0.75) return '#60A5FA';
  return '#2563EB';
}

function heatText(value: number, min: number, max: number): string {
  if (max === min) return '#0D1117';
  const ratio = (value - min) / (max - min);
  return ratio >= 0.75 ? '#FFFFFF' : '#0D1117';
}

function formatMetric(v: number, metric: string): string {
  if (metric === 'rework_rate') return `${(v * 100).toFixed(1)}%`;
  if (metric === 'avg_duration') return v < 1 ? `${(v * 24).toFixed(1)}h` : `${v.toFixed(1)}d`;
  return v.toLocaleString();
}

export const PivotTable: React.FC<Props> = ({ objectTypeId }) => {
  const [selectedDims, setSelectedDims] = useState<string[]>([]);
  const [metric, setMetric] = useState('count');
  const [result, setResult] = useState<PivotResult | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleDim = (dim: string) => {
    setSelectedDims(prev =>
      prev.includes(dim) ? prev.filter(d => d !== dim) : [...prev, dim]
    );
  };

  const analyze = async () => {
    if (selectedDims.length === 0) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('rows', selectedDims.join(','));
      params.set('metric', metric);
      const res = await fetch(`${PROCESS_API}/process/pivot/${objectTypeId}?${params.toString()}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const header = [...selectedDims.map(d => d.toUpperCase()), ...result.columns].join(',');
    const rows = result.rows.map(r =>
      [...r.row_keys, ...r.values.map(v => formatMetric(v, metric))].join(',')
    );
    const totalsRow = [...selectedDims.map(() => ''), ...result.totals.map(v => formatMetric(v, metric))].join(',');
    const csv = [header, ...rows, `TOTAL${totalsRow}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pivot_${metric}_${selectedDims.join('_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute global min/max for heat map
  let allValues: number[] = [];
  if (result) {
    allValues = result.rows.flatMap(r => r.values);
  }
  const minVal = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', margin: 0 }}>Pivot Table Analysis</h2>
        <p style={{ fontSize: 11, color: '#64748B', margin: '2px 0 0' }}>
          Multi-dimensional aggregation with heat-map visualization.
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
        borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* Row dimensions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Rows
          </span>
          {DIMENSION_OPTIONS.map(dim => (
            <button
              key={dim}
              onClick={() => toggleDim(dim)}
              style={{
                height: 26, padding: '0 10px', borderRadius: 12,
                border: selectedDims.includes(dim) ? '1.5px solid #1E3A5F' : '1px solid #E2E8F0',
                backgroundColor: selectedDims.includes(dim) ? '#1E3A5F' : '#FFFFFF',
                color: selectedDims.includes(dim) ? '#FFFFFF' : '#64748B',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {dim.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, backgroundColor: '#E2E8F0' }} />

        {/* Metric */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Metric
          </span>
          <select
            value={metric}
            onChange={e => setMetric(e.target.value)}
            style={{
              height: 28, padding: '0 24px 0 8px', borderRadius: 6,
              border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
              color: '#0D1117', fontSize: 11, fontWeight: 500,
              cursor: 'pointer', outline: 'none', appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
            }}
          >
            {METRIC_OPTIONS.map(m => (
              <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Analyze button */}
        <button
          onClick={analyze}
          disabled={selectedDims.length === 0 || loading}
          style={{
            height: 30, padding: '0 16px', borderRadius: 6,
            border: 'none',
            backgroundColor: selectedDims.length > 0 ? '#1E3A5F' : '#E2E8F0',
            color: selectedDims.length > 0 ? '#FFFFFF' : '#94A3B8',
            fontSize: 12, fontWeight: 600, cursor: selectedDims.length > 0 ? 'pointer' : 'default',
          }}
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Export CSV */}
        {result && (
          <button
            onClick={exportCsv}
            style={{
              height: 28, padding: '0 12px', borderRadius: 5,
              border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
              color: '#64748B', fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 12h8M8 3v7M5 7l3 3 3-3" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* Table content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {!result && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            Select row dimensions and click Analyze
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            Building pivot table...
          </div>
        )}

        {!loading && result && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                  {selectedDims.map(dim => (
                    <th key={dim} style={{
                      textAlign: 'left', padding: '8px 12px',
                      color: '#64748B', fontWeight: 600, fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      position: 'sticky', top: 0, backgroundColor: '#FFFFFF',
                    }}>
                      {dim.replace(/_/g, ' ')}
                    </th>
                  ))}
                  {result.columns.map(col => (
                    <th key={col} style={{
                      textAlign: 'right', padding: '8px 12px',
                      color: '#64748B', fontWeight: 600, fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      position: 'sticky', top: 0, backgroundColor: '#FFFFFF',
                    }}>
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    {row.row_keys.map((key, ki) => (
                      <td key={ki} style={{
                        padding: '8px 12px', color: '#0D1117', fontWeight: 500,
                      }}>
                        {key.replace(/_/g, ' ')}
                      </td>
                    ))}
                    {row.values.map((val, vi) => (
                      <td key={vi} style={{
                        padding: '8px 12px', textAlign: 'right',
                        fontFamily: 'var(--font-mono)', fontWeight: 600,
                        backgroundColor: heatColor(val, minVal, maxVal),
                        color: heatText(val, minVal, maxVal),
                        transition: 'background 200ms',
                      }}>
                        {formatMetric(val, metric)}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Totals row */}
                {result.totals && (
                  <tr style={{ borderTop: '2px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                    {selectedDims.map((_, i) => (
                      <td key={i} style={{
                        padding: '8px 12px', fontWeight: 700, fontSize: 10,
                        textTransform: 'uppercase', color: '#64748B',
                      }}>
                        {i === 0 ? 'TOTAL' : ''}
                      </td>
                    ))}
                    {result.totals.map((val, vi) => (
                      <td key={vi} style={{
                        padding: '8px 12px', textAlign: 'right',
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: '#1E3A5F',
                      }}>
                        {formatMetric(val, metric)}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
