import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { ConnectorTypeDefinition } from './connectorTypes';
import { ConnectorConfig, AuthType, PaginationStrategy } from '../../types/connector';
import { useConnectorStore } from '../../store/connectorStore';

interface Props {
  connectorType: ConnectorTypeDefinition;
  onClose: () => void;
}

const AUTH_TYPES: AuthType[] = ['Bearer', 'ApiKey', 'OAuth2', 'Basic', 'None'];

const NEEDS_URL = new Set([
  'REST_API', 'GRAPHQL_API', 'WEBSOCKET', 'SAP_ERP', 'HUBSPOT',
  'SALESFORCE', 'RELATIONAL_DB', 'GOOGLE_SHEETS', 'KAFKA',
  'WEBHOOK', 'MONGODB', 'DATA_WAREHOUSE',
  // FIREFLIES uses a fixed URL — pre-filled, not user-entered
]);

const DEFAULT_AUTH: Record<string, AuthType> = {
  REST_API: 'Bearer',
  GRAPHQL_API: 'Bearer',
  WEBSOCKET: 'Bearer',
  SAP_ERP: 'Basic',
  HUBSPOT: 'Bearer',
  SALESFORCE: 'OAuth2',
  RELATIONAL_DB: 'Basic',
  FILE_UPLOAD: 'None',
  DOCUMENT_UPLOAD: 'None',
  GOOGLE_SHEETS: 'OAuth2',
  KAFKA: 'None',
  WEBHOOK: 'None',
  MONGODB: 'Basic',
  DATA_WAREHOUSE: 'Basic',
  FIREFLIES: 'Bearer',
};

const URL_PLACEHOLDER: Record<string, string> = {
  REST_API: 'https://api.example.com',
  GRAPHQL_API: 'https://api.example.com/graphql',
  WEBSOCKET: 'wss://stream.example.com',
  SAP_ERP: 'https://sap-host:8000',
  HUBSPOT: 'https://api.hubapi.com',
  SALESFORCE: 'https://yourorg.my.salesforce.com',
  RELATIONAL_DB: 'postgresql://host:5432/dbname',
  GOOGLE_SHEETS: 'https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID',
  KAFKA: 'kafka-broker:9092',
  WEBHOOK: 'https://your-app.com/webhook',
  MONGODB: 'mongodb://host:27017/dbname',
  DATA_WAREHOUSE: 'https://account.snowflakecomputing.com',
};

interface GuideStep { step: string; detail: string; }

