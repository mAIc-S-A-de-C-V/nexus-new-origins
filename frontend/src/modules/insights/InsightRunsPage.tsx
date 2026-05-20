import React, { useEffect, useState } from 'react';
import { useInsightStore, InsightRun } from '../../store/insightStore';
import { useNavigationStore } from '../../store/navigationStore';
import { ChevronLeft, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  success: '#22C55E', error: '#EF4444',
};

const INSIGHT_API = import.meta.env.VITE_INSIGHT_ENGINE_URL || 'http://localhost:8016';

interface RunReport {
  run: InsightRun;
  families: Array<{ family: string; n: number; avg_effect: number; top_rank: number }>;
  top_insights: Array<{ id: string; family: string; title: string; effect_size: number; rank_score: number; status: string }>;
}

const InsightRunsPage: React.FC = () => {
  const { runs, fetchRuns } = useInsightStore();
  const navigate = useNavigationStore(s => s.navigateTo);
  const [selected, setSelected] = useState<InsightRun | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);

  useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  useEffect(() => {
    if (!selected) { setReport(null); return; }
    (async () => {
      try {
        const tid = new URLSearchParams({ tenant_id: localStorage.getItem('tenant_id') || 'tenant-001' });
        const res = await fetch(`${INSIGHT_API}/insights/runs/${selected.id}/report?${tid.toString()}`);
        setReport(await res.json());
      } catch { setReport(null); }
    })();
  }, [selected]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: C.bg }}>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('insights')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={14} /> Insights
        </button>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginLeft: 8 }}>Run history</div>
        <button onClick={() => fetchRuns()} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${C.border}`, padding: '4px 10px', borderRadius: 4, fontSize: 12, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 360, borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
          {runs.map(r => (
            <div key={r.id} onClick={() => setSelected(r)}
                 style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
                          cursor: 'pointer', backgroundColor: selected?.id === r.id ? C.accentLight : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {r.status === 'ok' && <CheckCircle2 size={12} color={C.success} />}
                {r.status === 'failed' && <AlertCircle size={12} color={C.error} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{r.status}</span>
                <span style={{ fontSize: 11, color: C.subtle, marginLeft: 'auto' }}>{new Date(r.started_at).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted }}>
                <span>{r.insights_kept ?? 0} kept</span>
                <span>{r.tests_run ?? 0}/{r.tests_planned ?? 0} tests</span>
                {r.duration_ms != null && <span>{(r.duration_ms / 1000).toFixed(1)}s</span>}
              </div>
            </div>
          ))}
          {runs.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.subtle, fontSize: 13 }}>No runs yet</div>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {!selected && <div style={{ color: C.subtle, fontSize: 13, textAlign: 'center', marginTop: 40 }}>Select a run</div>}
          {selected && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>Run {selected.id.slice(0, 8)}…</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
                <Stat label="Status" value={selected.status} />
                <Stat label="Insights kept" value={String(selected.insights_kept ?? 0)} />
                <Stat label="Tests run" value={`${selected.tests_run ?? 0} / ${selected.tests_planned ?? 0}`} />
                <Stat label="Duration" value={selected.duration_ms != null ? `${(selected.duration_ms / 1000).toFixed(1)}s` : '—'} sub={`peak ${selected.peak_memory_mb ?? 0} MB`} />
              </div>

              {selected.error && (
                <div style={{ padding: '10px 12px', backgroundColor: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 6, fontSize: 12, color: C.error, marginBottom: 16 }}>
                  {selected.error}
                </div>
              )}

              <SectionTitle>Family breakdown</SectionTitle>
              {report && report.families.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th style={th()}>Family</th>
                      <th style={th('right')}>Insights</th>
                      <th style={th('right')}>Avg effect</th>
                      <th style={th('right')}>Top rank</th>
                      <th style={th('right')}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.families.map(f => (
                      <tr key={f.family} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={td()}>{f.family}</td>
                        <td style={td('right')}>{f.n}</td>
                        <td style={td('right')}>{f.avg_effect?.toFixed(3)}</td>
                        <td style={td('right')}>{f.top_rank?.toFixed(2)}</td>
                        <td style={td('right')}>{selected.family_durations_ms?.[f.family] != null ? `${(selected.family_durations_ms[f.family] / 1000).toFixed(1)}s` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 12, color: C.subtle }}>No findings.</div>
              )}

              <SectionTitle style={{ marginTop: 24 }}>Top insights from this run</SectionTitle>
              {report && report.top_insights.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th style={th()}>Title</th>
                      <th style={th()}>Family</th>
                      <th style={th('right')}>Effect</th>
                      <th style={th('right')}>Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.top_insights.map(i => (
                      <tr key={i.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={td()}>{i.title}</td>
                        <td style={td()}>{i.family}</td>
                        <td style={td('right')}>{i.effect_size?.toFixed(3)}</td>
                        <td style={td('right')}>{i.rank_score?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 12, color: C.subtle }}>No findings.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div style={{ padding: '10px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
    <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: C.subtle, marginTop: 2 }}>{sub}</div>}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, ...style }}>{children}</div>
);

const th = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
  textAlign: align, padding: '6px 4px', color: C.muted, fontWeight: 500,
});
const td = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
  textAlign: align, padding: '6px 4px', color: C.text,
});

export default InsightRunsPage;
