import React, { useEffect, useState } from 'react';
import { Clock, Play, RefreshCw } from 'lucide-react';
import { usePipelineStore, PipelineSchedule } from '../../store/pipelineStore';
import { useAgentStore, AgentSchedule } from '../../store/agentStore';

// ─── Unified schedule type ────────────────────────────────────────────────────

type SelectedSchedule =
  | { type: 'pipeline'; schedule: PipelineSchedule }
  | { type: 'agent'; schedule: AgentSchedule };

// ─── Schedule card ────────────────────────────────────────────────────────────

const ScheduleCard: React.FC<{
  name: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: string | null;
  selected: boolean;
  onClick: () => void;
}> = ({ name, cron, enabled, lastRunAt, selected, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '10px 12px', border: 'none',
      borderBottom: '1px solid #E2E8F0',
      backgroundColor: selected ? '#EFF6FF' : '#FFFFFF',
      cursor: 'pointer',
      borderLeft: selected ? '2px solid #2563EB' : '2px solid transparent',
      transition: 'background-color 80ms',
    }}
    onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'; }}
    onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF'; }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        backgroundColor: enabled ? '#22C55E' : '#CBD5E1',
      }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: '#1E293B', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
    <code style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace', display: 'block' }}>{cron}</code>
    {lastRunAt && (
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
        Last: {new Date(lastRunAt).toLocaleString()}
      </div>
    )}
  </button>
);

// ─── Section header ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div style={{
    padding: '6px 12px', backgroundColor: '#F8FAFC',
    borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 6,
  }}>
    <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
    </span>
    <span style={{
      fontSize: 9, backgroundColor: '#E2E8F0', color: '#64748B',
      padding: '1px 5px', borderRadius: 8, fontWeight: 600,
    }}>{count}</span>
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

