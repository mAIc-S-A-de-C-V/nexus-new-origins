import { create } from 'zustand';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

export interface ConformanceModel {
  id: string;
  tenant_id: string;
  object_type_id: string;
  name: string;
  activities: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Deviation {
  type: 'skip' | 'wrong_order' | 'unauthorized' | 'rework';
  activity: string;
  position: number;
  detail: string;
}

export interface CaseConformance {
  case_id: string;
  fitness: number;
  is_conformant: boolean;
  matched: number;
  expected_total: number;
  actual_total: number;
  deviations: Deviation[];
}

export interface DeviationSummaryEntry {
  skip: number;
  wrong_order: number;
  unauthorized: number;
  rework: number;
}

export interface ConformanceAggregate {
  total_cases: number;
  conformant_cases: number;
  conformance_rate: number;
  avg_fitness: number;
  deviation_summary: Record<string, DeviationSummaryEntry>;
}

export interface ConformanceCheckResult {
  model_id: string;
  model_name: string;
  model_activities: string[];
  conformance_threshold: number;
  aggregate: ConformanceAggregate;
  cases: CaseConformance[];
}

interface ConformanceState {
  models: ConformanceModel[];
  checkResult: ConformanceCheckResult | null;
  hasModel: boolean;
  loading: boolean;
  checking: boolean;

  fetchModels: (objectTypeId: string, tenantId?: string) => Promise<void>;
  createModel: (objectTypeId: string, name: string, activities: string[], tenantId?: string) => Promise<ConformanceModel>;
  updateModel: (objectTypeId: string, modelId: string, updates: Partial<Pick<ConformanceModel, 'name' | 'activities' | 'is_active'>>, tenantId?: string) => Promise<void>;
  deleteModel: (objectTypeId: string, modelId: string, tenantId?: string) => Promise<void>;
  checkConformance: (objectTypeId: string, modelId: string, threshold?: number, tenantId?: string) => Promise<void>;
  fetchSummary: (objectTypeId: string, threshold?: number, tenantId?: string) => Promise<void>;
}

export const useConformanceStore = create<ConformanceState>((set, get) => ({
  models: [],
  checkResult: null,
  hasModel: false,
  loading: false,
  checking: false,

  fetchModels: async (objectTypeId, tenantId = 'tenant-001') => {
    set({ loading: true });
    try {
      const res = await fetch(`${PROCESS_API}/process/conformance/models/${objectTypeId}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      set({ models: data.models || [] });
    } catch {
      set({ models: [] });
    } finally {
      set({ loading: false });
    }
  },

  createModel: async (objectTypeId, name, activities, tenantId = 'tenant-001') => {
    const res = await fetch(`${PROCESS_API}/process/conformance/models/${objectTypeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ name, activities }),
    });
    const model = await res.json();
    await get().fetchModels(objectTypeId, tenantId);
    return model;
  },

  updateModel: async (objectTypeId, modelId, updates, tenantId = 'tenant-001') => {
    await fetch(`${PROCESS_API}/process/conformance/models/${objectTypeId}/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify(updates),
    });
    await get().fetchModels(objectTypeId, tenantId);
  },

  deleteModel: async (objectTypeId, modelId, tenantId = 'tenant-001') => {
    await fetch(`${PROCESS_API}/process/conformance/models/${objectTypeId}/${modelId}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': tenantId },
    });
    set(s => ({ models: s.models.filter(m => m.id !== modelId) }));
  },

  checkConformance: async (objectTypeId, modelId, threshold = 0.7, tenantId = 'tenant-001') => {
    set({ checking: true });
    try {
      const res = await fetch(
        `${PROCESS_API}/process/conformance/check/${objectTypeId}/${modelId}?conformance_threshold=${threshold}`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      const data = await res.json();
      set({ checkResult: data, hasModel: true });
    } finally {
      set({ checking: false });
    }
  },

  fetchSummary: async (objectTypeId, threshold = 0.7, tenantId = 'tenant-001') => {
    set({ checking: true });
    try {
      const res = await fetch(
        `${PROCESS_API}/process/conformance/summary/${objectTypeId}?conformance_threshold=${threshold}`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      const data = await res.json();
      if (data.has_model) {
        set({ checkResult: data, hasModel: true });
      } else {
        set({ hasModel: false, checkResult: null });
      }
    } finally {
      set({ checking: false });
    }
  },
}));
