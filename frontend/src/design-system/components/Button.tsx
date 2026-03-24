import React from 'react';

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
  ...props
}) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#2563EB',
      color: '#FFFFFF',
      border: '1px solid #2563EB',
    },
    secondary: {
      backgroundColor: '#FFFFFF',
      color: '#0D1117',
      border: '1px solid #E2E8F0',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: '#0D1117',
      border: '1px solid transparent',
    },
    danger: {
      backgroundColor: '#FFFFFF',
      color: '#DC2626',
      border: '1px solid #DC2626',
    },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { height: '28px', padding: '0 10px', fontSize: '12px' },
    md: { height: '32px', padding: '0 14px', fontSize: '13px' },
    lg: { height: '36px', padding: '0 18px', fontSize: '14px' },
  };

  return (
    <button
      disabled={disabled || loading}
      style={{
        ...variantStyles[variant],
        ...sizeStyles[size],
        borderRadius: '4px',
        fontWeight: 500,
        fontFamily: 'var(--font-interface)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        transition: 'background-color 80ms ease-out, border-color 80ms ease-out',
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
