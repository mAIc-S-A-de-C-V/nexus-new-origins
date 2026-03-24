import React, { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { usePipelineStore } from '../../store/pipelineStore';
import { useConnectorStore } from '../../store/connectorStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { EventLogQualityScore } from '../../types/pipeline';

const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';
const EVENT_LOG_API = import.meta.env.VITE_EVENT_LOG_SERVICE_URL || 'http://localhost:8005';

// ── Quality gauge ────────────────────────────────────────────────────────────

const QualityBar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
      <span style={{ color: '#64748B', fontWeight: 500 }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{Math.round(value * 100)}%</span>
    </div>
    <div style={{ height: '5px', backgroundColor: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.round(value * 100)}%`, backgroundColor: color, borderRadius: '3px', transition: 'width 400ms ease' }} />
    </div>
  </div>
);

const qualityColor = (v: number) => v >= 0.85 ? '#059669' : v >= 0.65 ? '#D97706' : '#DC2626';


interface LiveEvent {
  id: string;
  caseId: string;
  activity: string;
  timestamp: string;
  pipelineId: string;
  objectTypeId: string;
  connectorId: string;
  resource?: string;
  cost?: number;
  attributes: Record<string, unknown>;
}

// ── Main component ────────────────────────────────────────────────────────────

export const EventLog: React.FC = () => {
  const { pipelines, fetchPipelines } = usePipelineStore();
  const { connectors, fetchConnectors } = useConnectorStore();
  const { objectTypes, fetchObjectTypes } = useOntologyStore();

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [qualityMap, setQualityMap] = useState<Record<string, EventLogQualityScore>>({});
  const [loadingQuality, setLoadingQuality] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    fetchPipelines();
    fetchConnectors();
    fetchObjectTypes();
  }, []);

  // All pipelines with non-DRAFT status (they've been run and may have events)
  const eventPipelines = pipelines.filter((p) => p.status !== 'DRAFT');

  useEffect(() => {
    if (eventPipelines.length > 0 && !selectedPipelineId) {
      setSelectedPipelineId(eventPipelines[0].id);
    }
  }, [eventPipelines.length]);

  const currentPipeline = eventPipelines.find((p) => p.id === selectedPipelineId) || eventPipelines[0];

  const loadEvents = useCallback(async (pipelineId: string) => {
    setLoadingEvents(true);
    try {
      const res = await fetch(
        `${EVENT_LOG_API}/events?pipeline_id=${pipelineId}&limit=200`,
        { headers: { 'x-tenant-id': 'tenant-001' } }
      );
      if (res.ok) {
        const data: Record<string, unknown>[] = await res.json();
        setEvents(data.map((e) => ({
          id: e.id as string,
          caseId: e.case_id as string,
          activity: e.activity as string,
          timestamp: e.timestamp as string,
          pipelineId: e.pipeline_id as string,
          objectTypeId: e.object_type_id as string,
          connectorId: e.connector_id as string,
          resource: e.resource as string | undefined,
          cost: e.cost as number | undefined,
          attributes: (e.attributes as Record<string, unknown>) || {},
        })));
      }
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadQuality = useCallback(async (pipelineId: string) => {
    if (loadingQuality[pipelineId]) return;
    setLoadingQuality((m) => ({ ...m, [pipelineId]: true }));
    try {
      const res = await fetch(`${EVENT_LOG_API}/events/quality/${pipelineId}`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      if (res.ok) {
        const data = await res.json();
        setQualityMap((m) => ({ ...m, [pipelineId]: data }));
      }
    } catch {
      // quality score unavailable
    } finally {
      setLoadingQuality((m) => ({ ...m, [pipelineId]: false }));
    }
  }, [loadingQuality]);

  useEffect(() => {
    if (currentPipeline) {
      loadEvents(currentPipeline.id);
      loadQuality(currentPipeline.id);
    }
  }, [currentPipeline?.id]);

  const filtered = activityFilter
    ? events.filter((e) => e.activity.toLowerCase().includes(activityFilter.toLowerCase()) || e.caseId.toLowerCase().includes(activityFilter.toLowerCase()))
    : events;

  const quality = currentPipeline ? qualityMap[currentPipeline.id] || null : null;

  const objectTypeName = (id: string) => objectTypes.find((o) => o.id === id)?.displayName || id;
  const connectorName = (id: string) => connectors.find((c) => c.id === id)?.name || id;

  // Unique activities for the activity breakdown
  const activityCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.activity] = (acc[e.activity] || 0) + 1;
    return acc;
  }, {});
  const uniqueCases = new Set(events.map((e) => e.caseId)).size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', flexShrink: 0,
      }}>
        <Activity size={16} color="#7C3AED" />
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>Event Log</h1>

        {/* Pipeline selector */}
        <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
          {eventPipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPipelineId(p.id)}
              style={{
                height: '28px', padding: '0 12px', borderRadius: '2px', fontSize: '12px',
                border: `1px solid ${selectedPipelineId === p.id ? '#7C3AED' : '#E2E8F0'}`,
                backgroundColor: selectedPipelineId === p.id ? '#EDE9FE' : '#FFFFFF',
                color: selectedPipelineId === p.id ? '#6D28D9' : '#64748B',
                fontWeight: selectedPipelineId === p.id ? 500 : 400,
                cursor: 'pointer',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Filter size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              placeholder="Filter activities or case IDs…"
              style={{
                height: '30px', paddingLeft: '28px', paddingRight: '10px',
                border: '1px solid #E2E8F0', borderRadius: '4px',
                fontSize: '12px', color: '#0D1117', outline: 'none', width: '220px',
              }}
            />
          </div>
          <button
            onClick={() => {
              if (currentPipeline) {
                loadEvents(currentPipeline.id);
                loadQuality(currentPipeline.id);
              }
            }}
            style={{ height: '30px', width: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', backgroundColor: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Refresh events"
          >
            <RefreshCw size={13} color={loadingEvents ? '#2563EB' : '#64748B'} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: quality + activity summary */}
        <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid #E2E8F0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {currentPipeline && (
            <>
              {/* Pipeline info */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '6px' }}>Pipeline</div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>{currentPipeline.name}</div>
                {currentPipeline.description && (
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{currentPipeline.description}</div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '10px', padding: '2px 6px', borderRadius: '2px', fontWeight: 500,
                    backgroundColor: currentPipeline.status === 'RUNNING' ? '#ECFDF5' : currentPipeline.status === 'FAILED' ? '#FEF2F2' : '#F1F5F9',
                    color: currentPipeline.status === 'RUNNING' ? '#065F46' : currentPipeline.status === 'FAILED' ? '#991B1B' : '#64748B',
                  }}>
                    {currentPipeline.status === 'RUNNING' ? '● ' : ''}{currentPipeline.status}
                  </span>
                  <span style={{ fontSize: '10px', color: '#94A3B8' }}>v{currentPipeline.version}</span>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { label: 'Events', value: events.length },
                  { label: 'Cases', value: uniqueCases },
                  { label: 'Activities', value: Object.keys(activityCounts).length },
                  { label: 'Connectors', value: currentPipeline.connectorIds.length },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '4px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{value}</div>
                    <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '1px' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Quality scores */}
              {quality && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Quality</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: qualityColor(quality.composite), fontFamily: 'var(--font-mono)', textTransform: 'none' }}>
                      {Math.round(quality.composite * 100)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <QualityBar label="Completeness" value={quality.completeness} color={qualityColor(quality.completeness)} />
                    <QualityBar label="Timeliness" value={quality.timeliness} color={qualityColor(quality.timeliness)} />
                    <QualityBar label="Consistency" value={quality.consistency} color={qualityColor(quality.consistency)} />
                    <QualityBar label="Accuracy" value={quality.accuracy} color={qualityColor(quality.accuracy)} />
                  </div>
                  {quality.issues.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '8px 10px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '4px' }}>
                      {quality.issues.map((issue, i) => (
                        <div key={i} style={{ fontSize: '11px', color: '#92400E', display: 'flex', gap: '4px' }}>
                          <span>⚠</span><span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Activity breakdown */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px' }}>Activities</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {Object.entries(activityCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([activity, count]) => {
                      const pct = count / events.length;
                      return (
                        <div key={activity} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                          onClick={() => setActivityFilter(activityFilter === activity ? '' : activity)}
                        >
                          <div style={{ flex: 1, height: '18px', backgroundColor: '#F1F5F9', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.round(pct * 100)}%`, backgroundColor: activityFilter === activity ? '#7C3AED' : '#C4B5FD', borderRadius: '2px' }} />
                            <span style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', fontWeight: 500, color: '#0D1117', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                              {activity}
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: '#64748B', fontFamily: 'var(--font-mono)', minWidth: '22px', textAlign: 'right' }}>{count}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </>
          )}

          {eventPipelines.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '12px' }}>
              No pipeline runs yet.<br />
              Run a pipeline from the Pipeline Builder to generate events.
            </div>
          )}
        </div>

        {/* Right: event table */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Table header */}
          <div style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', padding: '0 16px', flexShrink: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: 600, color: '#64748B', width: '24px' }} />
                  <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B' }}>Timestamp</th>
                  <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B' }}>Case ID</th>
                  <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B' }}>Activity</th>
                  <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B' }}>Resource</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600, color: '#64748B' }}>Cost</th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Table body */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: '13px' }}>
                {loadingEvents ? 'Loading events...' : activityFilter ? 'No events match the filter' : 'No events recorded for this pipeline yet'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <tbody>
                  {filtered.map((evt) => (
                    <React.Fragment key={evt.id}>
                      <tr
                        onClick={() => setExpandedRow(expandedRow === evt.id ? null : evt.id)}
                        style={{
                          borderBottom: '1px solid #F1F5F9', cursor: 'pointer',
                          backgroundColor: expandedRow === evt.id ? '#F5F3FF' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '7px 8px 7px 16px', width: '24px', color: '#94A3B8' }}>
                          {expandedRow === evt.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </td>
                        <td style={{ padding: '7px 8px', color: '#64748B', fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                          {new Date(evt.timestamp).toLocaleString()}
                        </td>
                        <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono)', fontWeight: 500, color: '#0D1117' }}>
                          {evt.caseId}
                        </td>
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{ backgroundColor: '#EDE9FE', color: '#6D28D9', padding: '2px 7px', borderRadius: '2px', fontSize: '11px', fontWeight: 500 }}>
                            {evt.activity}
                          </span>
                        </td>
                        <td style={{ padding: '7px 8px', color: '#64748B', fontSize: '11px' }}>
                          {evt.resource}
                        </td>
                        <td style={{ padding: '7px 16px 7px 8px', textAlign: 'right', color: '#64748B', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                          {evt.cost != null ? `$${evt.cost.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                      {expandedRow === evt.id && (
                        <tr style={{ backgroundColor: '#F5F3FF' }}>
                          <td colSpan={6} style={{ padding: '8px 16px 12px 40px' }}>
                            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '11px' }}>
                              <div>
                                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Event ID</span>
                                <div style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', marginTop: '2px' }}>{evt.id}</div>
                              </div>
                              <div>
                                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Pipeline</span>
                                <div style={{ color: '#0D1117', marginTop: '2px' }}>{currentPipeline?.name}</div>
                              </div>
                              <div>
                                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Object Type</span>
                                <div style={{ color: '#0D1117', marginTop: '2px' }}>{evt.objectTypeId ? objectTypeName(evt.objectTypeId) : '—'}</div>
                              </div>
                              <div>
                                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Attributes</span>
                                <div style={{ fontFamily: 'var(--font-mono)', color: '#64748B', marginTop: '2px', fontSize: '10px' }}>
                                  {JSON.stringify(evt.attributes, null, 0)}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        height: 32, backgroundColor: '#0D1117', borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {filtered.length} events · {uniqueCases} cases
          {activityFilter && ` · filtered by "${activityFilter}"`}
        </span>
        {currentPipeline && quality && (
          <span style={{ fontSize: '11px', color: qualityColor(quality.composite), fontFamily: 'var(--font-mono)' }}>
            quality: {Math.round(quality.composite * 100)}%
          </span>
        )}
        {currentPipeline?.lastRunAt && (
          <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
            last run: {new Date(currentPipeline.lastRunAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};

export default EventLog;
