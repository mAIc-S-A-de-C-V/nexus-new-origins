import { create } from 'zustand';
import {
  ObjectType, OntologyLink, ObjectTypeVersion, SchemaDiff,
} from '../types/ontology';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

// ─── Helpers ────────────────────────────────────────────────────────────────

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[camel] = snakeToCamel(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[camel] = v.map((item) =>
        item && typeof item === 'object' ? snakeToCamel(item as Record<string, unknown>) : item
      );
    } else {
      out[camel] = v;
    }
  }
  return out;
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const snake = k.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[snake] = camelToSnake(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[snake] = v.map((item) =>
        item && typeof item === 'object' ? camelToSnake(item as Record<string, unknown>) : item
      );
    } else {
      out[snake] = v;
    }
  }
  return out;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface OntologyStoreState {
  objectTypes: ObjectType[];
  links: OntologyLink[];
  loading: boolean;
  error: string | null;

  fetchObjectTypes: () => Promise<void>;
  addObjectType: (ot: ObjectType) => Promise<ObjectType>;
  updateObjectType: (id: string, updates: Partial<ObjectType>) => Promise<void>;
  removeObjectType: (id: string) => Promise<void>;

  fetchLinks: () => Promise<void>;
  addLink: (link: OntologyLink) => Promise<OntologyLink>;
  removeLink: (id: string) => Promise<void>;

  fetchVersions: (objectTypeId: string) => Promise<ObjectTypeVersion[]>;
  fetchDiff: (objectTypeId: string, v1: number, v2: number) => Promise<SchemaDiff | null>;
}

export const useOntologyStore = create<OntologyStoreState>((set, get) => ({
  objectTypes: [],
  links: [],
  loading: false,
  error: null,

  fetchObjectTypes: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${ONTOLOGY_API}/object-types`);
      if (!res.ok) throw new Error(`Failed to fetch object types: ${res.status}`);
      const data = await res.json();
      const objectTypes = data.map((item: Record<string, unknown>) => snakeToCamel(item) as unknown as ObjectType);
      set({ objectTypes, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  addObjectType: async (ot: ObjectType) => {
    const body = camelToSnake(ot as unknown as Record<string, unknown>);
    const res = await fetch(`${ONTOLOGY_API}/object-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create object type: ${res.status}`);
    const data = await res.json();
    const created = snakeToCamel(data) as unknown as ObjectType;
    set((state) => ({ objectTypes: [...state.objectTypes, created] }));
    return created;
  },

  updateObjectType: async (id: string, updates: Partial<ObjectType>) => {
    const existing = get().objectTypes.find((o) => o.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    const body = camelToSnake(merged as unknown as Record<string, unknown>);
    const res = await fetch(`${ONTOLOGY_API}/object-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update object type: ${res.status}`);
    const data = await res.json();
    const updated = snakeToCamel(data) as unknown as ObjectType;
    set((state) => ({
      objectTypes: state.objectTypes.map((o) => (o.id === id ? updated : o)),
    }));
  },

  removeObjectType: async (id: string) => {
    const res = await fetch(`${ONTOLOGY_API}/object-types/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`Failed to delete object type: ${res.status}`);
    set((state) => ({ objectTypes: state.objectTypes.filter((o) => o.id !== id) }));
  },

  fetchLinks: async () => {
    try {
      const res = await fetch(`${ONTOLOGY_API}/object-types/links/all`);
      if (!res.ok) throw new Error(`Failed to fetch links: ${res.status}`);
      const data = await res.json();
      const links = data.map((item: Record<string, unknown>) => snakeToCamel(item) as unknown as OntologyLink);
      set({ links });
    } catch (err) {
      console.error('fetchLinks error:', err);
    }
  },

  addLink: async (link: OntologyLink) => {
    const body = camelToSnake(link as unknown as Record<string, unknown>);
    const res = await fetch(`${ONTOLOGY_API}/object-types/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create link: ${res.status}`);
    const data = await res.json();
    const created = snakeToCamel(data) as unknown as OntologyLink;
    set((state) => ({ links: [...state.links, created] }));
    return created;
  },

  removeLink: async (id: string) => {
    const res = await fetch(`${ONTOLOGY_API}/object-types/links/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`Failed to delete link: ${res.status}`);
    set((state) => ({ links: state.links.filter((l) => l.id !== id) }));
  },

  fetchVersions: async (objectTypeId: string) => {
    try {
      const res = await fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/versions`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.map((item: Record<string, unknown>) => snakeToCamel(item) as unknown as ObjectTypeVersion);
    } catch {
      return [];
    }
  },

  fetchDiff: async (objectTypeId: string, v1: number, v2: number) => {
    try {
      const res = await fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/diff/${v1}/${v2}`);
      if (!res.ok) return null;
      const data = await res.json();
      return snakeToCamel(data) as unknown as SchemaDiff;
    } catch {
      return null;
    }
  },
}));
