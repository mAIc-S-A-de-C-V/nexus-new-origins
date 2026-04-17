import React, { useEffect, useState } from 'react';
import { getTenantId } from '../../store/authStore';
import { useProcessStore } from '../../store/processStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

interface Insight {
  type: string;
  severity: string;
  title: string;
  description: string;
  baseline_value?: number;
  metric_value?: number;
  current_value?: number;
  delta_pct?: number;
  affected_count?: number;
  metric_label?: string;
}

interface Suggestion {
  type: string;
  icon: string;
  label: string;
  description: string;
  est_reduction_pct: number;
  category: string;
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

function formatVal(v: number | undefined | null): string {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

export const InsightsPanel: React.FC<Props> = ({ objectTypeId }) => {
  const { eventConfig, dateRange, attributeFilters } = useProcessStore();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);

  const buildQs = () => {
    const params = new URLSearchParams();
    if (eventConfig.excluded_activities.length > 0) params.set('excluded', eventConfig.excluded_activities.join(','));
    if (eventConfig.activity_attribute) params.set('activity_attribute', eventConfig.activity_attribute);
    if (eventConfig.case_id_attribute) params.set('case_id_attribute', eventConfig.case_id_attribute);
    if (eventConfig.timestamp_attribute) params.set('timestamp_attribute', eventConfig.timestamp_attribute);
    if (dateRange?.start) params.set('start_date', dateRange.start);
    if (dateRange?.end) params.set('end_date', dateRange.end);
    if (attributeFilters && Object.keys(attributeFilters).length > 0) params.set('attribute_filters', JSON.stringify(attributeFilters));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const qs = buildQs();
      const res = await fetch(`${PROCESS_API}/process/insights/${objectTypeId}${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      });
      const data = await res.json();
      const normalized = (data.insights || []).map((i: Insight) => ({
        ...i,
        severity: (i.severity || 'LOW').toUpperCase(),
        current_value: i.current_value ?? i.metric_value,
      }));
      const sorted = normalized.sort(
        (a: Insight, b: Insight) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
      );
      setInsights(sorted);
      setSuggestions(data.suggestions || []);
    } catch {
      setInsights([]);
      setSuggestions([]);
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

        {/* ── Suggested Automations ────────────────────────────────── */}
        {!loading && suggestions.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 1l-1.5 4.5L7 7l4.5 1.5L13 13l1.5-4.5L19 7l-4.5-1.5z" transform="scale(0.75) translate(1,1)" />
                <path d="M5 3V1M3 5H1M5 13v2M1 11h2" transform="scale(0.9)" />
              </svg>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#0D1117', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Suggested Automations
              </span>
              <span style={{
                fontSize: 10, fontWeight: 600, color: '#7C3AED', backgroundColor: '#F3F0FF',
                padding: '2px 8px', borderRadius: 10,
              }}>
                {suggestions.length} idea{suggestions.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((s, i) => {
                const isExpanded = expandedSuggestion === i;
                const catColors: Record<string, { bg: string; border: string; accent: string }> = {
                  alert:    { bg: '#FFF7ED', border: '#FED7AA', accent: '#EA580C' },
                  routing:  { bg: '#EFF6FF', border: '#BFDBFE', accent: '#2563EB' },
                  quality:  { bg: '#F0FDF4', border: '#BBF7D0', accent: '#16A34A' },
                  resource: { bg: '#FDF4FF', border: '#E9D5FF', accent: '#9333EA' },
                  ai:       { bg: '#F8FAFC', border: '#CBD5E1', accent: '#0F172A' },
                };
                const c = catColors[s.category] || catColors.ai;
                const iconMap: Record<string, React.ReactNode> = {
                  alert: (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={c.accent} strokeWidth="1.8" strokeLinecap="round">
                      <path d="M8 1L1 14h14L8 1zM8 6v4M8 12h.01" />
                    </svg>
                  ),
                  zap: (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={c.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 1L3 9h5l-1 6 6-8H8l1-6z" />
                    </svg>
                  ),
                  check: (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={c.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 8.5l3.5 3.5L14 4" />
                    </svg>
                  ),
                  users: (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="6" cy="5" r="2.5" /><path d="M1 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" /><circle cx="12" cy="5" r="2" /><path d="M12 9.5c2 0 3.5 1.5 3.5 3.5" />
                    </svg>
                  ),
                  bot: (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="10" height="8" rx="2" /><circle cx="6" cy="9" r="1" fill={c.accent} /><circle cx="10" cy="9" r="1" fill={c.accent} /><path d="M8 2v3M4 2h8" />
                    </svg>
                  ),
                };
                return (
                  <div
                    key={i}
                    onClick={() => setExpandedSuggestion(isExpanded ? null : i)}
                    style={{
                      display: 'inline-flex', gap: 6,
                      padding: isExpanded ? '10px 14px' : '6px 12px',
                      borderRadius: isExpanded ? 10 : 20,
                      border: `1px solid ${c.border}`,
                      backgroundColor: c.bg,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      maxWidth: isExpanded ? '100%' : undefined,
                      flexDirection: isExpanded ? 'column' : 'row',
                      alignItems: isExpanded ? 'flex-start' : 'center',
                      flexBasis: isExpanded ? '100%' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                      {iconMap[s.icon] || iconMap.bot}
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#0D1117', whiteSpace: 'nowrap' }}>
                        {s.label}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#16A34A',
                        backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0',
                        padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap',
                        marginLeft: isExpanded ? 'auto' : 0,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        -{s.est_reduction_pct}% time
                      </span>
                    </div>
                    {isExpanded && (
                      <p style={{
                        fontSize: 11, color: '#64748B', margin: '6px 0 0',
                        lineHeight: 1.5, paddingLeft: 18,
                      }}>
                        {s.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && insights.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map((insight, i) => {
              const colors = SEVERITY_COLORS[insight.severity] || SEVERITY_COLORS.LOW;
              const currentVal = insight.current_value ?? insight.metric_value;
              const baselineVal = insight.baseline_value;
              const deltaPct = insight.delta_pct ??
                (baselineVal && baselineVal > 0 && currentVal != null
                  ? ((currentVal - baselineVal) / baselineVal) * 100
                  : null);
              const deltaPositive = (deltaPct ?? 0) >= 0;
              const typeLabel = insight.metric_label || insight.type || '';

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
                    {insight.affected_count != null && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        backgroundColor: '#FFFFFF', color: colors.text,
                        border: `1px solid ${colors.border}`,
                      }}>
                        {insight.affected_count.toLocaleString()} affected
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 8px', lineHeight: 1.5 }}>
                    {insight.description}
                  </p>

                  {/* Metric comparison — only show if we have values */}
                  {(currentVal != null || baselineVal != null) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {typeLabel && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {typeLabel}
                        </span>
                      )}
                      {baselineVal != null && (
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                          {formatVal(baselineVal)}
                        </span>
                      )}
                      {baselineVal != null && currentVal != null && (
                        <span style={{ fontSize: 11, color: '#94A3B8' }}>{'\u2192'}</span>
                      )}
                      {currentVal != null && (
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: colors.text }}>
                          {formatVal(currentVal)}
                        </span>
                      )}
                      {deltaPct != null && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                          color: deltaPositive ? '#DC2626' : '#16A34A',
                        }}>
                          {deltaPositive ? '\u25B2' : '\u25BC'} {Math.abs(deltaPct).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
