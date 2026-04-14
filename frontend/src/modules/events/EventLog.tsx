import React, { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, Filter, ChevronDown, ChevronRight, Radio, BarChart2, List } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useEventStream } from '../../hooks/useEventStream';
import { usePipelineStore } from '../../store/pipelineStore';
import { useConnectorStore } from '../../store/connectorStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { EventLogQualityScore } from '../../types/pipeline';
import { getTenantId } from '../../store/authStore';

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


interface ChangedField {
  field: string;
  from: unknown;
  to: unknown;
}

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

function activityMeta(activity: string): { bg: string; color: string; border: string } {
  if (activity === 'PIPELINE_COMPLETED') return { bg: '#DCFCE7', color: '#15803D', border: '#BBF7D0' };
  if (activity === 'PIPELINE_FAILED') return { bg: '#FFE4E6', color: '#BE123C', border: '#FECDD3' };
  if (activity === 'RECORD_CREATED') return { bg: '#DBEAFE', color: '#1D4ED8', border: '#BFDBFE' };
  if (activity === 'RECORD_UPDATED') return { bg: '#FEF9C3', color: '#854D0E', border: '#FDE68A' };
  return { bg: '#EDE9FE', color: '#6D28D9', border: '#C4B5FD' };
}

const FieldDiff: React.FC<{ fields: ChangedField[] }> = ({ fields }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
    {fields.map((f) => (
      <div key={f.field} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        <span style={{ color: '#94A3B8', minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.field}</span>
        <span style={{ color: '#DC2626', textDecoration: 'line-through', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(f.from ?? '∅')}</span>
        <span style={{ color: '#94A3B8' }}>→</span>
        <span style={{ color: '#16A34A', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(f.to ?? '∅')}</span>
      </div>
    ))}
  </div>
);

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
  const [liveMode, setLiveMode] = useState(false);
  const [viewMode, setViewMode] = useState<'events' | 'timeseries'>('events');
  const [tsBucket, setTsBucket] = useState('1h');
  const [tsData, setTsData] = useState<{ bucket: string; [activity: string]: number | string }[]>([]);
  const [tsActivities, setTsActivities] = useState<string[]>([]);
  const [tsSummary, setTsSummary] = useState<{ total_events: number; unique_cases: number; first_event: string | null; last_event: string | null; activity_breakdown: { activity: string; count: number }[] } | null>(null);
  const [loadingTs, setLoadingTs] = useState(false);

  // Live streaming
  const streamUrl = liveMode && selectedPipelineId
    ? `${EVENT_LOG_API}/events/stream?pipeline_id=${selectedPipelineId}`
    : null;

  const { connected: streamConnected, error: streamError } = useEventStream<Record<string, unknown>>({
    url: streamUrl,
    enabled: liveMode,
    onEvent: (e) => {
      const mapped: LiveEvent = {
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
      };
      setEvents((prev) => [mapped, ...prev].slice(0, 500));
    },
  });

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
        `${EVENT_LOG_API}/events?pipeline_id=${pipelineId}&limit=1000`,
        { headers: { 'x-tenant-id': getTenantId() } }
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
        headers: { 'x-tenant-id': getTenantId() },
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

  const loadTimeseries = useCallback(async (pipelineId: string, bucket: string) => {
    setLoadingTs(true);
    try {
      const [tsRes, summRes] = await Promise.all([
        fetch(`${EVENT_LOG_API}/events/timeseries?pipeline_id=${pipelineId}&bucket=${bucket}`, { headers: { 'x-tenant-id': getTenantId() } }),
        fetch(`${EVENT_LOG_API}/events/timeseries/summary?pipeline_id=${pipelineId}`, { headers: { 'x-tenant-id': getTenantId() } }),
      ]);
      if (tsRes.ok) {
        const raw: { bucket: string; activity: string; count: number }[] = await tsRes.json();
        // Pivot to [{bucket, ACTIVITY1: count, ACTIVITY2: count}]
        const acts = Array.from(new Set(raw.map((r) => r.activity)));
        const byBucket: Record<string, Record<string, number>> = {};
        raw.forEach((r) => {
          if (!byBucket[r.bucket]) byBucket[r.bucket] = {};
          byBucket[r.bucket][r.activity] = r.count;
        });
        const pivoted = Object.entries(byBucket)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([bucket, actMap]) => {
            const row: { bucket: string; [k: string]: number | string } = {
              bucket: new Date(bucket).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            };
            acts.forEach((a) => { row[a] = actMap[a] || 0; });
            return row;
          });
        setTsData(pivoted);
        setTsActivities(acts);
      }
      if (summRes.ok) {
        setTsSummary(await summRes.json());
      }
    } catch {
      setTsData([]);
    } finally {
      setLoadingTs(false);
    }
  }, []);

  useEffect(() => {
    if (currentPipeline) {
      loadEvents(currentPipeline.id);
      loadQuality(currentPipeline.id);
    }
  }, [currentPipeline?.id]);

  useEffect(() => {
    if (currentPipeline && viewMode === 'timeseries') {
      loadTimeseries(currentPipeline.id, tsBucket);
    }
  }, [currentPipeline?.id, viewMode, tsBucket]);

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
        <select
          value={selectedPipelineId ?? ''}
          onChange={(e) => setSelectedPipelineId(e.target.value || null)}
          style={{
            height: '28px', padding: '0 8px', borderRadius: '4px', fontSize: '12px',
            border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
            color: '#64748B', cursor: 'pointer', outline: 'none',
            marginLeft: '8px', maxWidth: '220px',
          }}
        >
          <option value="">All pipelines</option>
          {eventPipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

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

          {/* Live mode toggle */}
          <button
            onClick={() => setLiveMode((v) => !v)}
            title={liveMode ? 'Disable live mode' : 'Enable live streaming'}
            style={{
              height: 30, padding: '0 10px',
              border: `1px solid ${liveMode ? '#059669' : '#E2E8F0'}`,
              borderRadius: 4,
              backgroundColor: liveMode ? '#ECFDF5' : '#FFFFFF',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 600,
              color: liveMode ? '#059669' : '#64748B',
              transition: 'all 120ms',
            }}
          >
            <Radio size={11} style={liveMode ? { animation: 'pulse-dot 1.5s ease-in-out infinite' } : {}} />
            {liveMode ? (streamConnected ? 'LIVE' : 'Connecting…') : 'Live'}
          </button>
          {streamError && liveMode && (
            <span style={{ fontSize: 10, color: '#D97706' }}>{streamError}</span>
          )}
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
                    {currentPipeline.status}
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
                          <span>{issue}</span>
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
                            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.round(pct * 100)}%`, backgroundColor: activityFilter === activity ? activityMeta(activity).color : activityMeta(activity).bg, borderRadius: '2px' }} />
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

        {/* Right: event table / timeseries */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* View mode toggle + table header */}
          <div style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', padding: '0 16px', flexShrink: 0 }}>
            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E2E8F0', marginBottom: 0 }}>
              {([['events', List, 'Events'], ['timeseries', BarChart2, 'Time Series']] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 14px', border: 'none',
                    borderBottom: viewMode === mode ? '2px solid #7C3AED' : '2px solid transparent',
                    backgroundColor: 'transparent', cursor: 'pointer',
                    fontSize: 12, fontWeight: viewMode === mode ? 600 : 500,
                    color: viewMode === mode ? '#7C3AED' : '#64748B',
                    transition: 'all 120ms',
                  }}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            {viewMode === 'events' && (
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
            )}
            {viewMode === 'timeseries' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>Bucket</span>
                {(['5m', '15m', '1h', '6h', '1d', '1w'] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => setTsBucket(b)}
                    style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${tsBucket === b ? '#7C3AED' : '#E2E8F0'}`,
                      backgroundColor: tsBucket === b ? '#EDE9FE' : '#FFFFFF',
                      color: tsBucket === b ? '#7C3AED' : '#64748B',
                      cursor: 'pointer',
                    }}
                  >
                    {b}
                  </button>
                ))}
                {loadingTs && <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 4 }}>Loading…</span>}
              </div>
            )}
          </div>

          {/* Timeseries view */}
          {viewMode === 'timeseries' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {tsSummary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                  {[
                    { label: 'Total Events', value: tsSummary.total_events.toLocaleString() },
                    { label: 'Unique Cases', value: tsSummary.unique_cases.toLocaleString() },
                    { label: 'First Event', value: tsSummary.first_event ? new Date(tsSummary.first_event).toLocaleDateString() : '—' },
                    { label: 'Last Event', value: tsSummary.last_event ? new Date(tsSummary.last_event).toLocaleDateString() : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: 6, backgroundColor: '#FFFFFF' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{value}</div>
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>
              )}

              {tsData.length === 0 && !loadingTs && (
                <div style={{ textAlign: 'center', padding: '48px 0', color: '#94A3B8', fontSize: 13 }}>
                  No time series data available for this pipeline
                </div>
              )}

              {tsData.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                    Events over time
                  </div>
                  <div style={{ height: 320, marginBottom: 24 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={tsData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#94A3B8' }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        {tsActivities.map((act, i) => {
                          const colors = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#DB2777'];
                          const color = colors[i % colors.length];
                          return (
                            <Area
                              key={act}
                              type="monotone"
                              dataKey={act}
                              stackId="1"
                              stroke={color}
                              fill={color + '33'}
                              strokeWidth={2}
                            />
                          );
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {tsSummary && tsSummary.activity_breakdown.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Activity breakdown
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {tsSummary.activity_breakdown.map(({ activity, count }) => {
                          const total = tsSummary.total_events || 1;
                          const pct = count / total;
                          const meta = activityMeta(activity);
                          return (
                            <div key={activity} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 180, flexShrink: 0, fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activity}</div>
                              <div style={{ flex: 1, height: 14, backgroundColor: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: meta.bg, borderRadius: 2 }} />
                              </div>
                              <div style={{ width: 60, textAlign: 'right', fontSize: 11, color: '#64748B', fontFamily: 'var(--font-mono)' }}>{count.toLocaleString()}</div>
                              <div style={{ width: 40, textAlign: 'right', fontSize: 11, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{Math.round(pct * 100)}%</div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Table body */}
          {viewMode === 'events' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: '13px' }}>
                {loadingEvents ? 'Loading events...' : activityFilter ? 'No events match the filter' : 'No events recorded for this pipeline yet'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <tbody>
                  {filtered.map((evt) => {
                    const isPipelineRun = evt.activity === 'PIPELINE_COMPLETED' || evt.activity === 'PIPELINE_FAILED';
                    const isCompleted = evt.activity === 'PIPELINE_COMPLETED';
                    const isFailed = evt.activity === 'PIPELINE_FAILED';
                    const isCreated = evt.activity === 'RECORD_CREATED';
                    const isUpdated = evt.activity === 'RECORD_UPDATED';
                    const isRecordEvent = isCreated || isUpdated;
                    const meta = activityMeta(evt.activity);
                    const changedFields = (evt.attributes.changed_fields ?? []) as ChangedField[];
                    const snapshot = (evt.attributes.record_snapshot ?? {}) as Record<string, unknown>;

                    const rowBg = expandedRow === evt.id ? '#F8FAFC' : 'transparent';
                    return (
                    <React.Fragment key={evt.id}>
                      <tr
                        onClick={() => setExpandedRow(expandedRow === evt.id ? null : evt.id)}
                        style={{
                          borderBottom: isPipelineRun ? `2px solid ${meta.border}` : '1px solid #F1F5F9',
                          cursor: 'pointer',
                          backgroundColor: expandedRow === evt.id ? meta.bg + '40' : rowBg,
                        }}
                      >
                        <td style={{ padding: '7px 8px 7px 16px', width: '24px', color: '#94A3B8' }}>
                          {expandedRow === evt.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </td>
                        <td style={{ padding: '7px 8px', color: '#64748B', fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                          {new Date(evt.timestamp).toLocaleString()}
                        </td>
                        <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono)', fontWeight: 500, color: '#0D1117', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isPipelineRun ? (evt.attributes.pipeline_name as string || currentPipeline?.name || evt.caseId) : evt.caseId}
                        </td>
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{
                            backgroundColor: meta.bg,
                            color: meta.color,
                            padding: '2px 7px', borderRadius: '2px', fontSize: '11px', fontWeight: 600,
                          }}>
                            {evt.activity}
                          </span>
                        </td>
                        <td style={{ padding: '7px 8px', color: '#64748B', fontSize: '11px' }}>
                          {isPipelineRun
                            ? (evt.attributes.rows_out != null ? `${evt.attributes.rows_out} records` : '')
                            : isUpdated
                              ? `${changedFields.length} field${changedFields.length !== 1 ? 's' : ''} changed`
                              : evt.objectTypeId ? objectTypeName(evt.objectTypeId) : evt.resource}
                        </td>
                        <td style={{ padding: '7px 16px 7px 8px', textAlign: 'right', color: '#64748B', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                          {isPipelineRun
                            ? (evt.attributes.rows_in != null ? `${evt.attributes.rows_in} in` : '—')
                            : (evt.cost != null ? `$${evt.cost.toFixed(2)}` : '—')}
                        </td>
                      </tr>
                      {expandedRow === evt.id && (
                        <tr style={{ backgroundColor: meta.bg + '30' }}>
                          <td colSpan={6} style={{ padding: '8px 16px 12px 40px' }}>
                            {isPipelineRun ? (
                              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '11px' }}>
                                <div>
                                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>Pipeline</span>
                                  <div style={{ color: '#0D1117', marginTop: '2px' }}>{evt.attributes.pipeline_name as string || currentPipeline?.name}</div>
                                </div>
                                <div>
                                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>Records In</span>
                                  <div style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', marginTop: '2px' }}>{String(evt.attributes.rows_in ?? '—')}</div>
                                </div>
                                <div>
                                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>Records Out</span>
                                  <div style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', marginTop: '2px' }}>{String(evt.attributes.rows_out ?? '—')}</div>
                                </div>
                                <div>
                                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>Status</span>
                                  <div style={{ color: isCompleted ? '#15803D' : '#BE123C', fontWeight: 600, marginTop: '2px' }}>{evt.attributes.status as string}</div>
                                </div>
                                {isFailed && !!evt.attributes.error && (
                                  <div style={{ flex: 1 }}>
                                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>Error</span>
                                    <div style={{ fontFamily: 'var(--font-mono)', color: '#BE123C', marginTop: '2px', fontSize: '10px', wordBreak: 'break-all' }}>{evt.attributes.error as string}</div>
                                  </div>
                                )}
                              </div>
                            ) : isRecordEvent ? (
                              <div style={{ fontSize: '11px' }}>
                                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                  <div>
                                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>Record ID</span>
                                    <div style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', marginTop: '2px' }}>{evt.caseId}</div>
                                  </div>
                                  <div>
                                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>Object Type</span>
                                    <div style={{ color: '#0D1117', marginTop: '2px' }}>{evt.objectTypeId ? objectTypeName(evt.objectTypeId) : '—'}</div>
                                  </div>
                                  <div>
                                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>Pipeline</span>
                                    <div style={{ color: '#0D1117', marginTop: '2px' }}>{currentPipeline?.name}</div>
                                  </div>
                                </div>
                                {isUpdated && changedFields.length > 0 && (
                                  <div>
                                    <div style={{ color: '#94A3B8', fontWeight: 600, marginBottom: '4px' }}>
                                      Changed Fields ({changedFields.length})
                                    </div>
                                    <FieldDiff fields={changedFields} />
                                  </div>
                                )}
                                {isCreated && Object.keys(snapshot).length > 0 && (
                                  <div>
                                    <div style={{ color: '#94A3B8', fontWeight: 600, marginBottom: '4px' }}>Initial Values</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {Object.entries(snapshot).slice(0, 12).map(([k, v]) => (
                                        <div key={k} style={{ padding: '3px 8px', backgroundColor: '#F1F5F9', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                                          <span style={{ color: '#64748B' }}>{k}: </span>
                                          <span style={{ color: '#0D1117' }}>{String(v)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
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
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          )}
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
