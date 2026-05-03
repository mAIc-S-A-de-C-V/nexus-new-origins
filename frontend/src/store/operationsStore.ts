/**
 * Operations store — feeds the Hivemind grid and the Run Drilldown.
 *
 * v2 shape: instead of "one card per entity", we surface
 *   - `runningRuns`  — pipelines + agents currently executing (with live progress)
 *   - `recentRuns`   — chronological feed of finished runs (mixed kinds)
 *   - `catalog`      — counts + entries per kind for the bottom-of-page browse
 *
 * The polling loop hits each service in parallel; an SSE multiplex is the
 * planned follow-up once we know it's worth the plumbing.
 */
import { create } from 'zustand';
import { getTenantId } from './authStore';

const PIPELINE_API  = import.meta.env.VITE_PIPELINE_SERVICE_URL  || 'http://localhost:8002';
const AGENT_API     = import.meta.env.VITE_AGENT_SERVICE_URL     || 'http://localhost:8013';
const ALERT_API     = import.meta.env.VITE_ALERT_ENGINE_URL      || 'http://localhost:8010';
const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

// ── Types ────────────────────────────────────────────────────────────────────

export type RunKind = 'pipeline' | 'agent';
export type RunStatus = 'running' | 'success' | 'failed';

export interface RunRow {
  kind: RunKind;
  /** stable id used to fetch the drilldown */
  id: string;
  /** entity that produced this run (pipeline_id / agent_id) */
  entityId: string;
  entityName: string;
  status: RunStatus;
  triggeredBy?: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;

  // Pipeline-specific
  rowsIn?: number;
  rowsOut?: number;
  currentNodeLabel?: string | null;
  currentStepIndex?: number | null;
  totalSteps?: number | null;
  /** Records processed within the current node (e.g. LLM_CLASSIFY counts after each batch). */
  currentNodeProcessed?: number | null;
  currentNodeTotal?: number | null;
  /** Model in use for the current node (e.g. claude-haiku-4-5 during LLM_CLASSIFY). */
  currentModel?: string | null;

  // Agent-specific
  model?: string | null;
  iterations?: number;
  toolCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

export interface CatalogEntry {
  id: string;
  kind: 'pipeline' | 'agent' | 'connector' | 'alert';
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed' | 'warning';
  /** terse per-entity verb — "12 runs / 24h", "last sync 4m ago", etc. */
  blurb: string;
  /** for entities with a recent run, the run id we can deep-link to */
  latestRunId?: string;
  /** pipelines: needed to fetch the run audit */
  pipelineId?: string;
  agentId?: string;
  notificationId?: string;
  meta?: Record<string, string | number | undefined>;
}

export interface OpsAggregate {
  runningCount: number;
  failedLast24h: number;
  totalRunsLast24h: number;
  tokensLast24h: number;
  costUsdLast24h: number;
  rowsProcessedLast24h: number;
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
  current_node_id?: string | null;
  current_node_label?: string | null;
  current_step_index?: number | null;
  total_steps?: number | null;
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
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  duration_ms?: number | null;
  is_test: boolean;
  error?: string | null;
  created_at?: string | null;
}

export type AnyRunDetail = PipelineRunDetail | AgentRunDetail;

export interface SelectedRun {
  kind: 'pipeline' | 'agent';
  runId: string;
  pipelineId?: string;
}

export interface EntityHistoryView {
  kind: 'pipeline' | 'agent';
  entityId: string;
  entityName: string;
}

interface OpsState {
  runningRuns: RunRow[];
  recentRuns: RunRow[];
  catalog: {
    pipelines: CatalogEntry[];
    agents: CatalogEntry[];
    connectors: CatalogEntry[];
    alerts: CatalogEntry[];
  };
  aggregate: OpsAggregate;

  loading: boolean;
  lastFetchedAt: string | null;
  selected: SelectedRun | null;
  entityHistory: EntityHistoryView | null;
  entityHistoryRuns: RunRow[];
  entityHistoryLoading: boolean;

  fetchSnapshot: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;

