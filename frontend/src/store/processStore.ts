import { create } from 'zustand';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

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

interface ProcessState {
  cases: ProcessCase[];
  variants: ProcessVariant[];
  transitions: Transition[];
  activities: string[];
  medianHours: number;
  stats: ProcessStats | null;
  loading: boolean;
  selectedObjectTypeId: string;
  setSelectedObjectTypeId: (id: string) => void;
  fetchCases: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchVariants: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchTransitions: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchStats: (objectTypeId: string, tenantId?: string) => Promise<void>;
  fetchCaseTimeline: (objectTypeId: string, caseId: string, tenantId?: string) => Promise<CaseTimelineEvent[]>;
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

  setSelectedObjectTypeId: (id) => set({ selectedObjectTypeId: id }),

  fetchCases: async (objectTypeId, tenantId = 'tenant-001') => {
    set({ loading: true });
    try {
      const res = await fetch(`${PROCESS_API}/process/cases/${objectTypeId}?limit=200`, {
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
    try {
      const res = await fetch(`${PROCESS_API}/process/variants/${objectTypeId}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ variants: data.variants || [] });
    } catch {
      set({ variants: [] });
    }
  },

  fetchTransitions: async (objectTypeId, tenantId = 'tenant-001') => {
    try {
      const res = await fetch(`${PROCESS_API}/process/transitions/${objectTypeId}`, {
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
    try {
      const res = await fetch(`${PROCESS_API}/process/stats/${objectTypeId}`, {
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
}));
