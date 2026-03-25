import React, { useState } from 'react';
import { useAuth } from '../shell/TenantContext';

// ── maic logo SVG ──────────────────────────────────────────────────────────

const MaicIcon: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Arms to corner nodes */}
    <line x1="18" y1="18" x2="9"  y2="9"  stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="18" x2="35" y2="9"  stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="18" y1="26" x2="9"  y2="35" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="26" x2="35" y2="35" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    {/* Short arm to right satellite dot */}
    <line x1="26" y1="22" x2="31" y2="22" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    {/* Corner nodes */}
    <circle cx="8"  cy="8"  r="5.5" fill="#7C3AED" />
    <circle cx="36" cy="8"  r="5.5" fill="#7C3AED" />
    <circle cx="8"  cy="36" r="5.5" fill="#7C3AED" />
    <circle cx="36" cy="36" r="5.5" fill="#7C3AED" />
    {/* Satellite dot */}
    <circle cx="33" cy="22" r="3.5" fill="#7C3AED" />
    {/* Central hub square */}
    <rect x="17" y="17" width="10" height="10" rx="2.5" fill="#7C3AED" />
  </svg>
);

// ── LoginPage ──────────────────────────────────────────────────────────────

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required.'); return; }
    setLoading(true);
    setError('');
    // Simulate brief async feel
    setTimeout(() => {
      const result = login(email.trim(), password);
      if (!result.success) {
        setError(result.error ?? 'Invalid credentials.');
        setLoading(false);
      }
    }, 200);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#070B0F',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle grid background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(124,58,237,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.04) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 1,
        background: 'linear-gradient(90deg, transparent, #7C3AED44, transparent)',
      }} />

      {/* Login card */}
      <div style={{
        width: 400,
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo block */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 16 }}>
            <MaicIcon size={40} />
            <span style={{
              fontSize: 32,
              fontWeight: 700,
              color: '#F8FAFC',
              letterSpacing: '-0.02em',
            }}>
              maic
            </span>
          </div>
          <p style={{
            fontSize: 13,
            color: '#475569',
            margin: 0,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            Enterprise Intelligence Platform
          </p>
        </div>

        {/* Form container */}
        <div style={{
          backgroundColor: '#0D1117',
          border: '1px solid #1E293B',
          padding: '40px 40px 36px',
        }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{
              fontSize: 15,
              fontWeight: 600,
              color: '#F8FAFC',
              margin: '0 0 4px',
              letterSpacing: '-0.01em',
            }}>
              Sign in
            </h2>
            <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>
              Use your maic credentials to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Email address
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="you@example.com"
                autoFocus
                autoComplete="email"
                style={{
                  width: '100%',
                  height: 38,
                  backgroundColor: '#070B0F',
                  border: '1px solid #1E293B',
                  color: '#F8FAFC',
                  fontSize: 13,
                  padding: '0 12px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  transition: 'border-color 120ms',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{
                  width: '100%',
                  height: 38,
                  backgroundColor: '#070B0F',
                  border: '1px solid #1E293B',
                  color: '#F8FAFC',
                  fontSize: 13,
                  padding: '0 12px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  transition: 'border-color 120ms',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#7C3AED'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#1E293B'; }}
              />
            </div>

            {error && (
              <div style={{
                fontSize: 12,
                color: '#F87171',
                backgroundColor: '#1A0A0A',
                border: '1px solid #3F1010',
                padding: '8px 12px',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 38,
                backgroundColor: loading ? '#4C1D95' : '#7C3AED',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                letterSpacing: '0.02em',
                transition: 'background-color 120ms',
                marginTop: 4,
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#6D28D9'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#7C3AED'; }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: '#334155', margin: 0 }}>
            maic Platform &nbsp;&middot;&nbsp; Confidential
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
