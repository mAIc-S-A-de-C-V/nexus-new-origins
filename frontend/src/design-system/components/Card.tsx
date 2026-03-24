import React from 'react';

interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  hoverable?: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
  className?: string;
  padding?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  onClick,
  hoverable = false,
  selected = false,
  style,
  className = '',
  padding = '0',
}) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={className}
      style={{
        backgroundColor: isHovered && hoverable ? '#F8F9FA' : '#FFFFFF',
        border: `1px solid ${selected ? '#2563EB' : isHovered && hoverable ? '#CBD5E1' : '#E2E8F0'}`,
        borderRadius: '4px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 80ms ease-out, background-color 80ms ease-out',
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default Card;
