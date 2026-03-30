import { create } from 'zustand';

const ALERT_API = import.meta.env.VITE_ALERT_ENGINE_URL || 'http://localhost:8010';

export type RuleType = 'stuck_case' | 'slow_transition' | 'rework_spike' | 'case_volume_anomaly';

export interface AlertRule {
  id: string;
  name: string;
  rule_type: RuleType;
  object_type_id: string | null;
  config: Record<string, unknown>;
  cooldown_minutes: number;
  enabled: boolean;
  created_at: string;
  last_fired: string | null;
}

export interface AlertNotification {
  id: string;
  rule_id: string;
  rule_name: string;
  rule_type: RuleType;
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  read: boolean;
  fired_at: string;
}

interface AlertState {
  rules: AlertRule[];
  notifications: AlertNotification[];
  unreadCount: number;
  loadingRules: boolean;
  loadingNotifications: boolean;

  fetchRules: (tenantId?: string) => Promise<void>;
  createRule: (rule: Omit<AlertRule, 'id' | 'created_at' | 'last_fired'>, tenantId?: string) => Promise<void>;
  updateRule: (id: string, updates: Partial<Pick<AlertRule, 'name' | 'config' | 'cooldown_minutes' | 'enabled'>>, tenantId?: string) => Promise<void>;
  deleteRule: (id: string, tenantId?: string) => Promise<void>;
  testRule: (id: string, tenantId?: string) => Promise<{ triggered: boolean; result: Record<string, unknown> | null }>;

  fetchNotifications: (tenantId?: string, unreadOnly?: boolean) => Promise<void>;
  markRead: (id: string, tenantId?: string) => Promise<void>;
  markAllRead: (tenantId?: string) => Promise<void>;
  deleteNotification: (id: string, tenantId?: string) => Promise<void>;
  pollUnreadCount: (tenantId?: string) => Promise<void>;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  rules: [],
  notifications: [],
  unreadCount: 0,
  loadingRules: false,
  loadingNotifications: false,

  fetchRules: async (tenantId = 'tenant-001') => {
    set({ loadingRules: true });
    try {
      const res = await fetch(`${ALERT_API}/alerts/rules?tenant_id=${tenantId}`);
      const data = await res.json();
      set({ rules: data.rules || [] });
    } catch {
      set({ rules: [] });
    } finally {
      set({ loadingRules: false });
    }
  },

  createRule: async (rule, tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/rules?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    await get().fetchRules(tenantId);
  },

  updateRule: async (id, updates, tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/rules/${id}?tenant_id=${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await get().fetchRules(tenantId);
  },

  deleteRule: async (id, tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/rules/${id}?tenant_id=${tenantId}`, { method: 'DELETE' });
    set(s => ({ rules: s.rules.filter(r => r.id !== id) }));
  },

  testRule: async (id, tenantId = 'tenant-001') => {
    const res = await fetch(`${ALERT_API}/alerts/rules/${id}/test?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    return res.json();
  },

  fetchNotifications: async (tenantId = 'tenant-001', unreadOnly = false) => {
    set({ loadingNotifications: true });
    try {
      const url = `${ALERT_API}/alerts/notifications?tenant_id=${tenantId}&unread_only=${unreadOnly}&limit=50`;
      const res = await fetch(url);
      const data = await res.json();
      set({
        notifications: data.notifications || [],
        unreadCount: data.unread_count || 0,
      });
    } catch {
      set({ notifications: [] });
    } finally {
      set({ loadingNotifications: false });
    }
  },

  markRead: async (id, tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/notifications/${id}/read?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  markAllRead: async (tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/notifications/read-all?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  deleteNotification: async (id, tenantId = 'tenant-001') => {
    await fetch(`${ALERT_API}/alerts/notifications/${id}?tenant_id=${tenantId}`, {
      method: 'DELETE',
    });
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
  },

  pollUnreadCount: async (tenantId = 'tenant-001') => {
    try {
      const res = await fetch(
        `${ALERT_API}/alerts/notifications?tenant_id=${tenantId}&unread_only=true&limit=1`
      );
      const data = await res.json();
      set({ unreadCount: data.unread_count || 0 });
    } catch {
      // silent
    }
  },
}));
