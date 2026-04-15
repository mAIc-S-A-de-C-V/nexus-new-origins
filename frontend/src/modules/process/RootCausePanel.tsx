import React, { useState } from 'react';
import { getTenantId } from '../../store/authStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

type Target = 'slow' | 'stuck' | 'rework';

interface Factor {
  rank: number;
  attribute: string;
  value: string;
  impact_score: number;
  frequency_ratio: number;
  target_count: number;
  baseline_count: number;
}

interface Props {
  objectTypeId: string;
}

const TARGET_OPTIONS: { id: Target; label: string }[] = [
  { id: 'slow', label: 'Slow Cases' },
  { id: 'stuck', label: 'Stuck Cases' },
  { id: 'rework', label: 'Rework Cases' },
];

function impactColor(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.66) return '#DC2626';
  if (ratio >= 0.33) return '#EA580C';
  return '#94A3B8';
}

function impactBg(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.66) return '#FEF2F2';
  if (ratio >= 0.33) return '#FFF7ED';
  return '#F8FAFC';
}

export const RootCausePanel: React.FC<Props> = ({ objectTypeId }) => {
  const [target, setTarget] = useState<Target | null>(null);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(false);

  const analyze = async (t: Target) => {
    setTarget(t);
    setLoading(true);
    setFactors([]);
    try {
      const res = await fetch(`${PROCESS_API}/process/root-cause/${objectTypeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({ target: t, top_n: 15 }),
      });
      const data = await res.json();
      setFactors(data.factors || []);
    } catch {
      setFactors([]);
    } finally {
      setLoading(false);
    }
  };

  const maxImpact = factors.length > 0 ? Math.max(...factors.map(f => f.impact_score)) : 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', margin: 0 }}>Root Cause Analysis</h2>
        <p style={{ fontSize: 11, color: '#64748B', margin: '2px 0 0' }}>
          Identify attributes most correlated with problematic cases.
        </p>
      </div>

      {/* Target selector */}
      <div style={{
        display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #E2E8F0',
        flexShrink: 0, backgroundColor: '#F8FAFC',
      }}>
        {TARGET_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => analyze(opt.id)}
            style={{
              height: 32, padding: '0 16px', borderRadius: 6,
              border: target === opt.id ? '1.5px solid #1E3A5F' : '1px solid #E2E8F0',
              backgroundColor: target === opt.id ? '#1E3A5F' : '#FFFFFF',
              color: target === opt.id ? '#FFFFFF' : '#64748B',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'all 100ms',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {!target && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            Select a target to analyze
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            Analyzing root causes...
          </div>
        )}

        {!loading && target && factors.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
            No contributing factors found
          </div>
        )}

        {!loading && factors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {factors.map((f, i) => {
              const barWidth = maxImpact > 0 ? (f.impact_score / maxImpact) * 100 : 0;
              const color = impactColor(f.impact_score, maxImpact);
              const bg = impactBg(f.impact_score, maxImpact);

              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #E2E8F0', backgroundColor: bg,
                }}>
                  {/* Rank */}
                  <div style={{
                    width: 28, height: 28, borderRadius: 6,
                    backgroundColor: color, color: '#FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}>
                    {f.rank || i + 1}
                  </div>

                  {/* Attribute info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', marginBottom: 4 }}>
                      {f.attribute} <span style={{ color: '#94A3B8', fontWeight: 400 }}>=</span> {f.value}
                    </div>

                    {/* Impact bar */}
                    <div style={{
                      height: 6, backgroundColor: '#E2E8F0', borderRadius: 3,
                      overflow: 'hidden', maxWidth: 280,
                    }}>
                      <div style={{
                        width: `${barWidth}%`, height: '100%',
                        backgroundColor: color, borderRadius: 3,
                        transition: 'width 300ms ease',
                      }} />
                    </div>
                  </div>

                  {/* Frequency ratio */}
                  <div style={{
                    padding: '3px 8px', borderRadius: 12,
                    backgroundColor: color === '#DC2626' ? '#FEE2E2' : color === '#EA580C' ? '#FFEDD5' : '#F1F5F9',
                    color: color,
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {f.frequency_ratio.toFixed(1)}x more likely
                  </div>

                  {/* Counts */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                      Target / Base
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#0D1117' }}>
                      {f.target_count} / {f.baseline_count}
                    </div>
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
