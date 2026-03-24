import { ConnectorCategory } from '../../types/connector';

export interface ConnectorTypeDefinition {
  type: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  iconName: string;
  color: string;
}

export const CONNECTOR_TYPES: ConnectorTypeDefinition[] = [
  {
    type: 'REST_API',
    displayName: 'REST API',
    description: 'Connect to any REST API endpoint with full auth support',
    category: 'REST',
    iconName: 'Globe',
    color: '#1D4ED8',
  },
  {
    type: 'GRAPHQL_API',
    displayName: 'GraphQL API',
    description: 'Query GraphQL endpoints with schema introspection',
    category: 'GraphQL',
    iconName: 'Code2',
    color: '#6D28D9',
  },
  {
    type: 'WEBSOCKET',
    displayName: 'WebSocket',
    description: 'Real-time streaming data via WebSocket connections',
    category: 'Stream',
    iconName: 'Zap',
    color: '#059669',
  },
  {
    type: 'SAP_ERP',
    displayName: 'SAP ECC/S4HANA',
    description: 'Extract data from SAP ERP systems via RFC or OData',
    category: 'ERP',
    iconName: 'Building2',
    color: '#92400E',
  },
  {
    type: 'HUBSPOT',
    displayName: 'HubSpot',
    description: 'Sync contacts, deals, and marketing data from HubSpot CRM',
    category: 'CRM',
    iconName: 'Users',
    color: '#7E22CE',
  },
  {
    type: 'SALESFORCE',
    displayName: 'Salesforce',
    description: 'Full Salesforce CRM integration with SOQL support',
    category: 'CRM',
    iconName: 'Cloud',
    color: '#0EA5E9',
  },
  {
    type: 'RELATIONAL_DB',
    displayName: 'PostgreSQL / MySQL / MSSQL',
    description: 'Direct database connections with CDC and batch modes',
    category: 'DB',
    iconName: 'Database',
    color: '#166534',
  },
  {
    type: 'FILE_UPLOAD',
    displayName: 'File Upload CSV/XLSX/JSON',
    description: 'Upload and parse structured file formats',
    category: 'File',
    iconName: 'FileText',
    color: '#0C4A6E',
  },
  {
    type: 'DOCUMENT_UPLOAD',
    displayName: 'Document Upload PDF/DOCX',
    description: 'Extract and structure content from documents using AI',
    category: 'Doc',
    iconName: 'FileSearch',
    color: '#713F12',
  },
  {
    type: 'GOOGLE_SHEETS',
    displayName: 'Google Sheets',
    description: 'Live sync from Google Sheets with formula resolution',
    category: 'File',
    iconName: 'Table',
    color: '#166534',
  },
  {
    type: 'KAFKA',
    displayName: 'Kafka / Redpanda',
    description: 'High-throughput streaming from Kafka or Redpanda topics',
    category: 'Stream',
    iconName: 'Activity',
    color: '#065F46',
  },
  {
    type: 'WEBHOOK',
    displayName: 'Custom Webhook',
    description: 'Receive push events from any system via HTTP webhook',
    category: 'HTTP',
    iconName: 'Webhook',
    color: '#9F1239',
  },
  {
    type: 'MONGODB',
    displayName: 'MongoDB',
    description: 'Connect to MongoDB collections with change stream support',
    category: 'DB',
    iconName: 'Layers',
    color: '#166534',
  },
  {
    type: 'DATA_WAREHOUSE',
    displayName: 'Snowflake / BigQuery',
    description: 'Query cloud data warehouses for analytics pipelines',
    category: 'DW',
    iconName: 'Snowflake',
    color: '#1E293B',
  },
  {
    type: 'FIREFLIES',
    displayName: 'Fireflies.ai',
    description: 'Sync meeting transcripts, summaries, and action items from Fireflies',
    category: 'Productivity',
    iconName: 'Mic',
    color: '#7C3AED',
  },
];

export const getConnectorTypeDef = (type: string): ConnectorTypeDefinition | undefined =>
  CONNECTOR_TYPES.find((c) => c.type === type);
