import { create } from 'zustand';

const LOGIC_API = import.meta.env.VITE_LOGIC_SERVICE_URL || 'http://localhost:8012';

export interface InputField {
  name: string;
  type: string;
  description?: string;
  object_type?: string;
  required: boolean;
}

export interface FilterRow {
  field: string;
  op: string;
  value: string;
}

export interface Block {
  id: string;
  type: 'ontology_query' | 'llm_call' | 'action' | 'ontology_update' | 'transform' | 'send_email' | 'utility_call';
  label?: string;
  // ontology_query
  config?: Record<string, unknown>; // includes object_type, filters: FilterRow[], limit
  // send_email
  to?: string;
  subject?: string;
  body?: string;
  from_name?: string;
  bcc?: string;
  // llm_call
  prompt_template?: string;
  system_prompt?: string;
  model?: string;
  output_schema?: Record<string, unknown>;
  max_tokens?: number;
  // action
  action_name?: string;
  params?: Record<string, unknown>;
  reasoning?: string;
  // transform
  operation?: string;
  source?: string;
  field?: string;
  value?: string;
  template?: string;
  // utility_call
  utility_id?: string;
  utility_params?: Record<string, string>;
}

export interface LogicFunction {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  input_schema: InputField[];
  blocks: Block[];
  output_block?: string;
  version: number;
  status: string;
  published_version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BlockTrace {
  result: unknown;
  duration_ms: number;
  status: string;
  error?: string;
}

export interface LogicRun {
  id: string;
  function_id: string;
  function_version: number;
  inputs: Record<string, unknown>;
  status: string;
  trace?: Record<string, BlockTrace>;
  output?: unknown;
  error?: string;
  triggered_by?: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
}

interface LogicStore {
  functions: LogicFunction[];
  selectedFn: LogicFunction | null;
  runs: LogicRun[];
  lastRun: LogicRun | null;
  loading: boolean;
  running: boolean;

  fetchFunctions: () => Promise<void>;
  selectFunction: (fn: LogicFunction | null) => void;
  createFunction: (data: Partial<LogicFunction>) => Promise<LogicFunction>;
  updateFunction: (id: string, data: Partial<LogicFunction>) => Promise<void>;
  deleteFunction: (id: string) => Promise<void>;
  publishFunction: (id: string) => Promise<void>;
  runSync: (id: string, inputs: Record<string, unknown>) => Promise<LogicRun>;
  fetchRuns: (functionId: string) => Promise<void>;
}

export const useLogicStore = create<LogicStore>((set, get) => ({
  functions: [],
  selectedFn: null,
  runs: [],
  lastRun: null,
  loading: false,
  running: false,

  fetchFunctions: async () => {
    set({ loading: true });
    try {
      const r = await fetch(`${LOGIC_API}/logic/functions`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      const data = await r.json();
      set({ functions: Array.isArray(data) ? data : [] });
    } finally {
      set({ loading: false });
    }
  },

  selectFunction: (fn) => set({ selectedFn: fn }),

  createFunction: async (data) => {
    const r = await fetch(`${LOGIC_API}/logic/functions`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const fn = await r.json();
    set((s) => ({ functions: [fn, ...s.functions], selectedFn: fn }));
    return fn;
  },

  updateFunction: async (id, data) => {
    const r = await fetch(`${LOGIC_API}/logic/functions/${id}`, {
      method: 'PUT',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const fn = await r.json();
    set((s) => ({
      functions: s.functions.map((f) => (f.id === id ? fn : f)),
      selectedFn: s.selectedFn?.id === id ? fn : s.selectedFn,
    }));
  },

  deleteFunction: async (id) => {
    await fetch(`${LOGIC_API}/logic/functions/${id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    set((s) => ({
      functions: s.functions.filter((f) => f.id !== id),
      selectedFn: s.selectedFn?.id === id ? null : s.selectedFn,
    }));
  },

  publishFunction: async (id) => {
    const r = await fetch(`${LOGIC_API}/logic/functions/${id}/publish`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    const fn = await r.json();
    set((s) => ({
      functions: s.functions.map((f) => (f.id === id ? fn : f)),
      selectedFn: s.selectedFn?.id === id ? fn : s.selectedFn,
    }));
  },

  runSync: async (id, inputs) => {
    set({ running: true, lastRun: null });
    try {
      const r = await fetch(`${LOGIC_API}/logic/functions/${id}/run/sync`, {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, triggered_by: 'studio' }),
      });
      const run = await r.json();
      set({ lastRun: run });
      return run;
    } finally {
      set({ running: false });
    }
  },

  fetchRuns: async (functionId) => {
    const r = await fetch(`${LOGIC_API}/logic/runs?function_id=${functionId}&limit=20`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    const data = await r.json();
    set({ runs: Array.isArray(data) ? data : [] });
  },
}));
