import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, Eye, EyeOff, Globe, Key, RefreshCw } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const GW_API = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8021';
const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  enabled: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface ApiEndpoint {
  id: string;
  object_type_id: string;
  object_type_name: string;
  slug: string;
  enabled: boolean;
  created_at: string;
}

interface ObjectType {
  id: string;
  name: string;
  displayName: string;
}

const ApiGatewayPage: React.FC = () => {
  const [tab, setTab] = useState<'endpoints' | 'keys'>('endpoints');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [newEpOtId, setNewEpOtId] = useState('');
  const [newEpSlug, setNewEpSlug] = useState('');
  const [loading, setLoading] = useState(false);

  const h = { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [keysRes, epRes, otRes] = await Promise.all([
        fetch(`${GW_API}/gateway/keys`, { headers: h }),
        fetch(`${GW_API}/gateway/manage`, { headers: h }),
        fetch(`${ONTOLOGY_API}/object-types`, { headers: h }),
      ]);
      if (keysRes.ok) setKeys(await keysRes.json());
      if (epRes.ok) setEndpoints(await epRes.json());
      if (otRes.ok) {
        const data = await otRes.json();
        setObjectTypes(Array.isArray(data) ? data : data.object_types || []);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    const res = await fetch(`${GW_API}/gateway/keys`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: newKeyName.trim(), scopes: ['read'] }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName('');
      await loadAll();
    }
  };

  const deleteKey = async (id: string) => {
    await fetch(`${GW_API}/gateway/keys/${id}`, { method: 'DELETE', headers: h });
    await loadAll();
  };

  const toggleKey = async (id: string) => {
    await fetch(`${GW_API}/gateway/keys/${id}/toggle`, { method: 'PATCH', headers: h });
    await loadAll();
  };

  const createEndpoint = async () => {
    if (!newEpOtId || !newEpSlug.trim()) return;
    const ot = objectTypes.find(o => o.id === newEpOtId);
    const res = await fetch(`${GW_API}/gateway/manage`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        object_type_id: newEpOtId,
        object_type_name: ot?.displayName || newEpOtId,
        slug: newEpSlug.trim().toLowerCase().replace(/\s+/g, '-'),
      }),
    });
    if (res.ok) { setNewEpOtId(''); setNewEpSlug(''); await loadAll(); }
  };

  const deleteEndpoint = async (id: string) => {
    await fetch(`${GW_API}/gateway/manage/${id}`, { method: 'DELETE', headers: h });
    await loadAll();
  };

  const baseUrl = `http://localhost:8021/gateway`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#F8FAFC', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0D1117', margin: 0 }}>API Gateway</h1>
            <p style={{ fontSize: 12, color: '#64748B', margin: '2px 0 0' }}>
              Expose your data as REST APIs · Base URL: <code style={{ fontSize: 11, backgroundColor: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>{baseUrl}/v1/&#123;slug&#125;</code>
            </p>
          </div>
          <button onClick={loadAll} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 32, padding: '0 12px', border: '1px solid #E2E8F0', borderRadius: 5, backgroundColor: '#fff', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E2E8F0' }}>
          {(['endpoints', 'keys'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer', backgroundColor: 'transparent', fontWeight: tab === t ? 500 : 400, color: tab === t ? '#2563EB' : '#64748B', borderBottom: tab === t ? '2px solid #2563EB' : '2px solid transparent' }}>
              {t === 'endpoints' ? <><Globe size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />Endpoints</> : <><Key size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />API Keys</>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Created key one-time modal */}
        {createdKey && (
          <div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 6 }}>API Key Created — copy it now, it won't be shown again</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: 1, fontSize: 11, backgroundColor: '#fff', padding: '6px 10px', borderRadius: 4, border: '1px solid #86EFAC', wordBreak: 'break-all', color: '#0D1117' }}>{createdKey}</code>
              <button onClick={() => navigator.clipboard.writeText(createdKey)} style={{ padding: '5px 10px', border: '1px solid #86EFAC', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Copy size={11} /> Copy
              </button>
              <button onClick={() => setCreatedKey(null)} style={{ padding: '5px 10px', border: '1px solid #86EFAC', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: '#166534' }}>Dismiss</button>
            </div>
          </div>
        )}

        {tab === 'endpoints' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Create endpoint form */}
            <div style={{ padding: '14px 16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Publish an Object Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={newEpOtId} onChange={e => { setNewEpOtId(e.target.value); const ot = objectTypes.find(o => o.id === e.target.value); if (ot) setNewEpSlug(ot.name.toLowerCase().replace(/\s+/g, '-')); }} style={{ height: 32, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, flex: 1, minWidth: 160 }}>
                  <option value="">Select object type...</option>
                  {objectTypes.map(ot => <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>)}
                </select>
                <input placeholder="URL slug (e.g. customers)" value={newEpSlug} onChange={e => setNewEpSlug(e.target.value)} style={{ height: 32, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, flex: 1, minWidth: 160, outline: 'none' }} />
                <button onClick={createEndpoint} disabled={!newEpOtId || !newEpSlug.trim()} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 4, backgroundColor: '#2563EB', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={12} /> Publish
                </button>
              </div>
            </div>

            {/* Endpoint list */}
            {endpoints.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 32 }}>No endpoints published yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {endpoints.map(ep => (
                  <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                    <Globe size={14} style={{ color: '#2563EB', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{ep.object_type_name}</div>
                      <code style={{ fontSize: 11, color: '#64748B' }}>{baseUrl}/v1/{ep.slug}</code>
                    </div>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, backgroundColor: ep.enabled ? '#DCFCE7' : '#F1F5F9', color: ep.enabled ? '#16A34A' : '#64748B' }}>
                      {ep.enabled ? 'Active' : 'Disabled'}
                    </span>
                    <button onClick={() => navigator.clipboard.writeText(`${baseUrl}/v1/${ep.slug}`)} style={{ padding: '4px 8px', border: '1px solid #E2E8F0', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', fontSize: 11, color: '#64748B', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Copy size={10} /> Copy URL
                    </button>
                    <button onClick={() => deleteEndpoint(ep.id)} style={{ padding: '4px 8px', border: '1px solid #FEE2E2', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', color: '#DC2626', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'keys' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Create key form */}
            <div style={{ padding: '14px 16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Create API Key</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Key name (e.g. Production App)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createKey()} style={{ flex: 1, height: 32, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }} />
                <button onClick={createKey} disabled={!newKeyName.trim()} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 4, backgroundColor: '#2563EB', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={12} /> Create
                </button>
              </div>
            </div>

            {/* Keys list */}
            {keys.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 32 }}>No API keys yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {keys.map(k => (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                    <Key size={14} style={{ color: '#7C3AED', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{k.name}</div>
                      <code style={{ fontSize: 11, color: '#64748B' }}>{k.key_prefix}••••••••••••••••••</code>
                      {k.last_used_at && <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 8 }}>Last used {new Date(k.last_used_at).toLocaleDateString()}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {k.scopes.map(s => <span key={s} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, backgroundColor: '#EFF6FF', color: '#2563EB' }}>{s}</span>)}
                    </div>
                    <button onClick={() => toggleKey(k.id)} style={{ padding: '4px 8px', border: '1px solid #E2E8F0', borderRadius: 4, backgroundColor: k.enabled ? '#DCFCE7' : '#F1F5F9', cursor: 'pointer', fontSize: 11, color: k.enabled ? '#16A34A' : '#64748B', display: 'flex', alignItems: 'center', gap: 3 }}>
                      {k.enabled ? <Eye size={10} /> : <EyeOff size={10} />} {k.enabled ? 'Active' : 'Disabled'}
                    </button>
                    <button onClick={() => deleteKey(k.id)} style={{ padding: '4px 8px', border: '1px solid #FEE2E2', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer', color: '#DC2626', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiGatewayPage;
