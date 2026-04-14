import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const QUALITY_API = import.meta.env.VITE_DATA_QUALITY_SERVICE_URL || 'http://localhost:8019';

interface TypeSummary {
  object_type_id: string;
  display_name: string;
  total_records: number;
  score: number;
  computed_at: string;
  error?: string;
}

interface PropertyProfile {
  name: string;
  total: number;
  null_count: number;
  null_rate: number;
  distinct_count: number;
  unique_rate: number;
  top_values: { value: string; count: number }[];
}

interface QualityProfile {
  object_type_id: string;
  total_records: number;
  score: number;
  properties: PropertyProfile[];
  computed_at: string;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? '#16A34A' : score >= 60 ? '#D97706' : '#DC2626';
  const bg = score >= 80 ? '#DCFCE7' : score >= 60 ? '#FEF3C7' : '#FEE2E2';
  const Icon = score >= 80 ? ShieldCheck : score >= 60 ? AlertTriangle : XCircle;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, backgroundColor: bg, color, fontSize: 12, fontWeight: 600 }}>
      <Icon size={11} />
      {score.toFixed(0)}
    </div>
  );
}

function NullBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct === 0 ? '#16A34A' : pct < 20 ? '#D97706' : '#DC2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3, transition: 'width 300ms' }} />
      </div>
      <span style={{ fontSize: 11, color: '#64748B', width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

const DataQualityPage: React.FC = () => {
  const [summary, setSummary] = useState<TypeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<QualityProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const headers = { 'x-tenant-id': getTenantId() };

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${QUALITY_API}/quality/summary`, { headers });
      if (res.ok) setSummary(await res.json());
    } finally { setLoading(false); }
  };

  const loadProfile = async (id: string) => {
    setProfileLoading(true);
    setProfile(null);
    try {
      const res = await fetch(`${QUALITY_API}/quality/${id}`, { headers });
      if (res.ok) setProfile(await res.json());
    } finally { setProfileLoading(false); }
  };

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { if (selectedId) loadProfile(selectedId); }, [selectedId]);

  const selectedType = summary.find(s => s.object_type_id === selectedId);

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#F8FAFC', overflow: 'hidden' }}>
      {/* Left panel — object type list */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>Data Quality</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>{summary.length} object types</div>
          </div>
          <button
            onClick={loadSummary}
            disabled={loading}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, display: 'flex', opacity: loading ? 0.5 : 1 }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {summary.length === 0 && !loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No object types found</div>
          )}
          {summary.map(type => (
            <div
              key={type.object_type_id}
              onClick={() => setSelectedId(type.object_type_id)}
              style={{
                padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9',
                backgroundColor: selectedId === type.object_type_id ? '#EFF6FF' : 'transparent',
                transition: 'background-color 80ms',
              }}
              onMouseEnter={e => { if (selectedId !== type.object_type_id) (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'; }}
              onMouseLeave={e => { if (selectedId !== type.object_type_id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{type.display_name}</span>
                <ScoreBadge score={type.score} />
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>{type.total_records.toLocaleString()} records</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — profile detail */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {!selectedId && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
            Select an object type to view its quality profile
          </div>
        )}

        {selectedId && (
          <>
            {/* Header */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0D1117' }}>{selectedType?.display_name}</div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                  {profile ? `${profile.total_records.toLocaleString()} records · Profiled ${new Date(profile.computed_at).toLocaleString()}` : 'Loading...'}
                </div>
              </div>
              {profile && <ScoreBadge score={profile.score} />}
              <button
                onClick={() => selectedId && loadProfile(selectedId)}
                style={{ padding: '5px 12px', border: '1px solid #E2E8F0', borderRadius: 5, backgroundColor: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <RefreshCw size={11} /> Re-run
              </button>
            </div>

            {/* Property profiles */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {profileLoading && (
                <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, paddingTop: 40 }}>Profiling...</div>
              )}
              {!profileLoading && profile && profile.properties.length === 0 && (
                <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, paddingTop: 40 }}>
                  {profile.total_records === 0 ? 'No records to profile' : 'No properties found on this object type'}
                </div>
              )}
              {!profileLoading && profile && profile.properties.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Summary cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 }}>
                    {[
                      { label: 'Quality Score', value: `${profile.score.toFixed(0)}/100` },
                      { label: 'Total Records', value: profile.total_records.toLocaleString() },
                      { label: 'Properties Profiled', value: profile.properties.length },
                    ].map(card => (
                      <div key={card.label} style={{ padding: '12px 16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>{card.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#0D1117' }}>{card.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Property table */}
                  <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                          {['Property', 'Null Rate', 'Unique Rate', 'Distinct Values', 'Top Values'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {profile.properties.map((prop, i) => (
                          <tr key={prop.name} style={{ borderBottom: i < profile.properties.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                            <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 500, color: '#0D1117', fontFamily: 'monospace' }}>{prop.name}</td>
                            <td style={{ padding: '8px 12px', minWidth: 120 }}><NullBar rate={prop.null_rate} /></td>
                            <td style={{ padding: '8px 12px', fontSize: 12, color: '#374151' }}>{(prop.unique_rate * 100).toFixed(0)}%</td>
                            <td style={{ padding: '8px 12px', fontSize: 12, color: '#374151' }}>{prop.distinct_count.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {prop.top_values.slice(0, 3).map(tv => (
                                  <span key={tv.value} style={{ fontSize: 10, padding: '1px 6px', backgroundColor: '#F1F5F9', borderRadius: 3, color: '#475569', whiteSpace: 'nowrap' }}>
                                    {String(tv.value).slice(0, 20)}{String(tv.value).length > 20 ? '…' : ''} ({tv.count})
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DataQualityPage;
