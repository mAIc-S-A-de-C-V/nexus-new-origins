import React, { useState, useCallback } from 'react';
import { PackageOpen, Upload, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useConnectorStore } from '../../store/connectorStore';
import type { AuthType } from '../../types/connector';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedEndpoint {
  name: string;
  method: string;
  rawUrl: string;
  path: string;
  baseVar: string;        // e.g. "info" from {{info}}/v1/...
  authType: AuthType;
  credentials: Record<string, string>;
  selected: boolean;
}

interface ParsedCollection {
  collectionName: string;
  collectionAuth: { authType: AuthType; credentials: Record<string, string> };
  knownVars: Record<string, string>;  // vars defined in the collection
  unknownVars: string[];              // vars used in URLs but not defined
  credVars: string[];                 // unresolved {{vars}} found inside auth credentials
  endpoints: ParsedEndpoint[];
}

// ── Parser helpers ────────────────────────────────────────────────────────────

function resolveVar(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function extractUnknownVars(endpoints: ParsedEndpoint[], knownVars: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const ep of endpoints) {
    const matches = ep.rawUrl.matchAll(/\{\{(\w+)\}\}/g);
    for (const m of matches) {
      if (!(m[1] in knownVars)) found.add(m[1]);
    }
  }
  return Array.from(found);
}

const TOKEN_VAR_NAMES = new Set(['token', 'access_token', 'auth_token', 'jwt', 'bearer', 'api_key', 'apikey']);

// Find {{vars}} that are still unresolved inside credential values — scans
// both collection-level auth and all per-endpoint auth credentials.
function extractCredVars(
  collectionAuth: { credentials: Record<string, string> },
  endpoints: ParsedEndpoint[],
  knownVars: Record<string, string>,
): string[] {
  const found = new Set<string>();
  const scan = (creds: Record<string, string>) => {
    for (const val of Object.values(creds)) {
      const matches = String(val).matchAll(/\{\{(\w+)\}\}/g);
      for (const m of matches) if (!(m[1] in knownVars)) found.add(m[1]);
    }
  };
  scan(collectionAuth.credentials);
  for (const ep of endpoints) scan(ep.credentials);
  return Array.from(found);
}

function parsePostmanAuth(
  auth: Record<string, unknown> | undefined,
  vars: Record<string, string>,
): { authType: AuthType; credentials: Record<string, string> } {
  if (!auth) return { authType: 'None', credentials: {} };
  const type = String(auth.type ?? '').toLowerCase();

  if (type === 'bearer') {
    const arr = auth.bearer as { key: string; value: string }[] | undefined;
    const token = arr?.find((x) => x.key === 'token')?.value ?? '';
    return { authType: 'Bearer', credentials: { token: resolveVar(token, vars) } };
  }
  if (type === 'apikey') {
    const arr = auth.apikey as { key: string; value: string }[] | undefined;
    const keyName = arr?.find((x) => x.key === 'key')?.value ?? 'x-api-key';
    const keyValue = arr?.find((x) => x.key === 'value')?.value ?? '';
    return { authType: 'ApiKey', credentials: { keyName: resolveVar(keyName, vars), keyValue: resolveVar(keyValue, vars) } };
  }
  if (type === 'basic') {
    const arr = auth.basic as { key: string; value: string }[] | undefined;
    const username = arr?.find((x) => x.key === 'username')?.value ?? '';
    const password = arr?.find((x) => x.key === 'password')?.value ?? '';
    return { authType: 'Basic', credentials: { username: resolveVar(username, vars), password: resolveVar(password, vars) } };
  }
  if (type === 'oauth2') {
    const arr = auth.oauth2 as { key: string; value: string }[] | undefined;
    const clientId = arr?.find((x) => x.key === 'clientId')?.value ?? '';
    const clientSecret = arr?.find((x) => x.key === 'clientSecret')?.value ?? '';
    return { authType: 'OAuth2', credentials: { clientId: resolveVar(clientId, vars), clientSecret: resolveVar(clientSecret, vars) } };
  }
  return { authType: 'None', credentials: {} };
}

