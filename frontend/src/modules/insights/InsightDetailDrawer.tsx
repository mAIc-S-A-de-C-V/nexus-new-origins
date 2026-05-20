import React from 'react';
import { X, ExternalLink, Pin, EyeOff, BellPlus } from 'lucide-react';
import { Insight, useInsightStore } from '../../store/insightStore';
import { useNavigationStore } from '../../store/navigationStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
};

interface Props {
  insight: Insight;
  onClose: () => void;
}

function renderGroupStats(evidence: Record<string, unknown>): React.ReactNode {
  const stats = (evidence as { group_stats?: Array<{ label: string; mean?: number; n?: number; pct?: number }> }).group_stats;
  if (!stats || !Array.isArray(stats) || stats.length === 0) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
          <th style={{ textAlign: 'left', padding: '6px 4px', color: C.muted, fontWeight: 500 }}>Group</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: C.muted, fontWeight: 500 }}>n</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: C.muted, fontWeight: 500 }}>Mean</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: C.muted, fontWeight: 500 }}>%</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((g, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
            <td style={{ padding: '6px 4px', color: C.text }}>{g.label}</td>
            <td style={{ padding: '6px 4px', textAlign: 'right', color: C.muted }}>{g.n ?? '—'}</td>
            <td style={{ padding: '6px 4px', textAlign: 'right', color: C.muted }}>{g.mean != null ? g.mean.toFixed(2) : '—'}</td>
            <td style={{ padding: '6px 4px', textAlign: 'right', color: C.muted }}>{g.pct != null ? `${g.pct.toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const InsightDetailDrawer: React.FC<Props> = ({ insight, onClose }) => {
  const { patchStatus, promoteToAlert, investigate } = useInsightStore();
  const navigate = useNavigationStore(s => s.navigateTo);

  const handleInvestigate = async () => {
    const payload = await investigate(insight.id);
    if (!payload) return;
    // Navigate to process-mining; the receiving page reads window.__nexusInvestigatePayload
    // (lightweight handoff to avoid coupling to a specific store). The page consumes-and-clears it.
    (window as unknown as Record<string, unknown>).__nexusInvestigatePayload = payload;
    navigate(payload.module || 'process-mining');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxWidth: '90vw', height: '100%', backgroundColor: C.panel,
        borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column',
      }}>
        {/* header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{insight.family}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{insight.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* numeric strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Stat label="Effect" value={`${insight.effect_size > 0 ? '+' : ''}${insight.effect_size.toFixed(3)}`} sub={insight.effect_metric} />
            <Stat label="n" value={String(insight.n)} />
            <Stat label="p-adj" value={insight.p_adjusted != null ? insight.p_adjusted.toFixed(4) : '—'} sub={insight.p_value != null ? `p ${insight.p_value.toFixed(4)}` : undefined} />
            <Stat label="Stability" value={insight.stability_score != null ? `${Math.round(insight.stability_score * 100)}%` : '—'}
                  sub={insight.replication_holdout_pass ? 'holdout ✓' : insight.replication_holdout_pass === false ? 'holdout ✗' : undefined} />
          </div>

          {/* description */}
          {insight.description && (
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{insight.description}</div>
          )}

          {/* recommendation */}
          {insight.recommendation && (
            <div style={{ padding: '10px 12px', backgroundColor: C.accentLight, borderRadius: 6, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: C.accent, marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>Recommendation</div>
              {insight.recommendation}
            </div>
          )}

          {/* causal panel */}
          {insight.causal_estimate && (
            <div style={{ padding: '10px 12px', backgroundColor: '#F3E8FF', borderRadius: 6, border: `1px solid #E9D5FF`, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: '#9333EA', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>Causal estimate</div>
              <pre style={{ margin: 0, fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap' }}>{JSON.stringify(insight.causal_estimate, null, 2)}</pre>
            </div>
          )}

          {/* evidence — group stats */}
          {renderGroupStats(insight.evidence)}

          {/* feature/outcome */}
          <details style={{ fontSize: 12, color: C.muted }}>
            <summary style={{ cursor: 'pointer', fontWeight: 500, color: C.text }}>Feature / Outcome</summary>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '80px 1fr', rowGap: 6, columnGap: 12 }}>
              <span>Feature</span>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', backgroundColor: C.bg, padding: '6px 8px', borderRadius: 4 }}>{JSON.stringify(insight.feature, null, 2)}</pre>
              <span>Outcome</span>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', backgroundColor: C.bg, padding: '6px 8px', borderRadius: 4 }}>{JSON.stringify(insight.outcome, null, 2)}</pre>
            </div>
          </details>

          {/* full evidence */}
          <details style={{ fontSize: 12, color: C.muted }}>
            <summary style={{ cursor: 'pointer', fontWeight: 500, color: C.text }}>Full evidence payload</summary>
            <pre style={{ margin: 0, marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap', backgroundColor: C.bg, padding: '8px 10px', borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(insight.evidence, null, 2)}</pre>
          </details>
        </div>

        {/* footer actions */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
          <button onClick={() => void patchStatus(insight.id, insight.status === 'pinned' ? 'new' : 'pinned')}
                  style={btn(insight.status === 'pinned' ? 'primary' : 'ghost')}>
            <Pin size={12} /> {insight.status === 'pinned' ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={() => { void patchStatus(insight.id, 'dismissed'); onClose(); }}
                  style={btn('ghost')}>
            <EyeOff size={12} /> Dismiss
          </button>
          <button onClick={() => void promoteToAlert(insight.id, 0.3)} style={btn('ghost')}>
            <BellPlus size={12} /> Alert me on this
          </button>
          <button onClick={handleInvestigate} style={{ ...btn('primary'), marginLeft: 'auto' }}>
            <ExternalLink size={12} /> Investigate
          </button>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div style={{ padding: '10px 12px', backgroundColor: '#F8FAFC', border: `1px solid #E2E8F0`, borderRadius: 6 }}>
    <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
  </div>
);

function btn(variant: 'primary' | 'ghost'): React.CSSProperties {
  if (variant === 'primary') {
    return { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: '#7C3AED', color: '#FFF', border: 'none', cursor: 'pointer' };
  }
  return { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: '#F8FAFC', color: '#64748B', border: `1px solid #E2E8F0`, cursor: 'pointer' };
}
