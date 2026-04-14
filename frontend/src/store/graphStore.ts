import { create } from 'zustand';
import { getTenantId } from './authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TypeNode {
  id: string;
  node_type: 'object_type';
  display_name: string;
  name: string;
  record_count: number;
  properties: { name: string; data_type: string; semantic_type: string }[];
  version: number;
  description: string;
}

export interface RecordNode {
  id: string;
  object_type_id: string;
  type_name: string;
  data: Record<string, unknown>;
  depth: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationship_type: string;
  join_keys?: { source_field: string; target_field: string }[];
  is_inferred?: boolean;
  confidence?: number | null;
  link_id?: string;
}

export type GraphMode = 'type_overview' | 'record_focus';

// ── Store ─────────────────────────────────────────────────────────────────────

interface GraphStore {
  mode: GraphMode;
  typeNodes: TypeNode[];
  typeEdges: GraphEdge[];
  recordNodes: RecordNode[];
  recordEdges: GraphEdge[];
  selectedNodeId: string | null;
  loading: boolean;
  loadingExpand: boolean;
  error: string | null;
  // "Open in Graph" cross-module link
  pendingTypeId: string | null;

  fetchSummary: () => Promise<void>;
  startRecordGraph: (objectTypeId: string, objectId?: string, depth?: number, maxNodes?: number) => Promise<void>;
  expandNode: (recordId: string, targetTypeId: string, linkId: string) => Promise<void>;
  setSelectedNode: (id: string | null) => void;
  setMode: (mode: GraphMode) => void;
  setPendingTypeId: (id: string | null) => void;
  clearRecordGraph: () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  mode: 'type_overview',
  typeNodes: [],
  typeEdges: [],
  recordNodes: [],
  recordEdges: [],
  selectedNodeId: null,
  loading: false,
  loadingExpand: false,
  error: null,
  pendingTypeId: null,

  fetchSummary: async () => {
    set({ loading: true, error: null });
    try {
      const resp = await fetch(`${ONTOLOGY_API}/graph/summary`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json() as { nodes: TypeNode[]; edges: GraphEdge[] };
      set({ typeNodes: data.nodes, typeEdges: data.edges });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  startRecordGraph: async (objectTypeId, objectId, depth = 2, maxNodes = 100) => {
    set({ loading: true, error: null });
    try {
      const resp = await fetch(`${ONTOLOGY_API}/graph/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': getTenantId(),
        },
        body: JSON.stringify({
          object_type_id: objectTypeId,
          object_id: objectId,
          depth,
          max_nodes: maxNodes,
        }),
      });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json() as { nodes: RecordNode[]; edges: GraphEdge[] };
      set({
        recordNodes: data.nodes,
        recordEdges: data.edges,
        mode: 'record_focus',
        selectedNodeId: objectId || data.nodes[0]?.id || null,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  expandNode: async (recordId, targetTypeId, linkId) => {
    set({ loadingExpand: true });
    try {
      const existingIds = get().recordNodes.map((n) => n.id);
      const resp = await fetch(`${ONTOLOGY_API}/graph/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': getTenantId(),
        },
        body: JSON.stringify({
          record_id: recordId,
          target_type_id: targetTypeId,
          link_id: linkId,
          existing_ids: existingIds,
          limit: 50,
        }),
      });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json() as { nodes: RecordNode[]; edges: GraphEdge[] };
      set((s) => ({
        recordNodes: [...s.recordNodes, ...data.nodes],
        recordEdges: [...s.recordEdges, ...data.edges],
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loadingExpand: false });
    }
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setMode: (mode) => set({ mode }),
  setPendingTypeId: (id) => set({ pendingTypeId: id }),
  clearRecordGraph: () => set({ recordNodes: [], recordEdges: [], mode: 'type_overview' }),
}));
