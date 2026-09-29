import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Lock,
  Mail,
  CheckCircle2,
  FileText,
  Globe,
  Zap,
  Coins,
  RefreshCw,
  Code2,
} from 'lucide-react';
import '../landing.css';
import { authApi, getAuthToken } from '../api/client';
import TopologyField from '@/components/ui/topology-field';
import BrandLogo from '../components/BrandLogo';

export default function Landing() {
  const [currentUser, setCurrentUser] = useState(null);
  const [demoCurrency, setDemoCurrency] = useState('USDT');
  const [simActive, setSimActive] = useState(false);
  const [simStep, setSimStep] = useState(0); // 0..12
  const [simComplete, setSimComplete] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [calcVolume, setCalcVolume] = useState(25000);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSection, setActiveSection] = useState('hero');
  const laptopRef = useRef(null);

  // Scroll Progress and Scrollspy
  // Optimized RAF-Throttled Scroll Progress and Scrollspy (zero layout thrashing)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const total = document.documentElement.scrollHeight - window.innerHeight;
          setScrollProgress(total > 0 ? (scrollY / total) * 100 : 0);

          const sections = ['how-it-works', 'calculator', 'security', 'benefits', 'hero'];
          for (const id of sections) {
            const el = document.getElementById(id);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.top <= 200) {
                setActiveSection(id);
                break;
              }
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll Reveal Intersection Observer - One-by-One Staggered Cascade
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );
    document.querySelectorAll('.reveal-on-scroll').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // High-Performance 3D Card Tilt Handler (Ref-based, zero React re-renders)
  const handleSandboxMouseMove = (e) => {
    if (window.innerWidth <= 860 || !laptopRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotX = -((y - centerY) / centerY) * 8;
    const rotY = ((x - centerX) / centerX) * 8;
    laptopRef.current.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateZ(4px)`;
  };

  const handleSandboxMouseLeave = () => {
    if (laptopRef.current) {
      laptopRef.current.style.transform = '';
    }
  };

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      authApi.getMe()
        .then((res) => {
          if (res?.user) setCurrentUser(res.user);
        })
        .catch(() => {});
    }
  }, []);

  const handleCopyDemoAddress = async () => {
    const addr = demoCurrency === 'BTC'
      ? 'bc1q9f8cAC706756Af7B5996fd8E14428DeB4b7dd59'
      : '0x9f8c8AC706756Af7B5996fd8E14428DeB4b7dd59';
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const runPaymentSimulation = () => {
    setSimActive(true);
    setSimComplete(false);
    setSimStep(1);
    let step = 1;
    const interval = setInterval(() => {
      step += 2;
      if (step >= 12) {
        setSimStep(12);
        clearInterval(interval);
        setTimeout(() => {
          setSimActive(false);
          setSimComplete(true);
        }, 500);
      } else {
        setSimStep(step);
      }
    }, 400);
  };

  const resetPaymentSimulation = () => {
    setSimActive(false);
    setSimComplete(false);
    setSimStep(0);
  };

  const traditionalFee = calcVolume * 0.035;
  const anonyFee = calcVolume * 0.01;
  const netSavings = traditionalFee - anonyFee;

  return (
    <div className="relative min-h-screen">
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

      {/* Cyber Grid Background */}
      <div className="cyber-grid-bg" />

      {/* Laser Scroll Progress Bar */}
      <div className="scroll-progress-bar" style={{ width: `${scrollProgress}%` }} />

      {/* Sticky Navigation with Scrollspy */}
      <header className="navbar">
        <div className="container nav-wrap">
          <BrandLogo to="/" size="md" />

          <nav className="nav-links">
            <a href="#benefits" className={`nav-link ${activeSection === 'benefits' ? 'active-section' : ''}`}>Benefits</a>
            <a href="#security" className={`nav-link ${activeSection === 'security' ? 'active-section' : ''}`}>Safety &amp; Protection</a>
            <a href="#calculator" className={`nav-link ${activeSection === 'calculator' ? 'active-section' : ''}`}>Savings Calculator</a>
            <a href="#how-it-works" className={`nav-link ${activeSection === 'how-it-works' ? 'active-section' : ''}`}>How It Works</a>
          </nav>

          <div className="nav-actions">
            {currentUser ? (
              <Link to="/dashboard" className="btn btn-emerald btn-sm">
                Dashboard ({currentUser.businessName || 'Merchant'}) →
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm" id="nav-btn-auth">Sign In</Link>
                <Link to="/signup" className="btn btn-primary btn-sm">Create Account</Link>
              </>
            )}

            {/* Mobile Nav Hamburger Button */}
            <button
              type="button"
              className="nav-toggle-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle Mobile Navigation"
            >
              <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{mobileMenuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Slide-down Glass Drawer */}
        {mobileMenuOpen && (
          <div className="mobile-nav-drawer">
            <a href="#benefits" className="mobile-nav-link" onClick={() => setMobileMenuOpen(false)}>
              Benefits
            </a>
            <a href="#security" className="mobile-nav-link" onClick={() => setMobileMenuOpen(false)}>
              Safety &amp; Protection
            </a>
            <a href="#calculator" className="mobile-nav-link" onClick={() => setMobileMenuOpen(false)}>
              Savings Calculator
            </a>
            <a href="#how-it-works" className="mobile-nav-link" onClick={() => setMobileMenuOpen(false)}>
              How It Works
            </a>
            <div className="mobile-nav-actions">
              {currentUser ? (
                <Link to="/dashboard" className="btn btn-emerald btn-block" onClick={() => setMobileMenuOpen(false)}>
                  Enter Merchant Dashboard →
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn-primary btn-block" onClick={() => setMobileMenuOpen(false)}>
                    Create Account Free →
                  </Link>
                  <Link to="/login" className="btn btn-ghost btn-block" onClick={() => setMobileMenuOpen(false)}>
                    Merchant Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main>
        {/* Hero Section */}
        <section className="hero" id="hero">
          <div className="container">
            {/* Logged In Quick Banner */}
            {currentUser && (
              <div id="logged-in-banner" style={{ display: 'flex' }}>
                <div>
                  <strong>👋 Welcome back, <span>{currentUser.businessName || currentUser.email}</span>!</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>Your session is authenticated and active.</span>
                </div>
                <Link to="/dashboard" className="btn btn-emerald btn-sm">Enter Merchant Dashboard →</Link>
              </div>
            )}

            <div className="hero-grid">
              {/* Hero Left: Pitch & Value Proposition */}
              <div className="hero-content">
                <div className="pill-badge liquid-pill reveal-on-scroll stagger-1">
                  <span className="pulse-dot" />
                  <span>💧 MILITARY-GRADE SECURITY • EVM, TRON &amp; BTC • FLAT 1.0% PROCESSING FEE</span>
                </div>

                <h1 className="hero-title reveal-on-scroll stagger-2">
                  The High-Security <span className="text-shimmer">Crypto Gateway</span> Built for Real Business
                </h1>

                <p className="hero-subtitle reveal-on-scroll stagger-3">
                  Accept crypto payments directly to your isolated non-custodial wallet with zero chargebacks, automated customer invoicing, instant email receipts, and military-grade OTP security. No paperwork required to start.
                </p>

                {/* Metrics */}
                <div className="hero-metrics">
                  <div className="metric-item reveal-on-scroll">
                    <div className="metric-num">0%</div>
                    <div className="metric-lbl">Chargeback Fraud</div>
                  </div>
                  <div className="metric-item reveal-on-scroll">
                    <div className="metric-num">1.0%</div>
                    <div className="metric-lbl">Flat Processing Fee</div>
                  </div>
                  <div className="metric-item reveal-on-scroll">
                    <div className="metric-num">100%</div>
                    <div className="metric-lbl">Isolated Wallets</div>
                  </div>
                  <div className="metric-item reveal-on-scroll">
                    <div className="metric-num">60s</div>
                    <div className="metric-lbl">Instant Setup</div>
                  </div>
                </div>

                {/* CTA Row */}
                <div className="reveal-on-scroll stagger-4">
                  <div className="hero-cta-group">
                    <Link to="/signup" className="btn btn-primary" id="hero-cta-btn" style={{ padding: '14px 28px', fontSize: '1rem' }}>
                      Start Accepting Crypto Free →
                    </Link>
                    <Link to="/login" className="btn btn-ghost" style={{ padding: '14px 24px', fontSize: '1rem' }}>
                      Merchant Sign In
                    </Link>
                  </div>

                  <div className="hero-live-status">
                    <span style={{ color: '#10b981' }}>●</span> Instant Settlement • <strong>Flat 1.0% Fee</strong> • <strong>Zero Rolling Reserves</strong> • <strong>0 KYC Wait</strong>
                  </div>
                </div>
              </div>

              {/* Hero Right: Modern Laptop & Smartphone Crypto Showcase */}
              <div
                className="device-showcase-wrap reveal-on-scroll stagger-3"
                style={{
                  transform: `translateY(${Math.min(scrollProgress * 0.45, 28)}px)`,
                  transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* 3D Holographic Orbit Wireframe Rings */}
                <div className="orbit-ring-3d orbit-ring-1" />
                <div className="orbit-ring-3d orbit-ring-2" />

                {/* Floating 3D Crypto Chips */}
                <div className="floating-crypto-chip chip-btc">
                  <span className="chip-icon btc">₿</span>
                  <div>
                    <div className="chip-sym">BTC / USD</div>
                    <div className="chip-price">$64,820 <span className="chip-up">+3.4%</span></div>
                  </div>
                </div>

                <div className="floating-crypto-chip chip-usdt">
                  <span className="chip-icon usdt">₮</span>
                  <div>
                    <div className="chip-sym">USDT / USD</div>
                    <div className="chip-price">$1.000 <span className="chip-stable">Stable</span></div>
                  </div>
                </div>

                <div className="floating-crypto-chip chip-bnb">
                  <span className="chip-icon bnb">⚡</span>
                  <div>
                    <div className="chip-sym">BNB / USD</div>
                    <div className="chip-price">$592.40 <span className="chip-up">+2.1%</span></div>
                  </div>
                </div>

                {/* 1. LAPTOP MOCKUP */}
                <div
                  ref={laptopRef}
                  className="laptop-mockup"
                  onMouseMove={handleSandboxMouseMove}
                  onMouseLeave={handleSandboxMouseLeave}
                  style={{ transition: 'transform 0.12s ease-out' }}
                >
                  <div className="laptop-lid">
                    <div className="laptop-camera" />

                    {/* Laptop Screen Content */}
                    <div className="laptop-screen">
                      {/* Browser Header Bar */}
                      <div className="laptop-browser-bar">
                        <div className="laptop-browser-dots">
                          <span className="browser-dot dot-red" />
                          <span className="browser-dot dot-yellow" />
                          <span className="browser-dot dot-green" />
                        </div>

                        <div className="laptop-url-bar">
                          <Lock size={12} color="#10B981" />
                          <span>anonygateway.io/checkout/live</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: '#10B981', fontWeight: 700 }}>
                          <span className="pulse-dot" />
                          <span>Live Node</span>
                        </div>
                      </div>

                      {/* Crypto Selection Pill Bar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fff' }}>
                          Select Payment Asset:
                        </div>

                        {/* Currency Switcher: BTC, USDT, BNB */}
                        <div className="currency-selector">
                          <button
                            type="button"
                            className={`currency-btn ${demoCurrency === 'BTC' ? 'active' : ''}`}
                            onClick={() => setDemoCurrency('BTC')}
                          >
                            ₿ Bitcoin
                          </button>
                          <button
                            type="button"
                            className={`currency-btn ${demoCurrency === 'USDT' ? 'active' : ''}`}
                            onClick={() => setDemoCurrency('USDT')}
                          >
                            ₮ USDT
                          </button>
                          <button
                            type="button"
                            className={`currency-btn ${demoCurrency === 'BNB' ? 'active' : ''}`}
                            onClick={() => setDemoCurrency('BNB')}
                          >
                            ⚡ BNB
                          </button>
                        </div>
                      </div>

                      {/* Animated Laser Scanner Box with Mock QR */}
                      <div className="qr-scanner-box">
                        <div className="laser-scan-line" />
                        <div className="qr-mock-matrix">
                          <div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot" />
                          <div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot off" /><div className="qr-dot" />
                          <div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" />
                          <div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" />
                          <div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" />
                          <div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot" />
                          <div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot" /><div className="qr-dot" /><div className="qr-dot off" /><div className="qr-dot off" /><div className="qr-dot" />
                        </div>
                      </div>

                      {/* Dynamic Crypto Amount Display */}
                      <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
                          {demoCurrency === 'BTC' ? (
                            <>0.0015 BTC <span style={{ fontSize: '0.90rem', color: 'var(--text-muted)', fontWeight: 500 }}>($97.20 USD)</span></>
                          ) : demoCurrency === 'USDT' ? (
                            <>50.00 USDT <span style={{ fontSize: '0.90rem', color: 'var(--text-muted)', fontWeight: 500 }}>($50.00 USD)</span></>
                          ) : (
                            <>0.05 BNB <span style={{ fontSize: '0.90rem', color: 'var(--text-muted)', fontWeight: 500 }}>($32.40 USD)</span></>
                          )}
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '5px 14px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '8px' }}>
                          <span className="pulse-dot" />
                          <span>Dynamic Single-Use Address • Isolated Ledger</span>
                        </div>
                      </div>

                      {/* Live Network & Settlement Status Footer Card */}
                      <div className="laptop-status-card">
                        <div className="laptop-status-row">
                          <span className="status-label">Network Protocol</span>
                          <span className="status-value highlight-cyan">
                            {demoCurrency === 'BTC' ? 'Bitcoin Mainnet (SegWit)' : demoCurrency === 'USDT' ? 'BEP-20 / ERC-20 Multi-Chain' : 'BNB Smart Chain (ID: 56)'}
                          </span>
                        </div>
                        <div className="laptop-status-row">
                          <span className="status-label">Settlement Speed</span>
                          <span className="status-value highlight-green">⚡ ~2.8s Instant Block Finality</span>
                        </div>
                        <div className="laptop-status-row">
                          <span className="status-label">Custody Model</span>
                          <span className="status-value highlight-amber">🔒 Non-Custodial HD Isolation</span>
                        </div>
                        <div className="laptop-status-row">
                          <span className="status-label">Chargeback Risk</span>
                          <span className="status-value highlight-green">0% Permanent On-Chain</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Laptop Base (Chassis & Trackpad Notch) */}
                  <div className="laptop-base">
                    <div className="laptop-notch" />
                  </div>
                </div>

                {/* 2. OVERLAPPING SMARTPHONE MOCKUP */}
                <div className="phone-mockup">
                  <div className="phone-screen">
                    <div className="phone-island" />
                    <div className="phone-status-bar">
                      <span>9:41</span>
                      <span>5G 100%</span>
                    </div>

                    <div className="phone-card">
                      <div className="phone-badge-coin" style={{ background: demoCurrency === 'BTC' ? 'linear-gradient(135deg, #F59E0B, #D97706)' : demoCurrency === 'USDT' ? 'linear-gradient(135deg, #10B981, #047857)' : 'linear-gradient(135deg, #06B6D4, #0284C7)' }}>
                        {demoCurrency === 'BTC' ? '₿' : demoCurrency === 'USDT' ? '₮' : '⚡'}
                      </div>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#fff' }}>
                        {demoCurrency} Payment Sent
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#10B981', margin: '4px 0' }}>
                        {demoCurrency === 'BTC' ? '+0.0015 BTC' : demoCurrency === 'USDT' ? '+50.00 USDT' : '+0.05 BNB'}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: '#94A3B8' }}>
                        Trust Wallet • Confirmed
                      </div>

                      <div className="phone-tx-row">
                        <span>Speed</span>
                        <strong style={{ color: '#38BDF8' }}>2.8s Instant</strong>
                      </div>
                      <div className="phone-tx-row">
                        <span>Fee</span>
                        <strong style={{ color: '#10B981' }}>$0.02 Gas</strong>
                      </div>
                      <div className="phone-tx-row">
                        <span>Receipt</span>
                        <strong style={{ color: '#34D399' }}>Emailed ✓</strong>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.60rem', color: '#64748B', textAlign: 'center', marginTop: '2px' }}>
                      🔒 Zero Chargeback Verified
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Animated Fluid Liquid Wave Divider */}
        <div className="liquid-wave-divider">
          <svg viewBox="0 0 1440 90" fill="none" preserveAspectRatio="none">
            <path
              className="wave-layer-3"
              d="M0,32 C320,65 420,-10 680,32 C940,75 1120,5 1440,32 L1440,90 L0,90 Z"
            />
            <path
              className="wave-layer-2"
              d="M0,45 C280,10 520,70 820,40 C1120,10 1280,60 1440,45 L1440,90 L0,90 Z"
            />
            <path
              className="wave-layer-1"
              d="M0,58 C220,80 480,25 740,55 C1000,85 1240,35 1440,58 L1440,90 L0,90 Z"
            />
          </svg>
        </div>

        {/* Live Real-Time Blockchain Activity Ticker */}
        <section className="stream-ticker-wrap reveal-on-scroll stagger-2">
          <div className="stream-ticker-track">
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #9a4f…b2: <strong>0.25 BNB</strong> received from Trust Wallet • 12/12 Confirmations • 3s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #12b7…e9: <strong>150.00 USDT</strong> settled to isolated ledger • Receipt dispatched • 11s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #89c1…7a: <strong>0.08 BNB</strong> confirmed on BSC Mainnet • 0% Chargebacks • 24s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #44e2…c4: <strong>450.00 USDT</strong> customer checkout completed • Verified in 2.8s • 36s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #77d3…f1: <strong>1.20 BNB</strong> internal transfer • 0 Gas Fees • 49s ago</div>
            {/* Loop Repeat for Infinite Marquee */}
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #9a4f…b2: <strong>0.25 BNB</strong> received from Trust Wallet • 12/12 Confirmations • 3s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #12b7…e9: <strong>150.00 USDT</strong> settled to isolated ledger • Receipt dispatched • 11s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #89c1…7a: <strong>0.08 BNB</strong> confirmed on BSC Mainnet • 0% Chargebacks • 24s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #44e2…c4: <strong>450.00 USDT</strong> customer checkout completed • Verified in 2.8s • 36s ago</div>
            <div className="ticker-item"><span className="ticker-dot" /> ⚡ TX #77d3…f1: <strong>1.20 BNB</strong> internal transfer • 0 Gas Fees • 49s ago</div>
          </div>
        </section>

        {/* Section: Safety & Manipulation Protection */}
        <section className="section section-alt" id="security">
          <div className="container">
            <div className="section-header reveal-on-scroll">
              <div className="section-tag">Security Architecture</div>
              <h2 className="section-title">Built So No One Can Hack or Manipulate Your Funds</h2>
              <p className="section-desc">
                Every transaction, balance update, and authentication step is mathematically verified, isolated, and permanently recorded.
              </p>
            </div>

            <div className="cards-grid">
              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon"><ShieldCheck size={26} color="#06B6D4" /></div>
                <h3 className="feature-title">BIP-44 HD Wallet Isolation</h3>
                <p className="feature-text">
                  Every merchant account is assigned a mathematically isolated hierarchical deterministic derivation path. Funds are never pooled, mixed, or co-mingled. Anti-IDOR enforcement guarantees no merchant can ever access another account's balance or invoices.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon emerald"><Mail size={26} color="#10B981" /></div>
                <h3 className="feature-title">Hostinger SMTP 2FA OTP</h3>
                <p className="feature-text">
                  Every registration and sign-in requires cryptographically random 6-digit codes dispatched via SSL-encrypted SMTP. OTPs are hashed using HMAC-SHA256 and verified using constant-time buffers to prevent timing-attack snooping.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon amber"><Lock size={26} color="#F59E0B" /></div>
                <h3 className="feature-title">Anti-Brute-Force &amp; Lockout</h3>
                <p className="feature-text">
                  Passwords are protected using the memory-hard <code>scrypt</code> key derivation function (N=16384). Five failed password attempts trigger an immediate, automated 15-minute account lockout, combined with per-IP rate limiters to defeat credential stuffing.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon"><CheckCircle2 size={26} color="#06B6D4" /></div>
                <h3 className="feature-title">12 BSC Mainnet Confirmations</h3>
                <p className="feature-text">
                  Continuous on-chain monitoring on Binance Smart Chain strictly requires 12 confirmations before marking any payment as confirmed and crediting your balance. This eliminates the risk of double-spend attacks and chain reorganizations.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon emerald"><FileText size={26} color="#10B981" /></div>
                <h3 className="feature-title">Tamper-Proof Audit Logging</h3>
                <p className="feature-text">
                  All security events — logins, failed passwords, account lockouts, invoice dispatches, status changes, and treasury payouts — are written directly to an indexed, append-only <code>audit_logs</code> database table with requester IP and timestamps.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon amber"><Globe size={26} color="#F59E0B" /></div>
                <h3 className="feature-title">Replay &amp; SSRF Webhook Shield</h3>
                <p className="feature-text">
                  All outgoing webhooks are signed with your individual merchant secret using timestamped HMAC-SHA256 headers. Furthermore, strict SSRF filters prevent webhooks from ever pinging private or internal network addresses.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section: Benefits for Businesses */}
        <section className="section" id="benefits">
          <div className="container">
            <div className="section-header reveal-on-scroll">
              <div className="section-tag">Merchant Advantages</div>
              <h2 className="section-title">Why Modern Businesses Choose AnonyGateway</h2>
              <p className="section-desc">
                Traditional payment gateways take 3-5% in fees, freeze accounts arbitrarily, and leave you vulnerable to chargebacks. AnonyGateway gives you total financial control.
              </p>
            </div>

            <div className="cards-grid">
              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon emerald"><ShieldCheck size={26} color="#10B981" /></div>
                <h3 className="feature-title">0% Chargeback Risk</h3>
                <p className="feature-text">
                  Blockchain transactions are permanent and mathematically irreversible. Say goodbye to fraudulent customer chargebacks, bank disputes, and expensive merchant arbitration penalties.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon"><Zap size={26} color="#06B6D4" /></div>
                <h3 className="feature-title">Zero KYC Bureaucracy</h3>
                <p className="feature-text">
                  Start accepting crypto immediately. No identity scans, no utility bill uploads, and no waiting weeks for underwriting approval. Simply register your business with an email and start collecting.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon amber"><Mail size={26} color="#F59E0B" /></div>
                <h3 className="feature-title">Automated Email Receipts</h3>
                <p className="feature-text">
                  Customers receive an official, beautifully formatted HTML payment receipt the exact millisecond their transaction is confirmed on-chain. You receive an instant payment confirmation alert.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon"><Coins size={26} color="#06B6D4" /></div>
                <h3 className="feature-title">Multi-Currency &amp; 1.0% Flat Fee</h3>
                <p className="feature-text">
                  Accept USDT (TRC-20 TRON), Bitcoin (BTC), BNB, and ETH with single-use HD addresses. Every transaction incurs an ultra-low, transparent 1.0% flat platform fee — 99% settles directly into your non-custodial merchant wallet.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon emerald"><RefreshCw size={26} color="#10B981" /></div>
                <h3 className="feature-title">0-Gas Internal Transfers</h3>
                <p className="feature-text">
                  Need to settle funds between multiple branches, partners, or internal merchant wallets? AnonyGateway provides instant internal ledger settlements with zero gas fees and zero block delay.
                </p>
              </div>

              <div className="feature-card glance-glass reveal-on-scroll">
                <div className="feature-icon amber"><Code2 size={26} color="#F59E0B" /></div>
                <h3 className="feature-title">Developer-Ready REST API</h3>
                <p className="feature-text">
                  Integrate into any custom e-commerce checkout, mobile app, or backend in under 10 minutes using your secret merchant API key (<code>mch_live_...</code>) and standardized JSON endpoints.
                </p>
              </div>
            </div>

            {/* Interactive Savings Calculator Widget */}
            <div className="calculator-glass-card glance-glass reveal-on-scroll" id="calculator">
              <div className="calc-grid">
                <div>
                  <span className="pill-badge" style={{ fontSize: '0.75rem', marginBottom: '12px' }}>Interactive Savings Calculator</span>
                  <h3 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '10px' }}>
                    See How Much Your Business Saves
                  </h3>
                  <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '20px' }}>
                    Credit card processors silently take 2.9% to 4% + $0.30 on every single charge, plus hit you with $15–$50 dispute fees on fraudulent chargebacks. With crypto on AnonyGateway, every transaction is mathematically irreversible.
                  </p>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 700, marginBottom: '8px' }}>
                      <span>Monthly Sales Volume:</span>
                      <span id="calc-volume-display" style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem' }}>
                        ${calcVolume.toLocaleString()} / mo
                      </span>
                    </div>
                    <input
                      type="range"
                      id="calc-range"
                      className="calc-slider"
                      min="1000"
                      max="100000"
                      step="1000"
                      value={calcVolume}
                      onChange={(e) => setCalcVolume(Number(e.target.value))}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: '4px' }}>
                      <span>$1,000</span>
                      <span>$50,000</span>
                      <span>$100,000+</span>
                    </div>
                  </div>
                </div>

                {/* Comparison Output Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="reveal-on-scroll stagger-2" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, color: '#fca5a5', fontSize: '0.9rem' }}>Traditional Processors (Stripe/PayPal ~3.5%)</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f87171' }}>
                        -${traditionalFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      ⚠️ Subject to 90-day customer chargeback fraud, 5-10% rolling reserve holds, and unexpected account freezes.
                    </div>
                  </div>

                  <div className="reveal-on-scroll stagger-3" style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: 'var(--radius-md)', padding: '18px', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.15)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, color: '#6ee7b7', fontSize: '0.9rem' }}>AnonyGateway Crypto Platform (Flat 1.0% Fee)</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981' }}>
                          +${netSavings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Saved / mo
                        </span>
                        <div style={{ fontSize: '0.75rem', color: '#34d399' }}>
                          AnonyGateway processing: only ${anonyFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo (1.0%)
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      ✔ <strong>0% Chargebacks</strong> • <strong>Flat 1% Platform Fee (99% Net Settled)</strong> • <strong>100% Non-Custodial HD Isolation</strong> • <strong>Instant Settlement</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section: How It Works */}
        <section className="section" id="how-it-works">
          <div className="container">
            <div className="section-header reveal-on-scroll">
              <div className="section-tag">Simple 3-Step Process</div>
              <h2 className="section-title">How To Get Started in 60 Seconds</h2>
              <p className="section-desc">
                You are three quick steps away from accepting crypto payments worldwide.
              </p>
            </div>

            <div className="steps-grid">
              <div className="step-card glance-glass reveal-on-scroll">
                <div className="step-num">01</div>
                <h3 className="step-title">Register in 60s</h3>
                <p className="step-desc">
                  Visit <Link to="/signup" style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}>/signup</Link> and enter your business name and email. Enter the 6-digit OTP code sent to your inbox. Your isolated wallet and live API keys are provisioned instantly.
                </p>
              </div>

              <div className="step-card glance-glass reveal-on-scroll">
                <div className="step-num">02</div>
                <h3 className="step-title">Generate Invoice or API Call</h3>
                <p className="step-desc">
                  Create an invoice directly from your merchant dashboard or make a simple <code>POST /v1/merchant/invoices</code> API call from your website backend.
                </p>
              </div>

              <div className="step-card glance-glass reveal-on-scroll">
                <div className="step-num">03</div>
                <h3 className="step-title">Receive Funds &amp; Auto Receipts</h3>
                <p className="step-desc">
                  Your customer scans the checkout QR code with Binance, Trust Wallet, or MetaMask. When 12 blocks confirm on BSC, your balance is credited and an official receipt is emailed.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="section">
          <div className="container">
            <div className="cta-banner glance-glass reveal-on-scroll">
              <h2 className="cta-title">Ready to Take Control of Your Payments?</h2>
              <p className="cta-subtitle">
                Join merchants processing seamless on-chain crypto transactions with zero chargebacks and military-grade isolation.
              </p>
              <div className="cta-btn-group">
                <Link to="/signup" className="btn btn-primary" style={{ padding: '14px 30px', fontSize: '1rem' }}>
                  Create Your Merchant Account Free →
                </Link>
                <Link to="/login" className="btn btn-ghost" style={{ padding: '14px 26px', fontSize: '1rem' }}>
                  Already Registered? Sign In
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container footer-wrap">
          <div>
            <BrandLogo to="/" size="md" style={{ marginBottom: '8px' }} />
            <div>High-Security Anonymous Crypto Payment Gateway &amp; HD Wallet Infrastructure</div>
          </div>

          <div className="footer-links">
            <a href="#benefits">Benefits</a>
            <a href="#security">Security Specs</a>
            <a href="#calculator">Calculator</a>
            <Link to="/login">Merchant Sign In</Link>
            <Link to="/signup">Sign Up</Link>
            <a href="/health" target="_blank" rel="noreferrer">Network Status</a>
          </div>
        </div>
        <div className="container" style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem', textAlign: 'center', color: 'var(--text-sub)' }}>
          © 2026 AnonyGateway. All rights reserved. BSC Mainnet Chain ID: 56. Protected by scrypt &amp; HMAC-SHA256.
        </div>
      </footer>
    </div>
  );
}
