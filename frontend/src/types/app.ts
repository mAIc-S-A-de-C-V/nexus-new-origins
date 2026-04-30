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

// Drill-down context binding — maps a value from the click event to a
// variable or filter in the target dashboard. `sourceFrom` says where the
// value comes from in the click payload; `apply` says what to do with it.
export interface ContextBinding {
  sourceFrom: 'clickedValue' | 'clickedField' | 'clickedRow' | 'rowField' | 'literal';
  rowField?: string;            // when sourceFrom='rowField'
  literal?: string;             // when sourceFrom='literal'
  apply: 'setVariable' | 'addFilter';
  targetVariableId?: string;    // when apply='setVariable'
  filterField?: string;         // when apply='addFilter'
  filterOp?: 'eq' | 'neq' | 'in';
}

export type DrillDisplayMode = 'replace' | 'modal' | 'sidepanel';

export interface AppEventAction {
  type:
    | 'setVariable'
    | 'refreshWidget'
    // Phase D — saved drill target.
    | 'openDashboard'
    | 'openDashboardModal'
    // Phase E — LLM-generated drill target.
    | 'generateDashboard'
    // Phase H — fire a typed action against the ontology.
    | 'runAction';
  variableId?: string;
  valueFrom?: string;
  targetWidgetId?: string;
  // Drill-down fields:
  targetDashboardId?: string;
  generatePromptTemplate?: string;
  generateObjectTypeIds?: string[];
  contextBindings?: ContextBinding[];
  displayMode?: DrillDisplayMode;
  // runAction:
  actionId?: string;
}

export interface AppEvent {
  id: string;
  sourceWidgetId: string;
  trigger:
    | 'onClick'
    | 'onBarClick'
    | 'onRowSelect'
    | 'onRowClick'
    | 'onCellClick'
    | 'onKpiClick'
    | 'onChange'
    | 'onSubmit'
    | 'onDateChange';
  actions: AppEventAction[];
}

// ── Action layer (Phase H) ──────────────────────────────────────────────
// Typed mutations declared at the dashboard level. Form/action-button/etc.
// widgets reference an action by id; the action knows how to translate its
// inputs into an ontology mutation (or webhook/utility/workflow call).

export type ActionKind =
  | 'createObject'
  | 'updateObject'
  | 'deleteObject'
  | 'callUtility'
  | 'runWorkflow'
  | 'webhook';

export interface ActionFieldMapping {
  formField: string;           // input name from the calling widget
  targetProperty: string;      // ontology property name (or workflow input)
  transform?: 'asNumber' | 'asDate' | 'asUuid' | 'literal';
  literalValue?: string;
}

export interface ActionValidationRule {
  field: string;
  rule: 'required' | 'regex' | 'min' | 'max';
  value?: string;
  message?: string;
}

export interface AppAction {
  id: string;
  name: string;
  kind: ActionKind;
  // Object mutations (createObject / updateObject / deleteObject):
  objectTypeId?: string;
  fieldMappings?: ActionFieldMapping[];
  recordIdSource?: 'formField' | 'variable' | 'selectedRow';
  recordIdField?: string;
  // callUtility:
  utilityId?: string;
  // runWorkflow:
  workflowId?: string;
  // webhook:
  webhookUrl?: string;
  webhookMethod?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // Pre-flight:
  validations?: ActionValidationRule[];
  confirmation?: { title: string; body: string };
  // Post-flight:
  onSuccess?: AppEventAction;
  onError?: AppEventAction;
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
  | 'object-table'
  // Composite — recursive container holding child widgets in a nested grid.
  | 'composite'
  // Action widgets (Phase I) — interactive widgets that mutate the ontology
  // via the AppAction layer rather than rendering data.
  | 'action-button'
  | 'object-editor'
  | 'record-creator'
  | 'approval-queue';

// Composite layout templates. Sugar over the inner 12-col grid — sets
// sensible colSpan defaults on children when they don't specify one.
export type CompositeLayout = 'grid' | 'banner-main' | 'hero-sidebar' | 'split';

export interface AppComponent {
  id: string;
  type: ComponentType;
  title: string;
  objectTypeId?: string;
  objectTypeIds?: string[];     // chat-widget: multiple data sources
  widgetSourceIds?: string[];   // chat-widget: sibling widget IDs as context
  // metric-card / kpi-banner
  field?: string;
  aggregation?: 'count' | 'sum' | 'avg' | 'max' | 'min' | 'runtime';
  tsField?: string; // timestamp field for runtime aggregation
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
  // form config — `options` only used when type === 'select'
  fields?: { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'textarea' | 'select' | 'date'; options?: string[] }[];
  actionName?: string;
  // Phase H — typed action reference (replaces actionName when set).
  // The widget resolves this against NexusApp.actions[] to find an AppAction.
  actionId?: string;
  // Phase H — for object-editor: which record to edit (id source).
  recordIdSource?: 'variable' | 'literal' | 'crossFilter';
  recordIdValue?: string;
  // Phase I — record-creator wizard step config.
  steps?: Array<{ title: string; fields: string[] }>;
  // Phase I — approval-queue config.
  approveActionId?: string;
  rejectActionId?: string;
  // object-table config (reuses objectTypeId, columns)

  // ── Composite widget ──────────────────────────────────────────────────
  // Recursive container — children render through the same WidgetRenderer
  // inside a nested 12-col grid. Inheritance flags propagate the composite's
  // objectTypeId / filters down to children that don't set their own.
  children?: AppComponent[];
  innerGridCols?: number;          // default 12
  cardLayout?: CompositeLayout;    // default 'grid'
  cardStyle?: {
    background?: string;
    border?: string;
    padding?: number;
    titleStyle?: 'bold' | 'subtle' | 'hidden';
  };
  shareDataSource?: boolean;       // children inherit objectTypeId
  shareFilters?: boolean;          // children inherit filters

  // ── Drill-down (Phase D/F) ────────────────────────────────────────────
  // Configured per-widget via the editor; the renderer resolves matching
  // AppEvent rows on the dashboard and dispatches them when widgets fire
  // their click events. Stored both on the widget (for editor convenience)
  // and on NexusApp.events[] (for the runtime dispatcher).
  drillEnabled?: boolean;
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
  // Phase G — distinguishes read-only viz dashboards from interactive
  // input/action apps. List pages filter by this; editor surfaces a
  // kind-aware widget palette. Defaults to 'dashboard' for migration.
  kind?: 'dashboard' | 'app';
  // Phase H — typed action declarations. Form / action-button / etc.
  // widgets reference these by id.
  actions?: AppAction[];
  // Phase E — generated dashboards persist with an expiry; user can
  // promote them via "Save permanently".
  isEphemeral?: boolean;
  parentAppId?: string;
  generatedFromWidgetId?: string;
  expiresAt?: string;
  // Phase J — system-managed dashboards (the home pages) can't be deleted.
  isSystem?: boolean;
  slug?: string;
}
