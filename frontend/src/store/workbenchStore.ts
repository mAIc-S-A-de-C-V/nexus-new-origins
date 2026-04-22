import { create } from 'zustand';
import { Cell, Notebook } from '../types/notebook';
import { getTenantId, getAccessToken } from './authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const KERNEL_API = import.meta.env.VITE_KERNEL_SERVICE_URL || 'http://localhost:8026';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'x-tenant-id': getTenantId(), ...extra };
  const token = getAccessToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function toNotebook(raw: Record<string, unknown>): Notebook {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Untitled Notebook'),
    description: String(raw.description ?? ''),
    cells: Array.isArray(raw.cells) ? (raw.cells as Cell[]) : [],
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? new Date().toISOString()),
  };
}

interface WorkbenchStore {
  notebooks: Notebook[];
  currentNotebookId: string | null;
  kernelSessionId: string | null;
  loading: boolean;
  generating: boolean;

  fetchNotebooks: () => Promise<void>;
  createNotebook: (name?: string) => Promise<Notebook>;
  deleteNotebook: (id: string) => Promise<void>;
  openNotebook: (id: string) => Promise<void>;
  closeNotebook: () => Promise<void>;

  updateCell: (cellId: string, patch: Partial<Cell>) => void;
  setCells: (cells: Cell[]) => void;
  appendCells: (cells: Cell[]) => void;
  removeCell: (cellId: string) => void;

  saveNotebook: () => Promise<void>;
  renameNotebook: (name: string) => Promise<void>;

  ensureKernel: () => Promise<string>;
  runCell: (cellId: string) => Promise<void>;
  generateFromPrompt: (prompt: string) => Promise<void>;
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  notebooks: [],
  currentNotebookId: null,
  kernelSessionId: null,
  loading: false,
  generating: false,

