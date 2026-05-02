/**
 * Operations store — feeds the Hivemind grid and the Run Drilldown.
 *
 * Aggregates state from the existing pipeline / agent / alert / connector
 * services so the UI has a single place to subscribe. We poll on an interval
 * rather than open a websocket for each entity; the SSE multiplex is a
 * follow-up.
 */
import { create } from 'zustand';
import { getTenantId } from './authStore';

const PIPELINE_API  = import.meta.env.VITE_PIPELINE_SERVICE_URL  || 'http://localhost:8002';
const AGENT_API     = import.meta.env.VITE_AGENT_SERVICE_URL     || 'http://localhost:8013';
const ALERT_API     = import.meta.env.VITE_ALERT_ENGINE_URL      || 'http://localhost:8010';
const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

// ── Types ────────────────────────────────────────────────────────────────────

export type OpsKind = 'pipeline' | 'agent' | 'connector' | 'schedule' | 'alert';
export type OpsStatus = 'running' | 'success' | 'failed' | 'warning' | 'idle';

export interface OpsCard {
  id: string;
  kind: OpsKind;
  name: string;
  status: OpsStatus;
  /** Short verb shown under the name — "ENRICH · 2,117 / 2,400" */
  verb: string;
  /** ISO timestamp of last activity */
  lastAt: string | null;
  meta: {
    runId?: string;
    pipelineId?: string;
    agentId?: string;
    notificationId?: string;
    model?: string;
    durationMs?: number;
    severity?: 'critical' | 'warning';
  };
}

export interface OpsLogLine {
  ts: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'OK';
  node_id?: string;
  msg: string;
  extra?: Record<string, unknown>;
}

export interface NodeAuditDetail {
  node_id: string;
  node_type: string;
  node_label: string;
  rows_in: number;
  rows_out: number;
  dropped: number;
  duration_ms: number;
  started_at: string;
  sample_in?: Record<string, unknown>[];
  sample_out?: Record<string, unknown>[];
  stats?: Record<string, unknown>;
  error?: string;
}

export interface PipelineRunDetail {
  kind: 'pipeline';
  run_id: string;
  pipeline_id: string;
  pipeline_name?: string;
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  triggered_by?: string;
  rows_in: number;
  rows_out: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  node_audits: Record<string, NodeAuditDetail>;
  logs: OpsLogLine[];
}

export type AgentStepKind = 'thinking' | 'tool_call' | 'tool_result' | 'assistant' | 'error';

export interface AgentStep {
  kind: AgentStepKind;
  iter: number;
  ts?: string;
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  msg?: string;
}

export interface AgentRunDetail {
  kind: 'agent';
  id: string;
  agent_id: string;
  agent_name?: string;
  model?: string | null;
  thread_id?: string | null;
  pipeline_id?: string | null;
  pipeline_run_id?: string | null;
  iterations: number;
  tool_calls: { tool: string; result?: unknown }[];
  steps: AgentStep[];
  final_text?: string | null;
  is_test: boolean;
  error?: string | null;
  created_at?: string | null;
}

export type AnyRunDetail = PipelineRunDetail | AgentRunDetail;

// ── Store ────────────────────────────────────────────────────────────────────

export interface SelectedRun {
  kind: 'pipeline' | 'agent';
  runId: string;
  pipelineId?: string;
}

interface OpsState {
  cards: OpsCard[];
  loading: boolean;
  lastFetchedAt: string | null;
  /** Currently-open run drilldown. null = grid view. */
  selected: SelectedRun | null;

  fetchSnapshot: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;

  selectRun: (run: SelectedRun | null) => void;

