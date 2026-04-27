export type FilterOperator =
  | 'eq' | 'neq'
  | 'in' | 'not_in'
  | 'contains' | 'not_contains'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'after' | 'before'
  | 'is_empty' | 'is_not_empty';

export interface AppFilter {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

// ── Variable & Event system ──────────────────────────────────────────────

export interface AppVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'dateRange' | 'stringArray' | 'objectRef' | 'objectSet';
  defaultValue: any;
}

export interface AppEventAction {
  type: 'setVariable' | 'refreshWidget';
  variableId?: string;
  valueFrom?: string;
  targetWidgetId?: string;
}

export interface AppEvent {
  id: string;
  sourceWidgetId: string;
  trigger: 'onClick' | 'onBarClick' | 'onRowSelect' | 'onChange' | 'onSubmit' | 'onDateChange';
  actions: AppEventAction[];
}

// Time-range presets shared by widget xAxisRange and the dashboard filter bar.
export type RangePreset =
  | 'last_15m' | 'last_1h' | 'last_4h' | 'last_24h' | 'last_7d'
  | 'last_30d' | 'last_90d' | 'last_year' | 'today' | 'yesterday'
  | 'this_week' | 'this_month' | 'all_time' | 'custom';

// Dashboard-level filter bar. When enabled, a row of controls renders at the
// top of the canvas (range, custom dates, group multi-select) and every
// inheriting widget's queries are scoped accordingly. Per-widget overrides
// remain possible via inheritDashboardFilter=false.
export interface DashboardFilterBar {
  enabled: boolean;
  // Field name to scope the time range against (e.g. 'time', 'created_at').
  timeField?: string;
  defaultRange?: RangePreset;
  customStart?: string;
  customEnd?: string;
  // Optional categorical filter — typically the EAV `sensor_name` column.
  // When set with a non-empty groupValues, every inheriting widget gets
  // `<groupField> IN [...]` appended to its filters.
  groupField?: string;
  groupValues?: string[];
}

export type ComponentType =
  | 'metric-card'
  | 'data-table'
  | 'bar-chart'
  | 'line-chart'
  | 'pie-chart'
  | 'area-chart'
  | 'pivot-table'
  | 'stat-card'
  | 'date-picker'
  | 'kpi-banner'
  | 'text-block'
  | 'filter-bar'
  | 'chat-widget'
  | 'custom-code'
  | 'map'
  | 'utility-output'
  | 'dropdown-filter'
  | 'form'
  | 'object-table';

export interface AppComponent {
  id: string;
  type: ComponentType;
  title: string;
  objectTypeId?: string;
  objectTypeIds?: string[];     // chat-widget: multiple data sources
  widgetSourceIds?: string[];   // chat-widget: sibling widget IDs as context
  // metric-card / kpi-banner
  field?: string;
  aggregation?: 'count' | 'sum' | 'avg' | 'max' | 'min';
  // data-table
  columns?: string[];
  maxRows?: number;
  // bar-chart / line-chart
  labelField?: string;
  valueField?: string;
  xField?: string; // line-chart x-axis (date/time field)
  // Time bucket for line/area charts. If unset, defaults to 'month' (or 'week' in count mode).
  timeBucket?:
    | 'second' | '5_seconds' | '15_seconds' | '30_seconds'
    | 'minute' | '5_minutes' | '15_minutes' | '30_minutes'
    | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  // Relative time-range preset for the x-axis. When set, the chart auto-adds
  // a filter on `xField` covering this window. Saves the user from typing
  // ISO timestamps. 'all_time' / undefined = no filter applied.
  xAxisRange?: RangePreset;
  // When true (default), the widget uses the dashboard-level filter bar's
  // time range / time field / group filter instead of its own xAxisRange.
  // Set to false to opt out — useful when one widget needs a different
  // window than the rest of the dashboard (e.g. a "30-day baseline" tile
  // alongside several "today" tiles).
  inheritDashboardFilter?: boolean;
  // Custom date range used when xAxisRange === 'custom'. ISO timestamps.
  xAxisCustomStart?: string;
  xAxisCustomEnd?: string;
  // Numeric value transform — applied at render time to every aggregated
  // number this widget displays (cells, axis labels, tooltips).
  //   displayed = (raw * valueMultiplier).toFixed(valueDecimals) + valueUnit
  // Examples: seconds → hours uses multiplier 1/3600 and unit ' h'.
  valueMultiplier?: number;
  valueDecimals?: number;
  valueUnit?: string;
  // When 'custom', the editor's preset dropdown sticks on Custom even if
  // the underlying values happen to match a named preset. Without this
  // flag, picking Custom while the values still equal e.g. (1/3600, ' h')
  // would auto-detect back to 'sec_to_hr' and the dropdown would jump.
  valueFormatPreset?: 'custom';
  // Server-side pagination page size for data-table. Default 50.
  pageSize?: number;
  // map
  latField?: string;
  lngField?: string;
  // utility-output
  utility_id?: string;
  utility_inputs?: string;
  display_field?: string;
  // text-block
  content?: string;
  // filter-bar
  filterField?: string;
  // custom-code
  code?: string;
  // stat-card
  comparisonField?: string; // date field for period comparison
  // filters applied before rendering
  filters?: AppFilter[];
  // layout (react-grid-layout)
  colSpan?: number; // grid x-width  1-12
  gridX?: number;   // grid x position
  gridY?: number;   // grid y position
  gridH?: number;   // grid height in rows (1 row = 60px)
  // variable bindings
  inputBindings?: Record<string, string>;   // widgetProp -> variableId
  outputBindings?: Record<string, string>;  // triggerName -> variableId
  // dropdown-filter config
  variableId?: string;
  options?: string[];
  // form config
  fields?: { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'textarea' }[];
  actionName?: string;
  // object-table config (reuses objectTypeId, columns)
}

export interface NexusApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  components: AppComponent[];
  objectTypeIds: string[];
  createdAt: string;
  updatedAt: string;
  syncInterval?: string;
  variables?: AppVariable[];
  events?: AppEvent[];
  filterBar?: DashboardFilterBar;
}
