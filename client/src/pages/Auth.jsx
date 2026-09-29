import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ShieldCheck,
  Zap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Key,
  ArrowRight,
  ArrowLeft,
  Building,
  User,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { authApi, setAuthToken, setStoredUser, clearAuth, getAuthToken } from '../api/client';
import TopologyField from '@/components/ui/topology-field';
import BrandLogo from '../components/BrandLogo';

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();

  // Active tab: 'login' | 'signup'
  const isSignupRoute = location.pathname.includes('signup');
  const [activeTab, setActiveTab] = useState(isSignupRoute ? 'signup' : 'login');

  // Sub-modes
  const [isApiKeyLogin, setIsApiKeyLogin] = useState(false);
  const [loginStep, setLoginStep] = useState(1); // 1: credentials, 2: OTP
  const [signupStep, setSignupStep] = useState(1); // 1: form, 2: OTP

  // Alerts
  const [alert, setAlert] = useState(null); // { type: 'error' | 'success', msg: '' }
  const [loading, setLoading] = useState(false);

  // Active session
  const [existingUser, setExistingUser] = useState(null);

  // Form states - Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginApiKey, setLoginApiKey] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [loginCooldown, setLoginCooldown] = useState(0);

  // Form states - Signup
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupOtp, setSignupOtp] = useState('');
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [signupCooldown, setSignupCooldown] = useState(0);

  // Sync tab with route
  useEffect(() => {
    setActiveTab(location.pathname.includes('signup') ? 'signup' : 'login');
    setAlert(null);
  }, [location.pathname]);

  // Check existing session
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      authApi.getMe()
        .then((res) => {
          if (res?.user) setExistingUser(res.user);
        })
        .catch(() => clearAuth());
    }
  }, []);

  // Cooldown timers
  useEffect(() => {
    if (loginCooldown > 0) {
      const timer = setTimeout(() => setLoginCooldown(loginCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [loginCooldown]);

  useEffect(() => {
    if (signupCooldown > 0) {
      const timer = setTimeout(() => setSignupCooldown(signupCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [signupCooldown]);

  // Password strength
  const getPasswordStrength = (pass) => {
    if (!pass) return { width: '0%', color: '#ef4444' };
    if (pass.length < 8) return { width: '30%', color: '#ef4444' };
    if (pass.length < 12) return { width: '70%', color: '#f59e0b' };
    return { width: '100%', color: '#10b981' };
  };

  // Switch account
  const handleSwitchAccount = () => {
    clearAuth();
    setExistingUser(null);
  };

  // ─────────────────────────────────────────────────────────────
  // 1. LOGIN SUBMIT
  // ─────────────────────────────────────────────────────────────
  const handleLoginStep1 = async (e) => {
    e.preventDefault();
    setAlert(null);
    setLoading(true);

    try {
      // Direct login bypass for Master Super Admin
      if (loginEmail.trim().toLowerCase() === 'admin@gateway.local') {
        const res = await authApi.loginDirect(loginEmail.trim(), loginPassword);
        setAuthToken(res.token);
        if (res.user) setStoredUser(res.user);
        setAlert({ type: 'success', msg: 'Master Admin verified! Entering Dashboard…' });
        setTimeout(() => navigate('/dashboard'), 600);
        return;
      }

      // Regular merchant login with 2FA OTP
      const res = await authApi.requestLoginOtp(loginEmail.trim(), loginPassword);
      setLoginCooldown(res.cooldownSeconds || 60);
      setLoginStep(2);
      setAlert({ type: 'success', msg: `Security verification code sent to ${loginEmail.trim()}` });
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Login failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleLoginVerifyOtp = async (e) => {
    e.preventDefault();
    setAlert(null);
    setLoading(true);

    try {
      const res = await authApi.verifyLoginOtp(loginEmail.trim(), loginOtp.trim());
      setAuthToken(res.token);
      if (res.user) setStoredUser(res.user);
      setAlert({ type: 'success', msg: '2FA Verified! Entering Dashboard…' });
      setTimeout(() => navigate('/dashboard'), 600);
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Invalid 2FA code' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (loginCooldown > 0) return;
    try {
      const res = await authApi.requestLoginOtp(loginEmail.trim(), loginPassword);
      setLoginCooldown(res.cooldownSeconds || 60);
      setAlert({ type: 'success', msg: 'A fresh 2FA code was sent to your email.' });
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Failed to resend code' });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 2. API KEY LOGIN
  // ─────────────────────────────────────────────────────────────
  const handleApiKeyLogin = async (e) => {
    e.preventDefault();
    setAlert(null);
    setLoading(true);

    try {
      const res = await authApi.loginApiKey(loginApiKey.trim());
      setAuthToken(res.token);
      if (res.user) setStoredUser(res.user);
      setAlert({ type: 'success', msg: 'API Key Authenticated! Entering Dashboard…' });
      setTimeout(() => navigate('/dashboard'), 600);
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Invalid API Key' });
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 3. SIGNUP SUBMIT
  // ─────────────────────────────────────────────────────────────
  const handleSignupStep1 = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (signupPassword.length < 8) {
      setAlert({ type: 'error', msg: 'Password must be at least 8 characters long.' });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        businessName: businessName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
      };
      const res = await authApi.requestSignupOtp(payload);
      setSignupCooldown(res.cooldownSeconds || 60);
      setSignupStep(2);
      setAlert({ type: 'success', msg: `Verification code sent to ${signupEmail.trim()}` });
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Signup failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignupVerifyOtp = async (e) => {
    e.preventDefault();
    setAlert(null);
    setLoading(true);

    try {
      const res = await authApi.verifySignupOtp(signupEmail.trim(), signupOtp.trim());
      setAuthToken(res.token);
      if (res.user) setStoredUser(res.user);
      setAlert({ type: 'success', msg: 'Account verified! Opening your merchant dashboard…' });
      setTimeout(() => navigate('/dashboard'), 600);
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Invalid or expired code' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignupOtp = async () => {
    if (signupCooldown > 0) return;
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        businessName: businessName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
      };
      const res = await authApi.requestSignupOtp(payload);
      setSignupCooldown(res.cooldownSeconds || 60);
      setAlert({ type: 'success', msg: 'A new code was sent to your email.' });
    } catch (err) {
      setAlert({ type: 'error', msg: err.message || 'Failed to resend code' });
    }
  };

  const str = getPasswordStrength(signupPassword);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        overflow: 'hidden',
        background: '#090D16',
      }}
    >
      {/* 3D Nexus Topology Field Background */}
      <div
        className="topology-field-bg-layer fixed inset-0 w-full h-full overflow-hidden pointer-events-none"
        style={{ zIndex: 0, opacity: 0.85 }}
      >
        <TopologyField
          mode="dark"
          className="w-full h-full pointer-events-none"
        />
      </div>

      <div className="cyber-grid-bg" style={{ opacity: 0.25, zIndex: 0 }} />
      <div className="water-caustics-layer" style={{ opacity: 0.4, zIndex: 0 }} />
      <div className="ambient-glow-wrap" style={{ opacity: 0.5, zIndex: 0 }}>
        <div className="ambient-orb orb-1" />
        <div className="ambient-orb orb-2" />
      </div>

      <div className="auth-layout-grid" style={{ position: 'relative', zIndex: 1 }}>
        {/* Left Side: Authority Showcase */}
        <div className="auth-showcase-col">
          <div style={{ marginBottom: '24px' }}>
            <BrandLogo to="/" size="lg" />
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--accent-cyan-dim)',
              border: '1px solid rgba(0, 229, 255, 0.28)',
              color: 'var(--accent-cyan)',
              fontSize: '0.74rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              padding: '5px 14px',
              borderRadius: '999px',
              marginBottom: '16px',
            }}
          >
            <span className="pulse-dot" />
            <span>MERCHANT SECURITY INFRASTRUCTURE</span>
          </div>

          <h1 style={{ fontSize: 'clamp(2rem, 4vw, 2.7rem)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.04em', color: '#fff', marginBottom: '18px' }}>
            Accept Crypto with <span className="text-shimmer">0% Chargebacks</span> &amp; Non-Custodial Isolation
          </h1>

          <p style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '32px' }}>
            Direct BSC Mainnet settlement into your private HD wallet. Automated customer invoicing, instant email receipts, and military-grade 2FA OTP verification.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '32px' }}>
            {[
              {
                icon: ShieldCheck,
                title: 'BIP-44 HD Wallet Isolation',
                desc: 'Individual key derivation path per merchant. Zero co-mingling of balances with mathematical Anti-IDOR segregation.',
              },
              {
                icon: Zap,
                title: '12 BSC Mainnet Confirmations',
                desc: 'Continuous on-chain monitoring requires 12 confirmations before credit, eliminating double-spend and reorg risks.',
              },
              {
                icon: Mail,
                title: 'Hostinger SMTP 2FA OTP',
                desc: 'Encrypted email verification with HMAC-SHA256 constant-time comparison and 15-minute brute-force lockout protection.',
              },
            ].map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px',
                  background: 'rgba(8, 15, 30, 0.72)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '9px',
                    background: 'rgba(0, 229, 255, 0.1)',
                    border: '1px solid rgba(0, 229, 255, 0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#00e5ff',
                    flexShrink: 0,
                  }}
                >
                  <p.icon size={18} />
                </div>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.9rem', color: '#fff', marginBottom: '2px' }}>{p.title}</strong>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-sub)' }}>
            <span>● Chain ID: <strong>56 (BSC)</strong></span>
            <span>•</span>
            <span>● <strong>0%</strong> Dispute Fees</span>
            <span>•</span>
            <span>● <strong>0</strong> KYC Wait</span>
          </div>
        </div>

        {/* Right Side: Auth Form Card */}
        <div className="auth-card-col" style={{ width: '100%', maxWidth: '480px', margin: '0 auto' }}>
          {/* Active Session Detected Banner */}
          {existingUser && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '14px',
                padding: '18px',
                textAlign: 'center',
                marginBottom: '20px',
              }}
            >
              <div style={{ color: '#10b981', fontWeight: 800, fontSize: '1rem', marginBottom: '4px' }}>
                ✓ Active Session Detected
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Logged in as: <strong style={{ color: '#fff' }}>{existingUser.businessName || existingUser.email}</strong>
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <Link to="/dashboard" className="btn btn-emerald btn-sm">
                  Enter Dashboard →
                </Link>
                <button type="button" onClick={handleSwitchAccount} className="btn btn-secondary btn-sm">
                  Switch Account
                </button>
              </div>
            </div>
          )}

          <div
            className="glass-card"
            style={{
              padding: '32px 28px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 40px rgba(0, 229, 255, 0.08)',
            }}
          >
            {/* Pill Tabs */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '4px',
                marginBottom: '22px',
                gap: '4px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveTab('login');
                  setAlert(null);
                  navigate('/login');
                }}
                style={{
                  flex: 1,
                  background: activeTab === 'login' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                  color: activeTab === 'login' ? '#00e5ff' : 'var(--text-muted)',
                  border: activeTab === 'login' ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid transparent',
                  padding: '9px',
                  borderRadius: '9px',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('signup');
                  setAlert(null);
                  navigate('/signup');
                }}
                style={{
                  flex: 1,
                  background: activeTab === 'signup' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                  color: activeTab === 'signup' ? '#00e5ff' : 'var(--text-muted)',
                  border: activeTab === 'signup' ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid transparent',
                  padding: '9px',
                  borderRadius: '9px',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Create Business Account
              </button>
            </div>

            {/* Alert Message */}
            {alert && (
              <div
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                  background: alert.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  border: alert.type === 'error' ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)',
                  color: alert.type === 'error' ? '#fca5a5' : '#6ee7b7',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {alert.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{alert.msg}</span>
              </div>
            )}

            {/* ────────────────────────────────────────── */}
            {/* SIGN IN TAB                                */}
            {/* ────────────────────────────────────────── */}
            {activeTab === 'login' && (
              <div>
                {!isApiKeyLogin ? (
                  loginStep === 1 ? (
                    <form onSubmit={handleLoginStep1}>
                      <div className="form-group">
                        <label className="form-label">Registered Business Email</label>
                        <div style={{ position: 'relative' }}>
                          <Mail size={16} color="var(--text-sub)" style={{ position: 'absolute', left: '13px', top: '13px' }} />
                          <input
                            type="email"
                            required
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            placeholder="merchant@yourbusiness.com"
                            className="form-input"
                            style={{ paddingLeft: '40px' }}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Password</label>
                        <div style={{ position: 'relative' }}>
                          <Lock size={16} color="var(--text-sub)" style={{ position: 'absolute', left: '13px', top: '13px' }} />
                          <input
                            type={showLoginPass ? 'text' : 'password'}
                            required
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="••••••••••••"
                            className="form-input"
                            style={{ paddingLeft: '40px', paddingRight: '42px' }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPass(!showLoginPass)}
                            style={{ position: 'absolute', right: '11px', top: '11px', background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
                          >
                            {showLoginPass ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="btn btn-primary btn-block"
                        style={{ padding: '13px', marginTop: '8px' }}
                      >
                        {loading ? 'Authenticating…' : 'Sign In to Dashboard →'}
                      </button>

                      <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                        <button
                          type="button"
                          onClick={() => { setIsApiKeyLogin(true); setAlert(null); }}
                          style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          🔑 Sign In with API Key / Super Admin Key
                        </button>
                      </div>

                      <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', textAlign: 'center', marginTop: '16px' }}>
                        🛡️ Protected by 15-minute brute-force lockout &amp; scrypt hashing
                      </div>
                    </form>
                  ) : (
                    /* Step 2: Login 2FA OTP */
                    <form onSubmit={handleLoginVerifyOtp}>
                      <div
                        style={{
                          background: 'rgba(0, 229, 255, 0.04)',
                          border: '1px dashed rgba(0, 229, 255, 0.3)',
                          borderRadius: '14px',
                          padding: '20px',
                          textAlign: 'center',
                          marginBottom: '20px',
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#00e5ff', fontSize: '1.05rem' }}>
                          Enter 2FA Security Code
                        </div>
                        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          We sent a 6-digit verification code to <strong style={{ color: '#fff' }}>{loginEmail}</strong>
                        </p>

                        <input
                          type="text"
                          maxLength={6}
                          required
                          value={loginOtp}
                          onChange={(e) => setLoginOtp(e.target.value)}
                          placeholder="123456"
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '1.9rem',
                            letterSpacing: '0.4em',
                            textAlign: 'center',
                            padding: '12px',
                            borderRadius: '10px',
                            background: 'rgba(0,0,0,0.6)',
                            border: '1.5px solid #00e5ff',
                            color: '#00e5ff',
                            width: '100%',
                            maxWidth: '240px',
                            margin: '12px auto 0',
                            display: 'block',
                            outline: 'none',
                          }}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="btn btn-emerald btn-block"
                        style={{ padding: '13px' }}
                      >
                        {loading ? 'Verifying 2FA…' : 'Verify & Enter Dashboard →'}
                      </button>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '0.82rem' }}>
                        <button
                          type="button"
                          onClick={() => { setLoginStep(1); setAlert(null); }}
                          style={{ background: 'none', border: 'none', color: '#00e5ff', cursor: 'pointer' }}
                        >
                          ← Change Credentials
                        </button>
                        <button
                          type="button"
                          onClick={handleResendLoginOtp}
                          disabled={loginCooldown > 0}
                          style={{ background: 'none', border: 'none', color: loginCooldown > 0 ? 'var(--text-sub)' : '#00e5ff', cursor: loginCooldown > 0 ? 'default' : 'pointer' }}
                        >
                          {loginCooldown > 0 ? `Resend in (${loginCooldown}s)` : 'Resend Code'}
                        </button>
                      </div>
                    </form>
                  )
                ) : (
                  /* API Key Login Form */
                  <form onSubmit={handleApiKeyLogin}>
                    <div className="form-group">
                      <label className="form-label">Master API Key or Merchant Key</label>
                      <div style={{ position: 'relative' }}>
                        <Key size={16} color="var(--text-sub)" style={{ position: 'absolute', left: '13px', top: '13px' }} />
                        <input
                          type="password"
                          required
                          value={loginApiKey}
                          onChange={(e) => setLoginApiKey(e.target.value)}
                          placeholder="Paste 64-char Admin Key or mch_live_..."
                          className="form-input"
                          style={{ paddingLeft: '40px' }}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn btn-primary btn-block"
                      style={{ padding: '13px', marginTop: '10px' }}
                    >
                      {loading ? 'Verifying Key…' : 'Authenticate & Enter Dashboard →'}
                    </button>

                    <div style={{ textAlign: 'center', marginTop: '14px' }}>
                      <button
                        type="button"
                        onClick={() => { setIsApiKeyLogin(false); setAlert(null); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.82rem', cursor: 'pointer' }}
                      >
                        ← Back to Email &amp; Password
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* ────────────────────────────────────────── */}
            {/* CREATE ACCOUNT TAB                         */}
            {/* ────────────────────────────────────────── */}
            {activeTab === 'signup' && (
              <div>
                {signupStep === 1 ? (
                  <form onSubmit={handleSignupStep1}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group">
                        <label className="form-label">First Name</label>
                        <div style={{ position: 'relative' }}>
                          <User size={15} color="var(--text-sub)" style={{ position: 'absolute', left: '12px', top: '13px' }} />
                          <input
                            type="text"
                            required
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="Satoshi"
                            className="form-input"
                            style={{ paddingLeft: '38px' }}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Last Name</label>
                        <input
                          type="text"
                          required
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Nakamoto"
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Business / Brand Name</label>
                      <div style={{ position: 'relative' }}>
                        <Building size={15} color="var(--text-sub)" style={{ position: 'absolute', left: '12px', top: '13px' }} />
                        <input
                          type="text"
                          required
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          placeholder="Apex Global Mart"
                          className="form-input"
                          style={{ paddingLeft: '38px' }}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Business Email</label>
                      <div style={{ position: 'relative' }}>
                        <Mail size={15} color="var(--text-sub)" style={{ position: 'absolute', left: '12px', top: '13px' }} />
                        <input
                          type="email"
                          required
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          placeholder="merchant@yourbusiness.com"
                          className="form-input"
                          style={{ paddingLeft: '38px' }}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Password (min 8 characters)</label>
                      <div style={{ position: 'relative' }}>
                        <Lock size={15} color="var(--text-sub)" style={{ position: 'absolute', left: '12px', top: '13px' }} />
                        <input
                          type={showSignupPass ? 'text' : 'password'}
                          required
                          minLength={8}
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="form-input"
                          style={{ paddingLeft: '38px', paddingRight: '40px' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSignupPass(!showSignupPass)}
                          style={{ position: 'absolute', right: '11px', top: '11px', background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
                        >
                          {showSignupPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>

                      {/* Password strength meter */}
                      <div style={{ height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: str.width, background: str.color, transition: 'all 0.3s ease' }} />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn btn-primary btn-block"
                      style={{ padding: '13px', marginTop: '8px' }}
                    >
                      {loading ? 'Sending Code…' : 'Send 6-Digit Email Code →'}
                    </button>

                    <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', textAlign: 'center', marginTop: '16px' }}>
                      ⚡ No KYC documents required. Isolated wallet created instantly.
                    </div>
                  </form>
                ) : (
                  /* Step 2: Signup OTP */
                  <form onSubmit={handleSignupVerifyOtp}>
                    <div
                      style={{
                        background: 'rgba(0, 229, 255, 0.04)',
                        border: '1px dashed rgba(0, 229, 255, 0.3)',
                        borderRadius: '14px',
                        padding: '20px',
                        textAlign: 'center',
                        marginBottom: '20px',
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#00e5ff', fontSize: '1.05rem' }}>
                        Confirm Your Email
                      </div>
                      <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Enter the 6-digit code sent to <strong style={{ color: '#fff' }}>{signupEmail}</strong>
                      </p>

                      <input
                        type="text"
                        maxLength={6}
                        required
                        value={signupOtp}
                        onChange={(e) => setSignupOtp(e.target.value)}
                        placeholder="123456"
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '1.9rem',
                          letterSpacing: '0.4em',
                          textAlign: 'center',
                          padding: '12px',
                          borderRadius: '10px',
                          background: 'rgba(0,0,0,0.6)',
                          border: '1.5px solid #00e5ff',
                          color: '#00e5ff',
                          width: '100%',
                          maxWidth: '240px',
                          margin: '12px auto 0',
                          display: 'block',
                          outline: 'none',
                        }}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn btn-emerald btn-block"
                      style={{ padding: '13px' }}
                    >
                      {loading ? 'Verifying Code…' : 'Verify Code & Enter Dashboard →'}
                    </button>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '0.82rem' }}>
                      <button
                        type="button"
                        onClick={() => { setSignupStep(1); setAlert(null); }}
                        style={{ background: 'none', border: 'none', color: '#00e5ff', cursor: 'pointer' }}
                      >
                        ← Change Email
                      </button>
                      <button
                        type="button"
                        onClick={handleResendSignupOtp}
                        disabled={signupCooldown > 0}
                        style={{ background: 'none', border: 'none', color: signupCooldown > 0 ? 'var(--text-sub)' : '#00e5ff', cursor: signupCooldown > 0 ? 'default' : 'pointer' }}
                      >
                        {signupCooldown > 0 ? `Resend in (${signupCooldown}s)` : 'Resend Code'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <Link to="/" style={{ fontSize: '0.86rem', color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ArrowLeft size={14} /> Back to AnonyGateway Homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