function walkItems(
  items: unknown[],
  collectionAuth: { authType: AuthType; credentials: Record<string, string> },
  vars: Record<string, string>,
): ParsedEndpoint[] {
  const results: ParsedEndpoint[] = [];

  const walk = (arr: unknown[]) => {
    for (const i of arr) {
      const item = i as Record<string, unknown>;
      if (item.item) {
        walk(item.item as unknown[]);
        continue;
      }
      const req = item.request as Record<string, unknown> | undefined;
      if (!req) continue;

      const method = String(req.method ?? 'GET').toUpperCase();
      const url = req.url;
      const rawUrl: string =
        typeof url === 'string' ? url : (url as Record<string, unknown>)?.raw as string ?? '';
      if (!rawUrl) continue;

      // Extract base var (e.g. "info" from "{{info}}/v1/...")
      const baseVarMatch = rawUrl.match(/^\{\{(\w+)\}\}/);
      const baseVar = baseVarMatch ? baseVarMatch[1] : '';

      // Extract path (everything after the first segment)
      const pathMatch = rawUrl.match(/^\{\{[^}]+\}\}(\/[^?]*)/);
      const path = pathMatch ? pathMatch[1] : (rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/');

      // Per-request auth overrides collection auth
      const reqAuth = req.auth as Record<string, unknown> | undefined;
      const { authType, credentials } = reqAuth
        ? parsePostmanAuth(reqAuth, vars)
        : collectionAuth;

      results.push({
        name: String(item.name ?? `${method} ${path}`),
        method,
        rawUrl,
        path,
        baseVar,
        authType,
        credentials,
        selected: true,
      });
    }
  };

  walk(items);
  return results;
}

function parseCollection(json: unknown): ParsedCollection {
  const col = json as Record<string, unknown>;

  const varArr = (col.variable ?? []) as { key: string; value: unknown }[];
  const knownVars: Record<string, string> = {};
  for (const v of varArr) knownVars[v.key] = String(v.value ?? '');

  const info = (col.info ?? {}) as Record<string, unknown>;
  const collectionName = String(info.name ?? 'Postman API');

  const collectionAuth = parsePostmanAuth(
    col.auth as Record<string, unknown> | undefined,
    knownVars,
  );

  const items = (col.item ?? []) as unknown[];
  const endpoints = walkItems(items, collectionAuth, knownVars);
  const credVars = extractCredVars(collectionAuth, endpoints, knownVars);
  const credVarSet = new Set(credVars);
  // Exclude vars that are already handled as credential vars (e.g. {{token}} in query params)
  const unknownVars = extractUnknownVars(endpoints, knownVars).filter((v) => !credVarSet.has(v));

  return { collectionName, collectionAuth, knownVars, unknownVars, credVars, endpoints };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#16A34A', POST: '#2563EB', PUT: '#D97706', PATCH: '#7C3AED',
  DELETE: '#DC2626', HEAD: '#64748B', OPTIONS: '#64748B',
};

type Stage = 'drop' | 'variables' | 'select' | 'saving';