  fetchNotebooks: async () => {
    set({ loading: true });
    try {
      const resp = await fetch(`${ONTOLOGY_API}/notebooks`, { headers: authHeaders() });
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>[];
        set({ notebooks: data.map(toNotebook) });
      }
    } finally {
      set({ loading: false });
    }
  },

  createNotebook: async (name = 'Untitled Notebook') => {
    const resp = await fetch(`${ONTOLOGY_API}/notebooks`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, description: '', cells: [] }),
    });
    if (!resp.ok) throw new Error(`Failed to create notebook: ${resp.status}`);
    const created = toNotebook((await resp.json()) as Record<string, unknown>);
    set((s) => ({ notebooks: [created, ...s.notebooks] }));
    return created;
  },

  deleteNotebook: async (id: string) => {
    const resp = await fetch(`${ONTOLOGY_API}/notebooks/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!resp.ok && resp.status !== 404) throw new Error(`Failed to delete notebook: ${resp.status}`);
    set((s) => ({
      notebooks: s.notebooks.filter((n) => n.id !== id),
      currentNotebookId: s.currentNotebookId === id ? null : s.currentNotebookId,
    }));
  },

  openNotebook: async (id: string) => {
    const resp = await fetch(`${ONTOLOGY_API}/notebooks/${id}`, { headers: authHeaders() });
    if (!resp.ok) throw new Error(`Failed to load notebook: ${resp.status}`);
    const nb = toNotebook((await resp.json()) as Record<string, unknown>);
    set((s) => ({
      notebooks: s.notebooks.some((n) => n.id === nb.id)
        ? s.notebooks.map((n) => (n.id === nb.id ? nb : n))
        : [nb, ...s.notebooks],
      currentNotebookId: nb.id,
    }));
  },

  closeNotebook: async () => {
    const { kernelSessionId } = get();
    if (kernelSessionId) {
      try {
        await fetch(`${KERNEL_API}/kernel/sessions/${kernelSessionId}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
      } catch {
        // ignore — kernel may already be gone
      }
    }
    set({ currentNotebookId: null, kernelSessionId: null });
  },

  updateCell: (cellId, patch) => {
    const id = get().currentNotebookId;
    if (!id) return;
    set((s) => ({
      notebooks: s.notebooks.map((n) =>
        n.id !== id ? n : { ...n, cells: n.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)) },
      ),
    }));
  },

  setCells: (cells) => {
    const id = get().currentNotebookId;
    if (!id) return;
    set((s) => ({
      notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, cells } : n)),
    }));
  },

  appendCells: (cells) => {
    const id = get().currentNotebookId;
    if (!id) return;
    set((s) => ({
      notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, cells: [...n.cells, ...cells] } : n)),
    }));
  },

  removeCell: (cellId) => {
    const id = get().currentNotebookId;
    if (!id) return;
    set((s) => ({
      notebooks: s.notebooks.map((n) =>
        n.id !== id ? n : { ...n, cells: n.cells.filter((c) => c.id !== cellId) },
      ),
    }));
  },

  saveNotebook: async () => {
    const id = get().currentNotebookId;
    if (!id) return;
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    await fetch(`${ONTOLOGY_API}/notebooks/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: nb.name, description: nb.description, cells: nb.cells }),
    });
  },

  renameNotebook: async (name) => {
    const id = get().currentNotebookId;
    if (!id) return;
    set((s) => ({
      notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, name } : n)),
    }));
    await get().saveNotebook();
  },

  ensureKernel: async () => {
    const existing = get().kernelSessionId;
    if (existing) return existing;
    const resp = await fetch(`${KERNEL_API}/kernel/sessions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
    if (!resp.ok) throw new Error(`Failed to start kernel: ${resp.status}`);
    const data = (await resp.json()) as { session_id: string };
    set({ kernelSessionId: data.session_id });
    return data.session_id;
  },

  runCell: async (cellId) => {
    const id = get().currentNotebookId;
    if (!id) return;
    const nb = get().notebooks.find((n) => n.id === id);
    const cell = nb?.cells.find((c) => c.id === cellId);
    if (!cell) return;
    if (cell.kind === 'markdown') return;

    get().updateCell(cellId, { running: true });
    try {
      const session = await get().ensureKernel();
      const resp = await fetch(`${KERNEL_API}/kernel/sessions/${session}/execute`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code: cell.source, timeout_sec: 60 }),
      });
      const data = (await resp.json()) as {
        status: 'ok' | 'error';
        outputs: { mime_type: string; data: unknown; stream?: string }[];
        error?: { ename: string; evalue: string; traceback: string[] };
      };
      get().updateCell(cellId, {
        running: false,
        output: {
          status: data.status,
          outputs: data.outputs ?? [],
          error: data.error,
          executed_at: new Date().toISOString(),
        },
      });
    } catch (e) {
      get().updateCell(cellId, {
        running: false,
        output: {
          status: 'error',
          outputs: [],
          error: { ename: 'NetworkError', evalue: String(e), traceback: [] },
          executed_at: new Date().toISOString(),
        },
      });
    }
    await get().saveNotebook();
  },

  generateFromPrompt: async (prompt: string) => {
    const id = get().currentNotebookId;
    if (!id) return;
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;

    set({ generating: true });
    try {
      const resp = await fetch(`${INFERENCE_API}/infer/workbench`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt, cells: nb.cells }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Generation failed (${resp.status}): ${err}`);
      }
      const data = (await resp.json()) as { cells: { id?: string; kind: string; source: string }[] };
      const newCells: Cell[] = (data.cells || []).map((c) => ({
        id: c.id || uid(),
        kind: (c.kind as Cell['kind']) || 'markdown',
        source: c.source || '',
      }));
      get().appendCells(newCells);

      // Execute each code cell in order.
      for (const c of newCells) {
        if (c.kind === 'python' || c.kind === 'sql') {
          await get().runCell(c.id);
        }
      }
      await get().saveNotebook();
    } finally {
      set({ generating: false });
    }
  },
}));

export const getCurrentNotebook = (): Notebook | undefined => {
  const s = useWorkbenchStore.getState();
  return s.notebooks.find((n) => n.id === s.currentNotebookId);
};