  selectRun: (run: SelectedRun | null) => void;
  viewEntityHistory: (entity: EntityHistoryView) => void;
  clearEntityHistory: () => void;
  fetchEntityHistory: () => Promise<void>;

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

function fmtTokens(n?: number): string {
  if (!n || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtCost(usd?: number): string {
  if (!usd || usd < 0.0005) return '$0';
  if (usd < 1)   return `$${usd.toFixed(usd < 0.1 ? 4 : 3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

function pipelineStatusToOps(status: string): RunStatus {
  const s = (status || '').toUpperCase();
  if (s === 'RUNNING') return 'running';
  if (s === 'FAILED')  return 'failed';
  return 'success';
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const useOperationsStore = create<OpsState>((set, get) => ({
  runningRuns: [],
  recentRuns: [],
  catalog: { pipelines: [], agents: [], connectors: [], alerts: [] },
  aggregate: {
    runningCount: 0, failedLast24h: 0, totalRunsLast24h: 0,
    tokensLast24h: 0, costUsdLast24h: 0, rowsProcessedLast24h: 0,
  },
  loading: false,
  lastFetchedAt: null,
  selected: null,
  entityHistory: null,
  entityHistoryRuns: [],
  entityHistoryLoading: false,

  selectRun: (run) => set({ selected: run }),

  viewEntityHistory: (entity) => {
    set({ entityHistory: entity, entityHistoryRuns: [], entityHistoryLoading: true });
    void get().fetchEntityHistory();
  },

  clearEntityHistory: () => set({ entityHistory: null, entityHistoryRuns: [] }),

  fetchEntityHistory: async () => {
    const e = get().entityHistory;
    if (!e) return;
    const headers = tenantHeaders();
    try {
      if (e.kind === 'pipeline') {
        const r = await fetch(`${PIPELINE_API}/pipelines/${e.entityId}/runs`, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        type PipeRunApi = {
          id: string; pipeline_id: string; status: string; triggered_by?: string;
          rows_in: number; rows_out: number; error_message?: string | null;
          started_at?: string; finished_at?: string;
          current_node_label?: string | null;
          current_step_index?: number | null; total_steps?: number | null;
          current_node_processed?: number | null;
          current_node_total?: number | null;
          current_model?: string | null;
        };
        const rows: PipeRunApi[] = await r.json();
        const runs: RunRow[] = rows.map((row) => {
          const status = pipelineStatusToOps(row.status);
          const startedAt = row.started_at || new Date(0).toISOString();
          const finishedAt = row.finished_at || null;
          const durationMs = finishedAt
            ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
            : (status === 'running' ? Date.now() - new Date(startedAt).getTime() : null);
          return {
            kind: 'pipeline',
            id: row.id,
            entityId: row.pipeline_id,
            entityName: e.entityName,
            status,
            triggeredBy: row.triggered_by,
            startedAt,
            finishedAt,
            durationMs,
            errorMessage: row.error_message,
            rowsIn: row.rows_in,
            rowsOut: row.rows_out,
            currentNodeLabel: row.current_node_label,
            currentStepIndex: row.current_step_index,
            totalSteps: row.total_steps,
            currentNodeProcessed: row.current_node_processed,
            currentNodeTotal: row.current_node_total,
            currentModel: row.current_model,
          };
        });
        if (get().entityHistory?.entityId !== e.entityId) return;  // user navigated away
        set({ entityHistoryRuns: runs, entityHistoryLoading: false });
      } else {
        // Agents: filter from the polled snapshot. /runs/recent doesn't yet
        // accept agent_id; this is enough for a one-screen history view.
        const all = [...get().runningRuns, ...get().recentRuns];
        const runs = all.filter((r) => r.kind === 'agent' && r.entityId === e.entityId);
        set({ entityHistoryRuns: runs, entityHistoryLoading: false });
      }
    } catch {
      if (get().entityHistory?.entityId === e.entityId) {
        set({ entityHistoryRuns: [], entityHistoryLoading: false });
      }
    }
  },

  fetchSnapshot: async () => {
    if (!get().lastFetchedAt) set({ loading: true });
    const headers = tenantHeaders();

    const [pRunsRes, aRunsRes, alertsRes, connsRes, pipesRes, agentsRes] = await Promise.allSettled([
      fetch(`${PIPELINE_API}/pipelines/runs/recent?limit=60`, { headers }),
      fetch(`${AGENT_API}/agents/runs/recent?limit=60`,       { headers }),
      fetch(`${ALERT_API}/alerts/notifications?tenant_id=${getTenantId()}&unread_only=false&limit=20`),
      fetch(`${CONNECTOR_API}/connectors`,                    { headers }),
      fetch(`${PIPELINE_API}/pipelines`,                      { headers }),
      fetch(`${AGENT_API}/agents`,                            { headers }),
    ]);

    // ── Pipelines ────────────────────────────────────────────────────────
    type PipeRunApi = {
      id: string; pipeline_id: string; pipeline_name?: string;
      status: string; triggered_by?: string;
      rows_in: number; rows_out: number; error_message?: string | null;
      started_at?: string; finished_at?: string;
      current_node_label?: string | null;
      current_step_index?: number | null;
      total_steps?: number | null;
      current_node_processed?: number | null;
      current_node_total?: number | null;
      current_model?: string | null;
    };
    let pipeRuns: PipeRunApi[] = [];
    if (pRunsRes.status === 'fulfilled' && pRunsRes.value.ok) {
      pipeRuns = await pRunsRes.value.json();
    }

    type PipeMeta = { id: string; name?: string; status?: string; last_run_at?: string };
    let pipes: PipeMeta[] = [];
    if (pipesRes.status === 'fulfilled' && pipesRes.value.ok) {
      pipes = await pipesRes.value.json();
    }

    // ── Agents ───────────────────────────────────────────────────────────
    type AgentRunApi = {
      id: string; agent_id: string; agent_name?: string;
      model?: string | null;
      iterations: number; tool_count: number;
      input_tokens?: number; output_tokens?: number;
      cache_read_tokens?: number; cost_usd?: number;
      duration_ms?: number | null;
      error?: string | null; created_at?: string | null;
    };
    let agentRuns: AgentRunApi[] = [];
    if (aRunsRes.status === 'fulfilled' && aRunsRes.value.ok) {
      agentRuns = await aRunsRes.value.json();
    }

    type AgentMeta = { id: string; name?: string; model?: string };
    let agents: AgentMeta[] = [];
    if (agentsRes.status === 'fulfilled' && agentsRes.value.ok) {
      agents = await agentsRes.value.json();
    }

    // ── Build run rows ──────────────────────────────────────────────────
    const runRows: RunRow[] = [];

    for (const r of pipeRuns) {
      const status = pipelineStatusToOps(r.status);
      const startedAt = r.started_at || new Date(0).toISOString();
      const finishedAt = r.finished_at || null;
      const durationMs = finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : (status === 'running' ? Date.now() - new Date(startedAt).getTime() : null);
      runRows.push({
        kind: 'pipeline',
        id: r.id,
        entityId: r.pipeline_id,
        entityName: r.pipeline_name || r.pipeline_id.slice(0, 8),
        status,
        triggeredBy: r.triggered_by,
        startedAt,
        finishedAt,
        durationMs,
        errorMessage: r.error_message,
        rowsIn: r.rows_in,
        rowsOut: r.rows_out,
        currentNodeLabel: r.current_node_label,
        currentStepIndex: r.current_step_index,
        totalSteps: r.total_steps,
        currentNodeProcessed: r.current_node_processed,
        currentNodeTotal: r.current_node_total,
        currentModel: r.current_model,
      });
    }

    for (const r of agentRuns) {
      const status: RunStatus = r.error ? 'failed' : 'success';
      runRows.push({
        kind: 'agent',
        id: r.id,
        entityId: r.agent_id,
        entityName: r.agent_name || r.agent_id.slice(0, 8),
        status,
        startedAt: r.created_at || new Date(0).toISOString(),
        finishedAt: r.created_at,
        durationMs: r.duration_ms ?? null,
        errorMessage: r.error,
        model: r.model,
        iterations: r.iterations,
        toolCount: r.tool_count,
        inputTokens: r.input_tokens || 0,
        outputTokens: r.output_tokens || 0,
        cacheReadTokens: r.cache_read_tokens || 0,
        costUsd: r.cost_usd || 0,
      });
    }

    runRows.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const runningRuns = runRows.filter((r) => r.status === 'running');
    const recentRuns  = runRows.filter((r) => r.status !== 'running').slice(0, 40);

    // ── Aggregate stats over last 24h ────────────────────────────────────
    const cutoff = Date.now() - ONE_DAY_MS;
    let totalRuns = 0, failed24 = 0, tokens24 = 0, cost24 = 0, rows24 = 0;
    for (const r of runRows) {
      const t = new Date(r.startedAt).getTime();
      if (t < cutoff) continue;
      totalRuns++;
      if (r.status === 'failed') failed24++;
      if (r.kind === 'agent') {
        tokens24 += (r.inputTokens || 0) + (r.outputTokens || 0);
        cost24   += r.costUsd || 0;
      } else {
        rows24 += r.rowsOut || 0;
      }
    }

    // ── Catalog entries ──────────────────────────────────────────────────
    const latestRunByPipeline = new Map<string, RunRow>();
    for (const r of runRows) if (r.kind === 'pipeline' && !latestRunByPipeline.has(r.entityId)) latestRunByPipeline.set(r.entityId, r);
    const runsCountByPipeline = new Map<string, number>();
    for (const r of runRows) if (r.kind === 'pipeline') {
      runsCountByPipeline.set(r.entityId, (runsCountByPipeline.get(r.entityId) || 0) + 1);
    }

    const pipelineCatalog: CatalogEntry[] = pipes.map((p) => {
      const latest = latestRunByPipeline.get(p.id);
      const status: CatalogEntry['status'] =
        latest?.status === 'running' ? 'running'
          : latest?.status === 'failed'  ? 'failed'
          : latest?.status === 'success' ? 'success'
          : 'idle';
      const runs = runsCountByPipeline.get(p.id) || 0;
      const blurb = latest
        ? (status === 'running'
            ? `${latest.currentNodeLabel || 'starting…'}${latest.totalSteps ? `  ·  step ${latest.currentStepIndex}/${latest.totalSteps}` : ''}`
            : status === 'failed'
              ? (latest.errorMessage?.slice(0, 80) || 'failed')
              : `${(latest.rowsOut ?? 0).toLocaleString()} rows · ${runs} run${runs === 1 ? '' : 's'} / 24h`)
        : 'never run';
      return {
        id: p.id, kind: 'pipeline', name: p.name || p.id.slice(0, 8),
        status, blurb, latestRunId: latest?.id, pipelineId: p.id,
      };
    });

    const latestRunByAgent = new Map<string, RunRow>();
    for (const r of runRows) if (r.kind === 'agent' && !latestRunByAgent.has(r.entityId)) latestRunByAgent.set(r.entityId, r);
    const tokenSumByAgent = new Map<string, number>();
    const costSumByAgent  = new Map<string, number>();
    for (const r of runRows) if (r.kind === 'agent' && new Date(r.startedAt).getTime() >= cutoff) {
      tokenSumByAgent.set(r.entityId, (tokenSumByAgent.get(r.entityId) || 0) + (r.inputTokens || 0) + (r.outputTokens || 0));
      costSumByAgent.set(r.entityId,  (costSumByAgent.get(r.entityId)  || 0) + (r.costUsd || 0));
    }

    const agentCatalog: CatalogEntry[] = agents.map((a) => {
      const latest = latestRunByAgent.get(a.id);
      const status: CatalogEntry['status'] = !latest
        ? 'idle' : latest.status === 'failed' ? 'failed' : 'success';
      const tok = tokenSumByAgent.get(a.id) || 0;
      const cost = costSumByAgent.get(a.id) || 0;
      const blurb = latest
        ? `${fmtTokens(tok)} tok · ${fmtCost(cost)} / 24h`
        : 'never run';
      return {
        id: a.id, kind: 'agent', name: a.name || a.id.slice(0, 8),
        status, blurb, latestRunId: latest?.id, agentId: a.id,
        meta: { model: a.model || '' },
      };
    });

    // Connectors
    type Conn = { id: string; name?: string; status?: string;
                  lastSyncAt?: string; last_sync_at?: string;
                  activePipelineCount?: number };
    let connectorCatalog: CatalogEntry[] = [];
    if (connsRes.status === 'fulfilled' && connsRes.value.ok) {
      const conns: Conn[] = await connsRes.value.json();
      connectorCatalog = conns.map((c) => {
        const cs = (c.status || '').toLowerCase();
        const status: CatalogEntry['status'] =
          cs.includes('error') || cs.includes('fail') ? 'failed'
            : cs.includes('warn') || cs.includes('rate') ? 'warning'
            : cs === 'active' || cs === 'connected' || cs === 'healthy' ? 'success'
            : 'idle';
        const lastAt = c.lastSyncAt || c.last_sync_at;
        const blurb = c.activePipelineCount
          ? `feeding ${c.activePipelineCount} pipeline${c.activePipelineCount === 1 ? '' : 's'}${lastAt ? ` · ${timeAgoIso(lastAt)}` : ''}`
          : (lastAt ? `last sync ${timeAgoIso(lastAt)}` : (cs || 'idle'));
        return {
          id: c.id, kind: 'connector', name: c.name || c.id.slice(0, 8),
          status, blurb,
        };
      });
    }

    // Alerts
    type Notif = {
      id: string; rule_name: string; rule_type: string;
      severity: 'critical' | 'warning'; message: string;
      read: boolean; fired_at: string;
      run_link?: { kind: string; run_id: string; pipeline_id?: string; agent_id?: string };
    };
    let alertCatalog: CatalogEntry[] = [];
    if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
      const data = await alertsRes.value.json();
      const notifs: Notif[] = data.notifications || [];
      alertCatalog = notifs.slice(0, 10).map((n) => ({
        id: n.id, kind: 'alert', name: n.rule_name,
        status: n.severity === 'critical' ? 'failed' : 'warning',
        blurb: `${n.message?.slice(0, 80) || n.rule_type} · ${timeAgoIso(n.fired_at)}`,
        latestRunId: n.run_link?.run_id,
        pipelineId: n.run_link?.kind === 'pipeline' ? n.run_link?.pipeline_id : undefined,
        agentId:    n.run_link?.kind === 'agent'    ? n.run_link?.agent_id    : undefined,
        notificationId: n.id,
      }));
    }

    set({
      runningRuns,
      recentRuns,
      catalog: {
        pipelines: pipelineCatalog,
        agents: agentCatalog,
        connectors: connectorCatalog,
        alerts: alertCatalog,
      },
      aggregate: {
        runningCount: runningRuns.length,
        failedLast24h: failed24,
        totalRunsLast24h: totalRuns,
        tokensLast24h: tokens24,
        costUsdLast24h: cost24,
        rowsProcessedLast24h: rows24,
      },
      loading: false,
      lastFetchedAt: new Date().toISOString(),
    });

    // Keep the per-entity history in sync with the same polling cadence.
    if (get().entityHistory) {
      void get().fetchEntityHistory();
    }
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
      current_node_id: data.current_node_id,
      current_node_label: data.current_node_label,
      current_step_index: data.current_step_index,
      total_steps: data.total_steps,
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
      input_tokens: data.input_tokens ?? 0,
      output_tokens: data.output_tokens ?? 0,
      cache_creation_tokens: data.cache_creation_tokens ?? 0,
      cache_read_tokens: data.cache_read_tokens ?? 0,
      cost_usd: data.cost_usd ?? 0,
      duration_ms: data.duration_ms ?? null,
      is_test: !!data.is_test,
      error: data.error,
      created_at: data.created_at,
    };
  },
}));

export { timeAgoIso, fmtTokens, fmtCost };
