import { create } from 'zustand';
import { NexusApp, AppAction, AppEvent, AppVariable } from '../types/app';
import { getTenantId } from './authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

function toNexusApp(raw: Record<string, unknown>): NexusApp {
  const otIds = Array.isArray(raw.object_type_ids) && (raw.object_type_ids as string[]).length > 0
    ? (raw.object_type_ids as string[])
    : raw.object_type_id ? [raw.object_type_id as string] : [];
  const settings = (raw.settings as Record<string, unknown>) || {};
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string) || '',
    icon: (raw.icon as string) || '',
    components: (raw.components as NexusApp['components']) || [],
    objectTypeIds: otIds,
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updated_at as string) || new Date().toISOString(),
    filterBar: settings.filter_bar as NexusApp['filterBar'] | undefined,
    // Phase G/H/I/E/J — fields stashed in settings for backward compat,
    // promoted to top-level via real columns where indexable matters.
    kind: (raw.kind as 'dashboard' | 'app') || (settings.kind as 'dashboard' | 'app') || 'dashboard',
    actions: (settings.actions as AppAction[]) || (raw.actions as AppAction[]) || [],
    variables: (settings.variables as AppVariable[]) || (raw.variables as AppVariable[]) || [],
    events: (settings.events as AppEvent[]) || (raw.events as AppEvent[]) || [],
    isEphemeral: Boolean(raw.is_ephemeral),
    parentAppId: (raw.parent_app_id as string) || undefined,
    generatedFromWidgetId: (raw.generated_from_widget_id as string) || undefined,
    expiresAt: (raw.expires_at as string) || undefined,
    isSystem: Boolean(raw.is_system),
    slug: (raw.slug as string) || undefined,
  };
}

function buildSettingsBlob(app: Partial<NexusApp>): Record<string, unknown> {
  // Pack non-column-backed app metadata into the settings JSON blob the
  // server already accepts. Keeps existing apps working without migration.
  const blob: Record<string, unknown> = {};
  if (app.filterBar !== undefined) blob.filter_bar = app.filterBar;
  if (app.actions !== undefined) blob.actions = app.actions;
  if (app.variables !== undefined) blob.variables = app.variables;
  if (app.events !== undefined) blob.events = app.events;
  return blob;
}

interface AppStore {
  apps: NexusApp[];
  loading: boolean;
  fetchApps: (kind?: 'dashboard' | 'app') => Promise<void>;
  fetchRecentGenerated: () => Promise<NexusApp[]>;
  addApp: (app: NexusApp) => Promise<NexusApp>;
  updateApp: (id: string, updates: Partial<NexusApp>) => Promise<void>;
  deleteApp: (id: string) => Promise<void>;
  savePermanently: (id: string) => Promise<NexusApp>;
  getApp: (id: string) => NexusApp | undefined;
}

export const useAppStore = create<AppStore>((set, get) => ({
  apps: [],
  loading: false,

  fetchApps: async (kind?: 'dashboard' | 'app') => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      const url = `${ONTOLOGY_API}/apps${params.toString() ? `?${params}` : ''}`;
      const resp = await fetch(url, { headers: { 'x-tenant-id': getTenantId() } });
      if (resp.ok) {
        const data = await resp.json();
        set({ apps: (data as Record<string, unknown>[]).map(toNexusApp) });
      }
    } catch {
      // silently ignore network errors
    } finally {
      set({ loading: false });
    }
  },

  fetchRecentGenerated: async () => {
    try {
      const resp = await fetch(`${ONTOLOGY_API}/apps/recent-generated`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as Record<string, unknown>[];
      return data.map(toNexusApp);
    } catch {
      return [];
    }
  },

  addApp: async (app: NexusApp) => {
    const resp = await fetch(`${ONTOLOGY_API}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({
        name: app.name,
        description: app.description,
        icon: app.icon,
        object_type_ids: app.objectTypeIds || [],
        components: app.components,
        settings: buildSettingsBlob(app),
        kind: app.kind || 'dashboard',
        is_ephemeral: app.isEphemeral || false,
        parent_app_id: app.parentAppId,
        generated_from_widget_id: app.generatedFromWidgetId,
        is_system: app.isSystem || false,
        slug: app.slug,
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create app: ${resp.status}`);
    const created = toNexusApp(await resp.json() as Record<string, unknown>);
    set((s) => ({ apps: [created, ...s.apps] }));
    return created;
  },

  updateApp: async (id: string, updates: Partial<NexusApp>) => {
    const settingsTouched =
      updates.filterBar !== undefined ||
      updates.actions !== undefined ||
      updates.variables !== undefined ||
      updates.events !== undefined;
    const resp = await fetch(`${ONTOLOGY_API}/apps/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        icon: updates.icon,
        components: updates.components,
        kind: updates.kind,
        settings: settingsTouched ? buildSettingsBlob(updates) : undefined,
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

  savePermanently: async (id: string) => {
    const resp = await fetch(`${ONTOLOGY_API}/apps/${id}/save-permanently`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId() },
    });
    if (!resp.ok) throw new Error(`Failed to save permanently: ${resp.status}`);
    const saved = toNexusApp(await resp.json() as Record<string, unknown>);
    set((s) => ({ apps: [saved, ...s.apps.filter((a) => a.id !== id)] }));
    return saved;
  },

  getApp: (id: string) => get().apps.find((a) => a.id === id),
}));
