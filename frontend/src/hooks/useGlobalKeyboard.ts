import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { useShortcutStore } from '../store/shortcutStore';

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useGlobalKeyboard() {
  const { openCommandPalette, closeCommandPalette, commandPaletteOpen, closeShortcutsOverlay, shortcutsOverlayOpen, closeObjectPanel } = useUiStore();
  const { shortcuts } = useShortcutStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+K — command palette
      if (isMeta && e.key === 'k') {
        e.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
        return;
      }

      // Escape — close everything
      if (e.key === 'Escape') {
        if (commandPaletteOpen) { closeCommandPalette(); return; }
        if (shortcutsOverlayOpen) { closeShortcutsOverlay(); return; }
        closeObjectPanel();
        return;
      }

      // Delegate to registered shortcuts
      for (const shortcut of shortcuts) {
        const hasMeta = shortcut.keys.includes('meta') || shortcut.keys.includes('ctrl');
        const hasShift = shortcut.keys.includes('shift');
        const mainKey = shortcut.keys.find((k) => k !== 'meta' && k !== 'ctrl' && k !== 'shift');

        if (!mainKey) continue;
        if (hasMeta && !isMeta) continue;
        if (hasShift && !e.shiftKey) continue;
        if (!hasMeta && isMeta) continue;

        if (e.key.toLowerCase() === mainKey.toLowerCase() || e.key === mainKey) {
          if (!isInputFocused() || hasMeta) {
            e.preventDefault();
            shortcut.handler();
            return;
          }
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, shortcutsOverlayOpen, shortcuts]);
}
