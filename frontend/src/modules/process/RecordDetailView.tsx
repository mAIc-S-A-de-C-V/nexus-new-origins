import React, { useEffect, useState } from 'react';
import { useOntologyStore } from '../../store/ontologyStore';
import { getTenantId } from '../../store/authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

interface Props {
  objectTypeId: string;
  recordId: string;
  onClose: () => void;
}

export const RecordDetailView: React.FC<Props> = ({ objectTypeId, recordId, onClose }) => {
  const { objectTypes } = useOntologyStore();
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const objectType = objectTypes.find(ot => ot.id === objectTypeId);
  const properties = objectType?.properties || [];

  useEffect(() => {
    if (!objectTypeId || !recordId) return;
    setLoading(true);
    setError(null);
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/records/${encodeURIComponent(recordId)}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then(res => {
        if (!res.ok) throw new Error(`Record not found (${res.status})`);
        return res.json();
      })
      .then(data => setRecord(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [objectTypeId, recordId]);

  // Find a title from the first string property
  const titleProp = properties.find(p => p.dataType === 'string' || p.semanticType === 'TEXT');
  const title = record && titleProp ? String(record[titleProp.name] || '') : recordId;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
      backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.08)', zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      animation: 'slideIn 200ms ease-out',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '14px 20px',
        borderBottom: '1px solid #E2E8F0', flexShrink: 0, gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: '#0D1117',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {objectType?.displayName || objectType?.name || objectTypeId}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 30, height: 30, borderRadius: 6,
            border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
            color: '#64748B', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          x
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8', fontSize: 13 }}>
            Loading record...
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#DC2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && record && (
          <>
            {/* Section header */}
            <div style={{
              fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 12,
            }}>
              Properties
            </div>

            {/* Properties grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px',
              backgroundColor: '#E2E8F0', borderRadius: 8, overflow: 'hidden',
              border: '1px solid #E2E8F0',
            }}>
              {properties.map(prop => {
                const rawValue = record[prop.name];
                const isPii = prop.piiLevel !== 'NONE' && prop.piiLevel;
                const displayValue = isPii && rawValue === '***REDACTED***'
                  ? '***REDACTED***'
                  : rawValue === null || rawValue === undefined
                    ? '\u2014'
                    : typeof rawValue === 'object'
                      ? JSON.stringify(rawValue)
                      : String(rawValue);

                return (
                  <div key={prop.id} style={{
                    padding: '10px 14px', backgroundColor: '#FFFFFF',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 600, color: '#94A3B8',
                      textTransform: 'uppercase', letterSpacing: '0.03em',
                      marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {prop.displayName || prop.name}
                      {isPii && rawValue === '***REDACTED***' && (
                        <span style={{
                          fontSize: 8, padding: '1px 4px', borderRadius: 3,
                          backgroundColor: '#FEF2F2', color: '#DC2626', fontWeight: 700,
                        }}>PII</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 12, color: rawValue === '***REDACTED***' ? '#DC2626' : '#0D1117',
                      fontWeight: 500,
                      fontFamily: typeof rawValue === 'number' ? 'var(--font-mono)' : 'inherit',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {displayValue}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Raw record ID */}
            <div style={{ marginTop: 20 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase',
                letterSpacing: '0.05em', marginBottom: 6,
              }}>
                Record ID
              </div>
              <div style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', color: '#94A3B8',
                padding: '8px 12px', backgroundColor: '#F8FAFC', borderRadius: 6,
                border: '1px solid #E2E8F0', wordBreak: 'break-all',
              }}>
                {recordId}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
