import React, { useEffect, useState } from 'react';
import { getTenantId } from '../../store/authStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

interface Insight {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  baseline_value: number;
  current_value: number;
  delta_pct: number;
  affected_count: number;
  metric_label: string;
}

interface Props {
  objectTypeId: string;
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  HIGH: { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', badge: '#DC2626' },
  MEDIUM: { bg: '#FFF7ED', border: '#FED7AA', text: '#EA580C', badge: '#EA580C' },
  LOW: { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B', badge: '#94A3B8' },
};

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function formatVal(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

export const InsightsPanel: React.FC<Props> = ({ objectTypeId }) => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${PROCESS_API}/process/insights/${objectTypeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      });
      const data = await res.json();
      const sorted = (data.insights || []).sort(
        (a: Insight, b: Insight) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
      );
      setInsights(sorted);
    } catch {
      setInsights([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (objectTypeId) fetchInsights();
  }, [objectTypeId]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #E2E8F0', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', margin: 0 }}>AI Insights</h2>
          <p style={{ fontSize: 11, color: '#64748B', margin: '2px 0 0' }}>
            Automated anomaly detection and process health observations.
          </p>
        </div>
        <button
          onClick={fetchInsights}
          disabled={loading}
          style={{
            height: 30, padding: '0 14px', borderRadius: 6,
            border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
            color: '#1E3A5F', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 8a7 7 0 0114 0M15 8a7 7 0 01-14 0" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 88, borderRadius: 8, backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0', animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {!loading && insights.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            No insights available
          </div>
        )}

        {!loading && insights.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map((insight, i) => {
              const colors = SEVERITY_COLORS[insight.severity] || SEVERITY_COLORS.LOW;
              const deltaPositive = insight.delta_pct >= 0;

              return (
                <div key={i} style={{
                  padding: '14px 16px', borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bg,
                }}>
                  {/* Top row: severity + title + affected */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.05em', padding: '2px 6px', borderRadius: 4,
                      backgroundColor: colors.badge, color: '#FFFFFF',
                    }}>
                      {insight.severity}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', flex: 1 }}>
                      {insight.title}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      backgroundColor: '#FFFFFF', color: colors.text,
                      border: `1px solid ${colors.border}`,
                    }}>
                      {insight.affected_count.toLocaleString()} affected
                    </span>
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 8px', lineHeight: 1.5 }}>
                    {insight.description}
                  </p>

                  {/* Metric comparison */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {insight.metric_label}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                      {formatVal(insight.baseline_value)}
                    </span>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>
                      {deltaPositive ? '\u2192' : '\u2192'}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: colors.text }}>
                      {formatVal(insight.current_value)}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: deltaPositive ? '#DC2626' : '#16A34A',
                    }}>
                      {deltaPositive ? '\u25B2' : '\u25BC'} {Math.abs(insight.delta_pct).toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
