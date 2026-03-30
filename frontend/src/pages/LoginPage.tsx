import React, { useState } from 'react';
import { useAuth } from '../shell/TenantContext';
import { useAuthStore } from '../store/authStore';

const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';
const SSO_ENABLED = !!import.meta.env.VITE_AUTH_SERVICE_URL;

// ── maic icon — muted for login screen ───────────────────────────────────

const MaicLoginIcon: React.FC = () => (
  <svg width="52" height="52" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="18" y1="18" x2="9"  y2="9"  stroke="#4A5568" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="26" y1="18" x2="35" y2="9"  stroke="#4A5568" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="18" y1="26" x2="9"  y2="35" stroke="#4A5568" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="26" y1="26" x2="35" y2="35" stroke="#4A5568" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="26" y1="22" x2="31" y2="22" stroke="#4A5568" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="8"  cy="8"  r="5" fill="#4A5568" />
    <circle cx="36" cy="8"  r="5" fill="#4A5568" />
    <circle cx="8"  cy="36" r="5" fill="#4A5568" />
    <circle cx="36" cy="36" r="5" fill="#4A5568" />
    <circle cx="33" cy="22" r="3" fill="#4A5568" />
    <rect x="17" y="17" width="10" height="10" rx="2" fill="#4A5568" />
  </svg>
);

// ── User icon for input ───────────────────────────────────────────────────

const UserIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B6B85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

const LockIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B6B85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// ── LoginPage ─────────────────────────────────────────────────────────────

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const W = 210; // form element width

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: W,
    height: 36,
    backgroundColor: '#1F2D3D',
    border: `1px solid ${focused ? '#4F6BC6' : '#2D3F55'}`,
    borderRadius: 3,
    color: '#C5CDD8',
    fontSize: 13,
    padding: '0 10px 0 32px',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    caretColor: '#C5CDD8',
  });

  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter your email address.'); return; }
    setError('');
    setStep('password');
    setTimeout(() => {
      (document.getElementById('maic-pass') as HTMLInputElement)?.focus();
    }, 50);
  };

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true);
    setError('');
    setTimeout(() => {
      const result = login(email.trim(), password);
      if (!result.success) {
        setError('Incorrect email or password.');
        setLoading(false);
      }
    }, 180);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1B2333',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
      backgroundImage: 'radial-gradient(ellipse at 50% 40%, #1E2A3D 0%, #151D2B 100%)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>

        {/* Logo */}
        <div style={{ marginBottom: 20 }}>
          <MaicLoginIcon />
        </div>

        {/* Email step */}
        {step === 'email' && (
          <form onSubmit={handleNext} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {/* Email input */}
            <div style={{ position: 'relative', width: W }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, pointerEvents: 'none' }}>
                <UserIcon />
              </div>
              <input
                id="maic-email"
                type="text"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="user@domain.com"
                autoFocus
                autoComplete="email"
                style={inputStyle(emailFocused)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
            </div>

            {/* Remember me */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: W, cursor: 'pointer',
              fontSize: 12, color: '#8A9BAE',
            }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={{ accentColor: '#4F6BC6', width: 13, height: 13, margin: 0 }}
              />
              Remember me
            </label>

            {error && (
              <div style={{ width: W, fontSize: 11, color: '#F87171', textAlign: 'center' }}>
                {error}
              </div>
            )}

            {/* Next button */}
            <button
              type="submit"
              style={{
                width: W, height: 34,
                backgroundColor: '#4054A8',
                border: 'none', borderRadius: 3,
                color: '#BCC8E0', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
                letterSpacing: '0.02em',
                transition: 'background-color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4A61C0'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#4054A8'; }}
            >
              Next
            </button>
          </form>
        )}

        {/* SSO buttons — shown only in email step when auth service is configured */}
        {step === 'email' && SSO_ENABLED && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: W, marginBottom: 2 }}>
              <div style={{ flex: 1, height: 1, backgroundColor: '#2D3F55' }} />
              <span style={{ fontSize: 10, color: '#4A5568' }}>or sign in with</span>
              <div style={{ flex: 1, height: 1, backgroundColor: '#2D3F55' }} />
            </div>
            {(['google', 'okta', 'azure'] as const).map(provider => (
              <button
                key={provider}
                type="button"
                onClick={() => { window.location.href = `${AUTH_API}/auth/oidc/${provider}`; }}
                style={{
                  width: W, height: 32,
                  backgroundColor: '#1F2D3D', border: '1px solid #2D3F55', borderRadius: 3,
                  color: '#8A9BAE', fontSize: 12, fontFamily: 'inherit',
                  cursor: 'pointer', textTransform: 'capitalize', letterSpacing: '0.02em',
                  transition: 'border-color 120ms, color 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#4F6BC6';
                  e.currentTarget.style.color = '#BCC8E0';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2D3F55';
                  e.currentTarget.style.color = '#8A9BAE';
                }}
              >
                {provider === 'azure' ? 'Microsoft' : provider.charAt(0).toUpperCase() + provider.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Password step */}
        {step === 'password' && (
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {/* Email display (readonly) */}
            <div style={{
              width: W, fontSize: 12, color: '#8A9BAE', textAlign: 'center',
              marginBottom: 2,
            }}>
              {email}
              <button
                type="button"
                onClick={() => { setStep('email'); setError(''); setPassword(''); }}
                style={{
                  marginLeft: 8, fontSize: 11, color: '#4F6BC6',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                change
              </button>
            </div>

            {/* Password input */}
            <div style={{ position: 'relative', width: W }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, pointerEvents: 'none' }}>
                <LockIcon />
              </div>
              <input
                id="maic-pass"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Password"
                autoComplete="current-password"
                style={inputStyle(passFocused)}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
              />
            </div>

            {error && (
              <div style={{ width: W, fontSize: 11, color: '#F87171', textAlign: 'center' }}>
                {error}
              </div>
            )}

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: W, height: 34,
                backgroundColor: loading ? '#2E3E6A' : '#4054A8',
                border: 'none', borderRadius: 3,
                color: '#BCC8E0', fontSize: 13, fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', letterSpacing: '0.02em',
                transition: 'background-color 120ms',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#4A61C0'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#4054A8'; }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
