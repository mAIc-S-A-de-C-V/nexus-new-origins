import React, { useState } from 'react';
import { useAuth } from '../shell/TenantContext';

const LockIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B6B85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const ChangePasswordPage: React.FC = () => {
  const { currentUser, changePassword, logout } = useAuth();
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [newFocused, setNewFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  const W = 210;

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: W, height: 36,
    backgroundColor: '#1F2D3D',
    border: `1px solid ${focused ? '#4F6BC6' : '#2D3F55'}`,
    borderRadius: 3, color: '#C5CDD8', fontSize: 13,
    padding: '0 10px 0 32px', outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', caretColor: '#C5CDD8',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPass !== confirm) { setError('Passwords do not match.'); return; }
    if (!currentUser) return;
    changePassword(currentUser.id, newPass);
  };

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#1B2333',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
      backgroundImage: 'radial-gradient(ellipse at 50% 40%, #1E2A3D 0%, #151D2B 100%)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>

        {/* Header text */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#8A9BAE', marginBottom: 4 }}>
            Set your password
          </div>
          <div style={{ fontSize: 11, color: '#4A5568', maxWidth: W }}>
            A temporary password was assigned to your account.
            Create a new one to continue.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>

          {/* Signed in as */}
          <div style={{ width: W, fontSize: 11, color: '#4A5568', textAlign: 'center', marginBottom: 2 }}>
            Signed in as <span style={{ color: '#8A9BAE' }}>{currentUser?.email}</span>
          </div>

          {/* New password */}
          <div style={{ position: 'relative', width: W }}>
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, pointerEvents: 'none' }}>
              <LockIcon />
            </div>
            <input
              type="password"
              value={newPass}
              onChange={(e) => { setNewPass(e.target.value); setError(''); }}
              placeholder="New password"
              autoFocus
              style={inputStyle(newFocused)}
              onFocus={() => setNewFocused(true)}
              onBlur={() => setNewFocused(false)}
            />
          </div>

          {/* Confirm password */}
          <div style={{ position: 'relative', width: W }}>
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, pointerEvents: 'none' }}>
              <LockIcon />
            </div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(''); }}
              placeholder="Confirm password"
              style={inputStyle(confirmFocused)}
              onFocus={() => setConfirmFocused(true)}
              onBlur={() => setConfirmFocused(false)}
            />
          </div>

          {/* Strength hint */}
          {newPass.length > 0 && (
            <div style={{ width: W, display: 'flex', gap: 4 }}>
              {[...Array(4)].map((_, i) => {
                const strength = newPass.length >= 12 ? 4 : newPass.length >= 8 ? 3 : newPass.length >= 6 ? 2 : 1;
                const colors = ['#EF4444', '#F97316', '#EAB308', '#22C55E'];
                return (
                  <div key={i} style={{
                    flex: 1, height: 2, borderRadius: 1,
                    backgroundColor: i < strength ? colors[strength - 1] : '#1F2D3D',
                    transition: 'background-color 200ms',
                  }} />
                );
              })}
            </div>
          )}

          {error && (
            <div style={{ width: W, fontSize: 11, color: '#F87171', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: W, height: 34, backgroundColor: '#4054A8',
              border: 'none', borderRadius: 3, color: '#BCC8E0',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.02em',
              transition: 'background-color 120ms', marginTop: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4A61C0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#4054A8'; }}
          >
            Set password
          </button>

          <button
            type="button"
            onClick={logout}
            style={{
              background: 'none', border: 'none',
              fontSize: 11, color: '#334155', cursor: 'pointer',
              fontFamily: 'inherit', marginTop: 4,
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
