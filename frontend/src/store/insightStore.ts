import { create } from 'zustand';
import { getTenantId } from './authStore';

const INSIGHT_API = import.meta.env.VITE_INSIGHT_ENGINE_URL || 'http://localhost:8016';

export type InsightStatus = 'new' | 'seen' | 'pinned' | 'dismissed' | 'promoted' | 'aged';

export interface Insight {
  id: string;
  tenant_id: string;
  run_id: string;
  family: string;
  object_type_id: string;
  outcome_object_type_id: string | null;
  feature: Record<string, unknown>;
  outcome: Record<string, unknown>;
  n: number;
  effect_size: number;
  effect_metric: string;
  p_value: number | null;
  p_adjusted: number | null;
  direction: string | null;
  stability_score: number | null;
  replication_holdout_pass: boolean | null;
  causal_estimate: Record<string, unknown> | null;
  rank_score: number;
  novelty_score: number | null;
  prior_insight_id: string | null;
  title: string;
  description: string;
  recommendation: string | null;
  evidence: Record<string, unknown>;
  status: InsightStatus;
  discovered_at: string;
}

export interface InsightRun {
  id: string;
  tenant_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  tests_planned: number | null;
  tests_run: number | null;
  insights_kept: number | null;
  families_run: string[] | null;
  family_durations_ms: Record<string, number> | null;
  duration_ms: number | null;
  peak_memory_mb: number | null;
  error: string | null;
}

export interface InsightConfig {
  tenant_id: string;
  enabled: boolean;
  schedule_cron: string;
  timezone: string;
  family_enabled: Record<string, boolean>;
  family_priors: Record<string, number>;
  max_tests: number;
  max_runtime_minutes: number;
  max_memory_mb: number;
  min_effect_size: number;
  min_sample_size: number;
  min_stability_score: number;
  feature_denylist: string[];
  outcome_denylist: string[];
  bootstrap_iterations: number;
  holdout_pct: number;
  keep_top_n: number;
  llm_titles_enabled: boolean;
  embeddings_enabled: boolean;
  causal_enabled: boolean;
  cross_ot_enabled: boolean;
}

interface InsightState {
  insights: Insight[];
  selected: Insight | null;
  runs: InsightRun[];
  config: InsightConfig | null;
  loading: boolean;
  unreadCount: number;

  fetchInsights: (filter?: { status?: string; family?: string; object_type_id?: string }) => Promise<void>;
  fetchInsight: (id: string) => Promise<void>;
  patchStatus: (id: string, status: InsightStatus) => Promise<void>;
  promoteToAlert: (id: string, threshold?: number) => Promise<{ ok: boolean; rule?: unknown }>;
  investigate: (id: string) => Promise<{ module: string; object_type_id: string; filters: Record<string, unknown>; highlight_record_ids: string[] } | null>;

  fetchRuns: () => Promise<void>;
  runNow: () => Promise<string | null>;

  fetchConfig: () => Promise<void>;
  patchConfig: (patch: Partial<InsightConfig>) => Promise<void>;

  pollUnread: () => Promise<void>;
}

function qs(filter: Record<string, unknown> | undefined) {
  const p = new URLSearchParams();
  p.set('tenant_id', getTenantId());
  if (filter) {
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    });
  }
  return `?${p.toString()}`;
}

export const useInsightStore = create<InsightState>((set, get) => ({
  insights: [],
  selected: null,
  runs: [],
  config: null,
  loading: false,
  unreadCount: 0,

  fetchInsights: async (filter) => {
    set({ loading: true });
    try {
      const res = await fetch(`${INSIGHT_API}/insights${qs(filter)}`);
      const data = await res.json();
      set({ insights: data.insights || [] });
    } catch {
      set({ insights: [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchInsight: async (id) => {
    try {
      const res = await fetch(`${INSIGHT_API}/insights/${id}${qs(undefined)}`);
      if (!res.ok) return;
      const data = await res.json();
      set({ selected: data });
    } catch {
      /* ignore */
    }
  },

  patchStatus: async (id, status) => {
    await fetch(`${INSIGHT_API}/insights/${id}${qs(undefined)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    set(state => ({
      insights: state.insights.map(i => i.id === id ? { ...i, status } : i),
      selected: state.selected && state.selected.id === id ? { ...state.selected, status } : state.selected,
    }));
  },

  promoteToAlert: async (id, threshold = 0.3) => {
    const res = await fetch(`${INSIGHT_API}/insights/${id}/promote-to-alert${qs(undefined)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, rule: data.rule };
  },

  investigate: async (id) => {
    const res = await fetch(`${INSIGHT_API}/insights/${id}/investigate${qs(undefined)}`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  },

  fetchRuns: async () => {
    try {
      const res = await fetch(`${INSIGHT_API}/insights/runs${qs(undefined)}`);
      const data = await res.json();
      set({ runs: data.runs || [] });
    } catch {
      set({ runs: [] });
    }
  },

  runNow: async () => {
    try {
      const res = await fetch(`${INSIGHT_API}/insights/runs/run-now${qs(undefined)}`, {
        method: 'POST',
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.queued_run_id || null;
    } catch {
      return null;
    }
  },

  fetchConfig: async () => {
    try {
      const res = await fetch(`${INSIGHT_API}/insights/config${qs(undefined)}`);
      const data = await res.json();
      set({ config: data });
    } catch {
      /* ignore */
    }
  },

  patchConfig: async (patch) => {
    await fetch(`${INSIGHT_API}/insights/config${qs(undefined)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await get().fetchConfig();
  },

  pollUnread: async () => {
    try {
      const res = await fetch(`${INSIGHT_API}/insights${qs({ status: 'new', limit: 200 })}`);
      const data = await res.json();
      set({ unreadCount: (data.insights || []).length });
    } catch {
      /* ignore */
    }
  },
}));
