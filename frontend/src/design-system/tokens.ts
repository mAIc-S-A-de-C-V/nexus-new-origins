export const colors = {
  base: '#F8F9FA',
  surface: '#FFFFFF',
  text: '#0D1117',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  primary: '#1A3C6E',
  primaryInteractive: '#2563EB',
  accent: '#D97706',
  statusGreen: '#059669',
  statusRed: '#DC2626',
  statusYellow: '#D97706',
  border: '#E2E8F0',
  borderEmphasis: '#CBD5E1',
} as const;

export const typography = {
  fontInterface: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  sizeXs: '11px',
  sizeSm: '12px',
  sizeBase: '13px',
  sizeMd: '14px',
  sizeLg: '16px',
  sizeXl: '18px',
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
} as const;

export const radius = {
  card: '4px',
  chip: '2px',
  none: '0px',
} as const;

export const transitions = {
  panel: '120ms ease-out',
  hover: '80ms ease-out',
} as const;

export const layout = {
  navCollapsed: '56px',
  navExpanded: '220px',
  tableRowHeight: '36px',
} as const;

export const nodeColors: Record<string, string> = {
  SOURCE: '#1A3C6E',
  FILTER: '#7C3AED',
  MAP: '#0891B2',
  CAST: '#059669',
  ENRICH: '#D97706',
  FLATTEN: '#DC2626',
  DEDUPE: '#64748B',
  VALIDATE: '#0D9488',
  SINK_OBJECT: '#1A3C6E',
  SINK_EVENT: '#059669',
};

export const categoryColors: Record<string, { bg: string; text: string }> = {
  REST: { bg: '#EFF6FF', text: '#1D4ED8' },
  GraphQL: { bg: '#F5F3FF', text: '#6D28D9' },
  Stream: { bg: '#ECFDF5', text: '#065F46' },
  ERP: { bg: '#FFF7ED', text: '#92400E' },
  CRM: { bg: '#FDF4FF', text: '#7E22CE' },
  DB: { bg: '#F0FDF4', text: '#166534' },
  File: { bg: '#F0F9FF', text: '#0C4A6E' },
  Doc: { bg: '#FEFCE8', text: '#713F12' },
  HTTP: { bg: '#FFF1F2', text: '#9F1239' },
  DW: { bg: '#F8FAFC', text: '#1E293B' },
};

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
