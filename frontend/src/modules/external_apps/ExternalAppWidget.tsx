/**
 * Renders an external-app surface as a dashboard widget (used by AppEditor).
 *
 * Bound widget config:
 *   { install_id: string; surface_id?: string }
 *
 * The host iframe is the same one used on the standalone page — what differs
 * is the chrome (no nav, sized to fit a grid cell). Apps can detect they're
 * in a widget context via `nexus.ctx.config.__surface = "widget"` if the
 * tenant's admin sets that, but most apps don't need to.
 */
import React from 'react';
import ExternalApp from './ExternalApp';

interface Props {
  installId: string;
  height?: number;
}

const ExternalAppWidget: React.FC<Props> = ({ installId, height = 360 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: height }}>
    <ExternalApp installId={installId} height={height} />
  </div>
);

export default ExternalAppWidget;
