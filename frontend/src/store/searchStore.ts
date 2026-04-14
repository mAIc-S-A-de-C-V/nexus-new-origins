import { create } from 'zustand';
import { getTenantId } from './authStore';

const SEARCH_API = import.meta.env.VITE_SEARCH_SERVICE_URL || 'http://localhost:8018';

export interface SearchResult {
  type: 'object_type' | 'pipeline' | 'connector' | 'agent' | 'logic' | 'dashboard' | 'record';
  id: string;
  title: string;
  subtitle: string;
  path: string;
  score: number;
}

interface SearchState {
  isOpen: boolean;
  query: string;
  results: SearchResult[];
  loading: boolean;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  search: (q: string) => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  isOpen: false,
  query: '',
  results: [],
  loading: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: '', results: [] }),
  setQuery: (q) => set({ query: q }),
  clear: () => set({ query: '', results: [] }),

  search: async (q: string) => {
    if (!q.trim()) {
      set({ results: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const res = await fetch(`${SEARCH_API}/search?q=${encodeURIComponent(q)}&limit=20`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (res.ok) {
        const data = await res.json();
        set({ results: data, loading: false });
      } else {
        set({ results: [], loading: false });
      }
    } catch {
      set({ results: [], loading: false });
    }
  },
}));
