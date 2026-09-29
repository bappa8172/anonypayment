import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Copy,
  Check,
  Zap,
  Mail,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  QrCode,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import QRCode from 'qrcode';
import { publicApi } from '../api/client';
import Toast from '../components/Toast';
import BrandLogo from '../components/BrandLogo';

export default function Pay() {
  const [searchParams] = useSearchParams();
  const invoiceParam = searchParams.get('invoice') || searchParams.get('invoiceId');
  const linkParam = searchParams.get('link') || searchParams.get('code');

  const [invoice, setInvoice] = useState(null);
  const [paymentLink, setPaymentLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Email Gate state
  const [emailGateRequired, setEmailGateRequired] = useState(false);
  const [gateEmail, setGateEmail] = useState('');
  const [gateName, setGateName] = useState('');
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [gateError, setGateError] = useState('');

  // Checkout tab: 'qr' | 'web3'
  const [checkoutTab, setCheckoutTab] = useState('qr');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);

  // Time remaining
  const [timeRemaining, setTimeRemaining] = useState('');

  // Web3 state
  const [web3Status, setWeb3Status] = useState('');
  const [web3Loading, setWeb3Loading] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  // Customer receipt email
  const [customerEmailInput, setCustomerEmailInput] = useState('');
  const [savingReceiptEmail, setSavingReceiptEmail] = useState(false);
  const [receiptEmailSaved, setReceiptEmailSaved] = useState(false);

  // Success screen redirect countdown
  const [redirectCount, setRedirectCount] = useState(5);
  const redirectTimerRef = useRef(null);

  // QR generation
  useEffect(() => {
    if (invoice?.address) {
      let uri = invoice.address;
      if (invoice.currency === 'BTC' || invoice.chain === 'btc') {
        uri = `bitcoin:${invoice.address}?amount=${invoice.amount}`;
      } else if (invoice.currency === 'USDT_TRC20' || invoice.chain === 'tron') {
        uri = `tron:${invoice.address}`;
      } else if (invoice.currency === 'BNB_BSC' || invoice.currency === 'BNB') {
        uri = `ethereum:${invoice.address}?value=${Math.round(Number(invoice.amount) * 1e18)}`;
      } else if (invoice.paymentUri) {
        uri = invoice.paymentUri;
      }

      QRCode.toDataURL(uri, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [invoice?.address, invoice?.amount, invoice?.currency, invoice?.chain, invoice?.paymentUri]);

  // Initial load
  useEffect(() => {
    if (invoiceParam) {
      loadInvoice(invoiceParam);
    } else if (linkParam) {
      loadPaymentLink(linkParam);
    } else {
      setLoading(false);
      setError('No active payment link or invoice parameter provided.');
    }
  }, [invoiceParam, linkParam]);

  // Polling for live invoice status every 3s
  useEffect(() => {
    if (!invoice?.id) return;
    if (invoice.status === 'confirmed' || invoice.status === 'expired') return;

    const interval = setInterval(async () => {
      try {
        const updated = await publicApi.getInvoice(invoice.id);
        setInvoice(updated);
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [invoice?.id, invoice?.status]);

  // Expiration Countdown
  useEffect(() => {
    if (!invoice?.expiresAt) return;
    if (invoice.status === 'confirmed' || invoice.status === 'paid' || invoice.status === 'expired') {
      return;
    }

    const target = new Date(invoice.expiresAt).getTime();
    const updateCountdown = () => {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setTimeRemaining('Expired');
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeRemaining(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [invoice?.expiresAt, invoice?.status]);

  // Success redirect countdown
  useEffect(() => {
    if (invoice?.status === 'confirmed' && invoice?.redirectUrl && !redirectTimerRef.current) {
      redirectTimerRef.current = setInterval(() => {
        setRedirectCount((prev) => {
          if (prev <= 1) {
            clearInterval(redirectTimerRef.current);
            window.location.href = invoice.redirectUrl;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (redirectTimerRef.current) clearInterval(redirectTimerRef.current);
    };
  }, [invoice?.status, invoice?.redirectUrl]);

  const loadInvoice = async (id) => {
    setLoading(true);
    setError(null);
    try {
      const inv = await publicApi.getInvoice(id);
      setInvoice(inv);
      if (inv.customerEmail) {
        setCustomerEmailInput(inv.customerEmail);
      }
      // If pending and no customer email, require email gate
      if (inv.status === 'pending' && !inv.customerEmail) {
        setEmailGateRequired(true);
      }
    } catch (err) {
      setError(err.message || 'Invoice not found or expired.');
    } finally {
      setLoading(false);
    }
  };

  const loadPaymentLink = async (code) => {
    setLoading(true);
    setError(null);
    try {
      const link = await publicApi.getPaymentLink(code);
      setPaymentLink(link);
      setEmailGateRequired(true); // Always ask email first on payment links!
    } catch (err) {
      setError(err.message || 'Payment link not found.');
    } finally {
      setLoading(false);
    }
  };

  // Submit Email Gate
  const handleEmailGateSubmit = async (e) => {
    e.preventDefault();
    setGateError('');
    if (!gateEmail || !gateEmail.includes('@')) {
      setGateError('Please enter a valid email address.');
      return;
    }

    setGateSubmitting(true);
    try {
      if (paymentLink) {
        // Checkout link with customer email
        const newInvoice = await publicApi.checkoutPaymentLink(paymentLink.code, gateEmail.trim(), gateName.trim());
        setInvoice(newInvoice);
        setCustomerEmailInput(gateEmail.trim());
        setEmailGateRequired(false);
        setToast({ msg: `✉️ Invoice details emailed to ${gateEmail.trim()}!`, type: 'success' });
      } else if (invoice) {
        // Register customer email to existing invoice
        await publicApi.updateCustomerEmail(invoice.id, gateEmail.trim(), gateName.trim());
        const updated = await publicApi.getInvoice(invoice.id);
        setInvoice(updated);
        setCustomerEmailInput(gateEmail.trim());
        setEmailGateRequired(false);
        setToast({ msg: `✉️ Invoice details emailed to ${gateEmail.trim()}!`, type: 'success' });
      }
    } catch (err) {
      setGateError(err.message || 'Failed to submit email. Please retry.');
    } finally {
      setGateSubmitting(false);
    }
  };

  const handleCopy = async (text, type) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'address') {
        setCopiedAddress(true);
        setTimeout(() => setCopiedAddress(false), 2000);
      } else {
        setCopiedAmount(true);
        setTimeout(() => setCopiedAmount(false), 2000);
      }
      setToast({ msg: 'Copied to clipboard! ✓', type: 'success' });
    } catch {}
  };

  // Save/Update Customer Receipt Email
  const handleSaveReceiptEmail = async (e) => {
    e.preventDefault();
    if (!invoice?.id || !customerEmailInput) return;
    setSavingReceiptEmail(true);
    try {
      await publicApi.updateCustomerEmail(invoice.id, customerEmailInput.trim());
      setReceiptEmailSaved(true);
      setToast({ msg: 'Receipt email saved successfully! ✓', type: 'success' });
      const updated = await publicApi.getInvoice(invoice.id);
      setInvoice(updated);
    } catch (err) {
      setToast({ msg: err.message || 'Failed to save email', type: 'error' });
    } finally {
      setSavingReceiptEmail(false);
    }
  };

  // Web3 MetaMask / Trust Wallet Payment
  const handleWeb3Pay = async () => {
    if (!window.ethereum || !invoice) {
      setWeb3Status('No Web3 wallet extension detected. Please scan the QR code instead.');
      return;
    }

    setWeb3Loading(true);
    setWeb3Status('Connecting to wallet extension…');

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const userAccount = accounts[0];

      const targetChainHex = '0x' + Number(invoice.chainId || 56).toString(16);
      const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });

      if (currentChainHex.toLowerCase() !== targetChainHex.toLowerCase()) {
        setWeb3Status(`Switching network to BSC Mainnet (Chain ID ${invoice.chainId || 56})…`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainHex }],
          });
        } catch {
          setWeb3Status('Please manually switch network to BNB Smart Chain in your wallet.');
          setWeb3Loading(false);
          return;
        }
      }

      setWeb3Status('Waiting for transaction signature in wallet…');
      const isNative = invoice.currency === 'BNB_BSC' || invoice.currency === 'BNB';

      if (isNative) {
        const weiAmount = BigInt(Math.round(Number(invoice.amount) * 1e18));
        const txHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: userAccount,
            to: invoice.address,
            value: '0x' + weiAmount.toString(16),
          }],
        });
        setWeb3Status(`✓ Broadcasted! Tx: ${txHash.slice(0, 10)}… Confirming on BSC.`);
      } else {
        // USDT on BSC
        const usdtContract = '0x55d398326f99059fF775485246999027B3197955';
        const cleanAddr = invoice.address.replace('0x', '').padStart(64, '0');
        const rawUnits = BigInt(Math.round(Number(invoice.amount) * 1e18));
        const hexAmount = rawUnits.toString(16).padStart(64, '0');
        const transferData = '0xa9059cbb' + cleanAddr + hexAmount;

        const txHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: userAccount,
            to: usdtContract,
            data: transferData,
          }],
        });
        setWeb3Status(`✓ Broadcasted! Tx: ${txHash.slice(0, 10)}… Confirming on BSC.`);
      }
    } catch (err) {
      setWeb3Status(err.message || 'Transaction rejected by user.');
    } finally {
      setWeb3Loading(false);
    }
  };

  const isConfirmed = invoice?.status === 'confirmed';
  const isPaid = invoice?.status === 'paid';
  const isExpired = invoice?.status === 'expired';
  const showSuccessScreen = isConfirmed || isPaid;

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 16px',
      }}
    >
      <div className="cyber-grid-bg" />
      <div className="water-caustics-layer" />
      <div className="ambient-glow-wrap">
        <div className="ambient-orb orb-1" />
        <div className="ambient-orb orb-2" />
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ width: '100%', maxWidth: '520px', position: 'relative', zIndex: 10 }}>
        {/* Brand Bar */}
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <BrandLogo to="/" size="lg" />
        </div>

        {/* Loading state */}
        {loading && (
          <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
            <div className="pulse-dot" style={{ margin: '0 auto 14px', width: '12px', height: '12px' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Resolving Secure Checkout…</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Querying BSC on-chain ledger records
            </p>
          </div>
        )}

        {/* Error / No Invoice State */}
        {!loading && error && (
          <div className="glass-card" style={{ padding: '36px 24px', textAlign: 'center' }}>
            <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: '12px' }}>💳</span>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
              No Active Checkout Found
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '24px' }}>
              {error}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Link to="/" className="btn btn-primary btn-block">
                ← Go to AnonyGateway Homepage
              </Link>
              <Link to="/login" className="btn btn-secondary btn-block">
                Merchant Sign In
              </Link>
            </div>
          </div>
        )}

        {/* STEP 1: Email Gate Card (prompts email before payment) */}
        {!loading && !error && emailGateRequired && (
          <div className="glass-card" style={{ padding: '32px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: '#00e5ff' }}>
                {paymentLink?.merchant_name || invoice?.merchantName || 'PAYMENT CHECKOUT'}
              </span>
              <span
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <span className="pulse-dot" /> {
                  (paymentLink?.currency || invoice?.currency || '').includes('TRC20')
                    ? 'TRON Network'
                    : (paymentLink?.currency || invoice?.currency || '') === 'BTC'
                      ? 'Bitcoin Network'
                      : 'BSC Mainnet'
                }
              </span>
            </div>

            <div style={{ textAlign: 'center', margin: '14px 0 22px' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                {paymentLink?.title || invoice?.description || 'Crypto Payment'}
              </div>
              <div style={{ fontSize: '2.3rem', fontWeight: 800, color: '#00e5ff', letterSpacing: '-0.04em' }}>
                {paymentLink
                  ? `${paymentLink.amount} ${paymentLink.currency.split('_')[0]}`
                  : `${invoice?.amount} ${invoice?.symbol || invoice?.currency.split('_')[0]}`}
              </div>
            </div>

            <form onSubmit={handleEmailGateSubmit}>
              <div
                style={{
                  background: 'rgba(0, 229, 255, 0.05)',
                  border: '1px solid rgba(0, 229, 255, 0.2)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  marginBottom: '18px',
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#00e5ff', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Mail size={15} /> Enter Your Email to Continue
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                  We will email your official invoice and on-chain payment confirmation receipt to this inbox.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Email Address <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={gateEmail}
                  onChange={(e) => setGateEmail(e.target.value)}
                  placeholder="buyer@example.com"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Payer Name <span style={{ fontSize: '0.73rem', color: 'var(--text-sub)' }}>(Optional)</span>
                </label>
                <input
                  type="text"
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  placeholder="Your name or company"
                  className="form-input"
                />
              </div>

              {gateError && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: '0.82rem', marginBottom: '14px' }}>
                  {gateError}
                </div>
              )}

              <button
                type="submit"
                disabled={gateSubmitting}
                className="btn btn-primary btn-block"
                style={{ padding: '14px', marginTop: '6px' }}
              >
                {gateSubmitting ? 'Sending Invoice & Preparing Payment…' : 'Send Invoice & Continue to Payment →'}
              </button>
            </form>
          </div>
        )}

        {/* STEP 2: Main Payment Card (active when invoice loaded & email gate passed & not confirmed yet) */}
        {!loading && !error && !emailGateRequired && invoice && !showSuccessScreen && (
          <div className="glass-card" style={{ padding: '28px 24px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: '#00e5ff' }}>
                {invoice.merchantName || 'CRYPTO INVOICE'}
              </span>
              <span
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '4px 12px',
                  borderRadius: '999px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span className="pulse-dot" /> {invoice.network || 'BSC Network'}
              </span>
            </div>

            {/* Email Sent Notification Banner */}
            {invoice.customerEmail && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  fontSize: '0.82rem',
                  color: '#34d399',
                  marginBottom: '16px',
                }}
              >
                <Mail size={15} />
                <span>
                  Invoice details emailed to <strong style={{ color: '#fff' }}>{invoice.customerEmail}</strong>! Complete payment below:
                </span>
              </div>
            )}

            {/* Amount display */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h1 style={{ fontSize: 'clamp(1.9rem, 6vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.04em', color: '#fff' }}>
                {invoice.amount} {invoice.symbol || invoice.currency.split('_')[0]}
              </h1>
              <button
                type="button"
                onClick={() => handleCopy(String(invoice.amount), 'amount')}
                className="btn btn-secondary btn-sm"
              >
                {copiedAmount ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                {copiedAmount ? 'Copied' : 'Copy Amount'}
              </button>
            </div>

            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '18px' }}>
              {invoice.chain === 'tron' || invoice.currency === 'USDT_TRC20'
                ? 'Send exact Tether USD on TRON Network (TRC-20)'
                : invoice.chain === 'btc' || invoice.currency === 'BTC'
                  ? 'Send exact Bitcoin to the Native SegWit deposit address below'
                  : `Send exact crypto on ${invoice.network || 'BNB Smart Chain'} (Chain ID: ${invoice.chainId || 56})`}
            </p>

            {/* Tabs: QR vs Web3 */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '4px',
                gap: '4px',
                marginBottom: '20px',
              }}
            >
              <button
                type="button"
                onClick={() => setCheckoutTab('qr')}
                style={{
                  flex: 1,
                  background: checkoutTab === 'qr' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                  color: checkoutTab === 'qr' ? '#00e5ff' : 'var(--text-muted)',
                  border: checkoutTab === 'qr' ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid transparent',
                  padding: '9px',
                  borderRadius: '9px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                📱 QR &amp; Deposit Address
              </button>
              <button
                type="button"
                onClick={() => setCheckoutTab('web3')}
                style={{
                  flex: 1,
                  background: checkoutTab === 'web3' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                  color: checkoutTab === 'web3' ? '#00e5ff' : 'var(--text-muted)',
                  border: checkoutTab === 'web3' ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid transparent',
                  padding: '9px',
                  borderRadius: '9px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                🦊 Pay with Web3 Wallet
              </button>
            </div>

            {/* TAB 1: QR & Manual Address */}
            {checkoutTab === 'qr' && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div
                    style={{
                      width: '200px',
                      height: '200px',
                      margin: '0 auto 12px',
                      background: '#fff',
                      borderRadius: '12px',
                      border: '2.5px solid #00e5ff',
                      padding: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 24px rgba(0, 229, 255, 0.25)',
                    }}
                  >
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="QR Code" style={{ width: '100%', height: '100%', display: 'block' }} />
                    ) : (
                      <span style={{ color: '#000', fontSize: '0.85rem', fontWeight: 600 }}>Loading QR…</span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-sub)' }}>
                    Scan with Trust Wallet, Binance, MetaMask, or any Web3 app
                  </span>
                </div>

                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  Deposit Address
                </div>
                <div
                  style={{
                    background: 'rgba(3, 7, 17, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginBottom: '16px',
                  }}
                >
                  <code style={{ fontSize: '0.82rem', color: '#00e5ff', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                    {invoice.address}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(invoice.address, 'address')}
                    className="btn btn-secondary btn-sm"
                  >
                    {copiedAddress ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    {copiedAddress ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Direct Web3 Button */}
            {checkoutTab === 'web3' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 16px',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: '14px',
                  border: '1px dashed rgba(249, 115, 22, 0.4)',
                  marginBottom: '18px',
                }}
              >
                <span style={{ fontSize: '2.4rem', display: 'block', marginBottom: '8px' }}>🦊</span>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginBottom: '4px' }}>
                  Direct Web3 One-Click Payment
                </div>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '18px' }}>
                  Connect your MetaMask or Trust Wallet extension to broadcast this payment directly.
                </p>

                {invoice.chain === 'tron' || invoice.currency === 'USDT_TRC20' || invoice.chain === 'btc' || invoice.currency === 'BTC' ? (
                  <div
                    style={{
                      padding: '16px',
                      background: 'rgba(0, 229, 255, 0.08)',
                      border: '1px solid rgba(0, 229, 255, 0.25)',
                      borderRadius: '12px',
                      color: '#00e5ff',
                      fontSize: '0.85rem',
                      lineHeight: 1.6,
                      textAlign: 'left',
                    }}
                  >
                    💡 <strong>Network Notice:</strong> Web3 browser extension direct connection (MetaMask / Trust Wallet) is built for EVM networks. For{' '}
                    <strong style={{ color: '#fff' }}>
                      {invoice.chain === 'tron' || invoice.currency === 'USDT_TRC20' ? 'TRON (TRC-20)' : 'Bitcoin (BTC)'}
                    </strong>
                    , please switch to the <strong>📱 QR &amp; Deposit Address</strong> tab above to scan or transfer from your wallet.
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleWeb3Pay}
                      disabled={web3Loading}
                      style={{
                        width: '100%',
                        padding: '13px',
                        background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.94rem',
                        border: 'none',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        boxShadow: '0 4px 18px rgba(249, 115, 22, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      <Zap size={16} /> {web3Loading ? 'Processing…' : 'Send Transaction with Web3'}
                    </button>

                    {web3Status && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '10px' }}>
                        {web3Status}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Status box */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: 'rgba(0, 0, 0, 0.42)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '12px 16px',
                marginBottom: '14px',
              }}
            >
              <div
                className={`pulse-dot ${isExpired ? 'expired' : ''}`}
                style={{
                  background: isExpired ? '#ef4444' : '#f59e0b',
                  boxShadow: isExpired ? 'none' : '0 0 8px #f59e0b',
                }}
              />
              <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                {isExpired
                  ? 'Invoice expired'
                  : 'Awaiting payment on BNB Smart Chain…'}
              </span>
            </div>

            {/* Expiry Timer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.84rem',
                color: 'var(--text-muted)',
                paddingTop: '12px',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <span>Expires in:</span>
              <strong style={{ color: '#00e5ff', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.96rem' }}>
                {timeRemaining || '—:—'}
              </strong>
            </div>

            {/* Fee Transparency Callout */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
                marginTop: '12px',
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldCheck size={14} color="#10b981" />
                <span>Flat 1.0% Platform Fee Included</span>
              </span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>Zero Extra Surcharges</span>
            </div>
          </div>
        )}

        {/* STEP 3: Payment Success Screen (QR hidden completely) */}
        {!loading && !error && showSuccessScreen && (
          <div
            className="glass-card payment-success-card"
            style={{
              padding: '38px 26px',
              textAlign: 'center',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 45px rgba(16, 185, 129, 0.15)',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                margin: '0 auto 20px',
                borderRadius: '50%',
                background: isConfirmed ? 'rgba(16, 185, 129, 0.12)' : 'rgba(0, 229, 255, 0.12)',
                border: isConfirmed ? '1.5px solid rgba(16, 185, 129, 0.45)' : '1.5px solid rgba(0, 229, 255, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isConfirmed ? '0 0 32px rgba(16, 185, 129, 0.35)' : '0 0 32px rgba(0, 229, 255, 0.35)',
              }}
            >
              <span style={{ fontSize: '2.6rem', color: isConfirmed ? '#10b981' : '#00e5ff', lineHeight: 1 }}>
                {isConfirmed ? '✓' : '⚡'}
              </span>
            </div>

            <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#f1f5f9', marginBottom: '6px', letterSpacing: '-0.03em' }}>
              {isConfirmed ? 'Payment Confirmed!' : 'Payment Received!'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.6 }}>
              {isConfirmed
                ? 'Your transaction has been finalized with 12 confirmations on the blockchain.'
                : `Confirming on BNB Smart Chain (${invoice.confirmations || 1}/${invoice.confirmationsRequired || 12} Confirmations)…`}
            </p>

            <div
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '14px',
                padding: '18px 20px',
                textAlign: 'left',
                marginBottom: '22px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Amount Paid:</span>
                <strong style={{ color: '#10b981', fontSize: '1.15rem', fontWeight: 800 }}>
                  {invoice.amount} {invoice.symbol || invoice.currency.split('_')[0]}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Network:</span>
                <span style={{ color: '#f1f5f9', fontSize: '0.86rem', fontWeight: 600 }}>
                  {invoice.network || 'BNB Smart Chain (BSC)'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Reference / Order:</span>
                <code style={{ color: '#38bdf8', fontSize: '0.82rem', fontFamily: 'JetBrains Mono, monospace' }}>
                  {invoice.orderId ? `Order #${invoice.orderId}` : (invoice.description || `Invoice #${invoice.id.slice(0, 8)}`)}
                </code>
              </div>

              {invoice.txid && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>Transaction Hash:</span>
                  <a
                    href={invoice.explorerTx || `https://bscscan.com/tx/${invoice.txid}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#00e5ff', fontSize: '0.82rem', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    View on BscScan ↗
                  </a>
                </div>
              )}

              {invoice.customerEmail && (
                <div
                  style={{
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    paddingTop: '10px',
                    fontSize: '0.8rem',
                    color: '#34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Mail size={14} /> Official payment receipt dispatched to {invoice.customerEmail}.
                </div>
              )}
            </div>

            {/* Redirect Countdown if configured */}
            {isConfirmed && invoice.redirectUrl && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.22)',
                  borderRadius: '10px',
                  fontSize: '0.86rem',
                  color: '#e2e8f0',
                }}
              >
                Redirecting to merchant store in <strong style={{ color: '#38bdf8' }}>{redirectCount}</strong>s…
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isConfirmed && invoice.redirectUrl && (
                <a
                  href={invoice.redirectUrl}
                  className="btn btn-emerald btn-block"
                  style={{ padding: '13px' }}
                >
                  Proceed to Merchant Store ↗
                </a>
              )}
              <Link to="/dashboard" className="btn btn-secondary btn-block">
                Open Merchant Portal
              </Link>
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-sub)', marginTop: '18px' }}>
          🔒 Real-time on-chain verification. BSC Mainnet Chain ID: 56. Always verify network before sending.
        </p>
      </div>
    </div>
  );
}