  fetchPipelineRun: (pipelineId: string, runId: string) => Promise<PipelineRunDetail>;
  fetchAgentRun: (runId: string) => Promise<AgentRunDetail>;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

const tenantHeaders = (): Record<string, string> => ({ 'x-tenant-id': getTenantId() });

function timeAgoIso(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function pipelineStatusToOps(status: string): OpsStatus {
  const s = (status || '').toUpperCase();
  if (s === 'RUNNING') return 'running';
  if (s === 'FAILED')  return 'failed';
  if (s === 'COMPLETED') return 'success';
  return 'idle';
}

export const useOperationsStore = create<OpsState>((set, get) => ({
  cards: [],
  loading: false,
  lastFetchedAt: null,
  selected: null,

  selectRun: (run) => set({ selected: run }),

  fetchSnapshot: async () => {
    if (!get().lastFetchedAt) set({ loading: true });

    const headers = tenantHeaders();

    // Fetch in parallel; tolerate any one failing — we still want to render.
    const [pRunsRes, aRunsRes, alertsRes, connsRes, pipesRes, agentsRes] = await Promise.allSettled([
      fetch(`${PIPELINE_API}/pipelines/runs/recent?limit=30`, { headers }),
      fetch(`${AGENT_API}/agents/runs/recent?limit=30`,       { headers }),
      fetch(`${ALERT_API}/alerts/notifications?tenant_id=${getTenantId()}&unread_only=false&limit=20`),
      fetch(`${CONNECTOR_API}/connectors`,                    { headers }),
      fetch(`${PIPELINE_API}/pipelines`,                      { headers }),
      fetch(`${AGENT_API}/agents`,                            { headers }),
    ]);

    const cards: OpsCard[] = [];

    // ── Pipelines ──────────────────────────────────────────────────────────
    type PipeRun = { id: string; pipeline_id: string; pipeline_name?: string;
                     status: string; triggered_by?: string; rows_in: number; rows_out: number;
                     error_message?: string; started_at?: string; finished_at?: string };
    let pipeRuns: PipeRun[] = [];
    if (pRunsRes.status === 'fulfilled' && pRunsRes.value.ok) {
      pipeRuns = await pRunsRes.value.json();
    }
    type PipeMeta = { id: string; name?: string; status?: string; last_run_at?: string };
    let pipes: PipeMeta[] = [];
    if (pipesRes.status === 'fulfilled' && pipesRes.value.ok) {
      pipes = await pipesRes.value.json();
    }
    const latestRunByPipeline = new Map<string, PipeRun>();
    for (const r of pipeRuns) {
      if (!latestRunByPipeline.has(r.pipeline_id)) latestRunByPipeline.set(r.pipeline_id, r);
    }
    for (const p of pipes) {
      const latest = latestRunByPipeline.get(p.id);
      const status: OpsStatus = latest
        ? pipelineStatusToOps(latest.status)
        : 'idle';
      const verb = latest
        ? (status === 'running'
            ? 'running'
            : status === 'failed'
              ? (latest.error_message?.slice(0, 80) || 'failed')
              : `${(latest.rows_out ?? 0).toLocaleString()} rows out`)
        : 'never run';
      cards.push({
        id: `pipeline-${p.id}`,
        kind: 'pipeline',
        name: p.name || p.id.slice(0, 8),
        status,
        verb,
        lastAt: latest?.finished_at || latest?.started_at || p.last_run_at || null,
        meta: {
          runId: latest?.id,
          pipelineId: p.id,
        },
      });
    }

    // ── Agents ─────────────────────────────────────────────────────────────
    type AgentMeta = { id: string; name?: string; model?: string; enabled?: boolean };
    type AgentRun = { id: string; agent_id: string; agent_name?: string;
                      iterations: number; tool_count: number; error?: string;
                      created_at?: string };
    let agents: AgentMeta[] = [];
    if (agentsRes.status === 'fulfilled' && agentsRes.value.ok) {
      agents = await agentsRes.value.json();
    }
    let agentRuns: AgentRun[] = [];
    if (aRunsRes.status === 'fulfilled' && aRunsRes.value.ok) {
      agentRuns = await aRunsRes.value.json();
    }
    const latestRunByAgent = new Map<string, AgentRun>();
    for (const r of agentRuns) {
      if (!latestRunByAgent.has(r.agent_id)) latestRunByAgent.set(r.agent_id, r);
    }
    for (const a of agents) {
      const latest = latestRunByAgent.get(a.id);
      const status: OpsStatus = !latest
        ? 'idle'
        : latest.error
          ? 'failed'
          : 'success';
      const verb = latest
        ? (latest.error
            ? latest.error.slice(0, 80)
            : `${latest.iterations} iter · ${latest.tool_count} tools`)
        : 'never run';
      cards.push({
        id: `agent-${a.id}`,
        kind: 'agent',
        name: a.name || a.id.slice(0, 8),
        status,
        verb,
        lastAt: latest?.created_at || null,
        meta: {
          runId: latest?.id,
          agentId: a.id,
          model: a.model,
        },
      });
    }

    // ── Connectors ─────────────────────────────────────────────────────────
    type Conn = { id: string; name?: string; status?: string; lastSyncAt?: string;
                  last_sync_at?: string; activePipelineCount?: number };
    if (connsRes.status === 'fulfilled' && connsRes.value.ok) {
      const conns: Conn[] = await connsRes.value.json();
      for (const c of conns) {
        const cstatus = (c.status || '').toLowerCase();
        const lastAt = c.lastSyncAt || c.last_sync_at || null;
        const status: OpsStatus = cstatus.includes('error') || cstatus.includes('fail')
          ? 'failed'
          : cstatus.includes('warn') || cstatus.includes('rate')
            ? 'warning'
            : cstatus === 'active' || cstatus === 'connected' || cstatus === 'healthy'
              ? 'success'
              : 'idle';
        cards.push({
          id: `connector-${c.id}`,
          kind: 'connector',
          name: c.name || c.id.slice(0, 8),
          status,
          verb: c.activePipelineCount
            ? `feeding ${c.activePipelineCount} pipeline${c.activePipelineCount === 1 ? '' : 's'}`
            : (cstatus || 'idle'),
          lastAt,
          meta: {},
        });
      }
    }

    // ── Alerts (recent fired notifications, unresolved) ────────────────────
    type Notif = { id: string; rule_name: string; rule_type: string;
                   severity: 'critical' | 'warning'; message: string;
                   read: boolean; fired_at: string;
                   run_link?: { kind: string; run_id: string; pipeline_id?: string; agent_id?: string } };
    if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
      const data = await alertsRes.value.json();
      const notifs: Notif[] = data.notifications || [];
      // Top 6 most recent — keep the lane focused
      for (const n of notifs.slice(0, 6)) {
        cards.push({
          id: `alert-${n.id}`,
          kind: 'alert',
          name: n.rule_name,
          status: n.severity === 'critical' ? 'failed' : 'warning',
          verb: n.message?.slice(0, 100) || n.rule_type,
          lastAt: n.fired_at,
          meta: {
            notificationId: n.id,
            severity: n.severity,
            runId: n.run_link?.run_id,
            pipelineId: n.run_link?.kind === 'pipeline' ? n.run_link?.pipeline_id : undefined,
            agentId: n.run_link?.kind === 'agent' ? n.run_link?.agent_id : undefined,
          },
        });
      }
    }

    set({ cards, loading: false, lastFetchedAt: new Date().toISOString() });
  },

  startPolling: (intervalMs = 5000) => {
    if (pollTimer) return;
    void get().fetchSnapshot();
    pollTimer = setInterval(() => {
      void get().fetchSnapshot();
    }, intervalMs);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },

  fetchPipelineRun: async (pipelineId, runId) => {
    const r = await fetch(
      `${PIPELINE_API}/pipelines/${pipelineId}/runs/${runId}/audit`,
      { headers: tenantHeaders() },
    );
    if (!r.ok) throw new Error(`Pipeline run ${runId}: HTTP ${r.status}`);
    const data = await r.json();
    // node_audits is a dict keyed by node_id — surface as-is for the viewer
    const node_audits: Record<string, NodeAuditDetail> = {};
    for (const [k, v] of Object.entries(data.node_audits || {})) {
      if (k === '_watermark_value') continue;
      node_audits[k] = v as NodeAuditDetail;
    }
    return {
      kind: 'pipeline',
      run_id: data.run_id,
      pipeline_id: data.pipeline_id,
      status: data.status,
      triggered_by: data.triggered_by,
      rows_in: data.rows_in ?? 0,
      rows_out: data.rows_out ?? 0,
      error_message: data.error_message,
      started_at: data.started_at,
      finished_at: data.finished_at,
      node_audits,
      logs: (data.logs || []) as OpsLogLine[],
    };
  },

  fetchAgentRun: async (runId) => {
    const r = await fetch(`${AGENT_API}/agents/runs/${runId}`, { headers: tenantHeaders() });
    if (!r.ok) throw new Error(`Agent run ${runId}: HTTP ${r.status}`);
    const data = await r.json();
    return {
      kind: 'agent',
      id: data.id,
      agent_id: data.agent_id,
      agent_name: data.agent_name,
      model: data.model,
      thread_id: data.thread_id,
      pipeline_id: data.pipeline_id,
      pipeline_run_id: data.pipeline_run_id,
      iterations: data.iterations ?? 0,
      tool_calls: data.tool_calls || [],
      steps: data.steps || [],
      final_text: data.final_text,
      is_test: !!data.is_test,
      error: data.error,
      created_at: data.created_at,
    };
  },
}));

// Re-export helper so views can format times consistently.
export { timeAgoIso };
