import { create } from 'zustand';
import { NexusApp } from '../types/app';
import { getTenantId } from './authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

function toNexusApp(raw: Record<string, unknown>): NexusApp {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string) || '',
    icon: (raw.icon as string) || '',
    components: (raw.components as NexusApp['components']) || [],
    objectTypeIds: raw.object_type_id ? [raw.object_type_id as string] : [],
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updated_at as string) || new Date().toISOString(),
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
    const objectTypeId = app.objectTypeIds?.[0] || '';
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
        object_type_id: objectTypeId,
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
