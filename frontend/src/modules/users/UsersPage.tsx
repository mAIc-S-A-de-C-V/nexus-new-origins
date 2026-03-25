import React, { useState } from 'react';
import { Plus, X, Pencil, Trash2, ShieldCheck, BarChart2, Eye, Wrench } from 'lucide-react';
import { useAuth, MaicUser, UserRole } from '../../shell/TenantContext';

// ── Role metadata ──────────────────────────────────────────────────────────

const ROLES: { value: UserRole; label: string; description: string; color: string }[] = [
  { value: 'ADMIN',          label: 'Admin',           description: 'Full platform access',          color: '#7C3AED' },
  { value: 'DATA_ENGINEER',  label: 'Data Engineer',   description: 'Connectors, pipelines, ontology', color: '#2563EB' },
  { value: 'ANALYST',        label: 'Analyst',         description: 'Apps, dashboards, read access', color: '#059669' },
  { value: 'VIEWER',         label: 'Viewer',          description: 'Read-only access',              color: '#64748B' },
];

const ROLE_ICON: Record<UserRole, React.ReactNode> = {
  ADMIN:         <ShieldCheck size={13} />,
  DATA_ENGINEER: <Wrench size={13} />,
  ANALYST:       <BarChart2 size={13} />,
  VIEWER:        <Eye size={13} />,
};