const SchedulesPage: React.FC = () => {
  const {
    pipelines, schedules: pipelineSchedules,
    fetchPipelines, fetchSchedules: fetchPipelineSchedules,
    updateSchedule: updatePipelineSchedule,
    runScheduleNow: runPipelineScheduleNow,
  } = usePipelineStore();

  const {
    agents, schedules: agentSchedules,
    fetchAgents, fetchSchedules: fetchAgentSchedules,
    updateSchedule: updateAgentSchedule,
    runScheduleNow: runAgentScheduleNow,
  } = useAgentStore();

  const [selected, setSelected] = useState<SelectedSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      await fetchPipelines();
      await fetchAgents();
      // Fetch schedules for all pipelines
      const currentPipelines = usePipelineStore.getState().pipelines;
      await Promise.all(currentPipelines.map(p => fetchPipelineSchedules(p.id)));
      // Fetch schedules for all agents
      const currentAgents = useAgentStore.getState().agents;
      await Promise.all(currentAgents.map(a => fetchAgentSchedules(a.id)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ── Detail panel helpers ──────────────────────────────────────────────────

  const handleToggleEnabled = async () => {
    if (!selected || actionPending) return;
    setActionPending(true);
    try {
      if (selected.type === 'pipeline') {
        const s = selected.schedule;
        await updatePipelineSchedule(s.pipeline_id, s.id, { enabled: !s.enabled });
        // Refresh selection from latest state
        const updated = usePipelineStore.getState().schedules.find(sc => sc.id === s.id);
        if (updated) setSelected({ type: 'pipeline', schedule: updated });
      } else {
        const s = selected.schedule;
        await updateAgentSchedule(s.agent_id, s.id, { enabled: !s.enabled });
        const updated = useAgentStore.getState().schedules.find(sc => sc.id === s.id);
        if (updated) setSelected({ type: 'agent', schedule: updated });
      }
    } finally {
      setActionPending(false);
    }
  };

  const handleRunNow = async () => {
    if (!selected || actionPending) return;
    setActionPending(true);
    try {
      if (selected.type === 'pipeline') {
        const s = selected.schedule;
        await runPipelineScheduleNow(s.pipeline_id, s.id);
      } else {
        const s = selected.schedule;
        await runAgentScheduleNow(s.agent_id, s.id);
      }
    } finally {
      setActionPending(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const selectedId = selected?.schedule.id;

  const selectedName = selected
    ? selected.schedule.name
    : null;

  const selectedCron = selected
    ? selected.schedule.cron_expression
    : null;

  const selectedEnabled = selected
    ? selected.schedule.enabled
    : null;

  const selectedLastRun = selected
    ? (selected.type === 'pipeline'
        ? (selected.schedule as PipelineSchedule).last_run_at
        : (selected.schedule as AgentSchedule).last_run_at)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#F8FAFC' }}>

      {/* Top bar */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0,
      }}>
        <Clock size={16} color="#2563EB" />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 }}>Schedules</h1>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>
          {pipelineSchedules.length + agentSchedules.length} total
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={loadAll}
            disabled={loading}
            style={{
              height: 28, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5,
              borderRadius: 4, border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
              color: '#64748B', fontSize: 12, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left list */}
        <div style={{
          width: 320, borderRight: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
          display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
        }}>

          {/* Pipelines section */}
          <SectionHeader label="Pipelines" count={pipelineSchedules.length} />
          {pipelineSchedules.length === 0 && (
            <div style={{ padding: '12px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
              No pipeline schedules
            </div>
          )}
          {pipelineSchedules.map(s => (
            <ScheduleCard
              key={s.id}
              name={s.name}
              cron={s.cron_expression}
              enabled={s.enabled}
              lastRunAt={s.last_run_at}
              selected={selectedId === s.id}
              onClick={() => setSelected({ type: 'pipeline', schedule: s })}
            />
          ))}

          {/* Agents section */}
          <SectionHeader label="Agents" count={agentSchedules.length} />
          {agentSchedules.length === 0 && (
            <div style={{ padding: '12px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
              No agent schedules
            </div>
          )}
          {agentSchedules.map(s => (
            <ScheduleCard
              key={s.id}
              name={s.name}
              cron={s.cron_expression}
              enabled={s.enabled}
              lastRunAt={s.last_run_at}
              selected={selectedId === s.id}
              onClick={() => setSelected({ type: 'agent', schedule: s })}
            />
          ))}

        </div>

        {/* Right detail panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!selected ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94A3B8', fontSize: 13,
            }}>
              Select a schedule to view details
            </div>
          ) : (
            <div style={{ maxWidth: 560 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0D1117', margin: '0 0 6px 0' }}>
                    {selectedName}
                  </h2>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 2,
                    backgroundColor: selected.type === 'pipeline' ? '#EFF6FF' : '#F5F3FF',
                    color: selected.type === 'pipeline' ? '#2563EB' : '#7C3AED',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {selected.type === 'pipeline' ? 'Pipeline' : 'Agent'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleRunNow}
                    disabled={actionPending}
                    style={{
                      height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6,
                      borderRadius: 4, border: 'none', backgroundColor: '#2563EB', color: '#FFFFFF',
                      fontSize: 12, fontWeight: 500, cursor: actionPending ? 'wait' : 'pointer',
                      opacity: actionPending ? 0.7 : 1,
                    }}
                  >
                    <Play size={12} />
                    Run Now
                  </button>
                  <button
                    onClick={handleToggleEnabled}
                    disabled={actionPending}
                    style={{
                      height: 32, padding: '0 14px', borderRadius: 4,
                      border: '1px solid #E2E8F0',
                      backgroundColor: selectedEnabled ? '#DCFCE7' : '#F1F5F9',
                      color: selectedEnabled ? '#16A34A' : '#64748B',
                      fontSize: 12, fontWeight: 500, cursor: actionPending ? 'wait' : 'pointer',
                      opacity: actionPending ? 0.7 : 1,
                    }}
                  >
                    {selectedEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              {/* Cron expression */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Cron Expression
                </div>
                <div style={{
                  padding: '10px 14px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                  borderRadius: 6, fontFamily: 'monospace', fontSize: 14, color: '#1E293B',
                }}>
                  {selectedCron}
                </div>
              </div>

              {/* Status */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Status
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: selectedEnabled ? '#22C55E' : '#CBD5E1',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: selectedEnabled ? '#16A34A' : '#64748B', fontWeight: 500 }}>
                    {selectedEnabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Last run */}
              {selectedLastRun && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Last Run
                  </div>
                  <div style={{ fontSize: 13, color: '#475569' }}>
                    {new Date(selectedLastRun).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Run history */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Run History
                </div>
                <p style={{ color: '#94A3B8', fontSize: 12, margin: 0 }}>Run history coming soon</p>
              </div>

            </div>
          )}
        </div>

      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default SchedulesPage;
