import { create } from 'zustand';
import { getTenantId } from './authStore';

const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

export interface CheckpointDefinition {
  id: string;
  name: string;
  description?: string;
  applies_to: { resource_type: string; operation: string; roles?: string[] }[];
  require_justification: boolean;
  min_justification_length: number;
  enabled: boolean;
  created_at: string;
}

export interface CheckpointEvalResult {
  required: boolean;
  checkpoint_id?: string;
  checkpoint_name?: string;
  require_justification?: boolean;
}

export interface CheckpointProof {
  token: string;
  expires_at: string;
  checkpoint_id: string;
}

interface CheckpointState {
  checkpoints: CheckpointDefinition[];
  // gate state: resource_type+operation -> pending proof token
  pendingProof: Record<string, CheckpointProof | null>;

  fetchCheckpoints: () => Promise<void>;
  evaluate: (resource_type: string, operation: string, user_role?: string) => Promise<CheckpointEvalResult>;
  respond: (checkpoint_id: string, justification: string) => Promise<CheckpointProof>;
  clearProof: (key: string) => void;
}

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: [],
  pendingProof: {},

  fetchCheckpoints: async () => {
    try {
      const res = await fetch(`${AUDIT_API}/audit/checkpoints`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!res.ok) return;
      const data = await res.json();
      set({ checkpoints: Array.isArray(data) ? data : data.checkpoints || [] });
    } catch {
      // silent
    }
  },

  evaluate: async (resource_type, operation, user_role = 'admin') => {
    try {
      const res = await fetch(`${AUDIT_API}/audit/checkpoints/evaluate`, {
        method: 'POST',
        headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_type, operation, user_role }),
      });
      if (!res.ok) return { required: false };
      return await res.json();
    } catch {
      return { required: false };
    }
  },

  respond: async (checkpoint_id, justification) => {
    const res = await fetch(`${AUDIT_API}/audit/checkpoints/${checkpoint_id}/respond`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to submit justification');
    }
    const proof: CheckpointProof = await res.json();
    return proof;
  },

  clearProof: (key) => {
    set((s) => {
      const updated = { ...s.pendingProof };
      delete updated[key];
      return { pendingProof: updated };
    });
  },
}));
