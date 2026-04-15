import { create } from 'zustand';
import { getTenantId } from './authStore';

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

export interface MonthlyDataPoint {
  month: string;
  cases_completed: number;
  avg_duration_days: number;
  total_cost: number;
}

export interface DistributionItem {
  group_label: string;
  case_count: number;
}

export interface ResourceRow {
  resource: string;
  case_count: number;
  event_count: number;
  total_cost: number;
}

export interface OverviewData {
  monthly_series: MonthlyDataPoint[];
  distribution: DistributionItem[];
  top_resources: ResourceRow[];
  total_cost: number;
  automation_rate: number;
}

export interface BenchmarkSegment {
  label: string;
  stats: ProcessStats;
  top_variants: ProcessVariant[];
}

export interface BenchmarkData {
  segment_a: BenchmarkSegment;
  segment_b: BenchmarkSegment;
  available_segments: { key: string; values: string[] }[];
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
  activity_attribute?: string;  // JSON attribute key to extract activity from (e.g. "activity")
  case_id_attribute?: string;   // JSON attribute key to extract case_id from (e.g. "case_id")
  timestamp_attribute?: string; // JSON attribute key to extract timestamp from (e.g. "occurred_at")
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
  suggestedOverrides: { activity_attribute?: string; case_id_attribute?: string; timestamp_attribute?: string } | null;
  analyzing: boolean;
  saving: boolean;

  // Date range filter
  dateRange: { start: string; end: string } | null;
  // Attribute filters
  attributeFilters: Record<string, string>;

  setSelectedObjectTypeId: (id: string) => void;
  setActivePipelineId: (id: string) => void;
  setEventConfig: (cfg: EventConfig) => void;
  setDateRange: (range: { start: string; end: string } | null) => void;
  setAttributeFilters: (filters: Record<string, string>) => void;

  fetchCases: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchVariants: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchTransitions: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchStats: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchCaseTimeline: (objectTypeId: string, caseId: string, tenantId?: string) => Promise<CaseTimelineEvent[]>;

  // Overview & Benchmark
  overviewData: OverviewData | null;
  benchmarkData: BenchmarkData | null;
  availableSegments: { key: string; values: string[] }[];
  fetchOverview: (objectTypeId: string, groupBy?: string) => Promise<void>;
  fetchBenchmark: (objectTypeId: string, segA: { key: string; value: string }, segB: { key: string; value: string }) => Promise<void>;
  fetchAttributeValues: (objectTypeId: string) => Promise<void>;

  fetchActivityProfile: (pipelineId: string, tenantId?: string) => Promise<void>;
  analyzeEvents: (pipelineId: string, tenantId?: string) => Promise<void>;
  saveEventConfig: (pipelineId: string, config: EventConfig, tenantId?: string) => Promise<void>;
}

