import { create } from 'zustand';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

export interface ActionExecution {
  id: string;
  tenant_id: string;
  action_name: string;
  inputs: Record<string, unknown>;
  status: 'pending_confirmation' | 'completed' | 'rejected';
  result?: unknown;
  error?: string;
  executed_by?: string;
  confirmed_by?: string;
  rejected_by?: string;
  rejection_reason?: string;
  source?: string;
  source_id?: string;
  reasoning?: string;
  created_at?: string;
  updated_at?: string;
}

interface HumanActionsStore {
  pending: ActionExecution[];
  history: ActionExecution[];
  loading: boolean;
  pendingCount: number;

  fetchPending: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  confirm: (executionId: string, confirmedBy?: string, note?: string) => Promise<void>;
  reject: (executionId: string, rejectedBy: string, reason: string) => Promise<void>;
}

export const useHumanActionsStore = create<HumanActionsStore>((set, get) => ({
  pending: [],
  history: [],
  loading: false,
  pendingCount: 0,

  fetchPending: async () => {
    set({ loading: true });
    try {
      const r = await fetch(`${ONTOLOGY_API}/actions/executions/pending`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      const data = await r.json();
      const pending = Array.isArray(data) ? data : [];
      set({ pending, pendingCount: pending.length });
    } finally {
      set({ loading: false });
    }
  },

  fetchHistory: async () => {
    // Fetch recent completed + rejected across all actions by loading
    // per-action executions. For now we load from the pending list endpoint
    // by passing status filter (the API supports ?status= per action).
    // Since actions/executions/pending only returns pending, we use a broader query.
    // We'll fetch up to 100 executions via the global executions endpoint.
    try {
      const r = await fetch(`${ONTOLOGY_API}/actions/executions?limit=100`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      if (r.ok) {
        const data = await r.json();
        set({ history: Array.isArray(data) ? data.filter((e: ActionExecution) => e.status !== 'pending_confirmation') : [] });
      }
    } catch {
      // history endpoint may not exist — silently ignore
    }
  },

  confirm: async (executionId, confirmedBy = 'admin', note) => {
    const r = await fetch(`${ONTOLOGY_API}/actions/executions/${executionId}/confirm`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed_by: confirmedBy, note }),
    });
    if (r.ok) {
      const updated = await r.json();
      set((s) => ({
        pending: s.pending.filter((e) => e.id !== executionId),
        pendingCount: Math.max(0, s.pendingCount - 1),
        history: [updated, ...s.history],
      }));
    }
  },

  reject: async (executionId, rejectedBy, reason) => {
    const r = await fetch(`${ONTOLOGY_API}/actions/executions/${executionId}/reject`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejected_by: rejectedBy, reason }),
    });
    if (r.ok) {
      const updated = await r.json();
      set((s) => ({
        pending: s.pending.filter((e) => e.id !== executionId),
        pendingCount: Math.max(0, s.pendingCount - 1),
        history: [updated, ...s.history],
      }));
    }
  },
}));
