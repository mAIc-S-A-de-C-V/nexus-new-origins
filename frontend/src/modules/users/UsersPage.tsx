import React, { useState } from 'react';
import {
  Plus, X, Pencil, Trash2, ShieldCheck, BarChart2, Eye, Wrench,
  Copy, Check, RefreshCw, ToggleLeft, ToggleRight, KeyRound, LayoutGrid,
} from 'lucide-react';
import { useAuth, MaicUser, UserRole } from '../../shell/TenantContext';

// ── Module access config ────────────────────────────────────────────────────

const ALL_MODULES = [
  { id: 'connectors', label: 'Connectors' },
  { id: 'ontology',   label: 'Ontology' },
  { id: 'events',     label: 'Event Log' },
  { id: 'process',    label: 'Process Mining' },
  { id: 'pipelines',  label: 'Pipelines' },
  { id: 'projects',   label: 'Projects' },
  { id: 'finance',    label: 'Finance' },
  { id: 'apps',       label: 'Apps' },
];

// ── Role metadata ──────────────────────────────────────────────────────────

const ROLES: { value: UserRole; label: string; description: string; color: string }[] = [
  { value: 'ADMIN',         label: 'Admin',         description: 'Full platform access',            color: '#7C3AED' },
  { value: 'DATA_ENGINEER', label: 'Data Engineer', description: 'Connectors, pipelines, ontology', color: '#2563EB' },
  { value: 'ANALYST',       label: 'Analyst',       description: 'Apps, dashboards, read access',   color: '#059669' },
  { value: 'VIEWER',        label: 'Viewer',        description: 'Read-only access',                color: '#64748B' },
];

const ROLE_ICON: Record<UserRole, React.ReactNode> = {
  ADMIN:         <ShieldCheck size={12} />,
  DATA_ENGINEER: <Wrench size={12} />,
  ANALYST:       <BarChart2 size={12} />,
  VIEWER:        <Eye size={12} />,
};

function roleMeta(role: UserRole) {
  return ROLES.find((r) => r.value === role) ?? ROLES[3];
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Temp password generator ────────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateTempPassword(len = 12): string {
  return Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

// ── Copy button ────────────────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; small?: boolean }> = ({ text, small }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button onClick={copy} title="Copy" style={{
      background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0,
      color: copied ? '#22C55E' : '#475569', padding: small ? 2 : 4,
      transition: 'color 150ms',
    }}>
      {copied ? <Check size={small ? 11 : 13} /> : <Copy size={small ? 11 : 13} />}
    </button>
  );
};

// ── Credentials card (shown after creating a user) ─────────────────────────

