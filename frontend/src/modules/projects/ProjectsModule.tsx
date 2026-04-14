import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Plus, Folder, Users, Trash2, ChevronRight,
  X, Check, Briefcase, User, MessageSquare, Send,
} from 'lucide-react';
import {
  Company, TeamMember, Project, ProjectStage, StageComment, RoleType, StageType,
  ROLE_META, STAGE_META,
} from '../../types/project';
import { GanttChart } from './GanttChart';
import { getTenantId } from '../../store/authStore';

const API = import.meta.env.VITE_PROJECT_MGMT_URL || 'http://localhost:9000';
const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const getH = () => ({ 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() });

// ── API helpers ───────────────────────────────────────────────────────────────

const api = {
  getCompanies: () => fetch(`${API}/projects/companies`, { headers: getH() }).then(r => r.json()),
  createCompany: (b: object) => fetch(`${API}/projects/companies`, { method: 'POST', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),
  deleteCompany: (id: string) => fetch(`${API}/projects/companies/${id}`, { method: 'DELETE', headers: getH() }),

  getMembers: (cid: string) => fetch(`${API}/projects/companies/${cid}/members`, { headers: getH() }).then(r => r.json()),
  createMember: (cid: string, b: object) => fetch(`${API}/projects/companies/${cid}/members`, { method: 'POST', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),
  deleteMember: (mid: string) => fetch(`${API}/projects/members/${mid}`, { method: 'DELETE', headers: getH() }),

  getProjects: (cid: string) => fetch(`${API}/projects/companies/${cid}/projects`, { headers: getH() }).then(r => r.json()),
  createProject: (cid: string, b: object) => fetch(`${API}/projects/companies/${cid}/projects`, { method: 'POST', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),
  deleteProject: (pid: string) => fetch(`${API}/projects/${pid}`, { method: 'DELETE', headers: getH() }),

  getProject: (pid: string) => fetch(`${API}/projects/${pid}`, { headers: getH() }).then(r => r.json()),
  updateProject: (pid: string, b: object) => fetch(`${API}/projects/${pid}`, { method: 'PUT', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),

  createStage: (pid: string, b: object) => fetch(`${API}/projects/${pid}/stages`, { method: 'POST', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),
  updateStage: (sid: string, b: object) => fetch(`${API}/projects/stages/${sid}`, { method: 'PUT', headers: getH(), body: JSON.stringify(b) }).then(r => r.json()),
  deleteStage: (sid: string) => fetch(`${API}/projects/stages/${sid}`, { method: 'DELETE', headers: getH() }),

  getOntologyRecords: (otId: string) => fetch(`${ONTOLOGY_API}/object-types/${otId}/records`, { headers: getH() }).then(r => r.json()).then(d => Array.isArray(d) ? d : (d.records ?? [])),
  getObjectTypes: () => fetch(`${ONTOLOGY_API}/object-types`, { headers: getH() }).then(r => r.json()),
};

// ── Utilities ─────────────────────────────────────────────────────────────────

const COMPANY_COLORS = ['#2563EB', '#7C3AED', '#059669', '#DB2777', '#D97706', '#0891B2'];

const isClosedRecord = (rec: Record<string, unknown>): boolean => {
  const closedFields = ['dealstage', 'status', 'stage', 'deal_stage', 'hs_deal_stage_probability'];
  return closedFields.some(f => {
    const v = String(rec[f] ?? '').toLowerCase();
    return v.includes('closed') || v === '1' || v === 'won';
  });
};

const getRecordName = (rec: Record<string, unknown>): string => {
  const nameFields = ['dealname', 'name', 'title', 'company_name', 'hs_object_name', 'firstname'];
  for (const f of nameFields) {
    if (rec[f]) return String(rec[f]);
  }
  return `Record ${String(rec['hs_object_id'] || rec['id'] || '').slice(0, 8)}`;
};

const toTitleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── Modal ─────────────────────────────────────────────────────────────────────

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; width?: number }> = ({
  title, onClose, children, width = 480,
}) => (
  <div style={{
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }}>
    <div style={{ backgroundColor: '#fff', borderRadius: 12, width, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0D1117' }}>{title}</span>
        <button onClick={onClose} style={{ color: '#94A3B8', lineHeight: 0 }}><X size={18} /></button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  </div>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, ...props }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>{label}</div>}
    <input
      {...props}
      style={{
        width: '100%', height: 36, border: '1px solid #E2E8F0', borderRadius: 6,
        padding: '0 10px', fontSize: 13, color: '#0D1117', boxSizing: 'border-box',
        outline: 'none',
        ...props.style,
      }}
    />
  </div>
);

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }> = ({
  variant = 'primary', children, ...props
}) => {
  const styles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: '#2563EB', color: '#fff', border: 'none' },
    ghost: { backgroundColor: 'transparent', color: '#374151', border: '1px solid #E2E8F0' },
    danger: { backgroundColor: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' },
  };
  return (
    <button
      {...props}
      style={{
        height: 36, padding: '0 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        ...styles[variant], ...props.style,
      }}
    >
      {children}
    </button>
  );
};

// ── Stage creation form (shared between new stage & sub-stage modals) ─────────

interface StageFormState {
  name: string;
  stageType: StageType;
  startDate: string;
  endDate: string;
  assignedToId: string;
}

const defaultStageForm = (): StageFormState => ({
  name: '',
  stageType: 'discovery',
  startDate: '',
  endDate: '',
  assignedToId: '',
});

// ── View: Company Folders ─────────────────────────────────────────────────────

const CompanyFoldersView: React.FC<{
  onOpenCompany: (c: Company) => void;
}> = ({ onOpenCompany }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', color: COMPANY_COLORS[0], description: '' });

  useEffect(() => { api.getCompanies().then(setCompanies); }, []);

  const create = async () => {
    if (!form.name.trim()) return;
    const c = await api.createCompany(form);
    setCompanies(p => [...p, c]);
    setForm({ name: '', color: COMPANY_COLORS[0], description: '' });
    setShowNew(false);
  };

  const del = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this company and all its projects?')) return;
    await api.deleteCompany(id);
    setCompanies(p => p.filter(c => c.id !== id));
  };

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0D1117', margin: 0 }}>Projects</h1>
          <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 0' }}>Manage delivery projects by company</p>
        </div>
        <Btn onClick={() => setShowNew(true)}><Plus size={15} /> New Company</Btn>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {companies.map(c => (
          <div
            key={c.id}
            onClick={() => onOpenCompany(c)}
            style={{
              backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
              padding: 20, cursor: 'pointer', transition: 'box-shadow 120ms',
              position: 'relative',
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, backgroundColor: c.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Folder size={20} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0D1117' }}>{c.name}</div>
                {c.description && <div style={{ fontSize: 12, color: '#64748B' }}>{c.description}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>Click to open</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={e => del(c.id, e)} style={{ color: '#CBD5E1', padding: 4, lineHeight: 0 }}>
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} color="#CBD5E1" />
              </div>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {companies.length === 0 && (
          <div style={{
            gridColumn: '1/-1', padding: 48, textAlign: 'center',
            border: '2px dashed #E2E8F0', borderRadius: 12, color: '#94A3B8',
          }}>
            <Folder size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>No companies yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Create a company folder to start managing projects</div>
          </div>
        )}
      </div>

      {/* New Company Modal */}
      {showNew && (
        <Modal title="New Company" onClose={() => setShowNew(false)}>
          <Input label="Company name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. maic" autoFocus />
          <Input label="Description (optional)" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Short description" />
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Color</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {COMPANY_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(p => ({ ...p, color: c }))}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', backgroundColor: c, border: 'none', cursor: 'pointer',
                    outline: form.color === c ? `3px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setShowNew(false)}>Cancel</Btn>
            <Btn onClick={create}><Check size={14} /> Create</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── View: Projects List ───────────────────────────────────────────────────────

const ProjectsListView: React.FC<{
  company: Company;
  onBack: () => void;
  onOpenProject: (p: Project) => void;
}> = ({ company, onBack: _onBack, onOpenProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [objectTypes, setObjectTypes] = useState<{ id: string; displayName: string }[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [selectedOtId, setSelectedOtId] = useState('');
  const [leftTab, setLeftTab] = useState<'records' | 'team'>('records');
  const [recordFilter, setRecordFilter] = useState<'closed' | 'all'>('closed');
  const [showNewProject, setShowNewProject] = useState<Record<string, unknown> | null>(null);
  const [memberForm, setMemberForm] = useState({ name: '', role: 'dev' as RoleType, email: '', color: '#2563EB' });
  const [projectForm, setProjectForm] = useState({ name: '', description: '', pmId: '' });

  useEffect(() => {
    api.getProjects(company.id).then(setProjects);
    api.getMembers(company.id).then(setMembers);
    api.getObjectTypes().then((ots: { id: string; display_name?: string; name?: string }[]) => {
      setObjectTypes(ots.map(o => ({ id: o.id, displayName: o.display_name || o.name || o.id })));
    });
  }, [company.id]);

  useEffect(() => {
    if (!selectedOtId) return;
    api.getOntologyRecords(selectedOtId).then((recs: Record<string, unknown>[]) => setRecords(recs));
  }, [selectedOtId]);

  const createMember = async () => {
    if (!memberForm.name.trim()) return;
    const m = await api.createMember(company.id, memberForm);
    setMembers(p => [...p, m]);
    setMemberForm({ name: '', role: 'dev', email: '', color: '#2563EB' });
  };

  const deleteMember = async (mid: string) => {
    await api.deleteMember(mid);
    setMembers(p => p.filter(m => m.id !== mid));
  };

  const openNewProject = (rec: Record<string, unknown>) => {
    setProjectForm({ name: getRecordName(rec), description: '', pmId: '' });
    setShowNewProject(rec);
  };

  const createProject = async () => {
    if (!showNewProject || !projectForm.name.trim()) return;
    const rec = showNewProject;
    const p = await api.createProject(company.id, {
      ...projectForm,
      objectTypeId: selectedOtId,
      recordId: String(rec['hs_object_id'] || rec['id'] || ''),
      recordName: getRecordName(rec),
    });
    setProjects(prev => [...prev, p]);
    setShowNewProject(null);
  };

  const deleteProject = async (pid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(pid);
    setProjects(p => p.filter(x => x.id !== pid));
  };

  const closedRecords = records.filter(isClosedRecord);
  const displayedRecords = recordFilter === 'closed' ? closedRecords : records;
  const pm = (id: string) => members.find(m => m.id === id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 52px 0 24px', gap: 12, flexShrink: 0,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: company.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Folder size={14} color="#fff" />
        </div>
        <span style={{ fontSize: 13, color: '#64748B' }}>{company.name}</span>
        <ChevronRight size={14} color="#CBD5E1" />
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0D1117' }}>Projects</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Users size={13} /> {members.length} members
          </span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel with tabs */}
        <div style={{ width: 320, borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', backgroundColor: '#FAFAFA' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', backgroundColor: '#fff', flexShrink: 0 }}>
            {(['records', 'team'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                style={{
                  flex: 1, height: 40, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: leftTab === tab ? 600 : 400,
                  color: leftTab === tab ? '#2563EB' : '#64748B',
                  backgroundColor: 'transparent',
                  borderBottom: leftTab === tab ? '2px solid #2563EB' : '2px solid transparent',
                  transition: 'all 120ms',
                  textTransform: 'capitalize',
                }}
              >
                {tab === 'records' ? 'Records' : `Team (${members.length})`}
              </button>
            ))}
          </div>

          {/* Records tab */}
          {leftTab === 'records' && (
            <>
              <div style={{ padding: '12px 16px 8px' }}>
                {/* Object type selector */}
                <select
                  value={selectedOtId}
                  onChange={e => setSelectedOtId(e.target.value)}
                  style={{ width: '100%', height: 32, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, padding: '0 8px', backgroundColor: '#fff', marginBottom: 8 }}
                >
                  <option value="">Select object type…</option>
                  {objectTypes.map(ot => <option key={ot.id} value={ot.id}>{ot.displayName}</option>)}
                </select>

                {/* Show filter toggle */}
                {selectedOtId && (
                  <div style={{ display: 'flex', backgroundColor: '#F1F5F9', borderRadius: 8, padding: 2 }}>
                    {(['closed', 'all'] as const).map(opt => (
                      <button
                        key={opt}
                        onClick={() => setRecordFilter(opt)}
                        style={{
                          flex: 1, height: 28, border: 'none', cursor: 'pointer',
                          fontSize: 12, fontWeight: recordFilter === opt ? 600 : 400,
                          color: recordFilter === opt ? '#0D1117' : '#64748B',
                          backgroundColor: recordFilter === opt ? '#fff' : 'transparent',
                          borderRadius: 6,
                          boxShadow: recordFilter === opt ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                          transition: 'all 120ms',
                        }}
                      >
                        {opt === 'closed' ? 'Closed' : 'All'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
                {selectedOtId && displayedRecords.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 24 }}>
                    No {recordFilter === 'closed' ? 'closed' : ''} records found
                  </div>
                )}
                {displayedRecords.map((rec, i) => {
                  const name = getRecordName(rec);
                  const alreadyProject = projects.some(p => p.recordId === String(rec['hs_object_id'] || rec['id'] || ''));
                  return (
                    <div
                      key={i}
                      style={{
                        backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
                        padding: '10px 12px', marginBottom: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                          {String(rec['dealstage'] || rec['status'] || '').slice(0, 30)}
                        </div>
                      </div>
                      {alreadyProject
                        ? <span style={{ fontSize: 11, color: '#059669', backgroundColor: '#ECFDF5', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>Active</span>
                        : <button
                            onClick={() => openNewProject(rec)}
                            style={{ fontSize: 11, color: '#2563EB', backgroundColor: '#EFF6FF', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}
                          >
                            + Project
                          </button>
                      }
                    </div>
                  );
                })}
                {!selectedOtId && (
                  <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 12, padding: 24 }}>
                    Select an object type to see records
                  </div>
                )}
              </div>
            </>
          )}

          {/* Team tab — inline team management */}
          {leftTab === 'team' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Members list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
                {members.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 24 }}>
                    <User size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                    No team members yet
                  </div>
                )}
                {members.map(m => {
                  const roleMeta = ROLE_META[m.role as RoleType] || ROLE_META.other;
                  const initials = m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 4px', borderBottom: '1px solid #F1F5F9',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        backgroundColor: m.color || roleMeta.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#fff',
                      }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: roleMeta.color,
                          backgroundColor: `${roleMeta.color}18`,
                          padding: '1px 6px', borderRadius: 10, display: 'inline-block', marginTop: 2,
                        }}>
                          {roleMeta.label}
                        </span>
                      </div>
                      <button
                        onClick={() => deleteMember(m.id)}
                        style={{ color: '#CBD5E1', lineHeight: 0, flexShrink: 0, padding: 4 }}
                        title="Remove member"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add Member row */}
              <div style={{ borderTop: '1px solid #E2E8F0', padding: '12px 12px 16px', backgroundColor: '#fff', flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Add Member
                </div>
                <input
                  type="text"
                  placeholder="Full name"
                  value={memberForm.name}
                  onChange={e => setMemberForm(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && createMember()}
                  style={{
                    width: '100%', height: 32, border: '1px solid #E2E8F0', borderRadius: 6,
                    padding: '0 10px', fontSize: 12, color: '#0D1117', boxSizing: 'border-box',
                    outline: 'none', marginBottom: 6,
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    value={memberForm.role}
                    onChange={e => setMemberForm(p => ({ ...p, role: e.target.value as RoleType }))}
                    style={{ flex: 1, height: 32, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, padding: '0 6px' }}
                  >
                    {(Object.entries(ROLE_META) as [RoleType, { label: string; color: string }][]).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={createMember}
                    disabled={!memberForm.name.trim()}
                    style={{
                      height: 32, padding: '0 14px', borderRadius: 6, border: 'none',
                      backgroundColor: memberForm.name.trim() ? '#2563EB' : '#E2E8F0',
                      color: memberForm.name.trim() ? '#fff' : '#94A3B8',
                      fontSize: 12, fontWeight: 600, cursor: memberForm.name.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Projects */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Projects ({projects.length})
          </div>

          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 48 }}>
              <Briefcase size={28} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div>No projects yet</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Select a record on the left to create a project</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {projects.map(p => {
                const pmMember = pm(p.pmId || '');
                return (
                  <div
                    key={p.id}
                    onClick={() => onOpenProject(p)}
                    style={{
                      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                      padding: 16, cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', flex: 1, paddingRight: 8 }}>{p.name}</div>
                      <button onClick={e => deleteProject(p.id, e)} style={{ color: '#CBD5E1', lineHeight: 0 }}><Trash2 size={14} /></button>
                    </div>
                    {p.recordName && (
                      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>{p.recordName}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {pmMember
                        ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: pmMember.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                              {pmMember.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 12, color: '#64748B' }}>{pmMember.name}</span>
                          </div>
                        : <span style={{ fontSize: 12, color: '#CBD5E1' }}>No PM assigned</span>
                      }
                      <ChevronRight size={14} color="#CBD5E1" style={{ marginLeft: 'auto' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <Modal title="Create Project" onClose={() => setShowNewProject(null)}>
          <Input
            label="Project name"
            value={projectForm.name}
            onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))}
            autoFocus
          />
          <Input
            label="Description (optional)"
            value={projectForm.description}
            onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))}
          />
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Assign Project Manager</div>
            <select
              value={projectForm.pmId}
              onChange={e => setProjectForm(p => ({ ...p, pmId: e.target.value }))}
              style={{ width: '100%', height: 36, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, padding: '0 10px' }}
            >
              <option value="">— Select PM —</option>
              {members.filter(m => m.role === 'pm').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {members.filter(m => m.role !== 'pm').length > 0 && <option disabled>─────────</option>}
              {members.filter(m => m.role !== 'pm').map(m => <option key={m.id} value={m.id}>{m.name} ({ROLE_META[m.role as RoleType]?.label})</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', backgroundColor: '#F8FAFC', padding: '8px 12px', borderRadius: 6, marginBottom: 20 }}>
            5 default stages (Discovery → HUs → UX & Screens → Development → Entrega) will be created automatically.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setShowNewProject(null)}>Cancel</Btn>
            <Btn onClick={createProject}><Check size={14} /> Create Project</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── New Stage Modal ────────────────────────────────────────────────────────────

const NewStageModal: React.FC<{
  title: string;
  members: TeamMember[];
  initialStageType?: StageType;
  inheritType?: boolean;
  onClose: () => void;
  onSubmit: (form: StageFormState) => void;
}> = ({ title, members, initialStageType = 'discovery', inheritType = false, onClose, onSubmit }) => {
  const [form, setForm] = useState<StageFormState>({
    ...defaultStageForm(),
    stageType: initialStageType,
  });

  return (
    <Modal title={title} onClose={onClose} width={440}>
      <Input
        label="Stage name"
        value={form.name}
        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
        placeholder="e.g. Sprint 1"
        autoFocus
      />

      {!inheritType && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Stage type</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(Object.entries(STAGE_META) as [StageType, { label: string; color: string; light: string }][]).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setForm(p => ({ ...p, stageType: k }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                  border: form.stageType === k ? `2px solid ${v.color}` : '2px solid #F1F5F9',
                  backgroundColor: form.stageType === k ? v.light : '#FAFAFA',
                  textAlign: 'left', transition: 'all 100ms',
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: v.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: form.stageType === k ? 600 : 400, color: form.stageType === k ? v.color : '#374151' }}>
                  {v.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label="Start date"
          type="date"
          value={form.startDate}
          onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
        />
        <Input
          label="End date"
          type="date"
          value={form.endDate}
          onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Assign to</div>
        <select
          value={form.assignedToId}
          onChange={e => setForm(p => ({ ...p, assignedToId: e.target.value }))}
          style={{ width: '100%', height: 36, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, padding: '0 10px' }}
        >
          <option value="">— Unassigned —</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn
          onClick={() => { if (form.name.trim()) onSubmit(form); }}
          disabled={!form.name.trim()}
        >
          <Check size={14} /> Create Stage
        </Btn>
      </div>
    </Modal>
  );
};

// ── Stage Detail Drawer ────────────────────────────────────────────────────────

const StageDetailDrawer: React.FC<{
  stage: ProjectStage;
  members: TeamMember[];
  onClose: () => void;
  onUpdate: (patch: Partial<ProjectStage>) => void;
}> = ({ stage, members, onClose, onUpdate }) => {
  const [commentText, setCommentText] = useState('');
  const [author, setAuthor] = useState('Me');
  const meta = STAGE_META[stage.stageType] || STAGE_META.custom;
  const comments = stage.comments || [];
  const progress = stage.progress ?? 0;

  const addComment = () => {
    if (!commentText.trim()) return;
    const newComment: StageComment = {
      id: `c-${Date.now()}`,
      text: commentText.trim(),
      author,
      createdAt: new Date().toISOString(),
    };
    onUpdate({ comments: [...comments, newComment] });
    setCommentText('');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          width: 420, height: '100%', backgroundColor: '#fff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: meta.color, marginTop: 5, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0D1117' }}>{stage.name || 'Unnamed stage'}</div>
            <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, backgroundColor: meta.light, padding: '1px 6px', borderRadius: 10, display: 'inline-block', marginTop: 4 }}>
              {meta.label}
            </span>
          </div>
          <button onClick={onClose} style={{ color: '#94A3B8', lineHeight: 0, flexShrink: 0 }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Progress */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Progress</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: progress === 100 ? '#059669' : '#374151' }}>{progress}%</div>
            </div>
            <input
              type="range"
              min={0} max={100} step={5}
              value={progress}
              onChange={e => onUpdate({ progress: Number(e.target.value) })}
              style={{ width: '100%', accentColor: meta.color, cursor: 'pointer' }}
            />
            <div style={{ height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', overflow: 'hidden', marginTop: 8 }}>
              <div style={{ width: `${progress}%`, height: '100%', backgroundColor: meta.color, borderRadius: 3, transition: 'width 200ms' }} />
            </div>
          </div>

          {/* Quick facts */}
          <div style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {stage.startDate && (
              <div style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 2 }}>Start</div>
                <div style={{ fontSize: 13, color: '#0D1117', fontWeight: 500 }}>{stage.startDate}</div>
              </div>
            )}
            {stage.endDate && (
              <div style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 2 }}>End</div>
                <div style={{ fontSize: 13, color: '#0D1117', fontWeight: 500 }}>{stage.endDate}</div>
              </div>
            )}
            {stage.assignedToId && (() => {
              const m = members.find(x => x.id === stage.assignedToId);
              return m ? (
                <div style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: '10px 12px', gridColumn: '1/-1' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 4 }}>Assigned to</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                      {m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{m.name}</span>
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {/* Comments */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={13} /> Comments ({comments.length})
            </div>

            {comments.length === 0 && (
              <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 13, padding: '24px 0' }}>No comments yet</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {comments.map(c => (
                <div key={c.id} style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{c.author}</span>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#0D1117', lineHeight: 1.5 }}>{c.text}</div>
                </div>
              ))}
            </div>

            {/* Add comment */}
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
              <input
                type="text"
                placeholder="Your name"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                style={{ width: '100%', height: 32, border: '1px solid #E2E8F0', borderRadius: 6, padding: '0 10px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  placeholder="Add a comment…"
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(); }}
                  rows={3}
                  style={{ flex: 1, border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 10px', fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <button
                  onClick={addComment}
                  disabled={!commentText.trim()}
                  style={{
                    width: 36, borderRadius: 6, border: 'none',
                    backgroundColor: commentText.trim() ? '#2563EB' : '#E2E8F0',
                    color: commentText.trim() ? '#fff' : '#94A3B8',
                    cursor: commentText.trim() ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>Cmd+Enter to send</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── View: Gantt ───────────────────────────────────────────────────────────────

const GanttView: React.FC<{
  projectId: string;
  company: Company;
  onBack: () => void;
}> = ({ projectId, company, onBack }) => {
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activeTab, setActiveTab] = useState<'gantt' | 'info'>('gantt');
  const [linkedRecord, setLinkedRecord] = useState<Record<string, unknown> | null>(null);
  const [showNewStage, setShowNewStage] = useState(false);
  const [subStageParentId, setSubStageParentId] = useState<string | null>(null);
  const [detailStageId, setDetailStageId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    api.getProject(projectId).then(p => {
      setProject(p);
      setStages(p.stages || []);
    });
    api.getMembers(company.id).then(setMembers);
  }, [projectId, company.id]);

  // Fetch linked record when project loads
  useEffect(() => {
    if (!project) return;
    const { objectTypeId, recordId, recordName } = project;
    if (!objectTypeId && !recordName) return;

    const tryFindInRecords = (recs: Record<string, unknown>[]): Record<string, unknown> | null => {
      if (recordId) {
        const byId = recs.find(r =>
          String(r['hs_object_id']) === String(recordId) ||
          String(r['id']) === String(recordId)
        );
        if (byId) return byId;
      }
      if (recordName) {
        return recs.find(r => getRecordName(r) === recordName) ?? null;
      }
      return null;
    };

    const searchAllTypes = () => {
      api.getObjectTypes().then((ots: { id: string }[]) => {
        const otherOts = ots.filter(o => o.id !== objectTypeId);
        Promise.all(otherOts.map(o => api.getOntologyRecords(o.id))).then(allRecs => {
          for (const recs of allRecs) {
            const f = tryFindInRecords(recs);
            if (f) { setLinkedRecord(f); return; }
          }
        });
      });
    };

    if (objectTypeId) {
      api.getOntologyRecords(objectTypeId).then((recs: Record<string, unknown>[]) => {
        const found = tryFindInRecords(recs);
        if (found) { setLinkedRecord(found); return; }
        if (recordName) searchAllTypes();
      });
    } else {
      // No objectTypeId stored — search all types by name
      api.getObjectTypes().then((ots: { id: string }[]) => {
        Promise.all(ots.map(o => api.getOntologyRecords(o.id))).then(allRecs => {
          for (const recs of allRecs) {
            const f = tryFindInRecords(recs);
            if (f) { setLinkedRecord(f); return; }
          }
        });
      });
    }
  }, [project?.objectTypeId, project?.recordId, project?.recordName]);

  // Build internal activity log from stage comments and progress updates
  useEffect(() => {
    const items: Record<string, unknown>[] = [];
    for (const stage of stages) {
      // Comments
      for (const c of stage.comments || []) {
        items.push({
          timestamp: c.createdAt,
          activity: `Comment on "${stage.name}"`,
          attributes: { author: c.author, message: c.text },
        });
      }
      // Progress if set
      if ((stage.progress ?? 0) > 0) {
        items.push({
          timestamp: stage.startDate || stage.endDate || '',
          activity: `Progress updated — "${stage.name}"`,
          attributes: { progress: `${stage.progress}%` },
        });
      }
    }
    // Sort newest first
    items.sort((a, b) => {
      const ta = String(a['timestamp'] || '');
      const tb = String(b['timestamp'] || '');
      return tb.localeCompare(ta);
    });
    setEvents(items);
  }, [stages]);

  const updateStage = useCallback(async (id: string, patch: Partial<ProjectStage>) => {
    setStages(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    await api.updateStage(id, patch);
  }, []);

  const handleAddSubStage = useCallback((parentId: string) => {
    setSubStageParentId(parentId);
  }, []);

  const submitNewStage = async (form: StageFormState) => {
    const meta = STAGE_META[form.stageType] || STAGE_META.custom;
    const s = await api.createStage(projectId, {
      name: form.name,
      stageType: form.stageType,
      color: meta.color,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      assignedToId: form.assignedToId || undefined,
      order: stages.filter(x => !x.parentId).length,
    });
    setStages(prev => [...prev, s]);
    setShowNewStage(false);
  };

  const submitNewSubStage = async (form: StageFormState) => {
    if (!subStageParentId) return;
    const parent = stages.find(s => s.id === subStageParentId);
    const stageType = parent?.stageType || form.stageType;
    const meta = STAGE_META[stageType] || STAGE_META.custom;
    const s = await api.createStage(projectId, {
      name: form.name,
      stageType,
      color: meta.color,
      parentId: subStageParentId,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      assignedToId: form.assignedToId || undefined,
      order: stages.filter(x => x.parentId === subStageParentId).length,
    });
    setStages(prev => [...prev, s]);
    setSubStageParentId(null);
  };

  const deleteStage = useCallback(async (id: string) => {
    const toDelete = stages.filter(s => s.id === id || s.parentId === id);
    await Promise.all(toDelete.map(s => api.deleteStage(s.id)));
    setStages(prev => prev.filter(s => s.id !== id && s.parentId !== id));
  }, [stages]);

  if (!project) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8' }}>
      Loading…
    </div>
  );

  const pm = members.find(m => m.id === project.pmId);
  const subStageParent = subStageParentId ? stages.find(s => s.id === subStageParentId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 52px 0 24px', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <ArrowLeft size={16} /> {company.name}
        </button>
        <div style={{ width: 1, height: 20, backgroundColor: '#E2E8F0' }} />
        <Briefcase size={16} color="#64748B" />
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0D1117' }}>{project.name}</span>
        {pm && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: pm.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>
              {pm.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: '#64748B' }}>{pm.name}</span>
          </div>
        )}

        {/* Stage legend (only in gantt tab) */}
        {activeTab === 'gantt' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            {(Object.entries(STAGE_META) as [string, { label: string; color: string; light: string }][])
              .filter(([k]) => k !== 'custom')
              .map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: v.color }} />
                  <span style={{ fontSize: 11, color: '#64748B' }}>{v.label}</span>
                </div>
              ))
            }
            {/* Add Stage button */}
            <button
              onClick={() => setShowNewStage(true)}
              style={{
                height: 32, padding: '0 12px', borderRadius: 6, border: '1px solid #E2E8F0',
                backgroundColor: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4,
              }}
            >
              <Plus size={13} /> Stage
            </button>
          </div>
        )}

        {activeTab === 'info' && <div style={{ marginLeft: 'auto' }} />}
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #E2E8F0', backgroundColor: '#fff',
        padding: '0 24px', flexShrink: 0,
      }}>
        {(['gantt', 'info'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              height: 40, padding: '0 16px', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#2563EB' : '#64748B',
              backgroundColor: 'transparent',
              borderBottom: activeTab === tab ? '2px solid #2563EB' : '2px solid transparent',
              transition: 'all 120ms',
              textTransform: 'capitalize',
              marginBottom: -1,
            }}
          >
            {tab === 'gantt' ? 'Gantt' : 'Info'}
          </button>
        ))}
      </div>

      {/* Gantt tab */}
      {activeTab === 'gantt' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GanttChart
            stages={stages}
            members={members}
            onUpdateStage={updateStage}
            onAddSubStage={handleAddSubStage}
            onDeleteStage={deleteStage}
            onOpenDetail={setDetailStageId}
          />
        </div>
      )}

      {/* Info tab */}
      {activeTab === 'info' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0D1117', marginBottom: 4 }}>
                {project.name}
              </div>
              {project.description && (
                <div style={{ fontSize: 13, color: '#64748B' }}>{project.description}</div>
              )}
            </div>

            {linkedRecord ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
                  Linked Record
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
                  border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden',
                }}>
                  {Object.entries(linkedRecord)
                    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
                    .map(([k, v], i) => (
                      <div
                        key={k}
                        style={{
                          padding: '10px 14px',
                          backgroundColor: i % 2 === 0 ? '#FAFAFA' : '#fff',
                          borderBottom: '1px solid #F1F5F9',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {toTitleCase(k)}
                        </div>
                        <div style={{ fontSize: 13, color: '#0D1117', wordBreak: 'break-word' }}>
                          {String(v)}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            ) : (project.recordId || project.recordName) ? (
              <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 48 }}>
                Loading linked record…
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 13, padding: 48 }}>
                No linked record for this project.
              </div>
            )}

            {/* Stage progress overview */}
            {stages.filter(s => !s.parentId).length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
                  Stage Progress
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stages.filter(s => !s.parentId).sort((a, b) => a.order - b.order).map(stage => {
                    const meta = STAGE_META[stage.stageType] || STAGE_META.custom;
                    const pct = stage.progress ?? 0;
                    const subCount = stages.filter(s => s.parentId === stage.id).length;
                    const commentCount = stage.comments?.length ?? 0;
                    const member = members.find(m => m.id === stage.assignedToId);
                    return (
                      <div key={stage.id} style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', flex: 1 }}>{stage.name || 'Unnamed stage'}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, backgroundColor: meta.light, padding: '1px 6px', borderRadius: 10 }}>{meta.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: pct === 100 ? '#059669' : '#374151', marginLeft: 8 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', overflow: 'hidden', marginBottom: 8 }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: meta.color, borderRadius: 3, transition: 'width 300ms' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#94A3B8' }}>
                          {member && <span>{member.name}</span>}
                          {stage.startDate && stage.endDate && <span>{stage.startDate} → {stage.endDate}</span>}
                          {subCount > 0 && <span>{subCount} sub-stage{subCount > 1 ? 's' : ''}</span>}
                          {commentCount > 0 && <span><MessageSquare size={11} style={{ display: 'inline' }} /> {commentCount} comment{commentCount > 1 ? 's' : ''}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Activity / Event Log */}
            {events.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
                  Activity Log
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                  {events.slice(0, 20).map((ev, i) => {
                    const ts = ev['timestamp'] as string;
                    const activity = ev['activity'] as string;
                    const attrs = ev['attributes'] as Record<string, unknown> | undefined;
                    const attrText = attrs ? Object.entries(attrs).filter(([,v]) => v != null).map(([k,v]) => `${k}: ${v}`).join(', ') : '';
                    const label = (activity || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
                    return (
                      <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', backgroundColor: i % 2 === 0 ? '#FAFAFA' : '#fff', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', marginTop: 1, minWidth: 120 }}>
                          {ts ? new Date(ts).toLocaleString() : '—'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: '#0D1117' }}>{label}</div>
                          {attrText && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{attrText}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Stage modal */}
      {showNewStage && (
        <NewStageModal
          title="New Stage"
          members={members}
          onClose={() => setShowNewStage(false)}
          onSubmit={submitNewStage}
        />
      )}

      {/* New Sub-Stage modal */}
      {subStageParentId && (
        <NewStageModal
          title={`Add Sub-stage${subStageParent ? ` to "${subStageParent.name || 'stage'}"` : ''}`}
          members={members}
          initialStageType={subStageParent?.stageType || 'custom'}
          inheritType={true}
          onClose={() => setSubStageParentId(null)}
          onSubmit={submitNewSubStage}
        />
      )}

      {/* Stage Detail Drawer */}
      {detailStageId && (
        <StageDetailDrawer
          stage={stages.find(s => s.id === detailStageId)!}
          members={members}
          onClose={() => setDetailStageId(null)}
          onUpdate={(patch) => updateStage(detailStageId, patch)}
        />
      )}
    </div>
  );
};

// ── Main Module ───────────────────────────────────────────────────────────────

type View = 'projects' | 'gantt';

const ProjectsModule: React.FC = () => {
  const [view, setView] = useState<View>('projects');
  const [company, setCompany] = useState<Company | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  // Auto-load or create the "maic" company on mount
  useEffect(() => {
    api.getCompanies().then(async (companies: Company[]) => {
      let maic: Company = (companies as Company[]).find((c) => c.name.toLowerCase() === 'maic') as Company;
      if (!maic) {
        maic = await api.createCompany({ name: 'maic', color: '#2563EB', description: 'mAIc S.A. de C.V.' });
      }
      setCompany(maic);
    });
  }, []);

  if (!company) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (view === 'gantt' && project) {
    return (
      <GanttView
        projectId={project.id}
        company={company}
        onBack={() => setView('projects')}
      />
    );
  }

  return (
    <ProjectsListView
      company={company}
      onBack={() => {}}
      onOpenProject={p => { setProject(p); setView('gantt'); }}
    />
  );
};

export default ProjectsModule;
