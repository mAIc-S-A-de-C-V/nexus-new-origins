import React from 'react';
import { ObjectProperty } from '../../types/ontology';
import { Badge } from '../../design-system/components/Badge';
import { SEMANTIC_TYPE_COLORS } from './ontologyTypes';

interface PropertyListProps {
  properties: ObjectProperty[];
  compact?: boolean;
  maxVisible?: number;
}

const PII_COLORS: Record<string, { text: string; bg: string }> = {
  NONE: { text: '#94A3B8', bg: '#F8FAFC' },
  LOW: { text: '#D97706', bg: '#FFFBEB' },
  MEDIUM: { text: '#EA580C', bg: '#FFF7ED' },
  HIGH: { text: '#DC2626', bg: '#FEF2F2' },
};

export const PropertyList: React.FC<PropertyListProps> = ({
  properties,
  compact = false,
  maxVisible,
}) => {
  const visible = maxVisible ? properties.slice(0, maxVisible) : properties;
  const hidden = maxVisible ? properties.length - maxVisible : 0;

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {visible.map((prop) => {
          const stColor = SEMANTIC_TYPE_COLORS[prop.semanticType] || { bg: '#F8FAFC', text: '#64748B' };
          return (
            <div key={prop.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#0D1117', fontFamily: 'var(--font-mono)' }}>
                {prop.name}
              </span>
              <Badge
                label={prop.semanticType}
                bg={stColor.bg}
                color={stColor.text}
                size="sm"
              />
            </div>
          );
        })}
        {hidden > 0 && (
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
            +{hidden} more
          </div>
        )}
      </div>
    );
  }

  return (
    <table style={{ width: '100%' }}>
      <thead>
        <tr>
          <th style={{ width: '180px' }}>Property</th>
          <th style={{ width: '120px' }}>Semantic Type</th>
          <th style={{ width: '100px' }}>Data Type</th>
          <th style={{ width: '80px' }}>PII Level</th>
          <th>Source</th>
          <th style={{ width: '80px' }}>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((prop) => {
          const stColor = SEMANTIC_TYPE_COLORS[prop.semanticType] || { bg: '#F8FAFC', text: '#64748B' };
          const piiColor = PII_COLORS[prop.piiLevel] || PII_COLORS.NONE;
          const isArray = prop.dataType === 'array' || prop.name.endsWith('[]');

          return (
            <tr key={prop.id} style={isArray ? { backgroundColor: '#F5F3FF' } : undefined}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 500, color: isArray ? '#6D28D9' : '#0D1117' }}>
                    {prop.name}{isArray ? '[]' : ''}
                  </span>
                  {isArray && (
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#7C3AED', backgroundColor: '#EDE9FE', padding: '1px 5px', borderRadius: '2px', letterSpacing: '0.05em' }}>
                      NESTED ARRAY
                    </span>
                  )}
                  {prop.required && !isArray && (
                    <span style={{ fontSize: '10px', color: '#DC2626' }} title="Required">*</span>
                  )}
                </div>
                {prop.description && (
                  <div style={{ fontSize: '11px', color: isArray ? '#7C3AED' : '#94A3B8', marginTop: '1px' }}>{prop.description}</div>
                )}
              </td>
              <td>
                {isArray
                  ? <Badge label="COLLECTION" bg="#EDE9FE" color="#6D28D9" size="sm" />
                  : <Badge label={prop.semanticType} bg={stColor.bg} color={stColor.text} size="sm" />
                }
              </td>
              <td>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: isArray ? '#7C3AED' : '#64748B' }}>
                  {isArray ? 'array' : prop.dataType}
                </span>
              </td>
              <td>
                {prop.piiLevel !== 'NONE' ? (
                  <span style={{
                    fontSize: '11px', fontWeight: 500,
                    color: piiColor.text, backgroundColor: piiColor.bg,
                    padding: '1px 5px', borderRadius: '2px',
                  }}>
                    {prop.piiLevel}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#94A3B8' }}>—</span>
                )}
              </td>
              <td>
                <span style={{ fontSize: '11px', color: '#64748B' }}>
                  {prop.sourceConnectorId || '—'}
                </span>
              </td>
              <td>
                {prop.inferenceConfidence !== undefined ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{
                      width: 40, height: 4, backgroundColor: '#F1F5F9', borderRadius: '2px', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${prop.inferenceConfidence * 100}%`,
                        height: '100%',
                        backgroundColor: prop.inferenceConfidence > 0.8 ? '#059669' : prop.inferenceConfidence > 0.6 ? '#D97706' : '#DC2626',
                        borderRadius: '2px',
                      }} />
                    </div>
                    <span style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
                      {Math.round(prop.inferenceConfidence * 100)}%
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: '11px', color: '#94A3B8' }}>—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default PropertyList;
