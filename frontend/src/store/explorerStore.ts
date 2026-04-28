import { create } from 'zustand';
import { getTenantId } from './authStore';

const ANALYTICS_API = import.meta.env.VITE_ANALYTICS_SERVICE_URL || 'http://localhost:8015';

export interface FilterRow {
  id: string;
  field: string;
  op: string;
  value: string;
}

export interface AggregateSpec {
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'RUNTIME';
  field: string;
  ts_field?: string;
}

export interface ExplorerObjectType {
  id: string;
  name: string;
  displayName: string;
}

export interface ExploreResult {
  rows: Record<string, unknown>[];
  total: number;
  columns: string[];
  query_ms: number;
}

export interface AnalystResult {
  answer: string;
  query_used: Record<string, unknown> | null;
  rows: Record<string, unknown>[] | null;
  columns: string[] | null;
  total: number | null;
}

interface ExplorerStore {
  objectTypes: ExplorerObjectType[];
  selectedTypeId: string | null;
  fields: string[];
  recordCount: number;
  filters: FilterRow[];
  aggregate: AggregateSpec | null;
  groupBy: string | null;
  result: ExploreResult | null;
  analystResult: AnalystResult | null;
  loading: boolean;
  loadingFields: boolean;
  loadingAnalyst: boolean;

  fetchObjectTypes: () => Promise<void>;
  selectObjectType: (id: string) => Promise<void>;
  setFilters: (filters: FilterRow[]) => void;
  setAggregate: (agg: AggregateSpec | null) => void;
  setGroupBy: (field: string | null) => void;
  runQuery: (limit?: number, offset?: number) => Promise<void>;
  runAnalyst: (question: string) => Promise<void>;
  clearResult: () => void;
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  objectTypes: [],
  selectedTypeId: null,
  fields: [],
  recordCount: 0,
  filters: [],
  aggregate: null,
  groupBy: null,
  result: null,
  analystResult: null,
  loading: false,
  loadingFields: false,
  loadingAnalyst: false,

  fetchObjectTypes: async () => {
    try {
      const r = await fetch(`${ANALYTICS_API}/explore/object-types`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (r.ok) {
        const data = await r.json();
        set({ objectTypes: Array.isArray(data) ? data : [] });
      }
    } catch {
      set({ objectTypes: [] });
    }
  },

  selectObjectType: async (id) => {
    set({ selectedTypeId: id, fields: [], recordCount: 0, result: null, analystResult: null, loadingFields: true });
    try {
      const r = await fetch(`${ANALYTICS_API}/explore/object-types/${id}/fields`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (r.ok) {
        const data = await r.json();
        set({ fields: data.fields || [], recordCount: data.record_count || 0 });
      }
    } catch {
      set({ fields: [] });
    } finally {
      set({ loadingFields: false });
    }
  },

  setFilters: (filters) => set({ filters }),
  setAggregate: (aggregate) => set({ aggregate }),
  setGroupBy: (groupBy) => set({ groupBy }),

  runQuery: async (limit = 100, offset = 0) => {
    const { selectedTypeId, filters, aggregate, groupBy } = get();
    if (!selectedTypeId) return;

    set({ loading: true });
    try {
      const body: Record<string, unknown> = {
        object_type_id: selectedTypeId,
        filters: filters.map(({ field, op, value }) => ({ field, op, value })),
        limit,
        offset,
      };
      if (aggregate && groupBy) {
        body.aggregate = aggregate;
        body.group_by = groupBy;
      }

      const r = await fetch(`${ANALYTICS_API}/explore/query`, {
        method: 'POST',
        headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const data = await r.json();
        set({ result: data });
      }
    } catch {
      // keep last result
    } finally {
      set({ loading: false });
    }
  },

  runAnalyst: async (question) => {
    const { selectedTypeId, objectTypes } = get();
    if (!selectedTypeId || !question.trim()) return;

    const type = objectTypes.find((t) => t.id === selectedTypeId);
    set({ loadingAnalyst: true, analystResult: null });
    try {
      const r = await fetch(`${ANALYTICS_API}/analyst/query`, {
        method: 'POST',
        headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          object_type_id: selectedTypeId,
          object_type_name: type?.displayName || type?.name,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        set({ analystResult: data });
      }
    } catch {
      set({ analystResult: { answer: 'Failed to connect to analytics service.', query_used: null, rows: null, columns: null, total: null } });
    } finally {
      set({ loadingAnalyst: false });
    }
  },

  clearResult: () => set({ result: null, analystResult: null }),
}));
