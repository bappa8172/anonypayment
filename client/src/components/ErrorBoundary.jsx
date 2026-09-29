import React from 'react';

function getSafeErrorMessage(error) {
  if (!error || !error.message) {
    return 'An unexpected rendering error occurred while loading this view.';
  }
  const msg = String(error.message);
  const lower = msg.toLowerCase();

  // If the message contains technical stack words, paths, or keys, mask it
  if (
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('key') ||
    lower.includes('password') ||
    lower.includes('0x') ||
    lower.includes('at ') ||
    lower.includes('cannot read') ||
    lower.includes('undefined') ||
    lower.includes('null') ||
    lower.includes('json') ||
    lower.includes('http') ||
    msg.length > 120
  ) {
    return 'An unexpected component error occurred while rendering this view. Please reload or contact support.';
  }

  return msg;
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log safe diagnostic trace in dev, suppressing sensitive data
    if (process.env.NODE_ENV !== 'production') {
      console.warn('UI View Error caught by ErrorBoundary:', error?.message);
    }
  }

  render() {
    if (this.state.hasError) {
      const safeMessage = getSafeErrorMessage(this.state.error);

      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#030711',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '16px',
              padding: '36px 28px',
              textAlign: 'center',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(239,68,68,0.15)',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', marginBottom: '8px' }}>
              Dashboard View Notice
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '24px' }}>
              {safeMessage}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: '#00e5ff',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                🔄 Reload Page
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('anony_token');
                  localStorage.removeItem('anony_user');
                  localStorage.removeItem('payrail_token');
                  localStorage.removeItem('payrail_user');
                  window.location.href = '/login';
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.15)',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔑 Re-authenticate
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
