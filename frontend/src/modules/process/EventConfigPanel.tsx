import React, { useState, useEffect } from 'react';
import { useProcessStore, type ActivityProfile, type AnalysisResult } from '../../store/processStore';

interface Props {
  objectTypeId: string;
  pipelines: Array<{ id: string; name: string; nodes: Array<{ type: string; config: Record<string, unknown> }> }>;
}

const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

// Infer field mapping from a pipeline's SINK_EVENT node
function getEventMapping(pipeline: Props['pipelines'][0]) {
  for (const node of pipeline.nodes) {
    if (node.type === 'SINK_EVENT') {
      const c = node.config as Record<string, string>;
      return {
        activityField: c?.activityField || c?.activity_field || '',
        caseIdField: c?.caseIdField || c?.case_id_field || '',
        timestampField: c?.timestampField || c?.timestamp_field || '',
      };
    }
  }
  return { activityField: '', caseIdField: '', timestampField: '' };
}

export const EventConfigPanel: React.FC<Props> = ({ objectTypeId, pipelines }) => {
  const {
    activePipelineId, setActivePipelineId,
    eventConfig, setEventConfig,
    activityProfile, fetchActivityProfile,
    analysisResults, analyzeEvents,
    saveEventConfig,
    analyzing, saving,
    fetchTransitions, fetchVariants, fetchCases, fetchStats,
  } = useProcessStore();

  // Local draft state before saving
  const [excluded, setExcluded] = useState<Set<string>>(new Set(eventConfig.excluded_activities));
  const [labels, setLabels] = useState<Record<string, string>>({ ...eventConfig.activity_labels });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Filter pipelines to those with SINK_EVENT or SINK_OBJECT targeting this object type
  const relevantPipelines = pipelines.filter(p =>
    p.nodes.some(n =>
      (n.type === 'SINK_EVENT' || n.type === 'SINK_OBJECT') &&
      (n.config?.objectTypeId === objectTypeId || !n.config?.objectTypeId)
    )
  );
  // Fall back to all pipelines if none match (e.g. objectTypeId not set on node)
  const displayPipelines = relevantPipelines.length > 0 ? relevantPipelines : pipelines;

  // Auto-select first relevant pipeline
  useEffect(() => {
    if (displayPipelines.length > 0 && !activePipelineId) {
      setActivePipelineId(displayPipelines[0].id);
    }
  }, [displayPipelines.length]);

  // Load profile when pipeline changes
  useEffect(() => {
    if (activePipelineId) {
      fetchActivityProfile(activePipelineId).then(() => setProfileLoaded(true));
    }
  }, [activePipelineId]);

  // Sync local state when eventConfig changes (e.g. pipeline switch)
  useEffect(() => {
    setExcluded(new Set(eventConfig.excluded_activities));
    setLabels({ ...eventConfig.activity_labels });
    setDirty(false);
  }, [eventConfig]);

  // Load saved config when pipeline changes
  useEffect(() => {
    if (!activePipelineId) return;
    fetch(`${PIPELINE_API}/pipelines/${activePipelineId}`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then(r => r.json())
      .then(data => {
        const cfg = data?.event_config;
        if (cfg) {
          setEventConfig({
            excluded_activities: cfg.excluded_activities || [],
            activity_labels: cfg.activity_labels || {},
            saved_at: cfg.saved_at,
          });
        } else {
          setEventConfig({ excluded_activities: [], activity_labels: {} });
        }
      })
      .catch(() => {});
  }, [activePipelineId]);

  const activePipeline = relevantPipelines.find(p => p.id === activePipelineId);
  const mapping = activePipeline ? getEventMapping(activePipeline) : null;

  // Build a merged view: activityProfile + analysisResults
  const mergedRows = activityProfile.map(ap => {
    const analysis = analysisResults?.find(r => r.activity === ap.activity);
    const isExcluded = excluded.has(ap.activity);
    const labelVal = labels[ap.activity] || analysis?.label || '';
    return { ...ap, analysis, isExcluded, labelVal };
  });

  function toggleExclude(activity: string) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
    setDirty(true);
  }

  function setLabel(activity: string, val: string) {
    setLabels(prev => ({ ...prev, [activity]: val }));
    setDirty(true);
  }

  async function handleAnalyze() {
    if (!activePipelineId) return;
    await analyzeEvents(activePipelineId);
    // Auto-apply AI suggestions: mark noise as excluded, use AI labels
    const store = useProcessStore.getState();
    const results = store.analysisResults || [];
    const aiExcluded = new Set<string>(excluded);
    const aiLabels = { ...labels };
    for (const r of results) {
      if (r.category === 'noise') aiExcluded.add(r.activity);
      if (r.label && r.label !== r.activity) aiLabels[r.activity] = r.label;
    }
    setExcluded(aiExcluded);
    setLabels(aiLabels);
    setDirty(true);
  }

  async function handleSave() {
    if (!activePipelineId) return;
    const config = {
      excluded_activities: Array.from(excluded),
      activity_labels: labels,
    };
    await saveEventConfig(activePipelineId, config);
    // Re-fetch the process map with new config applied
    if (objectTypeId) {
      fetchTransitions(objectTypeId);
      fetchVariants(objectTypeId);
      fetchCases(objectTypeId);
      fetchStats(objectTypeId);
    }
    setDirty(false);
  }

  const CATEGORY_COLOR: Record<string, string> = {
    stage: '#059669',
    noise: '#DC2626',
  };
  const CATEGORY_BG: Record<string, string> = {
    stage: '#D1FAE5',
    noise: '#FEE2E2',
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Pipeline Selector */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Pipeline
        </div>
        {displayPipelines.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94A3B8' }}>No pipelines found. Create a pipeline first.</div>
        ) : (
          <select
            value={activePipelineId}
            onChange={e => setActivePipelineId(e.target.value)}
            style={{
              height: 32, padding: '0 32px 0 10px', borderRadius: 6, border: '1px solid #E2E8F0',
              backgroundColor: '#FFFFFF', color: '#0D1117', fontSize: 13, cursor: 'pointer',
              outline: 'none', appearance: 'none', minWidth: 280,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            }}
          >
            {displayPipelines.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Field Mapping (read-only info) */}
      {mapping && (mapping.activityField || mapping.caseIdField) && (
        <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Event Mapping (from pipeline)
          </div>
          <div style={{ display: 'flex', gap: 32 }}>
            {[
              { label: 'Activity Field', value: mapping.activityField },
              { label: 'Case ID Field', value: mapping.caseIdField },
              { label: 'Timestamp Field', value: mapping.timestampField },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: value ? '#0D1117' : '#CBD5E1', fontFamily: 'var(--font-mono)' }}>
                  {value || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Table */}
      {activePipelineId && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Activities in Event Log
              </div>
              {activityProfile.length > 0 && (
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  {activityProfile.length} distinct activities · {excluded.size} excluded
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAnalyze}
                disabled={analyzing || activityProfile.length === 0}
                style={{
                  height: 30, padding: '0 14px', borderRadius: 6,
                  border: '1px solid #7C3AED',
                  backgroundColor: analyzing ? '#F3F4F6' : '#7C3AED',
                  color: analyzing ? '#94A3B8' : '#FFFFFF',
                  fontSize: 12, fontWeight: 500, cursor: analyzing ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {analyzing ? (
                  <>
                    <span style={{ fontSize: 12 }}>⟳</span> Analyzing…
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12 }}>✦</span> AI Analyze
                  </>
                )}
              </button>
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                style={{
                  height: 30, padding: '0 14px', borderRadius: 6,
                  border: dirty ? '1px solid #1E3A5F' : '1px solid #E2E8F0',
                  backgroundColor: dirty ? '#1E3A5F' : '#F8FAFC',
                  color: dirty ? '#FFFFFF' : '#94A3B8',
                  fontSize: 12, fontWeight: 500, cursor: dirty ? 'pointer' : 'default',
                }}
              >
                {saving ? 'Saving…' : 'Save & Apply'}
              </button>
            </div>
          </div>

          {!profileLoaded ? (
            <div style={{ fontSize: 13, color: '#94A3B8', padding: '20px 0' }}>Loading events…</div>
          ) : activityProfile.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94A3B8', padding: '20px 0' }}>
              No events found for this pipeline yet. Run the pipeline first.
            </div>
          ) : (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr 80px 80px 120px 1fr',
                gap: 0,
                backgroundColor: '#F8FAFC',
                borderBottom: '1px solid #E2E8F0',
                padding: '8px 12px',
              }}>
                {['', 'Activity', 'Count', 'AI Tag', 'Include', 'Display Label'].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </div>
                ))}
              </div>

              {mergedRows.map(row => (
                <div
                  key={row.activity}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr 80px 80px 120px 1fr',
                    gap: 0,
                    padding: '9px 12px',
                    borderBottom: '1px solid #F1F5F9',
                    alignItems: 'center',
                    backgroundColor: row.isExcluded ? '#FAFAFA' : '#FFFFFF',
                    opacity: row.isExcluded ? 0.6 : 1,
                  }}
                >
                  {/* Drag handle / index */}
                  <div style={{ color: '#CBD5E1', fontSize: 11 }}>⠿</div>

                  {/* Activity name */}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: row.isExcluded ? '#94A3B8' : '#0D1117', fontWeight: 500 }}>
                    {row.activity}
                  </div>

                  {/* Count */}
                  <div style={{ fontSize: 12, color: '#64748B' }}>{row.count.toLocaleString()}</div>

                  {/* AI category badge */}
                  <div>
                    {row.analysis ? (
                      <span
                        title={row.analysis.reason}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                          backgroundColor: CATEGORY_BG[row.analysis.category] || '#F1F5F9',
                          color: CATEGORY_COLOR[row.analysis.category] || '#64748B',
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}
                      >
                        {row.analysis.category}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#CBD5E1' }}>—</span>
                    )}
                  </div>

                  {/* Include/Exclude toggle */}
                  <div>
                    <button
                      onClick={() => toggleExclude(row.activity)}
                      style={{
                        height: 24, padding: '0 10px', borderRadius: 12,
                        border: `1px solid ${row.isExcluded ? '#E2E8F0' : '#10B981'}`,
                        backgroundColor: row.isExcluded ? '#F1F5F9' : '#D1FAE5',
                        color: row.isExcluded ? '#94A3B8' : '#059669',
                        fontSize: 11, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      {row.isExcluded ? 'Excluded' : 'Included'}
                    </button>
                  </div>

                  {/* Label input */}
                  <div>
                    <input
                      type="text"
                      value={row.labelVal}
                      placeholder={row.activity}
                      onChange={e => setLabel(row.activity, e.target.value)}
                      style={{
                        height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                        fontSize: 12, color: '#0D1117', outline: 'none', width: '100%',
                        backgroundColor: row.isExcluded ? '#F8FAFC' : '#FFFFFF',
                        fontFamily: row.labelVal ? 'inherit' : 'var(--font-mono)',
                      }}
                      onFocus={e => (e.target.style.borderColor = '#1E3A5F')}
                      onBlur={e => (e.target.style.borderColor = '#E2E8F0')}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info hint */}
      {dirty && (
        <div style={{ fontSize: 12, color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '8px 12px' }}>
          Changes not yet saved. Click <strong>Save & Apply</strong> to update the process map.
        </div>
      )}
    </div>
  );
};

export default EventConfigPanel;
