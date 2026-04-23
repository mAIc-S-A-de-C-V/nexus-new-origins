import { NodeType } from '../../types/pipeline';

export interface NodeTypeDefinition {
  type: NodeType;
  label: string;
  description: string;
  color: string;
  iconName: string;
  configFields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'multiselect' | 'number' | 'boolean' | 'code' | 'textarea';
  placeholder?: string;
  options?: string[];
  required?: boolean;
  default?: unknown;
}

export const NODE_TYPE_DEFS: NodeTypeDefinition[] = [
  {
    type: 'SOURCE',
    label: 'Source',
    description: 'Pull data from a connector',
    color: '#1A3C6E',
    iconName: 'Plug',
    configFields: [
      { key: 'connectorId', label: 'Connector', type: 'select', options: [], required: true },
      { key: 'pollFrequency', label: 'Sync Frequency', type: 'select', required: true, default: '1h', options: ['on_demand', '5m', '15m', '30m', '1h', '6h', '12h', '1d'] },
      { key: 'endpoint', label: 'Endpoint / Table', type: 'text', placeholder: '/api/contacts' },
      { key: 'method', label: 'HTTP Method', type: 'select', default: 'GET', options: ['GET', 'POST', 'PUT'] },
      { key: 'batchSize', label: 'Batch Size', type: 'number', default: 100 },
      { key: 'incrementalKey', label: 'Incremental Key', type: 'text', placeholder: 'updated_at' },
      { key: 'records_path', label: 'Records Path (optional)', type: 'text', placeholder: 'data.items' },
      { key: 'dict_unwrap_path', label: 'Dict Unwrap Path (optional)', type: 'text', placeholder: 'sensors' },
      { key: 'group_key_field', label: 'Group Key Field Name', type: 'text', placeholder: 'sensor_name', default: 'group_key' },
    ],
  },
  {
    type: 'FILTER',
    label: 'Filter',
    description: 'Keep only rows that match a condition',
    color: '#7C3AED',
    iconName: 'Filter',
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'status', required: true },
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: ['exists', 'not_null', 'eq', 'neq', 'contains', 'not_contains', 'gt', 'lt', 'gte', 'lte', 'is_null'] },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'active' },
    ],
  },
  {
    type: 'MAP',
    label: 'Map',
    description: 'Transform and rename fields',
    color: '#0891B2',
    iconName: 'ArrowRightLeft',
    configFields: [
      { key: 'mappings', label: 'Field Mappings', type: 'code', placeholder: '{\n  "source_field": "target_field"\n}' },
    ],
  },
  {
    type: 'CAST',
    label: 'Cast',
    description: 'Cast field types',
    color: '#059669',
    iconName: 'Repeat',
    configFields: [
      { key: 'casts', label: 'Type Casts', type: 'code', placeholder: '{\n  "amount": "float",\n  "created_at": "datetime"\n}' },
      { key: 'locale', label: 'Locale', type: 'text', default: 'en_US' },
    ],
  },
  {
    type: 'ENRICH',
    label: 'Enrich',
    description: 'Per-row detail lookup — for each incoming row, call a second connector using a field value as the lookup key and merge the full response back onto the row.',
    color: '#D97706',
    iconName: 'Sparkles',
    configFields: [
      { key: 'lookupConnectorId', label: 'Detail Connector', type: 'select', options: [], required: true },
      { key: 'joinKey', label: 'Join Key (field on incoming row)', type: 'text', placeholder: 'id', required: true },
      { key: 'lookupField', label: 'Lookup Param (query param on detail endpoint)', type: 'text', placeholder: 'id' },
    ],
  },
  {
    type: 'FLATTEN',
    label: 'Flatten',
    description: 'Flatten nested JSON structures',
    color: '#DC2626',
    iconName: 'Layers',
    configFields: [
      { key: 'path', label: 'Nested Path', type: 'text', placeholder: 'data.items' },
      { key: 'prefix', label: 'Field Prefix', type: 'text', placeholder: 'item_' },
      { key: 'separator', label: 'Separator', type: 'text', default: '_' },
    ],
  },
  {
    type: 'DEDUPE',
    label: 'Dedupe',
    description: 'Remove duplicate records',
    color: '#64748B',
    iconName: 'Copy',
    configFields: [
      { key: 'keys', label: 'Dedupe Keys', type: 'textarea', placeholder: 'email\ncustomer_id' },
      { key: 'strategy', label: 'Strategy', type: 'select', options: ['keep_first', 'keep_last', 'keep_highest'] },
      { key: 'orderBy', label: 'Order By Field', type: 'text' },
    ],
  },
  {
    type: 'VALIDATE',
    label: 'Validate',
    description: 'Validate records against rules',
    color: '#0D9488',
    iconName: 'ShieldCheck',
    configFields: [
      { key: 'rules', label: 'Validation Rules', type: 'code', placeholder: '[\n  { "field": "email", "rule": "is_email" }\n]' },
      { key: 'failMode', label: 'On Failure', type: 'select', options: ['drop', 'quarantine', 'tag'] },
    ],
  },
  {
    type: 'SINK_OBJECT',
    label: 'Sink: Object Type',
    description: 'Write transformed records to an Object Type in the ontology. Schema is inferred and properties are added automatically on first run.',
    color: '#1A3C6E',
    iconName: 'Database',
    configFields: [
      { key: 'objectTypeId', label: 'Target Object Type', type: 'select', options: [], required: true },
      { key: 'writeMode', label: 'Write Mode', type: 'select', options: ['upsert', 'insert', 'replace'], default: 'upsert' },
      { key: 'mergeKey', label: 'Merge / Match Key', type: 'text', placeholder: 'e.g. borrower_id — field used to match existing records' },
      { key: 'onConflict', label: 'On Conflict', type: 'select', options: ['overwrite', 'preserve', 'skip'], default: 'overwrite' },
    ],
  },
  {
    type: 'SINK_EVENT',
    label: 'Sink: Event Log',
    description: 'Write to the process mining event log',
    color: '#059669',
    iconName: 'Activity',
    configFields: [
      { key: 'activityField', label: 'Activity Field', type: 'text', required: true },
      { key: 'caseIdField', label: 'Case ID Field', type: 'text', required: true },
      { key: 'timestampField', label: 'Timestamp Field', type: 'text', required: true },
      { key: 'objectTypeId', label: 'Object Type', type: 'select', options: [] },
    ],
  },
  {
    type: 'AGENT_RUN',
    label: 'Agent Run',
    description: 'Fire an AI agent with the records just written. The agent analyzes them and can propose actions (urgency alerts, escalations, etc.) that appear in the Human Actions queue — no polling, no cron.',
    color: '#7C3AED',
    iconName: 'Bot',
    configFields: [
      { key: 'agentId', label: 'Agent', type: 'select', options: [], required: true },
      { key: 'prompt', label: 'Instructions', type: 'textarea', placeholder: 'e.g. Analyze these records and flag any that are urgent, fraudulent, or require escalation.' },
      { key: 'batchSize', label: 'Max Records per Run', type: 'number', default: 50 },
      { key: 'runAlways', label: 'Run even when no new records', type: 'boolean', default: false },
    ],
  },
  {
    type: 'LLM_CLASSIFY',
    label: 'LLM Classify',
    description: 'Send each record through Claude to extract structured fields — classification, priority, entities, summaries. Includes built-in PNC (El Salvador police) report classification. Creates Human Actions for critical/urgent items.',
    color: '#DC2626',
    iconName: 'Brain',
    configFields: [
      { key: 'textField', label: 'Text Field', type: 'text', placeholder: 'text', required: true, default: 'text' },
      { key: 'prompt', label: 'System Prompt (leave empty for PNC default)', type: 'textarea', placeholder: 'Custom classification prompt... Leave empty to use built-in PNC police report classifier.' },
      { key: 'model', label: 'Model', type: 'select', options: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'], default: 'claude-haiku-4-5-20251001' },
      { key: 'batchSize', label: 'Messages per LLM Call', type: 'number', default: 5 },
      { key: 'createActions', label: 'Create Actions for CRITICO/URGENTE', type: 'boolean', default: true },
    ],
  },
];
