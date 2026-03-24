export const SEMANTIC_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  IDENTIFIER: { bg: '#EFF6FF', text: '#1D4ED8' },
  PERSON_NAME: { bg: '#F5F3FF', text: '#6D28D9' },
  EMAIL: { bg: '#ECFDF5', text: '#065F46' },
  PHONE: { bg: '#FFF7ED', text: '#92400E' },
  ADDRESS: { bg: '#FEF2F2', text: '#991B1B' },
  DATE: { bg: '#F0F9FF', text: '#0C4A6E' },
  DATETIME: { bg: '#F0F9FF', text: '#075985' },
  CURRENCY: { bg: '#FEFCE8', text: '#713F12' },
  QUANTITY: { bg: '#F0FDF4', text: '#14532D' },
  PERCENTAGE: { bg: '#F0FDF4', text: '#166534' },
  CATEGORY: { bg: '#FDF4FF', text: '#7E22CE' },
  STATUS: { bg: '#FFF7ED', text: '#9A3412' },
  URL: { bg: '#F8FAFC', text: '#334155' },
  BOOLEAN: { bg: '#F1F5F9', text: '#475569' },
  TEXT: { bg: '#F8F9FA', text: '#64748B' },
};

export const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  has_many: 'has many',
  belongs_to: 'belongs to',
  has_one: 'has one',
  many_to_many: 'many to many',
};
