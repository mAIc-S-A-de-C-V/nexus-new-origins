import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useUiStore();

  return (
    <button
      onClick={toggleTheme}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        cursor: 'pointer',
        color: '#64748B',
        transition: 'background-color 80ms, color 80ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
        (e.currentTarget as HTMLElement).style.color = '#E2E8F0';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        (e.currentTarget as HTMLElement).style.color = '#64748B';
      }}
    >
      {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
};

export default ThemeToggle;
