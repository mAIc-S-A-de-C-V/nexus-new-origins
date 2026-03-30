/**
 * Landing page for OIDC redirect callbacks.
 * URL: /auth/callback?token=<access_token>&provider=<provider>
 *
 * Parses the token from the URL, stores it, and navigates home.
 */
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

const SSOCallbackPage: React.FC = () => {
  const { handleOIDCCallback } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const provider = params.get('provider') || 'unknown';
    const error = params.get('error');

    if (error) {
      setErrorMessage(`SSO error: ${error}`);
      setStatus('error');
      return;
    }

    if (!token) {
      setErrorMessage('No token received from SSO provider.');
      setStatus('error');
      return;
    }

    handleOIDCCallback(token)
      .then(() => {
        setStatus('success');
        // Clean URL and redirect home after brief delay
        setTimeout(() => {
          window.history.replaceState({}, '', '/');
          window.dispatchEvent(new Event('popstate'));
        }, 800);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to process SSO login';
        setErrorMessage(msg);
        setStatus('error');
      });
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1B2333',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
    }}>
      <div style={{ textAlign: 'center', color: '#8A9BAE' }}>
        {status === 'loading' && (
          <>
            <div style={{ fontSize: 14, marginBottom: 8 }}>Completing sign-in…</div>
            <div style={{ fontSize: 11, color: '#475569' }}>Please wait</div>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 14, color: '#10B981', marginBottom: 8 }}>Signed in successfully</div>
            <div style={{ fontSize: 11, color: '#475569' }}>Redirecting…</div>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 14, color: '#F87171', marginBottom: 8 }}>Sign-in failed</div>
            <div style={{ fontSize: 11, color: '#475569', maxWidth: 300 }}>{errorMessage}</div>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                marginTop: 16, height: 30, padding: '0 14px',
                backgroundColor: '#4054A8', color: '#BCC8E0',
                border: 'none', borderRadius: 3, fontSize: 12, cursor: 'pointer',
              }}
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SSOCallbackPage;
