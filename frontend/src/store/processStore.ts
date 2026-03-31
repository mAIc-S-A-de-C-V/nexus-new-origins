import { create } from 'zustand';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';
const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

export interface ProcessCase {
  case_id: string;
  current_activity: string;
  last_resource: string | null;
  total_duration_days: number;
  days_since_last_activity: number;
  event_count: number;
  started_at: string | null;
  last_activity_at: string | null;
  variant_id: string;
  is_rework: boolean;
  state: 'active' | 'stuck';
  activity_sequence: string[];
}

export interface ProcessVariant {
  rank: number;
  variant_id: string;
  activities: string[];
  case_count: number;
  frequency_pct: number;
  avg_duration_days: number;
  min_duration_days: number;
  max_duration_days: number;
  is_rework: boolean;
  is_skip: boolean;
}

export interface Transition {
  from_activity: string;
  to_activity: string;
  count: number;
  avg_hours: number;
  p50_hours: number;
  p95_hours: number;
  speed: 'fast' | 'normal' | 'slow';
}

export interface CaseTimelineEvent {
  id: string;
  activity: string;
  timestamp: string;
  resource: string | null;
  attributes: Record<string, unknown>;
  pipeline_id: string | null;
  duration_since_prev_hours: number | null;
}

export interface ProcessStats {
  total_cases: number;
  avg_duration_days: number;
  stuck_cases: number;
  variant_count: number;
  rework_rate: number;
}

export interface ActivityProfile {
  activity: string;
  count: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface AnalysisResult {
  activity: string;
  category: 'stage' | 'noise';
  label: string;
  reason: string;
}

export interface EventConfig {
  excluded_activities: string[];
  activity_labels: Record<string, string>;
  saved_at?: string;
}

interface ProcessState {
  cases: ProcessCase[];
  variants: ProcessVariant[];
  transitions: Transition[];
  activities: string[];
  medianHours: number;
  stats: ProcessStats | null;
  loading: boolean;
  selectedObjectTypeId: string;

  // Event config (per-pipeline process mining settings)
  activePipelineId: string;
  eventConfig: EventConfig;
  activityProfile: ActivityProfile[];
  analysisResults: AnalysisResult[] | null;
  analyzing: boolean;
  saving: boolean;

  setSelectedObjectTypeId: (id: string) => void;
  setActivePipelineId: (id: string) => void;
  setEventConfig: (cfg: EventConfig) => void;

  fetchCases: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchVariants: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchTransitions: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchStats: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchCaseTimeline: (objectTypeId: string, caseId: string, tenantId?: string) => Promise<CaseTimelineEvent[]>;

  fetchActivityProfile: (pipelineId: string, tenantId?: string) => Promise<void>;
  analyzeEvents: (pipelineId: string, tenantId?: string) => Promise<void>;
  saveEventConfig: (pipelineId: string, config: EventConfig, tenantId?: string) => Promise<void>;
}

function buildQueryParams(eventConfig: EventConfig): string {
  const params = new URLSearchParams();
  if (eventConfig.excluded_activities.length > 0) {
    params.set('excluded', eventConfig.excluded_activities.join(','));
  }
  if (Object.keys(eventConfig.activity_labels).length > 0) {
    params.set('labels', JSON.stringify(eventConfig.activity_labels));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const useProcessStore = create<ProcessState>((set, get) => ({
  cases: [],
  variants: [],
  transitions: [],
  activities: [],
  medianHours: 1,
  stats: null,
  loading: false,
  selectedObjectTypeId: '',
  activePipelineId: '',
  eventConfig: { excluded_activities: [], activity_labels: {} },
  activityProfile: [],
  analysisResults: null,
  analyzing: false,
  saving: false,

  setSelectedObjectTypeId: (id) => set({ selectedObjectTypeId: id }),
  setActivePipelineId: (id) => set({ activePipelineId: id }),
  setEventConfig: (cfg) => set({ eventConfig: cfg }),

  fetchCases: async (objectTypeId, tenantId = 'tenant-001') => {
    set({ loading: true });
    const { eventConfig } = get();
    const qs = buildQueryParams(eventConfig);
    try {
      const res = await fetch(`${PROCESS_API}/process/cases/${objectTypeId}${qs}&limit=200`.replace('?&', '?'), {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ cases: data.cases || [] });
    } catch {
      set({ cases: [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchVariants: async (objectTypeId, tenantId = 'tenant-001') => {
    const { eventConfig } = get();
    const qs = buildQueryParams(eventConfig);
    try {
      const res = await fetch(`${PROCESS_API}/process/variants/${objectTypeId}${qs}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ variants: data.variants || [] });
    } catch {
      set({ variants: [] });
    }
  },

  fetchTransitions: async (objectTypeId, tenantId = 'tenant-001') => {
    const { eventConfig } = get();
    const qs = buildQueryParams(eventConfig);
    try {
      const res = await fetch(`${PROCESS_API}/process/transitions/${objectTypeId}${qs}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({
        transitions: data.transitions || [],
        activities: data.activities || [],
        medianHours: data.median_hours || 1,
      });
    } catch {
      set({ transitions: [], activities: [] });
    }
  },

  fetchStats: async (objectTypeId, tenantId = 'tenant-001') => {
    const { eventConfig } = get();
    const excl = eventConfig.excluded_activities.length > 0
      ? `?excluded=${eventConfig.excluded_activities.join(',')}`
      : '';
    try {
      const res = await fetch(`${PROCESS_API}/process/stats/${objectTypeId}${excl}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ stats: data });
    } catch {
      set({ stats: null });
    }
  },

  fetchCaseTimeline: async (objectTypeId, caseId, tenantId = 'tenant-001') => {
    const res = await fetch(
      `${PROCESS_API}/process/cases/${objectTypeId}/${encodeURIComponent(caseId)}/timeline`,
      { headers: { 'x-tenant-id': tenantId } }
    );
    const data = await res.json();
    return data.events || [];
  },

  fetchActivityProfile: async (pipelineId, tenantId = 'tenant-001') => {
    try {
      const res = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/event-profile`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ activityProfile: data.activities || [] });
    } catch {
      set({ activityProfile: [] });
    }
  },

  analyzeEvents: async (pipelineId, tenantId = 'tenant-001') => {
    set({ analyzing: true });
    try {
      const res = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/analyze-events`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      const all: AnalysisResult[] = [...(data.stages || []), ...(data.noise || [])];
      set({ analysisResults: all });
    } catch {
      set({ analysisResults: [] });
    } finally {
      set({ analyzing: false });
    }
  },

  saveEventConfig: async (pipelineId, config, tenantId = 'tenant-001') => {
    set({ saving: true });
    try {
      await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/event-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(config),
      });
      set({ eventConfig: config });
    } catch {
      // ignore
    } finally {
      set({ saving: false });
    }
  },
}));
