import { create } from 'zustand';
import { ConnectorConfig } from '../types/connector';

// ─── Store ──────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';
const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

interface ConnectorStoreState {
  connectors: ConnectorConfig[];
  loading: boolean;
  error: string | null;
  fetchConnectors: () => Promise<void>;
  addConnector: (req: Omit<ConnectorConfig, 'id' | 'createdAt' | 'updatedAt' | 'tenantId' | 'activePipelineCount'>) => Promise<ConnectorConfig>;
  updateConnector: (id: string, updates: Partial<ConnectorConfig>) => Promise<void>;
  removeConnector: (id: string) => Promise<void>;
}

export const useConnectorStore = create<ConnectorStoreState>((set) => ({
  connectors: [],
  loading: false,
  error: null,

  fetchConnectors: async () => {
    set({ loading: true, error: null });
    try {
      const [connRes, pipeRes] = await Promise.all([
        fetch(`${API}/connectors`),
        fetch(`${PIPELINE_API}/pipelines`).catch(() => null),
      ]);
      if (!connRes.ok) throw new Error(`HTTP ${connRes.status}`);
      const data = await connRes.json();

      // Build per-connector pipeline stats from the pipeline service
      const pipelineStats: Record<string, { count: number; lastRun: string | null }> = {};
      if (pipeRes?.ok) {
        const pipes: Record<string, unknown>[] = await pipeRes.json();
        for (const p of pipes) {
          const ids = (p.connector_ids as string[]) ?? [];
          const lastRun = (p.last_run_at as string | null) ?? null;
          for (const cid of ids) {
            if (!pipelineStats[cid]) pipelineStats[cid] = { count: 0, lastRun: null };
            pipelineStats[cid].count += 1;
            if (lastRun && (!pipelineStats[cid].lastRun || lastRun > pipelineStats[cid].lastRun!)) {
              pipelineStats[cid].lastRun = lastRun;
            }
          }
        }
      }

      // Normalise snake_case from API to camelCase used by frontend types
      const connectors: ConnectorConfig[] = data.map((c: Record<string, unknown>) => {
        const stats = pipelineStats[c.id as string];
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          category: c.category,
          status: c.status,
          description: c.description,
          baseUrl: c.base_url,
          authType: c.auth_type,
          credentials: c.credentials,
          paginationStrategy: c.pagination_strategy,
          activePipelineCount: stats?.count ?? (c.active_pipeline_count as number) ?? 0,
          lastSync: stats?.lastRun ?? (c.last_sync as string | null) ?? undefined,
          lastSyncRowCount: c.last_sync_row_count,
          schemaHash: c.schema_hash,
          tags: c.tags ?? [],
          config: c.config,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          tenantId: c.tenant_id,
        };
      });
      set({ connectors, loading: false });
    } catch (err: unknown) {
      set({ error: String(err), loading: false });
    }
  },

  addConnector: async (req) => {
    const body = {
      name: req.name,
      type: req.type,
      category: req.category,
      description: req.description,
      base_url: req.baseUrl,
      auth_type: req.authType,
      credentials: req.credentials,
      pagination_strategy: req.paginationStrategy,
      tags: req.tags ?? [],
      config: req.config,
    };
    const res = await fetch(`${API}/connectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Failed to create connector: ${detail}`);
    }
    const c = await res.json();
    const connector: ConnectorConfig = {
      id: c.id,
      name: c.name,
      type: c.type,
      category: c.category,
      status: c.status,
      description: c.description,
      baseUrl: c.base_url,
      authType: c.auth_type,
      credentials: c.credentials,
      paginationStrategy: c.pagination_strategy,
      activePipelineCount: c.active_pipeline_count ?? 0,
      lastSync: c.last_sync,
      lastSyncRowCount: c.last_sync_row_count,
      schemaHash: c.schema_hash,
      tags: c.tags ?? [],
      config: c.config,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      tenantId: c.tenant_id,
    };
    set((state) => ({ connectors: [...state.connectors, connector] }));
    return connector;
  },

  updateConnector: async (id, updates) => {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.baseUrl !== undefined) body.base_url = updates.baseUrl;
    if (updates.authType !== undefined) body.auth_type = updates.authType;
    if (updates.credentials !== undefined) body.credentials = updates.credentials;
    if (updates.tags !== undefined) body.tags = updates.tags;
    if (updates.paginationStrategy !== undefined) body.pagination_strategy = updates.paginationStrategy;
    if (updates.config !== undefined) body.config = updates.config;
    if (updates.headers !== undefined) body.headers = updates.headers;
    const res = await fetch(`${API}/connectors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    set((state) => ({
      connectors: state.connectors.map((conn) =>
        conn.id === id ? { ...conn, ...updates, updatedAt: c.updated_at } : conn
      ),
    }));
  },

  removeConnector: async (id) => {
    const res = await fetch(`${API}/connectors/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    set((state) => ({
      connectors: state.connectors.filter((c) => c.id !== id),
    }));
  },
}));
