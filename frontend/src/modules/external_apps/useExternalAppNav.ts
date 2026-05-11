/**
 * Hook for NavRail / AppShell to surface "page" external apps in the side nav.
 *
 * Returns one entry per installed enabled app whose manifest has a "page" surface.
 */
import { useEffect, useState } from 'react';
import { tenantSurfaces } from './api';
import type { TenantSurface } from './types';

export interface ExternalAppNavEntry {
  install_id: string;
  app_id: string;
  title: string;
  icon?: string;
  path: string;            // routes to /apps/external/<install_id>
}

export function useExternalAppNav() {
  const [entries, setEntries] = useState<ExternalAppNavEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    tenantSurfaces()
      .then((surfaces) => {
        if (!mounted) return;
        const pages: ExternalAppNavEntry[] = [];
        for (const s of surfaces) {
          if (s.surface.type !== 'page') continue;
          pages.push({
            install_id: s.install_id,
            app_id: s.app_id,
            title: (s.surface.title as string) || s.display_name,
            icon: s.icon || (s.surface as { icon?: string }).icon,
            path: `/apps/external/${s.install_id}`,
          });
        }
        setEntries(pages);
      })
      .catch(() => setEntries([]))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  return { entries, loading };
}
