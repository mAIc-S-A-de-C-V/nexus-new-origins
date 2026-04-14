import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

export interface ObjectPanelContext {
  type: 'objectType' | 'pipeline' | 'agent' | 'connector';
  id: string;
  label?: string;
}

interface UiStore {
  theme: Theme;
  density: Density;
  commandPaletteOpen: boolean;
  shortcutsOverlayOpen: boolean;
  activeObjectPanel: ObjectPanelContext | null;

  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  toggleTheme: () => void;
  toggleDensity: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openShortcutsOverlay: () => void;
  closeShortcutsOverlay: () => void;
  openObjectPanel: (ctx: ObjectPanelContext) => void;
  closeObjectPanel: () => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      density: 'comfortable',
      commandPaletteOpen: false,
      shortcutsOverlayOpen: false,
      activeObjectPanel: null,

      setTheme: (t) => set({ theme: t }),
      setDensity: (d) => set({ density: d }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      toggleDensity: () => set((s) => ({ density: s.density === 'comfortable' ? 'compact' : 'comfortable' })),

      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),

      openShortcutsOverlay: () => set({ shortcutsOverlayOpen: true }),
      closeShortcutsOverlay: () => set({ shortcutsOverlayOpen: false }),

      openObjectPanel: (ctx) => set({ activeObjectPanel: ctx }),
      closeObjectPanel: () => set({ activeObjectPanel: null }),
    }),
    {
      name: 'nexus-ui-prefs',
      partialize: (state) => ({ theme: state.theme, density: state.density }),
    },
  ),
);
