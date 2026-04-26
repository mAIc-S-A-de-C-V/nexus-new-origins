import { create } from 'zustand';
import { NexusApp } from '../types/app';
import { getTenantId } from './authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

function toNexusApp(raw: Record<string, unknown>): NexusApp {
  // Prefer object_type_ids array, fall back to wrapping single object_type_id
  const otIds = Array.isArray(raw.object_type_ids) && (raw.object_type_ids as string[]).length > 0
    ? (raw.object_type_ids as string[])
    : raw.object_type_id ? [raw.object_type_id as string] : [];
  // Settings is a free-form JSON blob from the server. The dashboard filter
  // bar config lives under settings.filter_bar (snake_case to match the
  // rest of the API).
  const settings = (raw.settings as Record<string, unknown>) || {};
  const filterBar = settings.filter_bar as NexusApp['filterBar'] | undefined;
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string) || '',
    icon: (raw.icon as string) || '',
    components: (raw.components as NexusApp['components']) || [],
    objectTypeIds: otIds,
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updated_at as string) || new Date().toISOString(),
    filterBar,
  };
}

interface AppStore {
  apps: NexusApp[];
  loading: boolean;
  fetchApps: () => Promise<void>;
  addApp: (app: NexusApp) => Promise<NexusApp>;
  updateApp: (id: string, updates: Partial<NexusApp>) => Promise<void>;
  deleteApp: (id: string) => Promise<void>;
  getApp: (id: string) => NexusApp | undefined;
}

export const useAppStore = create<AppStore>((set, get) => ({
  apps: [],
  loading: false,

  fetchApps: async () => {
    set({ loading: true });
    try {
      const resp = await fetch(`${ONTOLOGY_API}/apps`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (resp.ok) {
        const data = await resp.json();
        set({ apps: (data as Record<string, unknown>[]).map(toNexusApp) });
      }
    } catch {
      // silently ignore network errors — app list will remain empty
    } finally {
      set({ loading: false });
    }
  },

  addApp: async (app: NexusApp) => {
    const resp = await fetch(`${ONTOLOGY_API}/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': getTenantId(),
      },
      body: JSON.stringify({
        name: app.name,
        description: app.description,
        icon: app.icon,
        object_type_ids: app.objectTypeIds || [],
        components: app.components,
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create app: ${resp.status}`);
    const created = toNexusApp(await resp.json() as Record<string, unknown>);
    set((s) => ({ apps: [created, ...s.apps] }));
    return created;
  },

  updateApp: async (id: string, updates: Partial<NexusApp>) => {
    const resp = await fetch(`${ONTOLOGY_API}/apps/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': getTenantId(),
      },
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        icon: updates.icon,
        components: updates.components,
        // settings is a free-form blob; the dashboard filter bar lives
        // inside it under filter_bar.
        settings: updates.filterBar !== undefined ? { filter_bar: updates.filterBar } : undefined,
      }),
    });
    if (!resp.ok) throw new Error(`Failed to update app: ${resp.status}`);
    const updated = toNexusApp(await resp.json() as Record<string, unknown>);
    set((s) => ({ apps: s.apps.map((a) => (a.id === id ? updated : a)) }));
  },

  deleteApp: async (id: string) => {
    const resp = await fetch(`${ONTOLOGY_API}/apps/${id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': getTenantId() },
    });
    if (!resp.ok && resp.status !== 404) throw new Error(`Failed to delete app: ${resp.status}`);
    set((s) => ({ apps: s.apps.filter((a) => a.id !== id) }));
  },

  getApp: (id: string) => get().apps.find((a) => a.id === id),
}));