function buildQueryParams(eventConfig: EventConfig, dateRange?: { start: string; end: string } | null, attributeFilters?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (eventConfig.excluded_activities.length > 0) {
    params.set('excluded', eventConfig.excluded_activities.join(','));
  }
  if (Object.keys(eventConfig.activity_labels).length > 0) {
    params.set('labels', JSON.stringify(eventConfig.activity_labels));
  }
  if (eventConfig.activity_attribute) {
    params.set('activity_attribute', eventConfig.activity_attribute);
  }
  if (eventConfig.case_id_attribute) {
    params.set('case_id_attribute', eventConfig.case_id_attribute);
  }
  if (eventConfig.timestamp_attribute) {
    params.set('timestamp_attribute', eventConfig.timestamp_attribute);
  }
  if (dateRange?.start) {
    params.set('start_date', dateRange.start);
  }
  if (dateRange?.end) {
    params.set('end_date', dateRange.end);
  }
  if (attributeFilters && Object.keys(attributeFilters).length > 0) {
    params.set('attribute_filters', JSON.stringify(attributeFilters));
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
  suggestedOverrides: null,
  analyzing: false,
  saving: false,
  dateRange: null,
  attributeFilters: {},
  overviewData: null,
  benchmarkData: null,
  availableSegments: [],

  setSelectedObjectTypeId: (id) => set({ selectedObjectTypeId: id }),
  setActivePipelineId: (id) => set({ activePipelineId: id }),
  setEventConfig: (cfg) => set({ eventConfig: cfg }),
  setDateRange: (range) => set({ dateRange: range }),
  setAttributeFilters: (filters) => set({ attributeFilters: filters }),

  fetchCases: async (objectTypeId, tenantId = getTenantId()) => {
    set({ loading: true });
    const { eventConfig, dateRange, attributeFilters } = get();
    const qs = buildQueryParams(eventConfig, dateRange, attributeFilters);
    try {
      const res = await fetch(`${PROCESS_API}/process/cases/${objectTypeId}${qs ? qs + '&limit=200' : '?limit=200'}`, {
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

  fetchVariants: async (objectTypeId, tenantId = getTenantId()) => {
    const { eventConfig, dateRange, attributeFilters } = get();
    const qs = buildQueryParams(eventConfig, dateRange, attributeFilters);
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

  fetchTransitions: async (objectTypeId, tenantId = getTenantId()) => {
    const { eventConfig, dateRange, attributeFilters } = get();
    const qs = buildQueryParams(eventConfig, dateRange, attributeFilters);
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

  fetchStats: async (objectTypeId, tenantId = getTenantId()) => {
    const { eventConfig, dateRange, attributeFilters } = get();
    const qs = buildQueryParams(eventConfig, dateRange, attributeFilters);
    try {
      const res = await fetch(`${PROCESS_API}/process/stats/${objectTypeId}${qs}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ stats: data });
    } catch {
      set({ stats: null });
    }
  },

  fetchCaseTimeline: async (objectTypeId, caseId, tenantId = getTenantId()) => {
    const res = await fetch(
      `${PROCESS_API}/process/cases/${objectTypeId}/${encodeURIComponent(caseId)}/timeline`,
      { headers: { 'x-tenant-id': tenantId } }
    );
    const data = await res.json();
    return data.events || [];
  },

  fetchOverview: async (objectTypeId, groupBy, tenantId = getTenantId()) => {
    const { eventConfig, dateRange, attributeFilters } = get();
    const qs = buildQueryParams(eventConfig, dateRange, attributeFilters);
    const sep = qs ? '&' : '?';
    const gbParam = groupBy ? `${sep}group_by=${encodeURIComponent(groupBy)}` : '';
    try {
      const res = await fetch(`${PROCESS_API}/process/overview/${objectTypeId}${qs}${gbParam}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      if (!res.ok) throw new Error(`overview ${res.status}`);
      const data = await res.json();
      set({ overviewData: data });
    } catch {
      set({ overviewData: null });
    }
  },

  fetchBenchmark: async (objectTypeId, segA, segB, tenantId = getTenantId()) => {
    const { eventConfig, dateRange } = get();
    const qs = buildQueryParams(eventConfig, dateRange);
    const sep = qs ? '&' : '?';
    const segParams = `${sep}segment_a_key=${encodeURIComponent(segA.key)}&segment_a_value=${encodeURIComponent(segA.value)}&segment_b_key=${encodeURIComponent(segB.key)}&segment_b_value=${encodeURIComponent(segB.value)}`;
    try {
      const res = await fetch(`${PROCESS_API}/process/benchmark/${objectTypeId}${qs}${segParams}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      if (!res.ok) throw new Error(`benchmark ${res.status}`);
      const data = await res.json();
      set({ benchmarkData: data });
    } catch {
      set({ benchmarkData: null });
    }
  },

  fetchAttributeValues: async (objectTypeId, tenantId = getTenantId()) => {
    try {
      const res = await fetch(`${PROCESS_API}/process/attribute-values/${objectTypeId}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      if (!res.ok) throw new Error(`attr-values ${res.status}`);
      const data = await res.json();
      set({ availableSegments: data.segments || [] });
    } catch {
      set({ availableSegments: [] });
    }
  },

  fetchActivityProfile: async (pipelineId, tenantId = getTenantId()) => {
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

  analyzeEvents: async (pipelineId, tenantId = getTenantId()) => {
    set({ analyzing: true });
    try {
      const res = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/analyze-events`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      const all: AnalysisResult[] = [...(data.stages || []), ...(data.noise || [])];
      set({ analysisResults: all, suggestedOverrides: data.suggested_overrides || null });
    } catch {
      set({ analysisResults: [], suggestedOverrides: null });
    } finally {
      set({ analyzing: false });
    }
  },

  saveEventConfig: async (pipelineId, config, tenantId = getTenantId()) => {
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