export const PostmanConnectorModal: React.FC<Props> = ({ onClose }) => {
  const { addConnector } = useConnectorStore();

  const [stage, setStage] = useState<Stage>('drop');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParsedCollection | null>(null);

  // Variable resolution step
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  // Token config (for {{token}}-style credential vars)
  const [tokenMode, setTokenMode] = useState<'static' | 'dynamic'>('static');
  const [staticToken, setStaticToken] = useState('');
  const [authEndpointUrl, setAuthEndpointUrl] = useState('');
  const [authEndpointMethod, setAuthEndpointMethod] = useState('POST');
  const [authEndpointBody, setAuthEndpointBody] = useState('{"username": "", "password": ""}');
  const [tokenResponsePath, setTokenResponsePath] = useState('token');

  // Endpoint selection step
  const [endpoints, setEndpoints] = useState<ParsedEndpoint[]>([]);
  const [collectionName, setCollectionName] = useState('');

  // Shared auth
  const [authType, setAuthType] = useState<AuthType>('None');
  const [token, setToken] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Save progress
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Please drop a Postman collection JSON file (.json)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const result = parseCollection(json);
        setParsed(result);
        setCollectionName(result.collectionName);
        setEndpoints(result.endpoints);
        setAuthType(result.collectionAuth.authType);
        if (result.collectionAuth.authType === 'Bearer') setToken(result.collectionAuth.credentials.token ?? '');
        if (result.collectionAuth.authType === 'ApiKey') {
          setApiKeyName(result.collectionAuth.credentials.keyName ?? '');
          setApiKeyValue(result.collectionAuth.credentials.keyValue ?? '');
        }
        if (result.collectionAuth.authType === 'Basic') {
          setUsername(result.collectionAuth.credentials.username ?? '');
          setPassword(result.collectionAuth.credentials.password ?? '');
        }

        // Init var inputs (pre-fill any known vars)
        const initVars: Record<string, string> = {};
        for (const v of result.unknownVars) initVars[v] = result.knownVars[v] ?? '';
        setVarValues(initVars);

        const hasVars = result.unknownVars.length > 0 || result.credVars.length > 0;
        setStage(hasVars ? 'variables' : 'select');
        setError('');
      } catch {
        setError('Could not parse file — make sure it is a valid Postman collection v2 JSON.');
      }
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleResolveVars = () => {
    const allVars = { ...parsed!.knownVars, ...varValues };
    const resolved = endpoints.map((ep) => {
      const resolvedUrl = resolveVar(ep.rawUrl, allVars);
      let path = ep.path;
      try {
        path = new URL(resolvedUrl).pathname;
      } catch {
        // keep existing path
      }
      return { ...ep, path };
    });
    setEndpoints(resolved);
    setStage('select');
  };

  const toggleAll = (val: boolean) =>
    setEndpoints((prev) => prev.map((ep) => ({ ...ep, selected: val })));

  const toggleOne = (idx: number) =>
    setEndpoints((prev) => prev.map((ep, i) => i === idx ? { ...ep, selected: !ep.selected } : ep));

  const handleSave = async () => {
    const selected = endpoints.filter((ep) => ep.selected);
    if (selected.length === 0) return;

    const allVars = { ...parsed!.knownVars, ...varValues };
    const credentials: Record<string, string> = {};
    if (authType === 'Bearer') {
      if (tokenMode === 'dynamic') {
        credentials.tokenEndpointUrl = authEndpointUrl;
        credentials.tokenEndpointMethod = authEndpointMethod;
        credentials.tokenEndpointBody = authEndpointBody;
        credentials.tokenPath = tokenResponsePath;
      } else {
        credentials.token = staticToken || token;
      }
    }
    if (authType === 'ApiKey') { credentials.keyName = apiKeyName; credentials.keyValue = apiKeyValue; }
    if (authType === 'Basic') { credentials.username = username; credentials.password = password; }

    setStage('saving');
    setSaveTotal(selected.length);
    setSaveProgress(0);

    for (let i = 0; i < selected.length; i++) {
      const ep = selected[i];

      // Resolve base URL for this endpoint
      const resolvedRaw = resolveVar(ep.rawUrl, allVars);
      let baseUrl = '';
      try {
        const u = new URL(resolvedRaw);
        baseUrl = `${u.protocol}//${u.host}`;
      } catch {
        // If var not filled in, store what we have
        const varVal = allVars[ep.baseVar] ?? '';
        baseUrl = varVal || `{{${ep.baseVar}}}`;
      }

      await addConnector({
        name: ep.name,
        type: 'REST_API',
        category: 'REST',
        status: 'idle',
        description: `${ep.method} ${ep.path}`,
        baseUrl: baseUrl || undefined,
        authType,
        credentials,
        paginationStrategy: 'none',
        tags: ['postman', collectionName.toLowerCase().replace(/\s+/g, '-')],
        config: {
          method: ep.method,
          path: ep.path,
          collectionName,
          endpointUrl: resolvedRaw,
        },
      });

      setSaveProgress(i + 1);
    }

    onClose();
  };

  const selectedCount = endpoints.filter((ep) => ep.selected).length;

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 32, padding: '0 10px',
    border: '1px solid #E2E8F0', borderRadius: 5,
    fontSize: 12, color: '#0D1117', outline: 'none',
    boxSizing: 'border-box', backgroundColor: '#fff',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#64748B',
    letterSpacing: '0.04em', marginBottom: 4, display: 'block',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        backgroundColor: '#fff', borderRadius: 10,
        width: stage === 'select' || stage === 'saving' ? 640 : 520,
        maxWidth: '94vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        overflow: 'hidden',
        transition: 'width 150ms ease-out',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7,
            backgroundColor: '#FFF0E6', border: '1px solid #FCD9BC',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <PackageOpen size={16} color="#EF6C1A" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>Postman Collection</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {stage === 'drop' && 'Drop a collection JSON to auto-configure'}
              {stage === 'variables' && `Resolve variables · ${parsed?.endpoints.length} endpoints found`}
              {stage === 'select' && `${collectionName} · select endpoints to import`}
              {stage === 'saving' && `Importing ${saveProgress} / ${saveTotal}…`}
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', color: '#94A3B8', fontSize: 18, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── Stage: drop ── */}
          {stage === 'drop' && (
            <div style={{ padding: 24 }}>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{
                  border: `2px dashed ${dragging ? '#EF6C1A' : '#E2E8F0'}`,
                  borderRadius: 10, backgroundColor: dragging ? '#FFF7F2' : '#F8FAFC',
                  padding: '48px 24px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 12,
                  transition: 'all 120ms', cursor: 'pointer',
                }}
                onClick={() => document.getElementById('postman-file-input')?.click()}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 10,
                  backgroundColor: dragging ? '#FFF0E6' : '#F1F5F9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background-color 120ms',
                }}>
                  <Upload size={22} color={dragging ? '#EF6C1A' : '#94A3B8'} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 4 }}>
                    Drop your Postman collection here
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>
                    or click to browse — supports Collection v2 and v2.1
                  </div>
                </div>
                <input
                  id="postman-file-input" type="file" accept=".json"
                  style={{ display: 'none' }} onChange={onFileInput}
                />
              </div>
              {error && (
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA', borderRadius: 6,
                  fontSize: 12, color: '#DC2626',
                }}>
                  <AlertCircle size={14} />{error}
                </div>
              )}
            </div>
          )}

          {/* ── Stage: variables ── */}
          {stage === 'variables' && parsed && (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Base URL variables */}
              {parsed.unknownVars.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{
                    padding: '10px 14px', backgroundColor: '#FFF7ED',
                    border: '1px solid #FED7AA', borderRadius: 8,
                    fontSize: 12, color: '#9A3412',
                  }}>
                    <strong>{parsed.unknownVars.length} base URL variable{parsed.unknownVars.length !== 1 ? 's' : ''}</strong> aren't defined in the collection — enter the real server URLs.
                  </div>
                  {parsed.unknownVars.filter((v) => !TOKEN_VAR_NAMES.has(v.toLowerCase())).map((v) => (
                    <div key={v}>
                      <label style={labelStyle}>
                        {`{{${v.toUpperCase()}}}`}
                        <span style={{ fontSize: 10, fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>
                          used by {endpoints.filter((ep) => ep.baseVar === v).length} endpoint{endpoints.filter((ep) => ep.baseVar === v).length !== 1 ? 's' : ''}
                        </span>
                      </label>
                      <input
                        value={varValues[v] ?? ''}
                        onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                        placeholder="https://your-api.com"
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Auth credential variables (e.g. {{token}}) */}
              {parsed.credVars.filter((v) => TOKEN_VAR_NAMES.has(v.toLowerCase())).map((v) => (
                <div key={v} style={{
                  border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 14px', backgroundColor: '#EFF6FF',
                    borderBottom: '1px solid #BFDBFE',
                    fontSize: 12, color: '#1E40AF',
                  }}>
                    <strong>{`{{${v}}}`}</strong> is used as the Bearer token but isn't defined in the collection.
                    How is it obtained?
                  </div>
                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {(['static', 'dynamic'] as const).map((mode) => (
                        <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
                          <input
                            type="radio"
                            name={`token-mode-${v}`}
                            checked={tokenMode === mode}
                            onChange={() => setTokenMode(mode)}
                            style={{ accentColor: '#2563EB' }}
                          />
                          {mode === 'static' ? 'I have a static token' : 'Generated by a login endpoint'}
                        </label>
                      ))}
                    </div>

                    {tokenMode === 'static' && (
                      <div>
                        <label style={labelStyle}>PASTE TOKEN</label>
                        <input
                          value={staticToken}
                          onChange={(e) => setStaticToken(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                          style={inputStyle}
                        />
                      </div>
                    )}

                    {tokenMode === 'dynamic' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ flex: '0 0 80px' }}>
                            <label style={labelStyle}>METHOD</label>
                            <select
                              value={authEndpointMethod}
                              onChange={(e) => setAuthEndpointMethod(e.target.value)}
                              style={{ ...inputStyle, cursor: 'pointer' }}
                            >
                              {['POST', 'GET'].map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={labelStyle}>LOGIN ENDPOINT URL</label>
                            <input
                              value={authEndpointUrl}
                              onChange={(e) => setAuthEndpointUrl(e.target.value)}
                              placeholder="https://auth.example.com/login"
                              style={inputStyle}
                            />
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>REQUEST BODY (JSON)</label>
                          <textarea
                            value={authEndpointBody}
                            onChange={(e) => setAuthEndpointBody(e.target.value)}
                            rows={3}
                            style={{
                              ...inputStyle, height: 'auto', padding: '8px 10px',
                              fontFamily: 'monospace', fontSize: 11, resize: 'vertical',
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>
                            TOKEN FIELD IN RESPONSE
                            <span style={{ fontSize: 10, fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>
                              dot-path, e.g. <code>data.token</code> or just <code>token</code>
                            </span>
                          </label>
                          <input
                            value={tokenResponsePath}
                            onChange={(e) => setTokenResponsePath(e.target.value)}
                            placeholder="token"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={() => { setParsed(null); setStage('drop'); setError(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#94A3B8', textAlign: 'left', padding: 0 }}
              >
                Drop a different file
              </button>
            </div>
          )}

          {/* ── Stage: select ── */}
          {stage === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Summary bar */}
              <div style={{
                padding: '10px 20px', backgroundColor: '#F0FDF4',
                borderBottom: '1px solid #BBF7D0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <CheckCircle size={14} color="#16A34A" />
                <span style={{ fontSize: 12, color: '#166534' }}>
                  <strong>{endpoints.length} endpoints</strong> parsed — each will become its own connector card
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => toggleAll(true)} style={{
                    fontSize: 11, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}>Select all</button>
                  <span style={{ color: '#CBD5E1', fontSize: 11 }}>·</span>
                  <button onClick={() => toggleAll(false)} style={{
                    fontSize: 11, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}>None</button>
                </div>
              </div>

              {/* Endpoint list */}
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {endpoints.map((ep, i) => (
                  <label
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 20px', borderBottom: '1px solid #F1F5F9',
                      cursor: 'pointer', backgroundColor: ep.selected ? '#fff' : '#FAFAFA',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={ep.selected}
                      onChange={() => toggleOne(i)}
                      style={{ flexShrink: 0, accentColor: '#EF6C1A' }}
                    />
                    <span style={{
                      fontSize: 10, fontWeight: 700, width: 44, textAlign: 'center', flexShrink: 0,
                      color: METHOD_COLORS[ep.method] ?? '#64748B',
                      backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                      borderRadius: 3, padding: '1px 0',
                    }}>{ep.method}</span>
                    <span style={{ fontSize: 12, color: '#0D1117', fontWeight: 500, flex: '0 0 160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ep.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ep.baseVar ? `{${ep.baseVar}}` : ''}{ep.path}
                    </span>
                  </label>
                ))}
              </div>

              {/* Auth config */}
              <div style={{ padding: '16px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <AuthSection
                  authType={authType} setAuthType={setAuthType}
                  token={token} setToken={setToken}
                  apiKeyName={apiKeyName} setApiKeyName={setApiKeyName}
                  apiKeyValue={apiKeyValue} setApiKeyValue={setApiKeyValue}
                  username={username} setUsername={setUsername}
                  password={password} setPassword={setPassword}
                  inputStyle={inputStyle} labelStyle={labelStyle}
                />
              </div>
            </div>
          )}

          {/* ── Stage: saving ── */}
          {stage === 'saving' && (
            <div style={{
              padding: 40, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 16,
            }}>
              <div style={{ fontSize: 14, color: '#0D1117', fontWeight: 500 }}>
                Creating connectors…
              </div>
              <div style={{
                width: '100%', maxWidth: 320, height: 6,
                backgroundColor: '#F1F5F9', borderRadius: 99, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  backgroundColor: '#EF6C1A',
                  width: saveTotal > 0 ? `${(saveProgress / saveTotal) * 100}%` : '0%',
                  transition: 'width 200ms ease-out',
                }} />
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                {saveProgress} of {saveTotal} connectors saved
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'variables' && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid #E2E8F0',
            display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
          }}>
            <button onClick={onClose} style={{
              padding: '7px 16px', border: '1px solid #E2E8F0', borderRadius: 6,
              fontSize: 12, color: '#64748B', backgroundColor: '#fff', cursor: 'pointer',
            }}>Cancel</button>
            <button
              onClick={handleResolveVars}
              style={{
                padding: '7px 20px', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                backgroundColor: '#EF6C1A', color: '#fff',
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {stage === 'select' && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid #E2E8F0',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, color: '#64748B', marginRight: 'auto' }}>
              {selectedCount} of {endpoints.length} selected
            </span>
            <button onClick={onClose} style={{
              padding: '7px 16px', border: '1px solid #E2E8F0', borderRadius: 6,
              fontSize: 12, color: '#64748B', backgroundColor: '#fff', cursor: 'pointer',
            }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={selectedCount === 0}
              style={{
                padding: '7px 20px', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                cursor: selectedCount > 0 ? 'pointer' : 'default',
                backgroundColor: selectedCount > 0 ? '#EF6C1A' : '#E2E8F0',
                color: selectedCount > 0 ? '#fff' : '#94A3B8',
              }}
            >
              Import {selectedCount} connector{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Auth sub-component ────────────────────────────────────────────────────────

interface AuthSectionProps {
  authType: AuthType; setAuthType: (v: AuthType) => void;
  token: string; setToken: (v: string) => void;
  apiKeyName: string; setApiKeyName: (v: string) => void;
  apiKeyValue: string; setApiKeyValue: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}

const AuthSection: React.FC<AuthSectionProps> = ({
  authType, setAuthType, token, setToken,
  apiKeyName, setApiKeyName, apiKeyValue, setApiKeyValue,
  username, setUsername, password, setPassword,
  inputStyle, labelStyle,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', background: '#F8FAFC',
          border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151',
        }}
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Authentication
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
          shared across all imported connectors
        </span>
      </button>
      {open && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>TYPE</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as AuthType)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {(['None', 'Bearer', 'ApiKey', 'Basic', 'OAuth2'] as AuthType[]).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          {authType === 'Bearer' && (
            <div>
              <label style={labelStyle}>BEARER TOKEN</label>
              <input value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle} placeholder="ey..." />
            </div>
          )}
          {authType === 'ApiKey' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>HEADER NAME</label>
                <input value={apiKeyName} onChange={(e) => setApiKeyName(e.target.value)} style={inputStyle} placeholder="x-api-key" />
              </div>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>KEY VALUE</label>
                <input value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} style={inputStyle} />
              </div>
            </div>
          )}
          {authType === 'Basic' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>USERNAME</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>PASSWORD</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PostmanConnectorModal;
