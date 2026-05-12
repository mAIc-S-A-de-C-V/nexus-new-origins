/**
 * Per-tenant pinned + home external apps. Persisted to localStorage so
 * a user's choice survives reloads without a backend round-trip.
 *
 * Two pieces of state, both keyed by tenant_id:
 *   - home_install_id:    the install that renders instead of /apps on first
 *                         load after sign-in (one per tenant, last write wins)
 *   - pinned_install_ids: installs that appear as cards at the top of the
 *                         Dashboards section
 *
 * Storage shape (one localStorage key per tenant):
 *   nexus.pinnedApps.<tenant_id> -> { home: string|null, pinned: string[] }
 *
 * Future: lift to a backend table (e.g. tenant_app_preferences) if we need
 * cross-device or cross-user (admin-set) home. localStorage is fine for now.
 */
import { create } from 'zustand';

const KEY_PREFIX = 'nexus.pinnedApps.';

interface Stored {
  home: string | null;
  pinned: string[];
}

function readFor(tenantId: string): Stored {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + tenantId);
    if (!raw) return { home: null, pinned: [] };
    const parsed = JSON.parse(raw);
    return {
      home: typeof parsed.home === 'string' ? parsed.home : null,
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return { home: null, pinned: [] };
  }
}

function writeFor(tenantId: string, state: Stored) {
  try {
    localStorage.setItem(KEY_PREFIX + tenantId, JSON.stringify(state));
  } catch {
    // localStorage full / private mode — silently no-op, in-memory state stays.
  }
}

interface PinnedAppsState {
  // Active tenant whose state lives in memory. Setter pulls fresh from storage.
  tenantId: string | null;
  home: string | null;
  pinned: string[];

  setTenant: (tenantId: string) => void;
  isPinned: (installId: string) => boolean;
  isHome: (installId: string) => boolean;
  togglePinned: (installId: string) => void;
  setHome: (installId: string | null) => void;
  // Drop entries for installs that no longer exist (call after listInstalls).
  pruneAgainst: (knownInstallIds: string[]) => void;
}

export const usePinnedAppsStore = create<PinnedAppsState>((set, get) => ({
  tenantId: null,
  home: null,
  pinned: [],

  setTenant: (tenantId) => {
    if (get().tenantId === tenantId) return;
    const stored = readFor(tenantId);
    set({ tenantId, home: stored.home, pinned: stored.pinned });
  },

  isPinned: (installId) => get().pinned.includes(installId),
  isHome: (installId) => get().home === installId,

  togglePinned: (installId) => {
    const { tenantId, pinned } = get();
    if (!tenantId) return;
    const next = pinned.includes(installId)
      ? pinned.filter((x) => x !== installId)
      : [...pinned, installId];
    set({ pinned: next });
    writeFor(tenantId, { home: get().home, pinned: next });
  },

  setHome: (installId) => {
    const { tenantId } = get();
    if (!tenantId) return;
    set({ home: installId });
    writeFor(tenantId, { home: installId, pinned: get().pinned });
  },

  pruneAgainst: (known) => {
    const { tenantId, home, pinned } = get();
    if (!tenantId) return;
    const keep = new Set(known);
    const nextPinned = pinned.filter((x) => keep.has(x));
    const nextHome = home && keep.has(home) ? home : null;
    if (nextPinned.length === pinned.length && nextHome === home) return;
    set({ pinned: nextPinned, home: nextHome });
    writeFor(tenantId, { home: nextHome, pinned: nextPinned });
  },
}));
