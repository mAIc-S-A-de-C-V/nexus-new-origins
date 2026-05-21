import React from 'react';
import { X } from 'lucide-react';
import PdfExtractorPage from '../pdf_extractor/PdfExtractorPage';

interface Props {
  onClose: () => void;
}

// The PDF Extractor is a self-contained tool wrapped in a connector-style
// modal so it lives where users expect data-ingress entry points to live.
// We render the full PdfExtractorPage inside a fullscreen overlay rather
// than reimplementing its UI — same flow as the standalone page, just
// reachable from the connector grid.
export const PdfExtractorSetupModal: React.FC<Props> = ({ onClose }) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        zIndex: 950,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          margin: 24,
          flex: 1,
          background: '#F8FAFC',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(2,6,23,0.35)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 2,
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 999,
            width: 32,
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#64748B',
            boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
          }}
        >
          <X size={16} />
        </button>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PdfExtractorPage />
        </div>
      </div>
    </div>
  );
};

export default PdfExtractorSetupModal;
