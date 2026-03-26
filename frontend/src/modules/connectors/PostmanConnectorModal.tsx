import React, { useState, useCallback } from 'react';
import { PackageOpen, Upload, CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useConnectorStore } from '../../store/connectorStore';
import type { AuthType } from '../../types/connector';

interface ParsedCollection {
  name: string;
  description: string;
  baseUrl: string;
  authType: AuthType;
  credentials: Record<string, string>;
  headers: Record<string, string>;
  endpoints: { method: string; path: string; name: string }[];
  variables: Record<string, string>;
}

// ── Postman JSON parser ───────────────────────────────────────────────────────

function resolveVar(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function extractBaseUrl(items: unknown[], vars: Record<string, string>): string {
  const flatten = (arr: unknown[]): unknown[] =>
    arr.flatMap((i: unknown) => {
      const item = i as Record<string, unknown>;
      return item.item ? flatten(item.item as unknown[]) : [item];
    });

  for (const item of flatten(items)) {
    const req = (item as Record<string, unknown>).request as Record<string, unknown> | undefined;
    if (!req) continue;
    const url = req.url;
    if (!url) continue;
    const raw: string =
      typeof url === 'string' ? url : (url as Record<string, unknown>).raw as string ?? '';
    if (!raw) continue;
    const resolved = resolveVar(raw, vars);
    try {
      const u = new URL(resolved);
      return `${u.protocol}//${u.host}`;
    } catch {
      const match = resolved.match(/^(https?:\/\/[^/]+)/);
      if (match) return match[1];
    }
  }
  return '';
}

function extractEndpoints(
  items: unknown[],
  vars: Record<string, string>,
  max = 40,
): { method: string; path: string; name: string }[] {
  const results: { method: string; path: string; name: string }[] = [];

  const walk = (arr: unknown[], prefix = '') => {
    for (const i of arr) {
      if (results.length >= max) return;
      const item = i as Record<string, unknown>;
      if (item.item) {
        walk(item.item as unknown[], prefix);
        continue;
      }
      const req = item.request as Record<string, unknown> | undefined;
      if (!req) continue;
      const method = String(req.method ?? 'GET').toUpperCase();
      const url = req.url;
      const raw: string =
        typeof url === 'string' ? url : (url as Record<string, unknown>)?.raw as string ?? '';
      const resolved = resolveVar(raw, vars);
      let path = resolved;
      try {
        path = new URL(resolved).pathname;
      } catch {
        path = resolved.replace(/^https?:\/\/[^/]+/, '') || resolved;
      }
      results.push({ method, path: path || '/', name: String(item.name ?? '') });
    }
  };

  walk(items);
  return results;
}

function parsePostmanAuth(
  auth: Record<string, unknown> | undefined,
  vars: Record<string, string>,
): { authType: AuthType; credentials: Record<string, string> } {
  if (!auth) return { authType: 'None', credentials: {} };
  const type = String(auth.type ?? '').toLowerCase();

  if (type === 'bearer') {
    const arr = (auth.bearer ?? auth['bearer']) as { key: string; value: string }[] | undefined;
    const token = arr?.find((x) => x.key === 'token')?.value ?? '';
    return { authType: 'Bearer', credentials: { token: resolveVar(token, vars) } };
  }
  if (type === 'apikey') {
    const arr = (auth.apikey ?? auth['apikey']) as { key: string; value: string }[] | undefined;
    const keyName = arr?.find((x) => x.key === 'key')?.value ?? 'x-api-key';
    const keyValue = arr?.find((x) => x.key === 'value')?.value ?? '';
    return {
      authType: 'ApiKey',
      credentials: { keyName: resolveVar(keyName, vars), keyValue: resolveVar(keyValue, vars) },
    };
  }
  if (type === 'basic') {
    const arr = (auth.basic ?? auth['basic']) as { key: string; value: string }[] | undefined;
    const username = arr?.find((x) => x.key === 'username')?.value ?? '';
    const password = arr?.find((x) => x.key === 'password')?.value ?? '';
    return {
      authType: 'Basic',
      credentials: {
        username: resolveVar(username, vars),
        password: resolveVar(password, vars),
      },
    };
  }
  if (type === 'oauth2') {
    const arr = (auth.oauth2 ?? auth['oauth2']) as { key: string; value: string }[] | undefined;
    const clientId = arr?.find((x) => x.key === 'clientId')?.value ?? '';
    const clientSecret = arr?.find((x) => x.key === 'clientSecret')?.value ?? '';
    return {
      authType: 'OAuth2',
      credentials: {
        clientId: resolveVar(clientId, vars),
        clientSecret: resolveVar(clientSecret, vars),
      },
    };
  }
  return { authType: 'None', credentials: {} };
}

function parseCollection(json: unknown): ParsedCollection {
  const col = json as Record<string, unknown>;

  // Variables
  const varArr = (col.variable ?? []) as { key: string; value: unknown }[];
  const vars: Record<string, string> = {};
  for (const v of varArr) vars[v.key] = String(v.value ?? '');

  // Info
  const info = (col.info ?? {}) as Record<string, unknown>;
  const name = String(info.name ?? 'Postman API');
  const description =
    typeof info.description === 'string'
      ? info.description
      : String((info.description as Record<string, unknown>)?.content ?? '');

  // Items
  const items = (col.item ?? []) as unknown[];

  // Base URL
  const baseUrl = resolveVar(vars.baseUrl ?? vars.base_url ?? vars.url ?? '', vars) ||
    extractBaseUrl(items, vars);

  // Auth
  const { authType, credentials } = parsePostmanAuth(
    col.auth as Record<string, unknown> | undefined,
    vars,
  );

  // Headers (collection-level)
  const headers: Record<string, string> = {};

  // Endpoints
  const endpoints = extractEndpoints(items, vars);

  return { name, description, baseUrl, authType, credentials, headers, variables: vars, endpoints };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#16A34A', POST: '#2563EB', PUT: '#D97706', PATCH: '#7C3AED',
  DELETE: '#DC2626', HEAD: '#64748B', OPTIONS: '#64748B',
};

export const PostmanConnectorModal: React.FC<Props> = ({ onClose }) => {
  const { addConnector } = useConnectorStore();

  const [stage, setStage] = useState<'drop' | 'preview' | 'saving'>('drop');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParsedCollection | null>(null);
  const [endpointsOpen, setEndpointsOpen] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('None');
  const [token, setToken] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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
        setName(result.name);
        setBaseUrl(result.baseUrl);
        setAuthType(result.authType);
        if (result.authType === 'Bearer') setToken(result.credentials.token ?? '');
        if (result.authType === 'ApiKey') {
          setApiKeyName(result.credentials.keyName ?? '');
          setApiKeyValue(result.credentials.keyValue ?? '');
        }
        if (result.authType === 'Basic') {
          setUsername(result.credentials.username ?? '');
          setPassword(result.credentials.password ?? '');
        }
        setStage('preview');
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

  const handleSave = async () => {
    if (!name.trim()) return;
    setStage('saving');

    const credentials: Record<string, string> = {};
    if (authType === 'Bearer') credentials.token = token;
    if (authType === 'ApiKey') { credentials.keyName = apiKeyName; credentials.keyValue = apiKeyValue; }
    if (authType === 'Basic') { credentials.username = username; credentials.password = password; }

    await addConnector({
      name: name.trim(),
      type: 'POSTMAN',
      category: 'REST',
      status: 'idle',
      description: parsed?.description || 'Imported from Postman collection',
      baseUrl: baseUrl || undefined,
      authType,
      credentials,
      paginationStrategy: 'cursor',
      tags: ['postman', 'rest'],
      config: parsed
        ? { endpointCount: String(parsed.endpoints.length), source: 'postman' }
        : undefined,
    });
    onClose();
  };

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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        backgroundColor: '#fff', borderRadius: 10, width: 520,
        maxWidth: '94vw', maxHeight: '90vh', display: 'flex',
        flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7,
            backgroundColor: '#FFF0E6', border: '1px solid #FCD9BC',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <PackageOpen size={16} color="#EF6C1A" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>
              Postman Collection
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              Drop a collection JSON to auto-configure
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', color: '#94A3B8', fontSize: 18, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── Drop zone ── */}
          {stage === 'drop' && (
            <div style={{ padding: 24 }}>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{
                  border: `2px dashed ${dragging ? '#EF6C1A' : '#E2E8F0'}`,
                  borderRadius: 10,
                  backgroundColor: dragging ? '#FFF7F2' : '#F8FAFC',
                  padding: '48px 24px',
                  display: 'flex', flexDirection: 'column',
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
                  id="postman-file-input"
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={onFileInput}
                />
              </div>

              {error && (
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA', borderRadius: 6,
                  fontSize: 12, color: '#DC2626',
                }}>
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── Preview / edit ── */}
          {(stage === 'preview' || stage === 'saving') && parsed && (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Parsed summary */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', backgroundColor: '#F0FDF4',
                border: '1px solid #BBF7D0', borderRadius: 8,
              }}>
                <CheckCircle size={15} color="#16A34A" />
                <div style={{ fontSize: 12, color: '#166534' }}>
                  Parsed <strong>{parsed.endpoints.length} endpoints</strong> from collection
                  {parsed.variables && Object.keys(parsed.variables).length > 0
                    ? ` · ${Object.keys(parsed.variables).length} variables`
                    : ''}
                </div>
              </div>

              {/* Name */}
              <div>
                <label style={labelStyle}>CONNECTOR NAME</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              {/* Base URL */}
              <div>
                <label style={labelStyle}>BASE URL</label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  style={inputStyle}
                />
              </div>

              {/* Auth */}
              <div>
                <label style={labelStyle}>AUTHENTICATION</label>
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

              {/* Endpoints preview */}
              {parsed.endpoints.length > 0 && (
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    onClick={() => setEndpointsOpen((v) => !v)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 14px', background: '#F8FAFC',
                      border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151',
                    }}
                  >
                    {endpointsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {parsed.endpoints.length} endpoints detected
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
                      click to {endpointsOpen ? 'hide' : 'preview'}
                    </span>
                  </button>
                  {endpointsOpen && (
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {parsed.endpoints.map((ep, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 14px', borderTop: '1px solid #F1F5F9',
                          fontSize: 11,
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, width: 46, textAlign: 'center',
                            color: METHOD_COLORS[ep.method] ?? '#64748B',
                            backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                            borderRadius: 3, padding: '1px 0',
                          }}>{ep.method}</span>
                          <span style={{ color: '#475569', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.path}</span>
                          <span style={{ color: '#94A3B8', flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => { setParsed(null); setStage('drop'); setError(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#94A3B8', textAlign: 'left', padding: 0 }}
              >
                Drop a different file
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {(stage === 'preview' || stage === 'saving') && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid #E2E8F0',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
          }}>
            <button onClick={onClose} style={{
              padding: '7px 16px', border: '1px solid #E2E8F0', borderRadius: 6,
              fontSize: 12, color: '#64748B', backgroundColor: '#fff', cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || stage === 'saving'}
              style={{
                padding: '7px 20px', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'default',
                backgroundColor: name.trim() && stage !== 'saving' ? '#EF6C1A' : '#E2E8F0',
                color: name.trim() && stage !== 'saving' ? '#fff' : '#94A3B8',
              }}
            >
              {stage === 'saving' ? 'Saving…' : 'Add Connector'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostmanConnectorModal;
