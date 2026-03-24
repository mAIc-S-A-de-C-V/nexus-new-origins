import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CorrelationResult {
  matches: unknown[];
  top_action: string;
  new_object_name: string;
}

interface InferenceEntry {
  result: Record<string, unknown>;
  correlationResult: CorrelationResult | null;
  statusLog: string[];
  sampleRows?: unknown[];
}

interface InferenceStore {
  cache: Record<string, InferenceEntry>;
  save: (connectorId: string, entry: InferenceEntry) => void;
  get: (connectorId: string) => InferenceEntry | null;
  clear: (connectorId: string) => void;
}

export const useInferenceStore = create<InferenceStore>()(
  persist(
    (set, get) => ({
      cache: {},

      save: (connectorId, entry) =>
        set((s) => ({ cache: { ...s.cache, [connectorId]: entry } })),

      get: (connectorId) => get().cache[connectorId] || null,

      clear: (connectorId) =>
        set((s) => {
          const c = { ...s.cache };
          delete c[connectorId];
          return { cache: c };
        }),
    }),
    { name: 'nexus-inference-cache' }
  )
);
