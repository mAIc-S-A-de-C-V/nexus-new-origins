import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Play, Pin, EyeOff, BellPlus, Search, X, Filter, History } from 'lucide-react';
import { useInsightStore, Insight, InsightStatus } from '../../store/insightStore';
import { useNavigationStore } from '../../store/navigationStore';
import { InsightDetailDrawer } from './InsightDetailDrawer';
import { InsightCard } from './InsightCard';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
};

const FAMILY_LABELS: Record<string, string> = {
  univariate_stats: 'Statistical',
  mutual_info: 'Non-linear',
  tree_importance: 'Tree-based',
  record_linkage: 'Record linkage',
  clustering: 'Clusters',
  anomaly_records: 'Outliers',
  association_rules: 'Activity bundles',
  sequence_mining: 'Sequences',
  survival: 'Survival',
  ts_anomaly: 'Time anomalies',
  propensity: 'Propensity (PSM)',
  causal: 'Causal',
  joined_correlations: 'Cross-object',
  text_clusters: 'Text clusters',
};

const InsightsFeed: React.FC = () => {
  const { insights, loading, fetchInsights, fetchRuns, runs, runNow, pollUnread } = useInsightStore();
  const navigate = useNavigationStore(s => s.navigateTo);
  const [statusFilter, setStatusFilter] = useState<'new' | 'pinned' | 'all' | 'dismissed'>('new');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Insight | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void fetchInsights({ status: statusFilter === 'all' ? '' : statusFilter, limit: 200 });
    void fetchRuns();
    void pollUnread();
  }, [statusFilter, fetchInsights, fetchRuns, pollUnread]);

  const visible = useMemo(() => {
    return insights.filter(i => {
      if (familyFilter !== 'all' && i.family !== familyFilter) return false;
      if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [insights, familyFilter, search]);

  const families = useMemo(() => {
    const set = new Set<string>();
    insights.forEach(i => set.add(i.family));
    return Array.from(set);
  }, [insights]);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const id = await runNow();
      if (id) {
        // poll until status changes
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 5000));
          await fetchRuns();
          const latest = useInsightStore.getState().runs.find(r => r.id === id);
          if (latest && latest.status !== 'queued' && latest.status !== 'running') break;
        }
        await fetchInsights({ status: 'new', limit: 200 });
      }
    } finally {
      setRunning(false);
    }
  };

  const latestRun = runs[0];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: C.bg }}>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Sparkles size={18} color={C.accent} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Insights</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            {latestRun ? `last run ${latestRun.status} · ${new Date(latestRun.started_at).toLocaleString()} · ${latestRun.insights_kept ?? 0} kept` : 'no run yet'}
          </div>
        </div>
        <button onClick={() => navigate('insights-runs')}
                style={btn(C, 'ghost')}><History size={13} /> Runs</button>
        <button onClick={handleRunNow} disabled={running}
                style={btn(C, 'primary')}><Play size={13} /> {running ? 'Running…' : 'Run discovery now'}</button>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '10px 24px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {(['new', 'pinned', 'all', 'dismissed'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={pill(C, statusFilter === s)}>{s}</button>
        ))}
        <div style={{ width: 1, height: 18, backgroundColor: C.border, margin: '0 4px' }} />
        <Filter size={13} color={C.muted} />
        <select value={familyFilter} onChange={e => setFamilyFilter(e.target.value)}
                style={{ height: 28, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: C.text, backgroundColor: C.bg }}>
          <option value="all">All families ({families.length})</option>
          {families.map(f => <option key={f} value={f}>{FAMILY_LABELS[f] ?? f}</option>)}
        </select>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={13} color={C.subtle} style={{ position: 'absolute', left: 8, top: 8 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title…"
                 style={{ height: 28, padding: '0 8px 0 28px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: C.text, backgroundColor: C.bg, width: '100%', boxSizing: 'border-box' }} />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && <div style={{ padding: 32, textAlign: 'center', color: C.subtle, fontSize: 13 }}>Loading…</div>}
        {!loading && visible.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: C.subtle, fontSize: 13 }}>
            <Sparkles size={32} color={C.border} style={{ marginBottom: 12 }} /><br />
            {insights.length === 0
              ? 'No insights yet. Click “Run discovery now” to kick off the first nightly run.'
              : 'No insights match your filters.'}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          {visible.map(i => (
            <InsightCard key={i.id} insight={i} onOpen={() => setOpen(i)} />
          ))}
        </div>
      </div>

      {open && <InsightDetailDrawer insight={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

function btn(c: typeof C, variant: 'primary' | 'ghost'): React.CSSProperties {
  if (variant === 'primary') {
    return { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: c.accent, color: '#FFF', border: 'none', cursor: 'pointer' };
  }
  return { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: c.bg, color: c.muted, border: `1px solid ${c.border}`, cursor: 'pointer' };
}

function pill(c: typeof C, active: boolean): React.CSSProperties {
  return { padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 500, border: `1px solid ${active ? c.accent : c.border}`, backgroundColor: active ? c.accentLight : 'transparent', color: active ? c.accent : c.muted, cursor: 'pointer', textTransform: 'capitalize' };
}

export default InsightsFeed;
