import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Sparkles, Loader, LayoutDashboard } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useNavigationStore } from '../../store/navigationStore';
import { NexusApp, AppComponent } from '../../types/app';
import { getTenantId } from '../../store/authStore';
import AppEditor from './AppEditor';
import { uuid as genId } from '../../lib/uuid';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

// ── Types ──────────────────────────────────────────────────────────────────

interface OntologyObjectType {
  id: string;
  name: string;
  properties: Array<{ name: string; displayName?: string }>;
}

// ── New App Modal ──────────────────────────────────────────────────────────

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  'kpi-banner': 'KPI Banner',
  'metric-card': 'Metric Card',
  'data-table': 'Data Table',
  'bar-chart': 'Bar Chart',
  'text-block': 'Text Block',
};

const NewAppModal: React.FC<{
  onClose: () => void;
  onCreated: (app: NexusApp) => void;
}> = ({ onClose, onCreated }) => {
  const [step, setStep] = useState<'describe' | 'generating' | 'preview'>('describe');
  const [genStatus, setGenStatus] = useState('');
  const [description, setDescription] = useState('');
  const [selectedOtIds, setSelectedOtIds] = useState<string[]>([]);
  const [objectTypes, setObjectTypes] = useState<OntologyObjectType[]>([]);
  const [error, setError] = useState('');
  const [pendingApp, setPendingApp] = useState<NexusApp | null>(null);

  useEffect(() => {
    fetch(`${ONTOLOGY_API}/object-types`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.json())
      .then((d) => {
        const ots: OntologyObjectType[] = (d.object_types || d || []).map((o: Record<string, unknown>) => ({
          id: o.id,
          name: o.name || o.displayName,
          properties: (o.properties as Array<{ name: string }>) || [],
        }));
        setObjectTypes(ots);
        if (ots.length > 0) setSelectedOtIds([ots[0].id]);
      })
      .catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!description.trim() || selectedOtIds.length === 0) {
      setError('Please enter a description and select at least one object type.');
      return;
    }
    setError('');
    setStep('generating');
    setGenStatus('Fetching sample data from ontology...');

    // Use first selected OT for generation prompt context
    const primaryOtId = selectedOtIds[0];
    const ot = objectTypes.find((o) => o.id === primaryOtId);
    const allSelectedOts = selectedOtIds.map(id => objectTypes.find(o => o.id === id)).filter(Boolean);
    const properties = allSelectedOts.flatMap(o => (o?.properties || []).map(p => p.name));

    try {
      const recordsResp = await fetch(
        `${ONTOLOGY_API}/object-types/${primaryOtId}/records`,
        { headers: { 'x-tenant-id': getTenantId() } }
      );
      const recordsData = recordsResp.ok ? await recordsResp.json() : {};
      const sampleRows: Record<string, unknown>[] = (recordsData.records || []).slice(0, 7);

      setGenStatus('Sending prompt to Claude...');
      const resp = await fetch(`${INFERENCE_API}/infer/generate-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          object_type_id: primaryOtId,
          object_type_name: allSelectedOts.map(o => o?.name).join(', ') || 'Object',
          properties: [...new Set(properties)],
          sample_rows: sampleRows,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const detail = errBody.detail || `HTTP ${resp.status}`;
        setStep('describe');
        setError(`Claude returned an error: ${detail}`);
        return;
      }

      const layout: Record<string, unknown> = await resp.json();
      const now = new Date().toISOString();
      const app: NexusApp = {
        id: genId(),
        name: String(layout.app_name || `${ot?.name} Dashboard`),
        description: String(layout.app_description || description),
        icon: '',
        components: ((layout.components as AppComponent[]) || []).map((c, i) => ({
          ...c,
          id: c.id || `c${i + 1}`,
        })),
        objectTypeIds: selectedOtIds,
        createdAt: now,
        updatedAt: now,
      };

      setPendingApp(app);
      setStep('preview');
    } catch (e) {
      setStep('describe');
      setError(`Could not reach inference service. Is it running? (${String(e)})`);
    }
  };

  const handleConfirm = () => {
    if (pendingApp) onCreated(pendingApp);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        width: step === 'preview' ? 600 : 520,
        maxWidth: '92vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        overflow: 'hidden',
        transition: 'width 200ms ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <Sparkles size={16} color="#2563EB" />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>
            {step === 'preview' ? 'Review generated app' : 'Build a new app'}
          </span>
          {step === 'preview' && (
            <span style={{
              marginLeft: 'auto', fontSize: 11, color: '#16A34A',
              backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0',
              padding: '2px 8px', borderRadius: 4, fontWeight: 500,
            }}>
              Claude designed this
            </span>
          )}
        </div>

        {/* ── Describe step ── */}
        {step === 'describe' && (
          <div style={{ padding: '24px' }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
                What do you want to build?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Show me a table with the top 10 deals that moved recently, calls with summaries, and new deals per week"
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#0D1117',
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
                Data sources <span style={{ fontWeight: 400, color: '#94A3B8' }}>(select one or more)</span>
              </label>
              {objectTypes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  No object types found. Create one in the Ontology module first.
                </div>
              ) : (
                <div style={{
                  border: '1px solid #E2E8F0', borderRadius: 6, maxHeight: 160,
                  overflowY: 'auto', backgroundColor: '#fff',
                }}>
                  {objectTypes.map((ot) => {
                    const checked = selectedOtIds.includes(ot.id);
                    return (
                      <label
                        key={ot.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 12px', cursor: 'pointer',
                          backgroundColor: checked ? '#EFF6FF' : 'transparent',
                          borderBottom: '1px solid #F1F5F9',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedOtIds(prev =>
                              prev.includes(ot.id)
                                ? prev.filter(id => id !== ot.id)
                                : [...prev, ot.id]
                            );
                          }}
                          style={{ accentColor: '#2563EB' }}
                        />
                        <span style={{ fontSize: 13, color: '#0D1117' }}>{ot.name}</span>
                        <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 'auto' }}>
                          {ot.properties.length} fields
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <div style={{
                fontSize: 12, color: '#DC2626', marginBottom: 16,
                backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: 6, padding: '8px 12px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{
                padding: '8px 16px', border: '1px solid #E2E8F0', borderRadius: 6,
                fontSize: 13, color: '#64748B', backgroundColor: '#fff', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!description.trim() || selectedOtIds.length === 0}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 500, color: '#fff',
                  backgroundColor: description.trim() && selectedOtIds.length > 0 ? '#2563EB' : '#94A3B8',
                  cursor: description.trim() && selectedOtIds.length > 0 ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Sparkles size={13} />
                Generate with Claude
              </button>
            </div>
          </div>
        )}

        {/* ── Generating step ── */}
        {step === 'generating' && (
          <div style={{
            padding: '48px 24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          }}>
            <Loader size={28} color="#2563EB" style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: '#0D1117' }}>{genStatus}</div>
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
              Claude is reading your data and designing the layout — takes 10-20s
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Preview step ── */}
        {step === 'preview' && pendingApp && (
          <div style={{ padding: '20px 24px' }}>
            {/* App name + description */}
            <div style={{
              backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
              borderRadius: 8, padding: '14px 16px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', marginBottom: 4 }}>
                {pendingApp.name}
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{pendingApp.description}</div>
            </div>

            {/* Component list */}
            <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
              Components Claude will build ({pendingApp.components.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {pendingApp.components.map((c) => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', border: '1px solid #E2E8F0',
                  borderRadius: 6, backgroundColor: '#fff',
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#2563EB',
                    backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE',
                    padding: '2px 6px', borderRadius: 3, flexShrink: 0, marginTop: 1,
                    whiteSpace: 'nowrap',
                  }}>
                    {COMPONENT_TYPE_LABELS[c.type] || c.type}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#0D1117' }}>{c.title}</div>
                    {c.columns && c.columns.length > 0 && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                        Columns: {c.columns.slice(0, 6).join(', ')}{c.columns.length > 6 ? ` +${c.columns.length - 6} more` : ''}
                      </div>
                    )}
                    {c.type === 'metric-card' && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                        {c.aggregation || 'count'}{c.field ? ` of ${c.field}` : ''}
                      </div>
                    )}
                    {c.type === 'bar-chart' && c.labelField && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                        By {c.labelField}{c.valueField ? ` vs ${c.valueField}` : ''}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: '#CBD5E1', flexShrink: 0 }}>
                    {c.colSpan || 6}/12
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => { setStep('describe'); setPendingApp(null); setError(''); }}
                style={{
                  padding: '8px 16px', border: '1px solid #E2E8F0', borderRadius: 6,
                  fontSize: 13, color: '#64748B', backgroundColor: '#fff', cursor: 'pointer',
                }}
              >
                Regenerate
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 500, color: '#fff',
                  backgroundColor: '#2563EB', cursor: 'pointer',
                }}
              >
                Create App
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── App Card ───────────────────────────────────────────────────────────────

const AppCard: React.FC<{
  app: NexusApp;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ app, onOpen, onDelete }) => (
  <div style={{
    backgroundColor: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: '20px',
    cursor: 'pointer',
    transition: 'box-shadow 120ms, border-color 120ms',
    position: 'relative',
  }}
    onClick={onOpen}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
      (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1';
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
    }}
  >
    <div style={{
      width: 40, height: 40, borderRadius: 8, marginBottom: 12,
      backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, fontWeight: 700, color: '#2563EB',
    }}>
      {app.name.charAt(0).toUpperCase()}
    </div>
    <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', marginBottom: 4 }}>
      {app.name}
    </div>
    <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.5, marginBottom: 16 }}>
      {app.description}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11, color: '#94A3B8' }}>
        {app.components.length} components · {new Date(app.createdAt).toLocaleDateString()}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{
            padding: '4px 10px',
            border: '1px solid #E2E8F0',
            borderRadius: 5,
            fontSize: 11,
            color: '#2563EB',
            backgroundColor: '#EFF6FF',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ExternalLink size={11} />
          Open
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            padding: '4px 8px',
            border: '1px solid #FEE2E2',
            borderRadius: 5,
            fontSize: 11,
            color: '#DC2626',
            backgroundColor: '#FFF5F5',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  </div>
);

// ── Apps Page ──────────────────────────────────────────────────────────────

const AppsPage: React.FC = () => {
  const { apps, addApp, deleteApp, fetchApps } = useAppStore();
  const { navigateTo, currentPage } = useNavigationStore();
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetchApps();
  }, []);

  // Support direct nav via app-{id} route
  const routeAppId = currentPage.startsWith('app-') ? currentPage.slice(4) : null;
  const [openAppId, setOpenAppId] = useState<string | null>(routeAppId);

  // Sync if route changes
  React.useEffect(() => {
    if (routeAppId) setOpenAppId(routeAppId);
    else if (currentPage === 'apps') setOpenAppId(null);
  }, [currentPage, routeAppId]);

  const openApp = apps.find((a) => a.id === openAppId);

  const handleCreated = async (app: NexusApp) => {
    const created = await addApp(app);
    setShowNew(false);
    setOpenAppId(created.id);
  };

  const handleBlank = async () => {
    const now = new Date().toISOString();
    const blank: NexusApp = {
      id: genId(),
      name: 'Untitled App',
      description: 'Blank app',
      icon: '',
      components: [],
      objectTypeIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const created = await addApp(blank);
    setOpenAppId(created.id);
  };

  // If viewing an app
  if (openApp) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* App topbar */}
        <div style={{
          height: 52,
          backgroundColor: '#fff',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 52px 0 20px',
          gap: 10,
          flexShrink: 0,
        }}>
          <button
            onClick={() => { setOpenAppId(null); navigateTo('apps'); }}
            style={{
              padding: '4px 10px',
              border: '1px solid #E2E8F0',
              borderRadius: 5,
              fontSize: 12,
              color: '#64748B',
              backgroundColor: '#fff',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#2563EB', flexShrink: 0,
          }}>
            {openApp.name.charAt(0).toUpperCase()}
          </div>
          <input
            defaultValue={openApp.name}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && val !== openApp.name) {
                useAppStore.getState().updateApp(openApp.id, { name: val });
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{
              fontSize: 15, fontWeight: 600, color: '#0D1117',
              border: 'none', outline: 'none', background: 'transparent',
              minWidth: 100, maxWidth: 260,
            }}
          />
          <span style={{ fontSize: 12, color: '#94A3B8' }}>{openApp.description}</span>
        </div>

        {/* App editor (view / edit / code) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <AppEditor app={openApp} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 52,
        backgroundColor: '#fff',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 52px 0 24px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontSize: 16, fontWeight: 500, color: '#0D1117' }}>Dashboards</h1>
          <span style={{
            fontSize: 11,
            backgroundColor: '#EFF6FF',
            color: '#2563EB',
            padding: '2px 8px',
            borderRadius: 2,
            fontWeight: 500,
          }}>
            {apps.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleBlank}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', border: '1px solid #E2E8F0',
              borderRadius: 6, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', backgroundColor: '#fff', color: '#374151',
            }}
          >
            <Plus size={14} />
            Blank App
          </button>
          <button
            onClick={() => setShowNew(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', backgroundColor: '#2563EB',
              color: '#fff', border: 'none', borderRadius: 6,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Sparkles size={14} />
            Generate with Claude
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {apps.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '60vh', gap: 20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12,
              backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <LayoutDashboard size={24} color="#2563EB" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#0D1117', textAlign: 'center', marginBottom: 6 }}>
                No apps yet
              </div>
              <div style={{ fontSize: 13, color: '#64748B', textAlign: 'center', maxWidth: 360 }}>
                Build dashboards wired to your ontology objects — drag widgets onto a canvas,
                configure fields, and see live data instantly.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleBlank}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', border: '1px solid #E2E8F0',
                  borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', backgroundColor: '#fff', color: '#374151',
                }}
              >
                <Plus size={16} />
                Start blank
              </button>
              <button
                onClick={() => setShowNew(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', backgroundColor: '#2563EB',
                  color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                }}
              >
                <Sparkles size={16} />
                Generate with Claude
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onOpen={() => setOpenAppId(app.id)}
                onDelete={() => deleteApp(app.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewAppModal
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};

// ── Template fallback (client-side) ───────────────────────────────────────

function buildFallbackLayout(
  objectTypeId: string,
  objectTypeName: string,
  properties: string[],
  description: string,
): Record<string, unknown> {
  const flatProps = properties.filter((p) => !p.endsWith('[]'));
  const tableCols = flatProps.slice(0, 8);
  const nameField = flatProps.find((p) =>
    ['name', 'company_name', 'firstname', 'title'].includes(p)
  ) || flatProps[0];

  const components: AppComponent[] = [
    {
      id: 'c1',
      type: 'kpi-banner',
      title: `${objectTypeName} Overview`,
      objectTypeId,
      colSpan: 12,
    },
    {
      id: 'c2',
      type: 'metric-card',
      title: 'Total Records',
      objectTypeId,
      aggregation: 'count',
      colSpan: 3,
    },
  ];

  if (nameField) {
    components.push({
      id: 'c3',
      type: 'bar-chart',
      title: `Records by ${nameField}`,
      objectTypeId,
      labelField: nameField,
      colSpan: 12,
    });
  }

  if (tableCols.length) {
    components.push({
      id: 'c4',
      type: 'data-table',
      title: `All ${objectTypeName} Records`,
      objectTypeId,
      columns: tableCols,
      maxRows: 20,
      colSpan: 12,
    });
  }

  return {
    app_name: `${objectTypeName} Dashboard`,
    app_description: description || `Overview of ${objectTypeName} data`,
    icon: '',
    components,
  };
}

export default AppsPage;
