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
      { key: 'batchSize', label: 'Batch Size', type: 'number', default: 100 },
      { key: 'incrementalKey', label: 'Incremental Key', type: 'text', placeholder: 'updated_at' },
    ],
  },
  {
    type: 'FILTER',
    label: 'Filter',
    description: 'Filter rows based on conditions',
    color: '#7C3AED',
    iconName: 'Filter',
    configFields: [
      { key: 'expression', label: 'Filter Expression', type: 'code', placeholder: 'row.status == "active"' },
      { key: 'dropOnFail', label: 'Drop on Fail', type: 'boolean', default: true },
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
    description: 'Add data from another source',
    color: '#D97706',
    iconName: 'Sparkles',
    configFields: [
      { key: 'lookupConnectorId', label: 'Lookup Connector', type: 'select', options: [] },
      { key: 'joinKey', label: 'Join Key', type: 'text', placeholder: 'customer_id' },
      { key: 'lookupEndpoint', label: 'Lookup Endpoint', type: 'text' },
      { key: 'fields', label: 'Fields to Add', type: 'textarea' },
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
    description: 'Write to an Object Type in the ontology',
    color: '#1A3C6E',
    iconName: 'Database',
    configFields: [
      { key: 'objectTypeId', label: 'Target Object Type', type: 'select', options: [], required: true },
      { key: 'writeMode', label: 'Write Mode', type: 'select', options: ['upsert', 'insert', 'replace'] },
      { key: 'mergeKey', label: 'Merge Key', type: 'text' },
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
];