const CREDENTIAL_GUIDES: Record<string, { title: string; steps: GuideStep[] }> = {
  HUBSPOT: {
    title: 'How to get your HubSpot API token',
    steps: [
      { step: 'Open HubSpot Settings', detail: 'Go to app.hubspot.com → click the Settings icon (top right).' },
      { step: 'Go to Private Apps', detail: 'In the left sidebar: Integrations → Private Apps.' },
      { step: 'Create a Private App', detail: 'Click "Create a private app". Name it e.g. "Nexus Origins".' },
      { step: 'Set Scopes', detail: 'Under the Scopes tab, enable: crm.objects.contacts.read, crm.objects.companies.read, crm.objects.deals.read, crm.schemas.contacts.read.' },
      { step: 'Create & copy token', detail: 'Click "Create app" → confirm. Copy the access token shown — it starts with pat-na1-...' },
      { step: 'Paste below', detail: 'Leave Base URL as https://api.hubapi.com and paste the token in the API Token field.' },
    ],
  },
  SALESFORCE: {
    title: 'How to get your Salesforce credentials',
    steps: [
      { step: 'Go to Setup', detail: 'In Salesforce, click the gear icon → Setup.' },
      { step: 'Create a Connected App', detail: 'Search "App Manager" → New Connected App. Enable OAuth, add callback URL.' },
      { step: 'Set OAuth Scopes', detail: 'Add: "Access and manage your data (api)" and "Perform requests on your behalf (refresh_token)".' },
      { step: 'Get Client ID & Secret', detail: 'After saving, click "Manage Consumer Details" — copy the Consumer Key (Client ID) and Consumer Secret.' },
      { step: 'Set Base URL', detail: 'Use your org URL: https://yourorgname.my.salesforce.com' },
    ],
  },
  RELATIONAL_DB: {
    title: 'How to get your database connection string',
    steps: [
      { step: 'Gather credentials', detail: 'You need: host, port, database name, username, password from your DB admin or cloud console (RDS, Cloud SQL, etc.).' },
      { step: 'PostgreSQL format', detail: 'postgresql://username:password@host:5432/dbname' },
      { step: 'MySQL format', detail: 'mysql://username:password@host:3306/dbname' },
      { step: 'MSSQL format', detail: 'mssql://username:password@host:1433/dbname' },
      { step: 'Allow access', detail: 'Ensure the DB allows connections from this server\'s IP. Use a read-only user for safety.' },
    ],
  },
  MONGODB: {
    title: 'How to get your MongoDB connection string',
    steps: [
      { step: 'Atlas (cloud)', detail: 'Go to MongoDB Atlas → your cluster → Connect → Drivers. Copy the connection string.' },
      { step: 'Fill in credentials', detail: 'Replace <username> and <password> in the string with your DB user credentials.' },
      { step: 'Format', detail: 'mongodb+srv://username:password@cluster.mongodb.net/dbname' },
      { step: 'Network access', detail: 'In Atlas: Network Access → Add IP Address → allow this server\'s IP.' },
    ],
  },
  GOOGLE_SHEETS: {
    title: 'How to get your Google Sheets credentials',
    steps: [
      { step: 'Open Google Cloud Console', detail: 'Go to console.cloud.google.com → create or select a project.' },
      { step: 'Enable Sheets API', detail: 'APIs & Services → Library → search "Google Sheets API" → Enable.' },
      { step: 'Create OAuth credentials', detail: 'APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.' },
      { step: 'Copy Client ID & Secret', detail: 'Copy the Client ID and Client Secret shown after creation.' },
      { step: 'Get Sheet ID', detail: 'Open your Google Sheet — the ID is in the URL: docs.google.com/spreadsheets/d/SHEET_ID/edit' },
    ],
  },
  DATA_WAREHOUSE: {
    title: 'How to connect Snowflake or BigQuery',
    steps: [
      { step: 'Snowflake URL', detail: 'Your account URL is: https://ACCOUNT_ID.snowflakecomputing.com — find ACCOUNT_ID in Snowflake Admin → Accounts.' },
      { step: 'Snowflake credentials', detail: 'Create a service user in Snowflake with USAGE on the warehouse and SELECT on the schema. Use Basic auth with that username/password.' },
      { step: 'BigQuery', detail: 'Go to Google Cloud → IAM → Service Accounts → create one with BigQuery Data Viewer role → download JSON key.' },
      { step: 'BigQuery credentials', detail: 'Use the client_email as username and private_key as password from the JSON key file.' },
    ],
  },
  SAP_ERP: {
    title: 'How to connect to SAP ECC/S4HANA',
    steps: [
      { step: 'Get host & port', detail: 'Contact your SAP BASIS admin for the OData service host and port (typically 8000 or 44300 for HTTPS).' },
      { step: 'Create an RFC user', detail: 'In SAP: transaction SU01 → create a service user with role SAP_BC_ODATA_CONSUMER.' },
      { step: 'Use Basic auth', detail: 'Enter that SAP username and password in the credentials fields.' },
      { step: 'Find your service URL', detail: 'OData services are at: https://host:port/sap/opu/odata/sap/SERVICE_NAME/' },
    ],
  },
  KAFKA: {
    title: 'How to connect to Kafka / Redpanda',
    steps: [
      { step: 'Get bootstrap servers', detail: 'Contact your Kafka admin or check your cloud provider (Confluent, MSK, Redpanda Cloud) for the broker addresses.' },
      { step: 'Format', detail: 'broker1:9092,broker2:9092 — comma-separated if multiple brokers.' },
      { step: 'Confluent Cloud', detail: 'Go to Confluent Cloud → your cluster → Clients → copy the Bootstrap server address.' },
      { step: 'Redpanda Cloud', detail: 'Redpanda Console → Overview → Connection info → copy bootstrap server.' },
    ],
  },
  REST_API: {
    title: 'How to connect to a REST API',
    steps: [
      { step: 'Find the base URL', detail: 'Check the API docs for the root URL, e.g. https://api.example.com/v2' },
      { step: 'Get your token', detail: 'Most APIs: go to your account settings / developer portal → create an API key or token.' },
      { step: 'Choose auth type', detail: 'Bearer: paste the token. ApiKey: check docs for which header name to use (e.g. X-API-Key). Basic: use username + password.' },
      { step: 'Test first', detail: 'Try the token in a tool like curl or Postman before pasting here to confirm it works.' },
    ],
  },
  FIREFLIES: {
    title: 'How to get your Fireflies API key',
    steps: [
      { step: 'Open Fireflies Settings', detail: 'Log in at app.fireflies.ai → click your avatar (top right) → Integrations.' },
      { step: 'Go to API Access', detail: 'In the left sidebar click "API" or go to app.fireflies.ai/account/api.' },
      { step: 'Copy your API key', detail: 'You will see your API key on that page — it looks like a UUID (e.g. b8ccbaa9-...). Click Copy.' },
      { step: 'Paste below', detail: 'Paste it in the API Token field. The base URL is fixed at https://api.fireflies.ai/graphql.' },
    ],
  },
};


