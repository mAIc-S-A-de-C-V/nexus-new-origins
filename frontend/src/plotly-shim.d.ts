// Minimal ambient declarations so we can import the plotly factory and the
// slim plotly bundle without pulling full @types/plotly.js (a 1MB dep tree)
// into this project. The Workbench CellOutput wraps these in typed React
// components at the call-site, so the lack of deep types here is harmless.

declare module 'react-plotly.js/factory' {
  import * as React from 'react';
  type Plotly = unknown;
  const createPlotlyComponent: (plotly: Plotly) => React.ComponentType<{
    data: unknown;
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
    frames?: unknown[];
    useResizeHandler?: boolean;
    style?: React.CSSProperties;
    className?: string;
    onInitialized?: (figure: unknown, el: HTMLElement) => void;
    onUpdate?: (figure: unknown, el: HTMLElement) => void;
    onError?: (err: Error) => void;
  }>;
  export default createPlotlyComponent;
}

declare module 'plotly.js-dist-min' {
  const Plotly: unknown;
  export default Plotly;
}
