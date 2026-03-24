import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { SchemaDiff, PropertyDiff } from '../../types/ontology';

interface SchemaDiffViewerProps {
  diff: SchemaDiff;
}

const changeTypeConfig: Record<string, { bg: string; rowBg: string; label: string; prefix: string; color: string }> = {
  ADDED: { bg: '#ECFDF5', rowBg: '#F0FDF4', label: 'Added', prefix: '+', color: '#059669' },
  REMOVED: { bg: '#FEF2F2', rowBg: '#FFF5F5', label: 'Removed', prefix: '−', color: '#DC2626' },
  MODIFIED: { bg: '#FEFCE8', rowBg: '#FFFDF0', label: 'Modified', prefix: '~', color: '#D97706' },
};

export const SchemaDiffViewer: React.FC<SchemaDiffViewerProps> = ({ diff }) => {
  return (
    <div style={{
      border: '1px solid #E2E8F0',
      borderRadius: '4px',
      overflow: 'hidden',
      fontFamily: 'var(--font-interface)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        backgroundColor: '#F8F9FA',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>Schema Diff</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: '#64748B', fontFamily: 'var(--font-mono)' }}>
              v{diff.fromVersion}
            </span>
            <ArrowRight size={12} color="#94A3B8" />
            <span style={{ fontSize: '12px', color: '#0D1117', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              v{diff.toVersion}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {(['ADDED', 'REMOVED', 'MODIFIED'] as const).map((ct) => {
            const count = diff.diffs.filter((d) => d.changeType === ct).length;
            if (count === 0) return null;
            const conf = changeTypeConfig[ct];
            return (
              <span key={ct} style={{
                fontSize: '11px', fontWeight: 500,
                color: conf.color, backgroundColor: conf.bg,
                padding: '2px 7px', borderRadius: '2px',
              }}>
                {conf.prefix}{count} {conf.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      </div>

      {/* Breaking change banner */}
      {diff.hasBreakingChanges && (
        <div style={{
          padding: '8px 14px',
          backgroundColor: '#FEF2F2',
          borderBottom: '1px solid #FECACA',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: '#991B1B',
        }}>
          <AlertTriangle size={14} />
          <span>This diff contains breaking changes that may affect downstream consumers.</span>
        </div>
      )}

      {/* Diff rows */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
        {diff.diffs.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center', color: '#94A3B8', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
            No changes between these versions
          </div>
        ) : (
          diff.diffs.map((d, i) => (
            <DiffRow key={i} diff={d} isLast={i === diff.diffs.length - 1} />
          ))
        )}
      </div>
    </div>
  );
};

const DiffRow: React.FC<{ diff: PropertyDiff; isLast: boolean }> = ({ diff, isLast }) => {
  const conf = changeTypeConfig[diff.changeType];

  return (
    <div style={{
      padding: '8px 14px',
      backgroundColor: conf.rowBg,
      borderBottom: isLast ? 'none' : '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          color: conf.color, fontWeight: 700, fontSize: '13px',
          width: '14px', textAlign: 'center', flexShrink: 0,
        }}>
          {conf.prefix}
        </span>
        <span style={{ fontWeight: 600, color: '#0D1117' }}>{diff.propertyName}</span>
        {diff.breakingChange && (
          <span style={{
            fontSize: '10px', backgroundColor: '#FEE2E2', color: '#991B1B',
            padding: '1px 5px', borderRadius: '2px', fontWeight: 500,
            fontFamily: 'var(--font-interface)',
          }}>
            BREAKING
          </span>
        )}
      </div>

      {diff.changeType === 'MODIFIED' && (
        <div style={{ marginLeft: '22px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {diff.oldValue && (
            <div>
              <span style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-interface)' }}>Before</span>
              <pre style={{
                margin: '2px 0 0', padding: '4px 8px',
                backgroundColor: '#FEF2F2', borderRadius: '2px', border: '1px solid #FECACA',
                fontSize: '11px', color: '#991B1B', whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify(diff.oldValue, null, 2)}
              </pre>
            </div>
          )}
          {diff.newValue && (
            <div>
              <span style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-interface)' }}>After</span>
              <pre style={{
                margin: '2px 0 0', padding: '4px 8px',
                backgroundColor: '#ECFDF5', borderRadius: '2px', border: '1px solid #A7F3D0',
                fontSize: '11px', color: '#065F46', whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify(diff.newValue, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {diff.changeType === 'ADDED' && diff.newValue && (
        <pre style={{
          margin: '2px 0 0 22px', padding: '4px 8px',
          backgroundColor: '#ECFDF5', borderRadius: '2px', border: '1px solid #A7F3D0',
          fontSize: '11px', color: '#065F46', whiteSpace: 'pre-wrap',
        }}>
          {JSON.stringify(diff.newValue, null, 2)}
        </pre>
      )}

      {diff.changeType === 'REMOVED' && diff.oldValue && (
        <pre style={{
          margin: '2px 0 0 22px', padding: '4px 8px',
          backgroundColor: '#FEF2F2', borderRadius: '2px', border: '1px solid #FECACA',
          fontSize: '11px', color: '#991B1B', whiteSpace: 'pre-wrap',
        }}>
          {JSON.stringify(diff.oldValue, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default SchemaDiffViewer;
