import { create } from 'zustand';
import { getTenantId } from './authStore';

const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

export interface ApprovalWorkflow {
  id: string;
  name: string;
  description?: string;
  resource_type: string;
  operation: string;
  required_approvers: number;
  eligible_roles: string[];
  expiry_hours: number;
  enabled: boolean;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  workflow_id: string;
  resource_type: string;
  resource_id: string;
  operation: string;
  requested_by: string;
  requested_by_role: string;
  context: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  required_approvers: number;
  approvals: { user_id: string; role: string; note?: string; approved_at: string }[];
  rejections: { user_id: string; role: string; reason: string; rejected_at: string }[];
  created_at: string;
  expires_at: string;
  completed_at?: string;
}

interface ApprovalState {
  workflows: ApprovalWorkflow[];
  requests: ApprovalRequest[];
  pendingForMe: ApprovalRequest[];
  pendingCount: number;

  fetchWorkflows: () => Promise<void>;
  fetchRequests: (status?: string) => Promise<void>;
  fetchPendingForMe: (user_role?: string) => Promise<void>;
  submitRequest: (payload: {
    workflow_id: string;
    resource_type: string;
    resource_id: string;
    operation: string;
    requested_by: string;
    requested_by_role: string;
    context?: Record<string, unknown>;
  }) => Promise<ApprovalRequest>;
  approve: (request_id: string, user_id: string, role: string, note?: string) => Promise<void>;
  reject: (request_id: string, user_id: string, role: string, reason: string) => Promise<void>;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  workflows: [],
  requests: [],
  pendingForMe: [],
  pendingCount: 0,

  fetchWorkflows: async () => {
    try {
      const res = await fetch(`${AUDIT_API}/audit/approvals/workflows`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!res.ok) return;
      const data = await res.json();
      set({ workflows: Array.isArray(data) ? data : data.workflows || [] });
    } catch {
      // silent
    }
  },

  fetchRequests: async (status?) => {
    try {
      const params = status ? `?status=${status}` : '';
      const res = await fetch(`${AUDIT_API}/audit/approvals/requests${params}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!res.ok) return;
      const data = await res.json();
      set({ requests: Array.isArray(data) ? data : data.requests || [] });
    } catch {
      // silent
    }
  },

  fetchPendingForMe: async (user_role = 'admin') => {
    try {
      const res = await fetch(`${AUDIT_API}/audit/approvals/requests/mine/pending?user_role=${user_role}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.requests || [];
      set({ pendingForMe: list, pendingCount: list.length });
    } catch {
      // silent
    }
  },

  submitRequest: async (payload) => {
    const res = await fetch(`${AUDIT_API}/audit/approvals/requests`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to submit approval request');
    }
    return res.json();
  },

  approve: async (request_id, user_id, role, note) => {
    const res = await fetch(`${AUDIT_API}/audit/approvals/requests/${request_id}/approve`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, role, note }),
    });
    if (!res.ok) throw new Error('Failed to approve');
    await get().fetchPendingForMe();
  },

  reject: async (request_id, user_id, role, reason) => {
    const res = await fetch(`${AUDIT_API}/audit/approvals/requests/${request_id}/reject`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, role, reason }),
    });
    if (!res.ok) throw new Error('Failed to reject');
    await get().fetchPendingForMe();
  },
}));
