import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, Plus, ArrowRight, GitBranch } from 'lucide-react';
import {
  EnrichmentProposal, FieldConflict, NewObjectProposal,
  ConflictResolution, SimilarityScore
} from '../../types/ontology';
import { Button } from '../../design-system/components/Button';
import { Badge } from '../../design-system/components/Badge';
import { SEMANTIC_TYPE_COLORS } from './ontologyTypes';

type ScenarioType = 'enrichment' | 'conflict' | 'new_object';

interface ScenarioResolverProps {
  scenario: ScenarioType;
  enrichmentProposal?: EnrichmentProposal;
  conflicts?: FieldConflict[];
  newObjectProposal?: NewObjectProposal;
  similarityScore?: SimilarityScore;
  onApply?: () => void;
  onReject?: () => void;
}

export const ScenarioResolver: React.FC<ScenarioResolverProps> = ({
  scenario,
  enrichmentProposal,
  conflicts: initialConflicts,
  newObjectProposal,
  similarityScore,
  onApply,
  onReject,
}) => {
  if (scenario === 'enrichment' && enrichmentProposal) {
    return (
      <EnrichmentScenario
        proposal={enrichmentProposal}
        score={similarityScore}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }

  if (scenario === 'conflict' && initialConflicts) {
    return (
      <ConflictScenario
        conflicts={initialConflicts}
        score={similarityScore}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }

  if (scenario === 'new_object' && newObjectProposal) {
    return (
      <NewObjectScenario
        proposal={newObjectProposal}
        score={similarityScore}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }

  return null;
};

const EnrichmentScenario: React.FC<{
  proposal: EnrichmentProposal;
  score?: SimilarityScore;
  onApply?: () => void;
  onReject?: () => void;
}> = ({ proposal, score, onApply, onReject }) => (
  <div style={{ border: '1px solid #A7F3D0', borderRadius: '4px', overflow: 'hidden' }}>
    <div style={{
      padding: '12px 16px', backgroundColor: '#ECFDF5',
      borderBottom: '1px solid #A7F3D0',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <CheckCircle size={16} color="#059669" />
      <span style={{ fontSize: '14px', fontWeight: 600, color: '#065F46' }}>Enrichment Detected</span>
      <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#059669', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
        {score ? `${Math.round(score.compositeScore * 100)}% match` : ''}
      </span>
      <Badge label="ENRICHMENT" bg="#ECFDF5" color="#059669" />
    </div>

    <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'start' }}>
      {/* Existing properties */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
          Existing Properties
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', backgroundColor: '#F8FAFC', borderRadius: '3px', border: '1px solid #E2E8F0' }}>
            <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#059669', fontWeight: 600 }}>
              {proposal.joinKey.existingField}
            </span>
            <Badge label="JOIN KEY" bg="#ECFDF5" color="#059669" size="sm" />
          </div>
        </div>
      </div>

      {/* Join key visualization */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '20px' }}>
        <ArrowRight size={20} color="#059669" />
      </div>

      {/* New properties */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
          New Properties (+{proposal.newProperties.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {proposal.newProperties.map((prop) => {
            const stColor = SEMANTIC_TYPE_COLORS[prop.semanticType] || { bg: '#F8FAFC', text: '#64748B' };
            return (
              <div key={prop.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '6px', padding: '5px 8px',
                backgroundColor: '#ECFDF5', borderRadius: '3px', border: '1px solid #A7F3D0',
              }}>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#065F46' }}>{prop.name}</span>
                <Badge label={prop.semanticType} bg={stColor.bg} color={stColor.text} size="sm" />
              </div>
            );
          })}
        </div>
      </div>
    </div>

    {/* Backfill strategy */}
    {proposal.backfillStrategy && (
      <div style={{ padding: '10px 16px', backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '12px', color: '#64748B' }}>
        Backfill strategy: <span style={{ fontWeight: 500, color: '#0D1117' }}>{proposal.backfillStrategy}</span>
      </div>
    )}

    <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '8px' }}>
      <Button variant="primary" size="sm" icon={<CheckCircle size={12} />} onClick={onApply}>
        Apply Enrichment
      </Button>
      <Button variant="secondary" size="sm">View Diff</Button>
      <Button variant="secondary" size="sm">Configure Backfill</Button>
      <Button variant="ghost" size="sm" onClick={onReject} style={{ marginLeft: 'auto', color: '#64748B' }}>
        Reject
      </Button>
    </div>
  </div>
);

const ConflictScenario: React.FC<{
  conflicts: FieldConflict[];
  score?: SimilarityScore;
  onApply?: () => void;
  onReject?: () => void;
}> = ({ conflicts, score, onApply, onReject }) => {
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>(() => {
    const init: Record<string, ConflictResolution> = {};
    conflicts.forEach((c) => { init[c.fieldName] = c.suggestedResolution; });
    return init;
  });

  const conflictTypeColors: Record<string, { bg: string; text: string }> = {
    VOCABULARY: { bg: '#F5F3FF', text: '#6D28D9' },
    TYPE: { bg: '#FEF2F2', text: '#991B1B' },
    GRANULARITY: { bg: '#FEFCE8', text: '#713F12' },
    SCALE: { bg: '#EFF6FF', text: '#1D4ED8' },
  };

  return (
    <div style={{ border: '1px solid #FCD34D', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{
        padding: '12px 16px', backgroundColor: '#FFFBEB',
        borderBottom: '1px solid #FCD34D',
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <AlertTriangle size={16} color="#D97706" />
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#92400E' }}>
          Schema Conflicts Detected
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#D97706', fontFamily: 'var(--font-mono)' }}>
          {score ? `${Math.round(score.compositeScore * 100)}% match` : ''}
        </span>
        <Badge label="CONFLICT" bg="#FFFBEB" color="#D97706" />
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {conflicts.map((conflict) => {
          const ctColor = conflictTypeColors[conflict.conflictType] || { bg: '#F8FAFC', text: '#64748B' };
          return (
            <div key={conflict.fieldName} style={{
              border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 12px', backgroundColor: '#FAFAFA',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#0D1117' }}>
                  {conflict.fieldName}
                </span>
                <Badge label={conflict.conflictType} bg={ctColor.bg} color={ctColor.text} size="sm" />
              </div>

              <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#94A3B8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Existing
                  </div>
                  <pre style={{
                    backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                    borderRadius: '3px', padding: '6px 8px',
                    fontSize: '11px', fontFamily: 'var(--font-mono)',
                    color: '#0D1117', margin: 0, whiteSpace: 'pre-wrap',
                  }}>
                    {JSON.stringify(conflict.existingShape, null, 2)}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#94A3B8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Incoming
                  </div>
                  <pre style={{
                    backgroundColor: '#FFFBEB', border: '1px solid #FCD34D',
                    borderRadius: '3px', padding: '6px 8px',
                    fontSize: '11px', fontFamily: 'var(--font-mono)',
                    color: '#92400E', margin: 0, whiteSpace: 'pre-wrap',
                  }}>
                    {JSON.stringify(conflict.incomingShape, null, 2)}
                  </pre>
                </div>
              </div>

              <div style={{ padding: '8px 12px', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#64748B' }}>Resolution:</span>
                <select
                  value={resolutions[conflict.fieldName]}
                  onChange={(e) => setResolutions((r) => ({ ...r, [conflict.fieldName]: e.target.value as ConflictResolution }))}
                  style={{
                    height: '26px', border: '1px solid #E2E8F0', borderRadius: '4px',
                    padding: '0 8px', fontSize: '12px', color: '#0D1117',
                    backgroundColor: '#FFFFFF', cursor: 'pointer',
                  }}
                >
                  <option value="NAMESPACE_BOTH">Namespace Both</option>
                  <option value="NORMALIZE_CANONICAL">Normalize to Canonical</option>
                  <option value="KEEP_EXISTING">Keep Existing</option>
                  <option value="REPLACE">Replace with Incoming</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '8px' }}>
        <Button variant="secondary" size="sm">Resolve All</Button>
        <Button variant="primary" size="sm" onClick={onApply}>Apply</Button>
        <Button variant="ghost" size="sm" onClick={onReject} style={{ marginLeft: 'auto', color: '#64748B' }}>
          Reject
        </Button>
      </div>
    </div>
  );
};

const NewObjectScenario: React.FC<{
  proposal: NewObjectProposal;
  score?: SimilarityScore;
  onApply?: () => void;
  onReject?: () => void;
}> = ({ proposal, score, onApply, onReject }) => (
  <div style={{ border: '1px solid #BFDBFE', borderRadius: '4px', overflow: 'hidden' }}>
    <div style={{
      padding: '12px 16px', backgroundColor: '#EFF6FF',
      borderBottom: '1px solid #BFDBFE',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      {proposal.isSubType ? <GitBranch size={16} color="#2563EB" /> : <Plus size={16} color="#2563EB" />}
      <span style={{ fontSize: '14px', fontWeight: 600, color: '#1E40AF' }}>
        {proposal.isSubType ? 'Sub-Type Detected' : 'New Object Type Proposed'}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#2563EB', fontFamily: 'var(--font-mono)' }}>
        {score ? `${Math.round(score.compositeScore * 100)}% sim` : ''}
      </span>
      <Badge label={proposal.isSubType ? 'SUB-TYPE' : 'NEW TYPE'} bg="#EFF6FF" color="#1D4ED8" />
    </div>

    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Suggested Name
        </span>
        <div style={{
          marginTop: '4px', fontSize: '16px', fontWeight: 700,
          color: '#0D1117', fontFamily: 'var(--font-mono)',
        }}>
          {proposal.suggestedName}
        </div>
      </div>

      {proposal.isSubType && proposal.parentObjectTypeId && (
        <div style={{ marginBottom: '12px', padding: '8px 12px', backgroundColor: '#EFF6FF', borderRadius: '4px', border: '1px solid #BFDBFE' }}>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Inheritance</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            <span style={{ color: '#1E40AF', fontWeight: 600 }}>{proposal.parentObjectTypeId}</span>
            <ArrowRight size={12} color="#94A3B8" />
            <span style={{ color: '#0D1117', fontWeight: 600 }}>{proposal.suggestedName}</span>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
          Suggested Properties ({proposal.suggestedProperties.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {proposal.suggestedProperties.slice(0, 6).map((prop) => {
            const stColor = SEMANTIC_TYPE_COLORS[prop.semanticType] || { bg: '#F8FAFC', text: '#64748B' };
            return (
              <div key={prop.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '6px', padding: '5px 8px',
                backgroundColor: '#EFF6FF', borderRadius: '3px', border: '1px solid #BFDBFE',
              }}>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#1E40AF' }}>{prop.name}</span>
                <Badge label={prop.semanticType} bg={stColor.bg} color={stColor.text} size="sm" />
              </div>
            );
          })}
          {proposal.suggestedProperties.length > 6 && (
            <div style={{ fontSize: '11px', color: '#94A3B8', padding: '4px 8px' }}>
              +{proposal.suggestedProperties.length - 6} more properties
            </div>
          )}
        </div>
      </div>

      {proposal.suggestedLinks.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Suggested Links ({proposal.suggestedLinks.length})
          </div>
          {proposal.suggestedLinks.map((link, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', padding: '5px 8px',
              backgroundColor: '#F8FAFC', borderRadius: '3px',
              border: '1px solid #E2E8F0', marginBottom: '3px',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ color: '#0D1117' }}>{proposal.suggestedName}</span>
              <span style={{ color: '#94A3B8' }}>—</span>
              <span style={{ color: '#2563EB' }}>{link.relationshipType}</span>
              <span style={{ color: '#94A3B8' }}>—</span>
              <span style={{ color: '#0D1117' }}>{link.targetObjectTypeId}</span>
            </div>
          ))}
        </div>
      )}
    </div>

    <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '8px' }}>
      <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={onApply}>
        Create Object Type
      </Button>
      <Button variant="ghost" size="sm" onClick={onReject} style={{ marginLeft: 'auto', color: '#64748B' }}>
        Reject
      </Button>
    </div>
  </div>
);

export default ScenarioResolver;
