import React, { useState, useEffect } from 'react';
import { Play, RefreshCw, ShieldCheck, AlertTriangle, ChevronRight } from 'lucide-react';
import { getTenantId } from '../../store/authStore';
import { useOntologyStore } from '../../store/ontologyStore';

const INFERENCE_URL = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B',
  success: '#059669', successDim: '#ECFDF5',
  warn: '#D97706', warnDim: '#FEF3C7',
  error: '#DC2626', errorDim: '#FEE2E2',
};

interface PiiHit {
  field: string;
  pii_level: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  reason: string;
  sample_match?: string;
}

interface PiiScanResult {
  object_type_id: string;
  object_type_name?: string;
  total_records_scanned: number;
  hits: PiiHit[];
  scanned_at?: string;
}

const fetchJSON = async (url: string, opts: RequestInit = {}) => {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId(), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

const PII_LEVEL_COLORS: Record<string, { bg: string; fg: string }> = {
  NONE:   { bg: C.successDim, fg: C.success },
  LOW:    { bg: C.warnDim,    fg: C.warn },
  MEDIUM: { bg: C.warnDim,    fg: C.warn },
  HIGH:   { bg: C.errorDim,   fg: C.error },
};

const PiiScanTab: React.FC = () => {
  const objectTypes = useOntologyStore(s => s.objectTypes);
  const fetchObjectTypes = useOntologyStore(s => s.fetchObjectTypes);

  const [scanning, setScanning] = useState<string | 'all' | null>(null);
  const [results, setResults] = useState<Record<string, PiiScanResult>>({});
  const [allScanId, setAllScanId] = useState<string | null>(null);
  const [allStatus, setAllStatus] = useState<string | null>(null);
  const [allResults, setAllResults] = useState<PiiScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchObjectTypes(); /* eslint-disable-next-line */ }, []);

  const scanOne = async (otId: string) => {
    setScanning(otId); setError(null);
    try {
      const data = await fetchJSON(`${INFERENCE_URL}/infer/scan-pii`, {
        method: 'POST',
        body: JSON.stringify({ object_type_id: otId }),
      });
      setResults(prev => ({ ...prev, [otId]: { ...data, object_type_id: otId, scanned_at: new Date().toISOString() } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(null);
    }
  };

  const scanAll = async () => {
    setScanning('all'); setError(null); setAllResults([]);
    try {
      const data = await fetchJSON(`${INFERENCE_URL}/infer/scan-all`, { method: 'POST' });
      setAllScanId(data.scan_id);
      setAllStatus(data.status || 'running');
      // Poll for results
      const poll = async () => {
        try {
          const r = await fetchJSON(`${INFERENCE_URL}/infer/scan-results/${data.scan_id}`);
          setAllStatus(r.status || null);
          if (r.results) setAllResults(r.results);
          if (r.status === 'running' || r.status === 'pending') {
            setTimeout(poll, 2500);
          } else {
            setScanning(null);
          }
        } catch (e) {
          setError((e as Error).message);
          setScanning(null);
        }
      };
      setTimeout(poll, 1500);
    } catch (e) {
      setError((e as Error).message);
      setScanning(null);
    }
  };

  const totalHits = (r: PiiScanResult) => r.hits.filter(h => h.pii_level !== 'NONE').length;
  const highHits = (r: PiiScanResult) => r.hits.filter(h => h.pii_level === 'HIGH').length;

  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>PII Scanner</div>
          <div style={{ fontSize: 12, color: C.muted, maxWidth: 540 }}>
            Detect PII fields across your ontology (regex pre-filter + Claude verification). HIGH-PII fields are masked from viewers automatically.
          </div>
        </div>
        <button
          onClick={scanAll}
          disabled={scanning === 'all'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: scanning === 'all' ? 'not-allowed' : 'pointer', opacity: scanning === 'all' ? 0.6 : 1 }}
        >
          {scanning === 'all' ? <RefreshCw size={13} style={{ animation: 'spin 0.6s linear infinite' }} /> : <ShieldCheck size={13} />}
          {scanning === 'all' ? `Scanning… (${allStatus || ''})` : 'Scan all object types'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 16, backgroundColor: C.errorDim, border: `1px solid ${C.error}`, borderRadius: 4, color: C.error, fontSize: 12 }}>
          {error}
        </div>
      )}

      {allResults.length > 0 && (
        <div style={{ marginBottom: 24, padding: 14, backgroundColor: C.successDim, border: `1px solid ${C.success}`, borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: C.success, marginBottom: 6 }}>Sweep complete · {allResults.length} object types scanned</div>
          <div style={{ color: C.text }}>
            High-risk fields found: <strong>{allResults.reduce((sum, r) => sum + r.hits.filter(h => h.pii_level === 'HIGH').length, 0)}</strong>
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Object types</div>
      <div style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
        {objectTypes.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No object types in this tenant.</div>
        )}
        {objectTypes.map((ot: any, idx) => {
          const r = results[ot.id];
          const allMatch = allResults.find(a => a.object_type_id === ot.id);
          const display = r || allMatch;
          return (
            <div key={ot.id} style={{ padding: '12px 14px', borderBottom: idx < objectTypes.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{ot.displayName || ot.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{(ot.properties || []).length} properties</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {display && (
                    <>
                      <span style={{ fontSize: 11, color: C.muted }}>{display.total_records_scanned} records scanned</span>
                      {totalHits(display) > 0 ? (
                        <span style={{ padding: '3px 9px', borderRadius: 3, fontSize: 11, fontWeight: 500, backgroundColor: highHits(display) > 0 ? C.errorDim : C.warnDim, color: highHits(display) > 0 ? C.error : C.warn }}>
                          {totalHits(display)} PII hit{totalHits(display) !== 1 ? 's' : ''}
                          {highHits(display) > 0 && ` (${highHits(display)} HIGH)`}
                        </span>
                      ) : (
                        <span style={{ padding: '3px 9px', borderRadius: 3, fontSize: 11, fontWeight: 500, backgroundColor: C.successDim, color: C.success }}>Clean</span>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => scanOne(ot.id)}
                    disabled={scanning === ot.id || scanning === 'all'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500, backgroundColor: scanning === ot.id ? C.accentDim : '#FFF', color: scanning === ot.id ? C.accent : C.muted, border: `1px solid ${C.border}`, cursor: scanning === ot.id ? 'wait' : 'pointer' }}
                  >
                    {scanning === ot.id ? <RefreshCw size={11} style={{ animation: 'spin 0.6s linear infinite' }} /> : <Play size={11} />}
                    {scanning === ot.id ? 'Scanning…' : (display ? 'Re-scan' : 'Scan')}
                  </button>
                </div>
              </div>

              {display && totalHits(display) > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: C.muted }}>{totalHits(display)} field{totalHits(display) !== 1 ? 's' : ''} flagged · click to view</summary>
                  <div style={{ marginTop: 8 }}>
                    {display.hits.filter(h => h.pii_level !== 'NONE').map((hit, i) => {
                      const colors = PII_LEVEL_COLORS[hit.pii_level] || PII_LEVEL_COLORS.NONE;
                      return (
                        <div key={i} style={{ padding: '6px 10px', marginBottom: 4, backgroundColor: C.bg, borderRadius: 3, fontSize: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ padding: '2px 7px', borderRadius: 3, fontWeight: 600, backgroundColor: colors.bg, color: colors.fg }}>{hit.pii_level}</span>
                          <span style={{ fontFamily: 'monospace', color: C.text }}>{hit.field}</span>
                          <ChevronRight size={11} color={C.muted} />
                          <span style={{ color: C.muted, flex: 1 }}>{hit.reason}</span>
                          {hit.confidence > 0 && <span style={{ color: C.muted }}>{Math.round(hit.confidence * 100)}%</span>}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, padding: 12, backgroundColor: C.warnDim, border: `1px solid ${C.warn}`, borderRadius: 4, fontSize: 11, color: C.text, display: 'flex', gap: 8 }}>
        <AlertTriangle size={14} color={C.warn} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>HIGH-PII fields are masked for users with role <code>viewer</code>. Adjust PII levels per-property in the ontology editor (Object Types).</span>
      </div>
    </div>
  );
};

export default PiiScanTab;
