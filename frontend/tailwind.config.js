/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'nexus-base': '#F8F9FA',
        'nexus-surface': '#FFFFFF',
        'nexus-text': '#0D1117',
        'nexus-text-muted': '#64748B',
        'nexus-text-subtle': '#94A3B8',
        'nexus-primary': '#1A3C6E',
        'nexus-interactive': '#2563EB',
        'nexus-interactive-dim': '#EFF6FF',
        'nexus-brand': '#7C3AED',
        'nexus-brand-dim': '#EDE9FE',
        'nexus-brand-border': '#C4B5FD',
        'nexus-accent': '#D97706',
        'nexus-green': '#059669',
        'nexus-red': '#DC2626',
        'nexus-yellow': '#D97706',
        'nexus-border': '#E2E8F0',
        'nexus-border-emphasis': '#CBD5E1',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      fontSize: {
        'xs': '11px',
        'sm': '12px',
        'base': '13px',
        'md': '14px',
        'lg': '16px',
        'xl': '18px',
      },
      borderRadius: {
        'none': '0',
        'sm': '2px',
        DEFAULT: '4px',
        'md': '4px',
        'lg': '4px',
        'full': '9999px',
      },
      boxShadow: {
        'none': 'none',
        DEFAULT: 'none',
        'sm': 'none',
        'md': 'none',
        'lg': 'none',
      },
      transitionDuration: {
        'fast': '80ms',
        'panel': '120ms',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
