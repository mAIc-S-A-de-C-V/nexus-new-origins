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

export type ComponentType =
  | 'metric-card'
  | 'data-table'
  | 'bar-chart'
  | 'line-chart'
  | 'kpi-banner'
  | 'text-block'
  | 'filter-bar'
  | 'chat-widget';

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
  // text-block
  content?: string;
  // filter-bar
  filterField?: string;
  // filters applied before rendering
  filters?: AppFilter[];
  // layout (react-grid-layout)
  colSpan?: number; // grid x-width  1-12
  gridX?: number;   // grid x position
  gridY?: number;   // grid y position
  gridH?: number;   // grid height in rows (1 row = 60px)
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
}
