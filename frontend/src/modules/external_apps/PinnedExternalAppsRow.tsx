/**
 * Row of "pinned" external apps at the top of the Dashboards section.
 *
 * Reads from `pinnedAppsStore` (per-tenant localStorage), fetches the install
 * + catalog list lazily so we have display names, and renders one card per
 * pinned install. Clicking a card navigates to /apps/external/<install_id>
 * (rendered by the existing ExternalAppsPage route).
 *
 * Renders nothing when no apps are pinned — keeps the Dashboards view clean
 * for tenants that haven't pinned anything.
 */
import React, { useEffect, useState } from 'react';
import { Home, ExternalLink } from 'lucide-react';
import { listInstalls, listCatalog } from './api';
import type { AppCatalogEntry, AppInstallEntry } from './types';
import { usePinnedAppsStore } from '../../store/pinnedAppsStore';
import { useNavigationStore } from '../../store/navigationStore';

const PURPLE = '#7C3AED';
const BORDER = '#E2E8F0';

const PinnedExternalAppsRow: React.FC = () => {
  const pinned = usePinnedAppsStore((s) => s.pinned);
  const home = usePinnedAppsStore((s) => s.home);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const [installs, setInstalls] = useState<AppInstallEntry[] | null>(null);
  const [catalog, setCatalog] = useState<AppCatalogEntry[]>([]);

  useEffect(() => {
    // Only fetch when something is pinned — saves a request on tenants that
    // never use this feature.
    if (pinned.length === 0 && !home) {
      setInstalls(null);
      return;
    }
    let cancelled = false;
    Promise.all([listInstalls(), listCatalog()]).then(([is, cs]) => {
      if (cancelled) return;
      setInstalls(is);
      setCatalog(cs);
    }).catch(() => {
      if (!cancelled) { setInstalls([]); setCatalog([]); }
    });
    return () => { cancelled = true; };
  }, [pinned.length, home]);

  if (pinned.length === 0 && !home) return null;
  if (installs == null) return null;

  // De-dupe — home install also shows in this row, prefixed/marked separately.
  const ids = Array.from(new Set([home, ...pinned].filter((x): x is string => Boolean(x))));
  const cards = ids.map((id) => {
    const install = installs.find((i) => i.id === id);
    if (!install) return null;
    const cat = catalog.find((c) => c.app_id === install.app_id);
    return { install, cat };
  }).filter(Boolean) as { install: AppInstallEntry; cat?: AppCatalogEntry }[];

  if (cards.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10, color: '#64748B',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        Pinned apps
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 12,
      }}>
        {cards.map(({ install, cat }) => {
          const isHomeCard = install.id === home;
          return (
            <button
              key={install.id}
              onClick={() => navigateTo('external-app:' + install.id)}
              style={{
                textAlign: 'left', cursor: 'pointer',
                background: '#fff',
                border: `1px solid ${isHomeCard ? PURPLE : BORDER}`,
                borderRadius: 8, padding: 14,
                display: 'flex', flexDirection: 'column', gap: 6,
                boxShadow: isHomeCard ? '0 0 0 3px #EDE9FE' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isHomeCard
                  ? <Home size={14} color={PURPLE} />
                  : <ExternalLink size={14} color="#64748B" />}
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0D1117', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat?.display_name || install.app_id}
                </div>
                {isHomeCard && (
                  <span style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 3,
                    background: PURPLE, color: '#fff', fontWeight: 700, letterSpacing: '0.04em',
                  }}>HOME</span>
                )}
              </div>
              {cat?.description && (
                <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {cat.description}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 'auto', fontFamily: 'ui-monospace,monospace' }}>
                {install.app_id} · v{install.version_pinned}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PinnedExternalAppsRow;
