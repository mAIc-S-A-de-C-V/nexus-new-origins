import React, { useEffect, useState } from 'react';
import { Play, Save } from 'lucide-react';
import { useInsightStore } from '../../store/insightStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
};

const FAMILIES = [
  'univariate_stats', 'mutual_info', 'tree_importance',
  'record_linkage', 'clustering', 'anomaly_records',
  'association_rules', 'sequence_mining',
  'survival', 'ts_anomaly', 'propensity', 'causal',
  'joined_correlations', 'text_clusters',
];

const InsightSettingsTab: React.FC = () => {
  const { config, fetchConfig, patchConfig, runNow } = useInsightStore();
  const [edit, setEdit] = useState<typeof config>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);
  useEffect(() => { setEdit(config); }, [config]);

  if (!edit) {
    return <div style={{ padding: 24, color: C.subtle }}>Loading configuration…</div>;
  }

  const familyMap: Record<string, boolean> = (edit.family_enabled || {}) as Record<string, boolean>;
  const featDeny = (edit.feature_denylist || []).join(', ');
  const outDeny = (edit.outcome_denylist || []).join(', ');

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Insight engine settings</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Nightly statistical discovery configuration</div>
        </div>
        <button onClick={async () => { setRunning(true); await runNow(); setRunning(false); }}
                style={{ padding: '6px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Play size={12} /> {running ? 'Queueing…' : 'Run now'}
        </button>
      </div>

      <Section title="Schedule">
        <Field label="Enabled"><input type="checkbox" checked={!!edit.enabled} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} style={{ accentColor: C.accent }} /></Field>
        <Field label="Cron"><input value={edit.schedule_cron} onChange={e => setEdit({ ...edit, schedule_cron: e.target.value })} style={inp({ width: 200, fontFamily: 'monospace' })} /></Field>
        <Field label="Timezone"><input value={edit.timezone} onChange={e => setEdit({ ...edit, timezone: e.target.value })} style={inp({ width: 200 })} placeholder="UTC, America/El_Salvador, …" /></Field>
      </Section>

      <Section title="Budgets">
        <Field label="Max tests / run"><input type="number" value={edit.max_tests} onChange={e => setEdit({ ...edit, max_tests: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Max runtime (min)"><input type="number" value={edit.max_runtime_minutes} onChange={e => setEdit({ ...edit, max_runtime_minutes: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Max memory (MB)"><input type="number" value={edit.max_memory_mb} onChange={e => setEdit({ ...edit, max_memory_mb: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Keep top N"><input type="number" value={edit.keep_top_n} onChange={e => setEdit({ ...edit, keep_top_n: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
      </Section>

      <Section title="Robustness">
        <Field label="Min effect size"><input type="number" step="0.05" value={edit.min_effect_size} onChange={e => setEdit({ ...edit, min_effect_size: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Min sample size"><input type="number" value={edit.min_sample_size} onChange={e => setEdit({ ...edit, min_sample_size: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Min stability"><input type="number" step="0.05" value={edit.min_stability_score} onChange={e => setEdit({ ...edit, min_stability_score: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Bootstrap iters"><input type="number" value={edit.bootstrap_iterations} onChange={e => setEdit({ ...edit, bootstrap_iterations: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
        <Field label="Holdout %"><input type="number" step="0.05" value={edit.holdout_pct} onChange={e => setEdit({ ...edit, holdout_pct: Number(e.target.value) })} style={inp({ width: 120 })} /></Field>
      </Section>

      <Section title="Features (toggle)">
        <Field label="LLM titles + recs"><input type="checkbox" checked={!!edit.llm_titles_enabled} onChange={e => setEdit({ ...edit, llm_titles_enabled: e.target.checked })} style={{ accentColor: C.accent }} /></Field>
        <Field label="Text embeddings"><input type="checkbox" checked={!!edit.embeddings_enabled} onChange={e => setEdit({ ...edit, embeddings_enabled: e.target.checked })} style={{ accentColor: C.accent }} /></Field>
        <Field label="Causal inference"><input type="checkbox" checked={!!edit.causal_enabled} onChange={e => setEdit({ ...edit, causal_enabled: e.target.checked })} style={{ accentColor: C.accent }} /></Field>
        <Field label="Cross-OT joined"><input type="checkbox" checked={!!edit.cross_ot_enabled} onChange={e => setEdit({ ...edit, cross_ot_enabled: e.target.checked })} style={{ accentColor: C.accent }} /></Field>
      </Section>

      <Section title="Family toggles">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {FAMILIES.map(f => (
            <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text }}>
              <input type="checkbox"
                     checked={familyMap[f] !== false}
                     onChange={e => setEdit({ ...edit, family_enabled: { ...familyMap, [f]: e.target.checked } })}
                     style={{ accentColor: C.accent }} />
              {f}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Denylists (comma-separated)">
        <Field label="Features"><input value={featDeny} onChange={e => setEdit({ ...edit, feature_denylist: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} style={inp({ width: '100%' })} placeholder="updated_at, deleted_at, …" /></Field>
        <Field label="Outcomes"><input value={outDeny} onChange={e => setEdit({ ...edit, outcome_denylist: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} style={inp({ width: '100%' })} placeholder="is_complete, …" /></Field>
      </Section>

      <button disabled={saving} onClick={async () => { setSaving(true); await patchConfig(edit); setSaving(false); }}
              style={{ marginTop: 16, padding: '8px 18px', backgroundColor: C.accent, color: '#FFF', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Save size={13} /> {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 20, padding: 14, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>{title}</div>
    {children}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
    <span style={{ fontSize: 12, color: C.muted, minWidth: 160 }}>{label}</span>
    {children}
  </div>
);

const inp = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4,
  fontSize: 13, color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box', ...extra,
});

export default InsightSettingsTab;
