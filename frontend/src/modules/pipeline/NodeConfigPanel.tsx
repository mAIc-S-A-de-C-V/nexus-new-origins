import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { PipelineNode } from '../../types/pipeline';
import { NODE_TYPE_DEFS } from './pipelineTypes';
import { Button } from '../../design-system/components/Button';
import { nodeColors } from '../../design-system/tokens';
import { useConnectorStore } from '../../store/connectorStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { getTenantId } from '../../store/authStore';

const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';

interface AgentOption { id: string; name: string; }

interface NodeConfigPanelProps {
  node: PipelineNode;
  onClose: () => void;
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void;
}

const CONNECTOR_FIELDS = new Set(['connectorId', 'lookupConnectorId']);
const OBJECT_TYPE_FIELDS = new Set(['objectTypeId']);
const AGENT_FIELDS = new Set(['agentId']);
const MODEL_FIELDS = new Set(['model']);

interface ModelOption { id: string; label: string; provider: string }

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ node, onClose, onUpdate }) => {
  const def = NODE_TYPE_DEFS.find((d) => d.type === node.type);
  const [config, setConfig] = useState<Record<string, unknown>>(node.config || {});
  const color = nodeColors[node.type] || '#64748B';

  const { connectors, fetchConnectors } = useConnectorStore();
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [tenantModels, setTenantModels] = useState<ModelOption[]>([]);

  const needsConnectors = def?.configFields.some((f) => CONNECTOR_FIELDS.has(f.key));
  const needsObjectTypes = def?.configFields.some((f) => OBJECT_TYPE_FIELDS.has(f.key));
  const needsAgents = def?.configFields.some((f) => AGENT_FIELDS.has(f.key));
  const needsModels = def?.configFields.some((f) => MODEL_FIELDS.has(f.key));

  useEffect(() => {
    if (needsConnectors && connectors.length === 0) fetchConnectors();
    if (needsObjectTypes && objectTypes.length === 0) fetchObjectTypes();
    if (needsAgents && agents.length === 0) {
      fetch(`${AGENT_API}/agents`, { headers: { 'x-tenant-id': getTenantId() } })
        .then(r => r.ok ? r.json() : [])
        .then(data => setAgents(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
    if (needsModels && tenantModels.length === 0) {
      fetch(`${AGENT_API}/model-providers`, { headers: { 'x-tenant-id': getTenantId() } })
        .then(r => r.ok ? r.json() : [])
        .then((providers: Array<{ name: string; enabled: boolean; models: Array<{ id: string; label?: string }> }>) => {
          const flat: ModelOption[] = [];
          for (const p of (Array.isArray(providers) ? providers : [])) {
            if (p.enabled === false) continue;
            for (const m of (p.models || [])) {
              flat.push({ id: m.id, label: m.label || m.id, provider: p.name });
            }
          }
          setTenantModels(flat);
        })
        .catch(() => {});
    }
  }, [needsConnectors, needsObjectTypes, needsAgents, needsModels]);

  const handleChange = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onUpdate(node.id, config);
    onClose();
  };

  if (!def) return null;

  return (
    <div style={{ width: '280px', backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ backgroundColor: color, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {def.type.replace('_', ' ')}
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', marginTop: '1px' }}>{node.label}</div>
        </div>
        <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
          <X size={16} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '10px' }}>{def.description}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748B', marginBottom: '4px' }}>Label</label>
            <input value={node.label} readOnly style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: '#0D1117', backgroundColor: '#F8F9FA', boxSizing: 'border-box' }} />
          </div>

          {def.configFields.map((field) => {
            const currentValue = String(config[field.key] ?? field.default ?? '');
            return (
              <div key={field.key}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748B', marginBottom: '4px' }}>
                  {field.label}
                  {field.required && <span style={{ color: '#DC2626', marginLeft: '2px' }}>*</span>}
                </label>

                {field.type === 'text' || field.type === 'number' ? (
                  <input type={field.type} value={currentValue} onChange={(e) => handleChange(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)} placeholder={field.placeholder}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: '#0D1117', backgroundColor: '#FFFFFF', boxSizing: 'border-box' }} />
                ) : field.type === 'select' && AGENT_FIELDS.has(field.key) ? (
                  <select value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: currentValue ? '#0D1117' : '#94A3B8', backgroundColor: '#FFFFFF' }}>
                    <option value="">Select agent...</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : field.type === 'select' && CONNECTOR_FIELDS.has(field.key) ? (
                  <select value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: currentValue ? '#0D1117' : '#94A3B8', backgroundColor: '#FFFFFF' }}>
                    <option value="">Select connector...</option>
                    {connectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : field.type === 'select' && OBJECT_TYPE_FIELDS.has(field.key) ? (
                  <select value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: currentValue ? '#0D1117' : '#94A3B8', backgroundColor: '#FFFFFF' }}>
                    <option value="">Select object type...</option>
                    {objectTypes.map((ot) => <option key={ot.id} value={ot.id}>{ot.name}</option>)}
                  </select>
                ) : field.type === 'select' && MODEL_FIELDS.has(field.key) ? (
                  <select value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: '#0D1117', backgroundColor: '#FFFFFF' }}>
                    {tenantModels.length > 0 && (
                      <optgroup label="From your providers">
                        {tenantModels.map((m) => (
                          <option key={`tm-${m.id}`} value={m.id}>{m.label} — {m.provider}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Built-in defaults">
                      {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </optgroup>
                  </select>
                ) : field.type === 'select' ? (
                  <select value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)}
                    style={{ width: '100%', height: '30px', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '0 8px', fontSize: '12px', color: '#0D1117', backgroundColor: '#FFFFFF' }}>
                    <option value="">Select...</option>
                    {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : field.type === 'boolean' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={Boolean(config[field.key] ?? field.default)} onChange={(e) => handleChange(field.key, e.target.checked)} />
                    <span style={{ fontSize: '12px', color: '#64748B' }}>Enabled</span>
                  </label>
                ) : (
                  <textarea value={currentValue} onChange={(e) => handleChange(field.key, e.target.value)} placeholder={field.placeholder} rows={4}
                    style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '6px 8px', fontSize: '12px', color: '#0D1117', backgroundColor: '#FFFFFF', fontFamily: field.type === 'code' ? 'var(--font-mono)' : 'var(--font-interface)', resize: 'vertical', lineHeight: '1.5', boxSizing: 'border-box' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '8px' }}>
        <Button variant="primary" size="sm" onClick={handleSave} style={{ flex: 1 }}>Apply</Button>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
};

export default NodeConfigPanel;
