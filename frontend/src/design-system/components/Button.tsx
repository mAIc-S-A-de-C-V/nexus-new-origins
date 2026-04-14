import React, { useState } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  children,
  icon,
  iconPosition = 'left',
  loading = false,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  ...props
}) => {
  const [hovered, setHovered] = useState(false);

  const variantBase: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--color-interactive)',
      color: '#FFFFFF',
      border: '1px solid var(--color-interactive)',
    },
    secondary: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border)',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--color-text)',
      border: '1px solid transparent',
    },
    danger: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-status-red)',
      border: '1px solid var(--color-status-red)',
    },
  };

  const variantHover: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#1D4ED8',
      border: '1px solid #1D4ED8',
    },
    secondary: {
      backgroundColor: 'var(--color-base)',
      border: '1px solid var(--color-border-emphasis)',
    },
    ghost: {
      backgroundColor: 'var(--color-base)',
    },
    danger: {
      backgroundColor: 'var(--color-status-red-dim)',
    },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { height: '28px', padding: '0 10px', fontSize: '12px' },
    md: { height: '32px', padding: '0 14px', fontSize: '13px' },
    lg: { height: '36px', padding: '0 18px', fontSize: '14px' },
  };

  const isDisabled = disabled || loading;
  const base = variantBase[variant];
  const hover = hovered && !isDisabled ? variantHover[variant] : {};

  return (
    <button
      disabled={isDisabled}
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      style={{
        ...base,
        ...hover,
        ...sizeStyles[size],
        borderRadius: '4px',
        fontWeight: 500,
        fontFamily: 'var(--font-interface)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'background-color 80ms ease-out, border-color 80ms ease-out, opacity 80ms',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...props}
    >
      {icon && iconPosition === 'left' && !loading && icon}
      {loading && (
        <span style={{
          width: '12px', height: '12px', border: '2px solid currentColor',
          borderTopColor: 'transparent', borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
          display: 'inline-block',
        }} />
      )}
      {children}
      {icon && iconPosition === 'right' && !loading && icon}
    </button>
  );
};

export default Button;