function roleMeta(role: UserRole) {
  return ROLES.find((r) => r.value === role) ?? ROLES[3];
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── User form modal ────────────────────────────────────────────────────────

interface UserFormData {
  name: string;
  email: string;
  role: UserRole;
  password: string;
  active: boolean;
}

const BLANK: UserFormData = { name: '', email: '', role: 'ANALYST', password: '', active: true };

const UserModal: React.FC<{
  title: string;
  initial: UserFormData;
  onSave: (data: UserFormData) => void;
  onClose: () => void;
  showPassword: boolean;
}> = ({ title, initial, onSave, onClose, showPassword }) => {
  const [form, setForm] = useState<UserFormData>(initial);
  const [error, setError] = useState('');

  const set = (patch: Partial<UserFormData>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.email.trim()) { setError('Email is required.'); return; }
    if (showPassword && !form.password.trim()) { setError('Password is required.'); return; }
    onSave(form);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 34, backgroundColor: '#070B0F',
    border: '1px solid #1E293B', color: '#F8FAFC', fontSize: 13,
    padding: '0 10px', outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#0D1117', border: '1px solid #1E293B',
        width: 440, fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #1E293B',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#F8FAFC' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', lineHeight: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { label: 'Full name', key: 'name' as const, type: 'text', placeholder: 'Jane Smith' },
            { label: 'Email address', key: 'email' as const, type: 'text', placeholder: 'jane@example.com' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 6 }}>
                {label}
              </label>
              <input
                type={type}
                value={form[key] as string}
                onChange={(e) => set({ [key]: e.target.value })}
                placeholder={placeholder}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
              />
            </div>
          ))}

          {showPassword && (
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
              />
            </div>
          )}

          {/* Role selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Role
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ROLES.map((r) => (
                <label key={r.value} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  border: `1px solid ${form.role === r.value ? r.color : '#1E293B'}`,
                  backgroundColor: form.role === r.value ? `${r.color}18` : 'transparent',
                  cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={form.role === r.value}
                    onChange={() => set({ role: r.value })}
                    style={{ accentColor: r.color, margin: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: form.role === r.value ? '#F8FAFC' : '#94A3B8' }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{r.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#F87171', backgroundColor: '#1A0A0A', border: '1px solid #3F1010', padding: '8px 12px' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px', borderTop: '1px solid #1E293B',
        }}>
          <button onClick={onClose} style={{
            height: 32, padding: '0 16px', backgroundColor: 'transparent',
            border: '1px solid #1E293B', color: '#94A3B8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{
            height: 32, padding: '0 20px', backgroundColor: '#7C3AED',
            border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// ── UsersPage ──────────────────────────────────────────────────────────────

const UsersPage: React.FC = () => {
  const { users, currentUser, addUser, updateUser, deleteUser } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<MaicUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';

  const handleAdd = (data: UserFormData) => {
    addUser({ ...data, name: data.name.trim(), email: data.email.trim() });
    setShowAdd(false);
  };

  const handleEdit = (data: UserFormData) => {
    if (!editing) return;
    updateUser(editing.id, {
      name: data.name.trim(),
      email: data.email.trim(),
      role: data.role,
      active: data.active,
      ...(data.password ? { password: data.password } : {}),
    });
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    deleteUser(id);
    setConfirmDelete(null);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      backgroundColor: '#F8FAFC', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif',
    }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 }}>Users</h1>
          <span style={{
            fontSize: 11, color: '#64748B', backgroundColor: '#F1F5F9',
            padding: '2px 8px', borderRadius: 2, fontWeight: 500,
          }}>
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              height: 32, padding: '0 14px', backgroundColor: '#7C3AED',
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <Plus size={13} />
            Add user
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['User', 'Email', 'Role', 'Status', 'Created', isAdmin ? 'Actions' : ''].filter(Boolean).map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 16px', fontSize: 11,
                    fontWeight: 600, color: '#64748B', letterSpacing: '0.05em',
                    textTransform: 'uppercase', whiteSpace: 'nowrap',
                    borderBottom: '1px solid #E2E8F0',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const meta = roleMeta(u.role);
                const isMe = u.id === currentUser?.id;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    {/* User */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%',
                          backgroundColor: meta.color + '22',
                          border: `1px solid ${meta.color}44`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: meta.color, flexShrink: 0,
                        }}>
                          {initials(u.name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, color: '#0D1117', fontSize: 13 }}>
                            {u.name}
                            {isMe && (
                              <span style={{ marginLeft: 6, fontSize: 10, color: '#7C3AED', backgroundColor: '#EDE9FE', padding: '1px 6px', borderRadius: 2 }}>
                                you
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Email */}
                    <td style={{ padding: '12px 16px', color: '#475569', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                      {u.email}
                    </td>
                    {/* Role */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, fontWeight: 600, color: meta.color,
                        backgroundColor: meta.color + '18', padding: '3px 8px',
                      }}>
                        {ROLE_ICON[u.role]}
                        {meta.label}
                      </span>
                    </td>
                    {/* Status */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: u.active ? '#059669' : '#94A3B8',
                        backgroundColor: u.active ? '#ECFDF5' : '#F1F5F9',
                        padding: '2px 8px',
                      }}>
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Created */}
                    <td style={{ padding: '12px 16px', color: '#94A3B8', fontSize: 12 }}>
                      {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    {/* Actions */}
                    {isAdmin && (
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setEditing(u)}
                            style={{
                              width: 28, height: 28, border: '1px solid #E2E8F0',
                              backgroundColor: '#F8FAFC', color: '#475569', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                            title="Edit user"
                          >
                            <Pencil size={12} />
                          </button>
                          {!isMe && (
                            <button
                              onClick={() => setConfirmDelete(u.id)}
                              style={{
                                width: 28, height: 28, border: '1px solid #FCA5A5',
                                backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                              title="Remove user"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Role reference */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
            Role reference
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {ROLES.map((r) => (
              <div key={r.value} style={{
                backgroundColor: '#fff', border: '1px solid #E2E8F0',
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: r.color }}>{ROLE_ICON[r.value]}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>{r.label}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>{r.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add modal */}
      {showAdd && (
        <UserModal
          title="Add user"
          initial={BLANK}
          showPassword
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <UserModal
          title={`Edit — ${editing.name}`}
          initial={{ name: editing.name, email: editing.email, role: editing.role, password: '', active: editing.active }}
          showPassword={false}
          onSave={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (() => {
        const u = users.find((x) => x.id === confirmDelete);
        return (
          <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}>
            <div style={{ backgroundColor: '#0D1117', border: '1px solid #1E293B', width: 360, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F8FAFC', marginBottom: 8 }}>Remove user</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>
                Remove <strong style={{ color: '#F8FAFC' }}>{u?.name}</strong> from the platform? This cannot be undone.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setConfirmDelete(null)} style={{
                  height: 32, padding: '0 16px', backgroundColor: 'transparent',
                  border: '1px solid #1E293B', color: '#94A3B8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={() => handleDelete(confirmDelete)} style={{
                  height: 32, padding: '0 16px', backgroundColor: '#DC2626',
                  border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default UsersPage;
