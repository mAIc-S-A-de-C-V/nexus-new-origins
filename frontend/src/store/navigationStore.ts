import { create } from 'zustand';
import { Pipeline } from '../types/pipeline';

export interface BreadcrumbItem {
  label: string;
  page?: string;
  icon?: string;
}

interface NavigationStore {
  currentPage: string;
  pendingPipeline: Partial<Pipeline> | null;
  breadcrumbs: BreadcrumbItem[];
  navigateTo: (page: string, pendingPipeline?: Partial<Pipeline>) => void;
  consumePendingPipeline: () => Partial<Pipeline> | null;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentPage: 'apps',
  pendingPipeline: null,
  breadcrumbs: [],

  navigateTo: (page, pendingPipeline) => {
    set({ currentPage: page, pendingPipeline: pendingPipeline ?? null, breadcrumbs: [] });
  },

  consumePendingPipeline: () => {
    const { pendingPipeline } = get();
    set({ pendingPipeline: null });
    return pendingPipeline;
  },

  setBreadcrumbs: (items) => {
    set({ breadcrumbs: items });
  },
}));
