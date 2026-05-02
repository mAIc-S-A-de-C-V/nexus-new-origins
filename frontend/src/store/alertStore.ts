import { create } from 'zustand';
import { getTenantId } from './authStore';

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
  // Optional deep-link to the underlying pipeline / agent run that produced
  // this alert. Populated by the alert engine when the notification's details
  // payload references a run id.
  run_link?: {
    kind: 'pipeline' | 'agent';
    run_id: string;
    pipeline_id?: string;
    agent_id?: string;
  } | null;
}

export interface ChannelConfig {
  email_enabled: boolean;
  email_recipients: string;
  slack_enabled: boolean;
  slack_webhook_url: string;
}

interface AlertState {
  rules: AlertRule[];
  notifications: AlertNotification[];
  unreadCount: number;
  loadingRules: boolean;
  loadingNotifications: boolean;
  webhooks: { id: string; url: string; enabled: boolean; created_at: string }[];
  channels: ChannelConfig | null;

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

  snoozeNotification: (id: string, until: string) => Promise<void>;
  fetchWebhooks: () => Promise<void>;
  createWebhook: (url: string) => Promise<{ id: string; url: string; secret: string }>;
  deleteWebhook: (id: string) => Promise<void>;
  fetchChannels: () => Promise<void>;
  updateChannels: (config: ChannelConfig) => Promise<void>;
  testChannels: () => Promise<{ ok: boolean; slack?: string; email?: string }>;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  rules: [],
  notifications: [],
  unreadCount: 0,
  loadingRules: false,
  loadingNotifications: false,
  webhooks: [],
  channels: null,

  fetchRules: async (tenantId = getTenantId()) => {
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

  createRule: async (rule, tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/rules?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    await get().fetchRules(tenantId);
  },

  updateRule: async (id, updates, tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/rules/${id}?tenant_id=${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await get().fetchRules(tenantId);
  },

  deleteRule: async (id, tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/rules/${id}?tenant_id=${tenantId}`, { method: 'DELETE' });
    set(s => ({ rules: s.rules.filter(r => r.id !== id) }));
  },

  testRule: async (id, tenantId = getTenantId()) => {
    const res = await fetch(`${ALERT_API}/alerts/rules/${id}/test?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    return res.json();
  },

  fetchNotifications: async (tenantId = getTenantId(), unreadOnly = false) => {
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

  markRead: async (id, tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/notifications/${id}/read?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  markAllRead: async (tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/notifications/read-all?tenant_id=${tenantId}`, {
      method: 'POST',
    });
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  deleteNotification: async (id, tenantId = getTenantId()) => {
    await fetch(`${ALERT_API}/alerts/notifications/${id}?tenant_id=${tenantId}`, {
      method: 'DELETE',
    });
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
  },

  pollUnreadCount: async (tenantId = getTenantId()) => {
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

  snoozeNotification: async (id, until) => {
    await fetch(`${ALERT_API}/alerts/notifications/${id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({ until }),
    });
  },

  fetchWebhooks: async () => {
    try {
      const res = await fetch(`${ALERT_API}/alerts/notifications/webhooks`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      const data = await res.json();
      set({ webhooks: data.webhooks || data || [] });
    } catch {
      set({ webhooks: [] });
    }
  },

  createWebhook: async (url) => {
    const res = await fetch(`${ALERT_API}/alerts/notifications/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    await get().fetchWebhooks();
    return data;
  },

  deleteWebhook: async (id) => {
    await fetch(`${ALERT_API}/alerts/notifications/webhooks/${id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': getTenantId() },
    });
    set(s => ({ webhooks: s.webhooks.filter(w => w.id !== id) }));
  },

  fetchChannels: async () => {
    try {
      const res = await fetch(`${ALERT_API}/alerts/channels`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      const data = await res.json();
      set({ channels: data });
    } catch {
      set({ channels: null });
    }
  },

  updateChannels: async (config) => {
    await fetch(`${ALERT_API}/alerts/channels`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify(config),
    });
    set({ channels: config });
  },

  testChannels: async () => {
    const res = await fetch(`${ALERT_API}/alerts/channels/test`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId() },
    });
    return res.json();
  },
}));