const CredentialsCard: React.FC<{
  user: MaicUser;
  tempPassword: string;
  onClose: () => void;
}> = ({ user, tempPassword, onClose }) => {
  const snippet = `Email: ${user.email}\nTemp password: ${tempPassword}`;
  const [allCopied, setAllCopied] = useState(false);

  const copyAll = () => {
    navigator.clipboard.writeText(snippet).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#0D1117', border: '1px solid #1E293B', width: 400,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #1E293B',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={14} style={{ color: '#7C3AED' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC' }}>
              Account created
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', lineHeight: 0 }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 16px' }}>
          <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 16px' }}>
            Share these credentials with <strong style={{ color: '#94A3B8' }}>{user.name}</strong>.
            They will be prompted to set a new password on first login.
          </p>

          <div style={{
            backgroundColor: '#070B0F', border: '1px solid #1E293B',
            borderRadius: 4, padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            {/* Email row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>Email</div>
                <div style={{ fontSize: 13, color: '#C5CDD8', fontFamily: 'monospace' }}>{user.email}</div>
              </div>
              <CopyButton text={user.email} />
            </div>

            <div style={{ borderTop: '1px solid #1E293B' }} />

            {/* Temp password row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>
                  Temporary password
                </div>
                <div style={{ fontSize: 13, color: '#A78BFA', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                  {tempPassword}
                </div>
              </div>
              <CopyButton text={tempPassword} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#7C3AED', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#475569' }}>
              User must set a new password before accessing the platform.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={copyAll} style={{
            height: 30, padding: '0 12px', backgroundColor: 'transparent',
            border: '1px solid #1E293B', color: allCopied ? '#22C55E' : '#64748B',
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {allCopied ? <Check size={11} /> : <Copy size={11} />}
            {allCopied ? 'Copied' : 'Copy all'}
          </button>
          <button onClick={onClose} style={{
            height: 30, padding: '0 16px', backgroundColor: '#7C3AED',
            border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Create user modal ──────────────────────────────────────────────────────

const CreateUserModal: React.FC<{
  onSave: (data: { name: string; email: string; role: UserRole; password: string; allowed_modules?: string[] }) => void;
  onClose: () => void;
}> = ({ onSave, onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('ANALYST');
  const [tempPass, setTempPass] = useState(() => generateTempPassword());
  const [error, setError] = useState('');
  const [restrictModules, setRestrictModules] = useState(false);
  const [allowedMods, setAllowedMods] = useState<string[]>(ALL_MODULES.map(m => m.id));

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 34, backgroundColor: '#070B0F',
    border: '1px solid #1E293B', color: '#F8FAFC', fontSize: 13,
    padding: '0 10px', outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box', borderRadius: 2,
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Full name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!email.includes('@')) { setError('Enter a valid email address.'); return; }
    if (!tempPass.trim()) { setError('Temporary password is required.'); return; }
    onSave({ name: name.trim(), email: email.trim().toLowerCase(), role, password: tempPass, allowed_modules: restrictModules ? allowedMods : undefined });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#0D1117', border: '1px solid #1E293B', width: 460,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #1E293B',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC' }}>Create user</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', lineHeight: 0 }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Name */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 5 }}>
              Full name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Jane Smith"
              autoFocus
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
            />
          </div>

          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 5 }}>
              Email address
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="jane@example.com"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
            />
          </div>

          {/* Temp password */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 5 }}>
              Temporary password
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={tempPass}
                onChange={(e) => { setTempPass(e.target.value); setError(''); }}
                style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.06em', flex: 1 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
              />
              <button
                type="button"
                onClick={() => setTempPass(generateTempPassword())}
                title="Generate new password"
                style={{
                  width: 34, height: 34, border: '1px solid #1E293B',
                  backgroundColor: '#070B0F', color: '#475569', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <RefreshCw size={13} />
              </button>
              <CopyButton text={tempPass} />
            </div>
            <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
              User will be forced to change this on first login.
            </div>
          </div>

          {/* Role */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 8 }}>
              Role
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {ROLES.map((r) => (
                <label key={r.value} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '8px 10px', cursor: 'pointer',
                  border: `1px solid ${role === r.value ? r.color + '66' : '#1E293B'}`,
                  backgroundColor: role === r.value ? r.color + '0F' : 'transparent',
                }}>
                  <input
                    type="radio" name="role" value={r.value}
                    checked={role === r.value} onChange={() => setRole(r.value)}
                    style={{ accentColor: r.color, marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: role === r.value ? '#F8FAFC' : '#64748B' }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: '#334155', marginTop: 1 }}>{r.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Module access */}
          {role !== 'ADMIN' && (
            <div style={{ border: '1px solid #1E293B', backgroundColor: '#070B0F' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LayoutGrid size={13} style={{ color: '#475569' }} />
                  <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>Restrict module access</span>
                </div>
                <button type="button" onClick={() => setRestrictModules(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0, color: restrictModules ? '#7C3AED' : '#334155' }}>
                  {restrictModules ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
              {restrictModules && (
                <div style={{ borderTop: '1px solid #1E293B', padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {ALL_MODULES.map(m => (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allowedMods.includes(m.id)}
                        onChange={e => setAllowedMods(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))}
                        style={{ accentColor: '#7C3AED' }}
                      />
                      <span style={{ fontSize: 12, color: allowedMods.includes(m.id) ? '#E2E8F0' : '#475569' }}>{m.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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
            border: '1px solid #1E293B', color: '#64748B', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{
            height: 32, padding: '0 20px', backgroundColor: '#7C3AED',
            border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Create user
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Edit user modal ────────────────────────────────────────────────────────

const EditUserModal: React.FC<{
  user: MaicUser;
  onSave: (patch: Partial<MaicUser>) => void;
  onClose: () => void;
}> = ({ user, onSave, onClose }) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<UserRole>(user.role);
  const [resetPass, setResetPass] = useState(false);
  const [newTempPass, setNewTempPass] = useState(() => generateTempPassword());
  const [error, setError] = useState('');
  const [restrictModules, setRestrictModules] = useState(!!(user.allowed_modules && user.allowed_modules.length > 0));
  const [allowedMods, setAllowedMods] = useState<string[]>(user.allowed_modules ?? ALL_MODULES.map(m => m.id));

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 34, backgroundColor: '#070B0F',
    border: '1px solid #1E293B', color: '#F8FAFC', fontSize: 13,
    padding: '0 10px', outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box', borderRadius: 2,
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    const patch: Partial<MaicUser> = {
      name: name.trim(), email: email.trim().toLowerCase(), role,
      allowed_modules: (role !== 'ADMIN' && restrictModules) ? allowedMods : undefined,
    };
    if (resetPass) {
      patch.password = newTempPass;
      patch.mustChangePassword = true;
    }
    onSave(patch);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ backgroundColor: '#0D1117', border: '1px solid #1E293B', width: 440, fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1E293B' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC' }}>Edit user</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', lineHeight: 0 }}><X size={15} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { label: 'Full name', value: name, set: setName, placeholder: 'Jane Smith' },
            { label: 'Email address', value: email, set: setEmail, placeholder: 'jane@example.com' },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 5 }}>{label}</label>
              <input type="text" value={value} onChange={(e) => { set(e.target.value); setError(''); }} placeholder={placeholder} style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }} />
            </div>
          ))}

          {/* Role */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 8 }}>Role</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {ROLES.map((r) => (
                <label key={r.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer',
                  border: `1px solid ${role === r.value ? r.color + '66' : '#1E293B'}`,
                  backgroundColor: role === r.value ? r.color + '0F' : 'transparent',
                }}>
                  <input type="radio" name="edit-role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} style={{ accentColor: r.color }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: role === r.value ? '#F8FAFC' : '#64748B' }}>{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Reset password toggle */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid #1E293B', backgroundColor: '#070B0F' }}>
            <KeyRound size={14} style={{ color: '#475569', marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: resetPass ? 8 : 0 }}>
                <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>Reset password</span>
                <button type="button" onClick={() => setResetPass((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0, color: resetPass ? '#7C3AED' : '#334155' }}>
                  {resetPass ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
              {resetPass && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" value={newTempPass} onChange={(e) => setNewTempPass(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.06em', flex: 1, fontSize: 12 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }} />
                  <button type="button" onClick={() => setNewTempPass(generateTempPassword())} style={{ width: 34, height: 34, border: '1px solid #1E293B', backgroundColor: '#0D1117', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw size={12} />
                  </button>
                  <CopyButton text={newTempPass} small />
                </div>
              )}
            </div>
          </div>

          {/* Module access */}
          {role !== 'ADMIN' && (
            <div style={{ border: '1px solid #1E293B', backgroundColor: '#070B0F' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LayoutGrid size={13} style={{ color: '#475569' }} />
                  <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>Restrict module access</span>
                </div>
                <button type="button" onClick={() => setRestrictModules(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0, color: restrictModules ? '#7C3AED' : '#334155' }}>
                  {restrictModules ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
              {restrictModules && (
                <div style={{ borderTop: '1px solid #1E293B', padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {ALL_MODULES.map(m => (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allowedMods.includes(m.id)}
                        onChange={e => setAllowedMods(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))}
                        style={{ accentColor: '#7C3AED' }}
                      />
                      <span style={{ fontSize: 12, color: allowedMods.includes(m.id) ? '#E2E8F0' : '#475569' }}>{m.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: '#F87171', backgroundColor: '#1A0A0A', border: '1px solid #3F1010', padding: '8px 12px' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid #1E293B' }}>
          <button onClick={onClose} style={{ height: 32, padding: '0 16px', backgroundColor: 'transparent', border: '1px solid #1E293B', color: '#64748B', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={handleSave} style={{ height: 32, padding: '0 20px', backgroundColor: '#7C3AED', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Save changes</button>
        </div>
      </div>
    </div>
  );
};

// ── UsersPage ──────────────────────────────────────────────────────────────

const UsersPage: React.FC = () => {
  const { users, currentUser, addUser, updateUser, deleteUser } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<MaicUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ user: MaicUser; tempPassword: string } | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';

  const handleCreate = ({ name, email, role, password, allowed_modules }: { name: string; email: string; role: UserRole; password: string; allowed_modules?: string[] }) => {
    const user = addUser({ name, email, role, password, active: true, mustChangePassword: true, createdBy: currentUser?.id, allowed_modules });
    setShowCreate(false);
    setCreatedCreds({ user, tempPassword: password });
  };

  const handleEdit = (patch: Partial<MaicUser>) => {
    if (!editing) return;
    updateUser(editing.id, patch);
    setEditing(null);
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
        padding: '0 52px 0 24px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 }}>Users</h1>
          <span style={{ fontSize: 11, color: '#64748B', backgroundColor: '#F1F5F9', padding: '2px 8px', fontWeight: 500 }}>
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </span>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)} style={{
            height: 32, padding: '0 14px', backgroundColor: '#7C3AED',
            border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
          }}>
            <Plus size={13} /> Create user
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                {['User', 'Email', 'Role', 'Status', 'Created', ...(isAdmin ? ['Actions'] : [])].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '9px 16px',
                    fontSize: 10, fontWeight: 600, color: '#94A3B8',
                    letterSpacing: '0.07em', textTransform: 'uppercase',
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
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          backgroundColor: meta.color + '18', border: `1px solid ${meta.color}33`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700, color: meta.color, flexShrink: 0,
                        }}>
                          {initials(u.name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, color: '#0D1117', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {u.name}
                            {isMe && <span style={{ fontSize: 9, color: '#7C3AED', backgroundColor: '#EDE9FE', padding: '1px 5px' }}>you</span>}
                            {u.mustChangePassword && <span style={{ fontSize: 9, color: '#B45309', backgroundColor: '#FEF3C7', padding: '1px 5px' }}>temp pwd</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', color: '#475569', fontFamily: 'monospace', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {u.email}
                        <CopyButton text={u.email} small />
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, fontWeight: 600, color: meta.color,
                        backgroundColor: meta.color + '15', padding: '3px 8px',
                      }}>
                        {ROLE_ICON[u.role]} {meta.label}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      {isAdmin && !isMe ? (
                        <button
                          onClick={() => updateUser(u.id, { active: !u.active })}
                          title={u.active ? 'Deactivate' : 'Activate'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            fontSize: 11, fontWeight: 500, cursor: 'pointer',
                            color: u.active ? '#059669' : '#94A3B8',
                            backgroundColor: u.active ? '#ECFDF5' : '#F1F5F9',
                            padding: '3px 8px', border: 'none', fontFamily: 'inherit',
                          }}
                        >
                          {u.active ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                          {u.active ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 500, color: '#059669', backgroundColor: '#ECFDF5', padding: '3px 8px' }}>
                          Active
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#94A3B8', fontSize: 12 }}>
                      {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    {isAdmin && (
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setEditing(u)} style={{ width: 28, height: 28, border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Pencil size={11} />
                          </button>
                          {!isMe && (
                            <button onClick={() => setConfirmDelete(u.id)} style={{ width: 28, height: 28, border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Trash2 size={11} />
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
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Role permissions</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {ROLES.map((r) => (
              <div key={r.value} style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ color: r.color }}>{ROLE_ICON[r.value]}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>{r.label}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>{r.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create modal */}
      {showCreate && <CreateUserModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}

      {/* Credentials card */}
      {createdCreds && (
        <CredentialsCard
          user={createdCreds.user}
          tempPassword={createdCreds.tempPassword}
          onClose={() => setCreatedCreds(null)}
        />
      )}

      {/* Edit modal */}
      {editing && <EditUserModal user={editing} onSave={handleEdit} onClose={() => setEditing(null)} />}

      {/* Delete confirm */}
      {confirmDelete && (() => {
        const u = users.find((x) => x.id === confirmDelete);
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ backgroundColor: '#0D1117', border: '1px solid #1E293B', width: 360, padding: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC', marginBottom: 8 }}>Remove user</div>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 20 }}>
                Remove <strong style={{ color: '#F8FAFC' }}>{u?.name}</strong> permanently? This cannot be undone.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setConfirmDelete(null)} style={{ height: 32, padding: '0 14px', backgroundColor: 'transparent', border: '1px solid #1E293B', color: '#64748B', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={() => { deleteUser(confirmDelete); setConfirmDelete(null); }} style={{ height: 32, padding: '0 14px', backgroundColor: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default UsersPage;
