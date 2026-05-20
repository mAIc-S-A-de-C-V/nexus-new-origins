import { create } from 'zustand';
import { getTenantId } from './authStore';

const ALERT_API = import.meta.env.VITE_ALERT_ENGINE_URL || 'http://localhost:8010';

export interface RoutingRule {
  id: string;
  tenant_id: string;
  name: string;
  condition: Record<string, unknown>;
  target_user_ids: string[];
  channels: string[];
  priority: number;
  enabled: boolean;
}

export interface OnCallSchedule {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  rotation: unknown;
}

export interface UserPrefs {
  user_id: string;
  tenant_id: string;
  channel_prefs: Record<string, boolean>;
  quiet_hours: { enabled?: boolean; start?: string; end?: string } | null;
  do_not_disturb_until: string | null;
}

interface State {
  routingRules: RoutingRule[];
  schedules: OnCallSchedule[];

  fetchRouting: () => Promise<void>;
  createRouting: (body: Omit<RoutingRule, 'id' | 'tenant_id'>) => Promise<void>;
  updateRouting: (id: string, body: Omit<RoutingRule, 'id' | 'tenant_id'>) => Promise<void>;
  deleteRouting: (id: string) => Promise<void>;

  fetchSchedules: () => Promise<void>;
  createSchedule: (body: Omit<OnCallSchedule, 'id' | 'tenant_id'>) => Promise<void>;
  updateSchedule: (id: string, body: Omit<OnCallSchedule, 'id' | 'tenant_id'>) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;

  fetchUserPrefs: (userId: string) => Promise<UserPrefs | null>;
  upsertUserPrefs: (userId: string, body: Omit<UserPrefs, 'user_id' | 'tenant_id'>) => Promise<void>;
}

function qs(extra: Record<string, string> = {}) {
  return `?tenant_id=${encodeURIComponent(getTenantId())}` +
    Object.entries(extra).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
}

export const useRoutingStore = create<State>((set) => ({
  routingRules: [],
  schedules: [],

  fetchRouting: async () => {
    try {
      const res = await fetch(`${ALERT_API}/alerts/routing${qs()}`);
      const data = await res.json();
      set({ routingRules: data.rules || [] });
    } catch { set({ routingRules: [] }); }
  },
  createRouting: async (body) => {
    await fetch(`${ALERT_API}/alerts/routing${qs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updateRouting: async (id, body) => {
    await fetch(`${ALERT_API}/alerts/routing/${id}${qs()}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  deleteRouting: async (id) => {
    await fetch(`${ALERT_API}/alerts/routing/${id}${qs()}`, { method: 'DELETE' });
  },

  fetchSchedules: async () => {
    try {
      const res = await fetch(`${ALERT_API}/alerts/oncall${qs()}`);
      const data = await res.json();
      set({ schedules: data.schedules || [] });
    } catch { set({ schedules: [] }); }
  },
  createSchedule: async (body) => {
    await fetch(`${ALERT_API}/alerts/oncall${qs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updateSchedule: async (id, body) => {
    await fetch(`${ALERT_API}/alerts/oncall/${id}${qs()}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  deleteSchedule: async (id) => {
    await fetch(`${ALERT_API}/alerts/oncall/${id}${qs()}`, { method: 'DELETE' });
  },

  fetchUserPrefs: async (userId) => {
    try {
      const res = await fetch(`${ALERT_API}/alerts/user-prefs/${userId}${qs()}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },
  upsertUserPrefs: async (userId, body) => {
    await fetch(`${ALERT_API}/alerts/user-prefs/${userId}${qs()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
}));
