/**
 * <ExternalAppObjectActions object_type record /> renders one menu item per
 * surface where { type: "object_action", object_type: <this type> }.
 *
 * Clicking opens a side-sheet that mounts the app's iframe with the record's
 * id passed via config so the app can deep-link into the right view.
 *
 * Embed wherever your record action menus live:
 *
 *     <RecordMenu>
 *       <CoreActions />
 *       <ExternalAppObjectActions object_type={ot.name} record={r} />
 *     </RecordMenu>
 */
import React, { useEffect, useState } from 'react';
import ExternalApp from './ExternalApp';
import { tenantSurfaces } from './api';
import type { TenantSurface } from './types';

interface Props {
  object_type: string;
  record: { id: string; [k: string]: unknown };
}

const ExternalAppObjectActions: React.FC<Props> = ({ object_type, record }) => {
  const [surfaces, setSurfaces] = useState<TenantSurface[]>([]);
  const [open, setOpen] = useState<TenantSurface | null>(null);

  useEffect(() => { tenantSurfaces().then(setSurfaces).catch(() => setSurfaces([])); }, []);

  const items = surfaces.filter((s) => s.surface.type === 'object_action' && s.surface.object_type === object_type);
  if (items.length === 0) return null;

  return (
    <>
      {items.map((s) => (
        <button
          key={s.install_id + ':' + (s.surface as any).label}
          onClick={() => setOpen(s)}
          style={{ padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', textAlign: 'left', width: '100%', cursor: 'pointer' }}
        >
          {(s.surface as any).label || s.display_name}
        </button>
      ))}
      {open && (
        <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(560px, 60vw)', background: '#fff', borderLeft: '1px solid #E2E8F0', boxShadow: '-8px 0 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', zIndex: 200 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{(open.surface as any).label || open.display_name}</div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: '#64748B' }}>record: {record.id}</div>
            <button onClick={() => setOpen(null)} style={{ marginLeft: 12, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <ExternalApp installId={open.install_id} height="auto" onClose={() => setOpen(null)} />
          </div>
        </div>
      )}
    </>
  );
};

export default ExternalAppObjectActions;
