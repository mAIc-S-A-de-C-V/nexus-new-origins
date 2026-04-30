import { create } from 'zustand';
import { NexusApp, AppFilter } from '../types/app';

// Each entry on the stack represents one "view" — either a saved dashboard
// (loaded by id) or an ephemeral generated dashboard. The renderer reads
// `app` from the top entry and passes it to AppCanvas.
export interface DashboardStackEntry {
  dashboardId: string;
  source: 'saved' | 'generated';
  ephemeralApp?: NexusApp;
  initialContext: {
    variables: Record<string, unknown>;
    addedFilters: Array<{ widgetId?: string; filter: AppFilter }>;
  };
  triggeredFrom?: { dashboardId: string; widgetId: string; label: string };
  displayMode: 'replace' | 'modal' | 'sidepanel';
  // For breadcrumb display.
  title: string;
}

const MAX_DEPTH = 6;

interface DashboardStackStore {
  stack: DashboardStackEntry[];
  push: (entry: DashboardStackEntry) => void;
  pop: () => void;
  jumpTo: (index: number) => void;
  clear: () => void;
  // True when push would exceed depth — caller should toast a warning.
  wouldOverflow: () => boolean;
}

export const useDashboardStackStore = create<DashboardStackStore>((set, get) => ({
  stack: [],
  push: (entry) => set((s) => {
    if (s.stack.length >= MAX_DEPTH) return s;
    // Cycle guard — if the top entry is already this same dashboard, swap
    // its initialContext rather than stacking another copy.
    const top = s.stack[s.stack.length - 1];
    if (top && top.dashboardId === entry.dashboardId && top.source === entry.source) {
      const next = [...s.stack];
      next[next.length - 1] = entry;
      return { stack: next };
    }
    return { stack: [...s.stack, entry] };
  }),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  jumpTo: (index) => set((s) => ({ stack: s.stack.slice(0, index + 1) })),
  clear: () => set({ stack: [] }),
  wouldOverflow: () => get().stack.length >= MAX_DEPTH,
}));
