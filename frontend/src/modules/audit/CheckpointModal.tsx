import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useCheckpointStore } from '../../store/checkpointStore';

interface Props {
  checkpointId: string;
  checkpointName: string;
  minLength?: number;
  onConfirm: (token: string) => void;
  onCancel: () => void;
}

export const CheckpointModal: React.FC<Props> = ({
  checkpointId,
  checkpointName,
  minLength = 10,
  onConfirm,
  onCancel,
}) => {
  const { respond } = useCheckpointStore();
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tooShort = justification.trim().length < minLength;

  const handleSubmit = async () => {
    if (tooShort) return;
    setLoading(true);
    setError('');
    try {
      const proof = await respond(checkpointId, justification.trim());
      onConfirm(proof.token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit justification');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          backgroundColor: 'rgba(0,0,0,0.6)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        zIndex: 1101,
        width: 480,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 20px',
          borderBottom: '1px solid #E2E8F0',
          backgroundColor: '#FFF7ED',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            backgroundColor: '#FED7AA',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <ShieldCheck size={16} color="#C2410C" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>
              Justification Required
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>
              {checkpointName}
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
            This operation is governed by a checkpoint policy. Provide a written justification before proceeding.
          </p>
          <textarea
            autoFocus
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Explain the reason for this action..."
            rows={4}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              color: '#0D1117',
              backgroundColor: '#F8FAFC',
              border: `1px solid ${tooShort && justification.length > 0 ? '#EF4444' : '#E2E8F0'}`,
              borderRadius: 6,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: justification.trim().length < minLength ? '#94A3B8' : '#22C55E' }}>
              {justification.trim().length} / {minLength} min characters
            </span>
            {error && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#EF4444' }}>
                <AlertTriangle size={11} /> {error}
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            style={{
              height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', borderRadius: 4,
              border: '1px solid #E2E8F0', backgroundColor: 'transparent', color: '#475569',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={tooShort || loading}
            style={{
              height: 32, padding: '0 16px', fontSize: 13, fontWeight: 600,
              cursor: tooShort || loading ? 'not-allowed' : 'pointer', borderRadius: 4,
              border: 'none',
              backgroundColor: tooShort || loading ? '#FED7AA' : '#EA580C',
              color: tooShort || loading ? '#9A3412' : '#FFFFFF',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background-color 100ms',
            }}
          >
            {loading && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
            {loading ? 'Submitting...' : 'Proceed'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>,
    document.body,
  );
};
