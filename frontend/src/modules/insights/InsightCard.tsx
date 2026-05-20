import React from 'react';
import { Sparkles, Pin, EyeOff, BellPlus, TrendingUp, TrendingDown, GitBranch, Activity } from 'lucide-react';
import { Insight, useInsightStore } from '../../store/insightStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  high: '#DC2626', mid: '#D97706', low: '#0EA5E9', causal: '#9333EA', robust: '#059669',
};

const FAMILY_COLOR: Record<string, string> = {
  univariate_stats: '#2563EB',
  mutual_info: '#0EA5E9',
  tree_importance: '#7C3AED',
  record_linkage: '#0F766E',
  clustering: '#9333EA',
  anomaly_records: '#DC2626',
  association_rules: '#D97706',
  sequence_mining: '#A16207',
  survival: '#0EA5E9',
  ts_anomaly: '#DB2777',
  propensity: '#059669',
  causal: '#9333EA',
  joined_correlations: '#0E7490',
  text_clusters: '#7C3AED',
};

const FAMILY_LABEL: Record<string, string> = {
  univariate_stats: 'Statistical',
  mutual_info: 'Non-linear',
  tree_importance: 'Tree-based',
  record_linkage: 'Record linkage',
  clustering: 'Clusters',
  anomaly_records: 'Outlier',
  association_rules: 'Activity bundle',
  sequence_mining: 'Sequence',
  survival: 'Survival',
  ts_anomaly: 'Time anomaly',
  propensity: 'Propensity-checked',
  causal: 'Causal',
  joined_correlations: 'Cross-object',
  text_clusters: 'Text cluster',
};

function badge(label: string, color: string): React.ReactNode {
  return (
    <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: color + '22', color, whiteSpace: 'nowrap' }}>{label}</span>
  );
}

function effectMagnitude(effect: number): 'high' | 'mid' | 'low' {
  const abs = Math.abs(effect);
  if (abs >= 0.5) return 'high';
  if (abs >= 0.2) return 'mid';
  return 'low';
}

interface Props {
  insight: Insight;
  onOpen: () => void;
}

export const InsightCard: React.FC<Props> = ({ insight, onOpen }) => {
  const { patchStatus, promoteToAlert } = useInsightStore();
  const fam = insight.family;
  const famColor = FAMILY_COLOR[fam] ?? '#475569';
  const famLabel = FAMILY_LABEL[fam] ?? fam;
  const mag = effectMagnitude(insight.effect_size);
  const magColor = mag === 'high' ? C.high : mag === 'mid' ? C.mid : C.low;
  const direction = insight.direction;

  const causalBadge = insight.causal_estimate ? badge('CAUSAL', C.causal) : null;
  const propBadge = insight.causal_estimate && (insight.causal_estimate as { psm_robust?: boolean }).psm_robust ? badge('PSM-ROBUST', C.robust) : null;
  const replBadge = insight.replication_holdout_pass ? badge('HOLDOUT ✓', C.robust) : null;
  const crossOt = insight.outcome_object_type_id && insight.outcome_object_type_id !== insight.object_type_id ? badge('CROSS-OBJECT', '#0E7490') : null;

  const onAlert = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await promoteToAlert(insight.id, 0.3);
    if (!res.ok) alert('Failed to promote to alert');
  };

  return (
    <div onClick={onOpen} style={{
      backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 14, cursor: 'pointer', transition: 'box-shadow 100ms, border-color 100ms',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 10px rgba(0,0,0,0.04)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.borderColor = C.border; }}>

      {/* badge row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {badge(famLabel, famColor)}
        <span style={{ fontSize: 11, fontWeight: 600, color: magColor, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {direction === 'higher' || (insight.effect_size > 0) ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(insight.effect_size).toFixed(2)} {insight.effect_metric}
        </span>
        {causalBadge}
        {propBadge}
        {replBadge}
        {crossOt}
      </div>

      {/* title */}
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.35 }}>{insight.title}</div>

      {/* description (truncated) */}
      {insight.description && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {insight.description}
        </div>
      )}

      {/* footer */}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.subtle }}>n={insight.n}</span>
        {insight.stability_score != null && (
          <span style={{ fontSize: 10, color: C.subtle }}>stab {Math.round((insight.stability_score || 0) * 100)}%</span>
        )}
        <span style={{ fontSize: 10, color: C.subtle, marginLeft: 'auto' }}>rank {insight.rank_score.toFixed(2)}</span>
        <button title="Pin" onClick={(e) => { e.stopPropagation(); void patchStatus(insight.id, insight.status === 'pinned' ? 'new' : 'pinned'); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: insight.status === 'pinned' ? C.accent : C.subtle, lineHeight: 0 }}>
          <Pin size={13} />
        </button>
        <button title="Dismiss" onClick={(e) => { e.stopPropagation(); void patchStatus(insight.id, 'dismissed'); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0 }}>
          <EyeOff size={13} />
        </button>
        <button title="Alert me on this" onClick={onAlert}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.accent, lineHeight: 0 }}>
          <BellPlus size={13} />
        </button>
      </div>
    </div>
  );
};
