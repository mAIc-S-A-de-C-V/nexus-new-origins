import React from 'react';
import { categoryColors } from '../tokens';

interface BadgeProps {
  label: string;
  variant?: 'category' | 'status' | 'semantic' | 'custom';
  color?: string;
  bg?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'custom',
  color,
  bg,
  size = 'sm',
  className = '',
}) => {
  const getCategoryStyle = () => {
    const cat = categoryColors[label];
    if (cat) return { backgroundColor: cat.bg, color: cat.text };
    return { backgroundColor: '#F1F5F9', color: '#475569' };
  };

  const getStyle = () => {
    if (variant === 'category') return getCategoryStyle();
    if (color || bg) return { backgroundColor: bg || '#F1F5F9', color: color || '#475569' };
    return { backgroundColor: '#F1F5F9', color: '#475569' };
  };

  const sizeStyles = size === 'sm'
    ? { fontSize: '11px', padding: '1px 6px' }
    : { fontSize: '12px', padding: '2px 8px' };

  return (
    <span
      className={className}
      style={{
        ...getStyle(),
        ...sizeStyles,
        borderRadius: '2px',
        fontWeight: 500,
        lineHeight: '18px',
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-interface)',
      }}
    >
      {label}
    </span>
  );
};

export default Badge;
