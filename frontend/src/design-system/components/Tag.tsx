import React from 'react';

interface TagProps {
  label: string;
  color?: string;
  bg?: string;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

export const Tag: React.FC<TagProps> = ({
  label,
  color = '#475569',
  bg = '#F1F5F9',
  onRemove,
  size = 'sm',
}) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        backgroundColor: bg,
        color,
        fontSize: size === 'sm' ? '11px' : '12px',
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: '2px',
        fontWeight: 500,
        border: `1px solid ${color}22`,
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-interface)',
      }}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color,
            padding: '0',
            lineHeight: '1',
            fontSize: '10px',
            fontWeight: 700,
            opacity: 0.7,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
};

export default Tag;