export const AddConnectorModal: React.FC<Props> = ({ connectorType, onClose }) => {
  const { addConnector } = useConnectorStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>(DEFAULT_AUTH[connectorType.type] ?? 'Bearer');
  const [apiToken, setApiToken] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hubspotObject, setHubspotObject] = useState('contacts');
  const [guideOpen, setGuideOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const needsUrl = NEEDS_URL.has(connectorType.type);
  const guide = CREDENTIAL_GUIDES[connectorType.type];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const credentials: Record<string, string> = {};
    if (authType === 'Bearer') credentials.token = apiToken;
    if (authType === 'ApiKey') { credentials.keyName = apiKeyName; credentials.keyValue = apiKeyValue; }
    if (authType === 'Basic') { credentials.username = username; credentials.password = password; }
    if (authType === 'OAuth2') { credentials.clientId = clientId; credentials.clientSecret = clientSecret; }

    const pagination: PaginationStrategy =
      connectorType.type === 'RELATIONAL_DB' || connectorType.type === 'DATA_WAREHOUSE' ? 'offset' : 'cursor';

    setSaving(true);
    setSaveError(null);
    try {
      const extraConfig: Record<string, string> = {};
      if (connectorType.type === 'HUBSPOT') extraConfig.hubspotObject = hubspotObject;

      await addConnector({
        name: name.trim(),
        type: connectorType.type,
        category: connectorType.category,
        status: 'idle',
        description: description.trim() || connectorType.description,
        baseUrl: needsUrl ? baseUrl.trim() : undefined,
        authType,
        credentials,
        paginationStrategy: authType === 'None' ? 'none' : pagination,
        tags: [connectorType.category.toLowerCase()],
        config: Object.keys(extraConfig).length > 0 ? extraConfig : undefined,
      });
      onClose();
    } catch (err: unknown) {
      setSaveError(String(err));
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '34px',
    padding: '0 10px',
    border: '1px solid #E2E8F0',
    borderRadius: '4px',
    fontSize: '13px',
    color: '#0D1117',
    backgroundColor: '#FFFFFF',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '4px',
  };

  const fieldStyle: React.CSSProperties = { marginBottom: '14px' };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '6px',
        width: '500px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#0D1117' }}>
              Add {connectorType.displayName}
            </div>
            <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
              {connectorType.description}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#94A3B8', padding: '4px', borderRadius: '4px',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Credential guide */}
        {guide && (
          <div style={{
            margin: '16px 20px 0',
            border: '1px solid #DBEAFE',
            borderRadius: '4px',
            backgroundColor: '#EFF6FF',
            overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setGuideOpen((o) => !o)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, color: '#1D4ED8',
                textAlign: 'left',
              }}
            >
              <span>{guide.title}</span>
              {guideOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {guideOpen && (
              <div style={{ padding: '0 14px 14px' }}>
                {guide.steps.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: '10px',
                    marginBottom: i < guide.steps.length - 1 ? '10px' : 0,
                  }}>
                    <div style={{
                      flexShrink: 0,
                      width: '20px', height: '20px',
                      borderRadius: '50%',
                      backgroundColor: '#2563EB',
                      color: '#FFFFFF',
                      fontSize: '11px', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1E3A5F', marginBottom: '2px' }}>
                        {s.step}
                      </div>
                      <div style={{ fontSize: '12px', color: '#3B5A8A', lineHeight: '1.5' }}>
                        {s.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Connector Name *</label>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={connectorType.type === 'HUBSPOT'
                ? `e.g. HubSpot ${hubspotObject.charAt(0).toUpperCase() + hubspotObject.slice(1)}`
                : `e.g. ${connectorType.displayName} Production`}
              required
              autoFocus
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What data does this connector pull?"
            />
          </div>

          {needsUrl && (
            <div style={fieldStyle}>
              <label style={labelStyle}>
                {connectorType.type === 'RELATIONAL_DB' || connectorType.type === 'MONGODB'
                  ? 'Connection String'
                  : connectorType.type === 'KAFKA'
                  ? 'Bootstrap Servers'
                  : 'Base URL'}
              </label>
              <input
                style={inputStyle}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={URL_PLACEHOLDER[connectorType.type] ?? 'https://'}
              />
            </div>
          )}

          {connectorType.type === 'HUBSPOT' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>HubSpot Object to Sync</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={hubspotObject}
                onChange={(e) => setHubspotObject(e.target.value)}
              >
                <option value="contacts">Contacts</option>
                <option value="companies">Companies</option>
                <option value="deals">Deals</option>
                <option value="tickets">Tickets</option>
                <option value="line_items">Line Items</option>
                <option value="products">Products</option>
              </select>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                Each object hits a different HubSpot endpoint: <code style={{ fontSize: '11px', backgroundColor: '#F1F5F9', padding: '1px 4px', borderRadius: '2px' }}>/crm/v3/objects/{hubspotObject}</code>
              </div>
            </div>
          )}

          <div style={fieldStyle}>
            <label style={labelStyle}>Authentication</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={authType}
              onChange={(e) => setAuthType(e.target.value as AuthType)}
            >
              {AUTH_TYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {authType === 'Bearer' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>API Token</label>
              <input
                style={inputStyle}
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Paste your token here (e.g. pat-na1-...)"
              />
            </div>
          )}

          {authType === 'ApiKey' && (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Key Header Name</label>
                <input
                  style={inputStyle}
                  value={apiKeyName}
                  onChange={(e) => setApiKeyName(e.target.value)}
                  placeholder="e.g. X-API-Key"
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Key Value</label>
                <input
                  style={inputStyle}
                  type="password"
                  value={apiKeyValue}
                  onChange={(e) => setApiKeyValue(e.target.value)}
                  placeholder="Your API key value"
                />
              </div>
            </>
          )}

          {authType === 'Basic' && (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Username</label>
                <input
                  style={inputStyle}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Password</label>
                <input
                  style={inputStyle}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
              </div>
            </>
          )}

          {authType === 'OAuth2' && (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Client ID</label>
                <input
                  style={inputStyle}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="OAuth2 Client ID"
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Client Secret</label>
                <input
                  style={inputStyle}
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="OAuth2 Client Secret"
                />
              </div>
            </>
          )}

          {/* Footer */}
          {saveError && (
            <div style={{ fontSize: '12px', color: '#DC2626', marginBottom: '12px' }}>
              {saveError}
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: '8px',
            marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #E2E8F0',
          }}>
            <button type="button" onClick={onClose} disabled={saving} style={{
              height: '32px', padding: '0 14px',
              border: '1px solid #E2E8F0', borderRadius: '4px',
              backgroundColor: '#FFFFFF', color: '#374151',
              fontSize: '13px', cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{
              height: '32px', padding: '0 16px',
              border: 'none', borderRadius: '4px',
              backgroundColor: saving ? '#93C5FD' : '#2563EB', color: '#FFFFFF',
              fontSize: '13px', fontWeight: 500, cursor: saving ? 'wait' : 'pointer',
            }}>
              {saving ? 'Saving...' : 'Add Connector'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
