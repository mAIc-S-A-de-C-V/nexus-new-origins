import { create } from 'zustand';
import { Pipeline } from '../types/pipeline';

interface NavigationStore {
  currentPage: string;
  pendingPipeline: Partial<Pipeline> | null;
  navigateTo: (page: string, pendingPipeline?: Partial<Pipeline>) => void;
  consumePendingPipeline: () => Partial<Pipeline> | null;
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentPage: 'connectors',
  pendingPipeline: null,

  navigateTo: (page, pendingPipeline) => {
    set({ currentPage: page, pendingPipeline: pendingPipeline ?? null });
  },

  consumePendingPipeline: () => {
    const { pendingPipeline } = get();
    set({ pendingPipeline: null });
    return pendingPipeline;
  },
}));
