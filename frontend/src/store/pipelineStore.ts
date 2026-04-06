import { create } from 'zustand';
import { Pipeline, PipelineNode, PipelineEdge } from '../types/pipeline';
import { useRunLogStore } from './runLogStore';

const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

// ─── Helpers ────────────────────────────────────────────────────────────────

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[camel] = snakeToCamel(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[camel] = v.map((item) =>
        item && typeof item === 'object' ? snakeToCamel(item as Record<string, unknown>) : item
      );
    } else {
      out[camel] = v;
    }
  }
  return out;
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const snake = k.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[snake] = camelToSnake(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[snake] = v.map((item) =>
        item && typeof item === 'object' ? camelToSnake(item as Record<string, unknown>) : item
      );
    } else {
      out[snake] = v;
    }
  }
  return out;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface PipelineStoreState {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  loading: boolean;
  error: string | null;

  fetchPipelines: () => Promise<void>;
  selectPipeline: (id: string) => void;
  addPipeline: (pipeline: Pipeline) => Promise<Pipeline>;
  updatePipeline: (id: string, updates: Partial<Pipeline>) => Promise<void>;
  updatePipelineNodes: (id: string, nodes: PipelineNode[], edges: PipelineEdge[]) => Promise<void>;
  removePipeline: (id: string) => Promise<void>;
  runPipeline: (id: string) => Promise<{ run_id: string; status: string }>;
  setPipelines: (pipelines: Pipeline[]) => void;
}

export const usePipelineStore = create<PipelineStoreState>((set, get) => ({
  pipelines: [],
  selectedPipelineId: null,
  loading: false,
  error: null,

  fetchPipelines: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${PIPELINE_API}/pipelines`);
      if (!res.ok) throw new Error(`Failed to fetch pipelines: ${res.status}`);
      const data = await res.json();
      const pipelines = data.map((item: Record<string, unknown>) => snakeToCamel(item) as unknown as Pipeline);
      set({ pipelines, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  selectPipeline: (id) => set({ selectedPipelineId: id }),

  addPipeline: async (pipeline: Pipeline) => {
    const body = camelToSnake(pipeline as unknown as Record<string, unknown>);
    const res = await fetch(`${PIPELINE_API}/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create pipeline: ${res.status}`);
    const data = await res.json();
    const created = snakeToCamel(data) as unknown as Pipeline;
    set((state) => ({ pipelines: [...state.pipelines, created] }));
    return created;
  },

  updatePipeline: async (id: string, updates: Partial<Pipeline>) => {
    const existing = get().pipelines.find((p) => p.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    const body = camelToSnake(merged as unknown as Record<string, unknown>);
    const res = await fetch(`${PIPELINE_API}/pipelines/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update pipeline: ${res.status}`);
    const data = await res.json();
    const updated = snakeToCamel(data) as unknown as Pipeline;
    set((state) => ({
      pipelines: state.pipelines.map((p) => (p.id === id ? updated : p)),
    }));
  },

  updatePipelineNodes: async (id: string, nodes: PipelineNode[], edges: PipelineEdge[]) => {
    const existing = get().pipelines.find((p) => p.id === id);
    if (!existing) return;
    const merged = { ...existing, nodes, edges };
    const body = camelToSnake(merged as unknown as Record<string, unknown>);
    const res = await fetch(`${PIPELINE_API}/pipelines/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update pipeline nodes: ${res.status}`);
    const data = await res.json();
    const updated = snakeToCamel(data) as unknown as Pipeline;
    set((state) => ({
      pipelines: state.pipelines.map((p) => (p.id === id ? updated : p)),
    }));
  },

  removePipeline: async (id: string) => {
    const res = await fetch(`${PIPELINE_API}/pipelines/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`Failed to delete pipeline: ${res.status}`);
    set((state) => ({ pipelines: state.pipelines.filter((p) => p.id !== id) }));
  },

  runPipeline: async (id: string) => {
    const pipeline = get().pipelines.find((p) => p.id === id);
    const startedAt = new Date().toISOString();

    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.id === id ? { ...p, status: 'RUNNING' as any } : p
      ),
    }));

    // Kick off the run
    let runId: string | undefined;
    let kickError: string | undefined;
    try {
      const res = await fetch(`${PIPELINE_API}/pipelines/${id}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      runId = data.run_id;
    } catch (err) {
      kickError = String(err);
    }

    if (kickError || !runId) {
      const status = 'FAILED';
      set((state) => ({
        pipelines: state.pipelines.map((p) => p.id === id ? { ...p, status: status as any } : p),
      }));
      useRunLogStore.getState().addLog({
        id: crypto.randomUUID(),
        pipeline_id: id,
        pipeline_name: pipeline?.name || id,
        status,
        rows_in: 0,
        rows_out: 0,
        error: kickError,
        node_audits: [],
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        read: false,
      });
      return { run_id: '', status };
    }

    // Poll audit endpoint until run is no longer RUNNING (max ~60s)
    let audit: Record<string, unknown> = { run_id: runId, status: 'RUNNING' };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await fetch(`${PIPELINE_API}/pipelines/${id}/runs/${runId}/audit`);
        if (r.ok) {
          audit = await r.json();
          if ((audit.status as string) !== 'RUNNING') break;
        }
      } catch { /* ignore transient */ }
    }

    const status: 'COMPLETED' | 'FAILED' =
      (audit.status as string) === 'COMPLETED' ? 'COMPLETED' : 'FAILED';

    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.id === id ? { ...p, status: status as any } : p
      ),
    }));

    // node_audits is a dict keyed by node_id — flatten to array
    const rawAudits = audit.node_audits as Record<string, any> | null | undefined;
    const nodeAudits = rawAudits
      ? Object.values(rawAudits).map((a) => ({
          node_id: a.node_id,
          node_type: a.node_type,
          label: a.node_label,
          status: a.error ? 'error' : 'ok',
          rows_in: a.rows_in ?? 0,
          rows_out: a.rows_out ?? 0,
          error: a.error,
          duration_ms: a.duration_ms,
        }))
      : [];

    useRunLogStore.getState().addLog({
      id: runId,
      pipeline_id: id,
      pipeline_name: pipeline?.name || id,
      status,
      rows_in: (audit.rows_in as number) ?? 0,
      rows_out: (audit.rows_out as number) ?? 0,
      error: audit.error_message as string | undefined,
      node_audits: nodeAudits,
      started_at: (audit.started_at as string) || startedAt,
      finished_at: (audit.finished_at as string) || new Date().toISOString(),
      read: false,
    });

    return { run_id: runId, status };
  },

  setPipelines: (pipelines) => set({ pipelines }),
}));
