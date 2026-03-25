export type RoleType = 'pm' | 'dev' | 'qa' | 'ux' | 'explorer' | 'analyst' | 'other';
export type StageType = 'discovery' | 'hu' | 'ux' | 'development' | 'entrega' | 'custom';

export interface Company {
  id: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  companyId: string;
  name: string;
  role: RoleType;
  email?: string;
  color: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  objectTypeId?: string;
  recordId?: string;
  recordName?: string;
  pmId?: string;
  status: 'active' | 'completed' | 'paused';
  createdAt: string;
  stages?: ProjectStage[];
}

export interface StageComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface ProjectStage {
  id: string;
  projectId: string;
  parentId?: string;
  name: string;
  stageType: StageType;
  assignedToId?: string;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;   // "YYYY-MM-DD"
  color: string;
  order: number;
  progress?: number;        // 0–100
  comments?: StageComment[];
}

export const STAGE_META: Record<StageType, { label: string; color: string; light: string }> = {
  discovery:   { label: 'Discovery',    color: '#7C3AED', light: '#EDE9FE' },
  hu:          { label: 'HUs',          color: '#2563EB', light: '#EFF6FF' },
  ux:          { label: 'UX & Screens', color: '#DB2777', light: '#FCE7F3' },
  development: { label: 'Development',  color: '#059669', light: '#ECFDF5' },
  entrega:     { label: 'Entrega',      color: '#D97706', light: '#FFFBEB' },
  custom:      { label: 'Custom',       color: '#475569', light: '#F1F5F9' },
};

export const ROLE_META: Record<RoleType, { label: string; color: string }> = {
  pm:       { label: 'Project Manager',   color: '#7C3AED' },
  dev:      { label: 'Developer',         color: '#2563EB' },
  qa:       { label: 'QA',               color: '#059669' },
  ux:       { label: 'UX/UI Designer',    color: '#DB2777' },
  explorer: { label: 'Product Explorer',  color: '#D97706' },
  analyst:  { label: 'Analyst',           color: '#0891B2' },
  other:    { label: 'Other',             color: '#475569' },
};
