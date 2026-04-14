import { create } from 'zustand';

export interface ShortcutDefinition {
  id: string;
  keys: string[];       // e.g. ['meta', 'k'] or ['?']
  display: string;      // e.g. '⌘K' or '?'
  label: string;
  category: 'navigation' | 'action' | 'view';
  handler: () => void;
}

interface ShortcutStore {
  shortcuts: ShortcutDefinition[];
  register: (s: ShortcutDefinition) => void;
  unregister: (id: string) => void;
}

export const useShortcutStore = create<ShortcutStore>((set) => ({
  shortcuts: [],

  register: (s) =>
    set((state) => ({
      shortcuts: [...state.shortcuts.filter((x) => x.id !== s.id), s],
    })),

  unregister: (id) =>
    set((state) => ({
      shortcuts: state.shortcuts.filter((x) => x.id !== id),
    })),
}));
