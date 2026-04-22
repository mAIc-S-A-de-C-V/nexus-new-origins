import React, { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import type { CellOutput as CellOutputT } from '../../../types/notebook';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Plotly loader (singleton, lazy) ─────────────────────────────────────────
type PlotComponent = React.ComponentType<{
  data: unknown;
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  useResizeHandler?: boolean;
  style?: React.CSSProperties;
}>;

let _plotPromise: Promise<PlotComponent> | null = null;
async function loadPlot(): Promise<PlotComponent> {
  if (_plotPromise) return _plotPromise;
  _plotPromise = (async () => {
    const [{ default: createPlotlyComponent }, Plotly] = await Promise.all([
      import('react-plotly.js/factory'),
      import('plotly.js-dist-min'),
    ]);
    return createPlotlyComponent(Plotly as unknown as Parameters<typeof createPlotlyComponent>[0]) as PlotComponent;
  })();
  return _plotPromise;
}

const PlotlyBlock: React.FC<{ data: { data: unknown[]; layout?: Record<string, unknown> } }> = ({ data }) => {
  const [Plot, setPlot] = useState<PlotComponent | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    loadPlot().then((P) => { if (mountedRef.current) setPlot(() => P); });
    return () => { mountedRef.current = false; };
  }, []);

  if (!Plot) {
    return <div style={{ color: C.muted, fontSize: 12, padding: 12 }}>Loading chart…</div>;
  }

  return (
    <Plot
      data={data.data}
      layout={{
        autosize: true,
        margin: { l: 48, r: 16, t: 24, b: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'Inter, system-ui, sans-serif', size: 12, color: C.text },
        ...(data.layout as Record<string, unknown>),
      }}
      config={{ displaylogo: false, responsive: true }}
      useResizeHandler
      style={{ width: '100%', height: 420 }}
    />
  );
};

export const CellOutput: React.FC<{ output?: CellOutputT }> = ({ output }) => {
  if (!output) return null;

  if (output.status === 'error' && output.error) {
    return (
      <div style={{
        padding: 12, backgroundColor: '#FEF2F2', color: C.error, fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {output.error.ename}: {output.error.evalue}
        </div>
        {output.error.traceback?.length > 0 && (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#7F1D1D' }}>
            {stripAnsi(output.error.traceback.join('\n'))}
          </pre>
        )}
      </div>
    );
  }

  if (!output.outputs || output.outputs.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {output.outputs.map((o, i) => (
        <OutputBlock key={i} mimeType={o.mime_type} data={o.data} />
      ))}
    </div>
  );
};

const OutputBlock: React.FC<{ mimeType: string; data: unknown }> = ({ mimeType, data }) => {
  if (mimeType.startsWith('application/vnd.plotly.v1+json')) {
    return <PlotlyBlock data={data as { data: unknown[]; layout?: Record<string, unknown> }} />;
  }

  if (mimeType === 'image/png') {
    const src = typeof data === 'string' ? `data:image/png;base64,${data}` : '';
    return <img src={src} alt="cell output" style={{ maxWidth: '100%' }} />;
  }

  if (mimeType === 'image/jpeg') {
    const src = typeof data === 'string' ? `data:image/jpeg;base64,${data}` : '';
    return <img src={src} alt="cell output" style={{ maxWidth: '100%' }} />;
  }

  if (mimeType === 'image/svg+xml') {
    return <div dangerouslySetInnerHTML={{ __html: String(data) }} />;
  }

  if (mimeType === 'text/html') {
    return (
      <div
        className="workbench-html-output"
        style={{ overflowX: 'auto', fontSize: 12 }}
        dangerouslySetInnerHTML={{ __html: String(data) }}
      />
    );
  }

  if (mimeType === 'application/json') {
    return (
      <pre style={{ margin: 0, padding: 10, backgroundColor: '#F8FAFC', fontSize: 11, overflowX: 'auto' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <pre style={{
      margin: 0, padding: 10, backgroundColor: 'transparent', color: C.text,
      fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {stripAnsi(typeof data === 'string' ? data : JSON.stringify(data, null, 2))}
    </pre>
  );
};

export default CellOutput;
