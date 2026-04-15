export type FilterOperator =
  | 'eq' | 'neq'
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

export type ComponentType =
  | 'metric-card'
  | 'data-table'
  | 'bar-chart'
  | 'line-chart'
  | 'pie-chart'
  | 'area-chart'
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
}
