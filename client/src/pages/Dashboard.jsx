import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Wallet,
  History,
  Link as LinkIcon,
  Code2,
  Mail,
  Users,
  Landmark,
  Settings,
  RefreshCw,
  LogOut,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Zap,
  Clock,
  X,
  Send,
  Eye,
  EyeOff,
  QrCode as QrCodeIcon,
  Menu,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  adminApi,
  authApi,
  getAuthToken,
  clearAuth,
  getStoredUser,
  setStoredUser,
} from '../api/client';
import Toast from '../components/Toast';
import BrandLogo from '../components/BrandLogo';

// Smart Crypto Amount Formatter - preserves micro amounts like 0.00006365 without rounding to 0
function formatCrypto(val) {
  if (val === null || val === undefined || val === '' || val === '0' || val === '0.0') return '0.00';
  const num = Number(val);
  if (isNaN(num) || num === 0) return '0.00';
  if (num < 0.0001) return String(val);
  if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// Robust date formatter handling SQLite dates ('2026-09-25 17:09:42') & ISO timestamps
function formatDate(val) {
  if (!val) return '—';
  try {
    const s = typeof val === 'string' ? val.replace(' ', 'T') : val;
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString();
  } catch {
    return String(val);
  }
}

// Explorer URL Helpers based on network mode
function getTxExplorerUrl(txid, currency = 'BNB_BSC') {
  if (!txid) return '#';
  if (currency && (currency.includes('TRC20') || currency.includes('TRON'))) {
    return `https://tronscan.org/#/transaction/${txid}`;
  }
  if (currency && (currency === 'BTC' || currency.includes('BTC'))) {
    return `https://mempool.space/tx/${txid}`;
  }
  if (currency && currency.includes('SEPOLIA')) {
    return `https://sepolia.etherscan.io/tx/${txid}`;
  }
  if (currency && currency.includes('POLYGON')) {
    return `https://polygonscan.com/tx/${txid}`;
  }
  return `https://bscscan.com/tx/${txid}`;
}

function getAddressExplorerUrl(address, currency = 'BNB_BSC') {
  if (!address) return '#';
  if (currency && (currency.includes('TRC20') || currency.includes('TRON'))) {
    return `https://tronscan.org/#/address/${address}`;
  }
  if (currency && (currency === 'BTC' || currency.includes('BTC'))) {
    return `https://mempool.space/address/${address}`;
  }
  if (currency && currency.includes('SEPOLIA')) {
    return `https://sepolia.etherscan.io/address/${address}`;
  }
  if (currency && currency.includes('POLYGON')) {
    return `https://polygonscan.com/address/${address}`;
  }
  return `https://bscscan.com/address/${address}`;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Auth & User State
  const [user, setUser] = useState(getStoredUser());
  const [isAdmin, setIsAdmin] = useState(false);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Network & Live Sync
  const [networkStatus, setNetworkStatus] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());

  // Data States
  const [stats, setStats] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [paymentLinks, setPaymentLinks] = useState([]);
  const [emails, setEmails] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [treasury, setTreasury] = useState(null);
  const [sweeps, setSweeps] = useState([]);

  // Modals Visibility
  const [modalInvoiceOpen, setModalInvoiceOpen] = useState(false);
  const [modalDepositOpen, setModalDepositOpen] = useState(false);
  const [modalWithdrawOpen, setModalWithdrawOpen] = useState(false);
  const [modalTransferOpen, setModalTransferOpen] = useState(false);
  const [modalPaymentLinkOpen, setModalPaymentLinkOpen] = useState(false);
  const [modalEmbedOpen, setModalEmbedOpen] = useState(false);
  const [modalTreasuryPayoutOpen, setModalTreasuryPayoutOpen] = useState(false);
  const [modalTreasurySettingsOpen, setModalTreasurySettingsOpen] = useState(false);
  const [modalTreasuryQrOpen, setModalTreasuryQrOpen] = useState(false);
  const [modalBackupOpen, setModalBackupOpen] = useState(false);

  // Embed Modal State
  const [embedData, setEmbedData] = useState({ code: '', title: '', amount: '', currency: '' });

  // Backup Data State
  const [backupData, setBackupData] = useState({ mnemonic: '', treasuryAddress: '', treasuryPrivateKey: '' });
  const [showSeedPhrase, setShowSeedPhrase] = useState(false);
  const [showBackupKey, setShowBackupKey] = useState(false);

  // Integration Snippet Language
  const [snippetLang, setSnippetLang] = useState('curl');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [rotatingSecret, setRotatingSecret] = useState(false);

  // Modal Form States
  const [depositCurrency, setDepositCurrency] = useState('BNB_BSC');
  const [depositAddress, setDepositAddress] = useState('');
  const [depositQrUrl, setDepositQrUrl] = useState('');

  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState('USDT_BSC');
  const [invoiceOrderRef, setInvoiceOrderRef] = useState('');
  const [invoiceEmail, setInvoiceEmail] = useState('');
  const [invoiceName, setInvoiceName] = useState('');
  const [invoiceDesc, setInvoiceDesc] = useState('');
  const [invoiceExpiry, setInvoiceExpiry] = useState(30);
  const [invoiceWebhook, setInvoiceWebhook] = useState('');

  const [withdrawCurrency, setWithdrawCurrency] = useState('USDT_BSC');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('Merchant payout withdrawal');
  const [withdrawStatus, setWithdrawStatus] = useState(null);
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  const [transferCurrency, setTransferCurrency] = useState('USDT_BSC');
  const [transferWalletId, setTransferWalletId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('Internal wallet transfer');
  const [transferStatus, setTransferStatus] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);

  const [linkTitle, setLinkTitle] = useState('');
  const [linkDesc, setLinkDesc] = useState('');
  const [linkAmount, setLinkAmount] = useState('');
  const [linkCurrency, setLinkCurrency] = useState('USDT_BSC');
  const [linkRedirect, setLinkRedirect] = useState('');

  const [payoutAddressInput, setPayoutAddressInput] = useState('');
  const [autoForwardCheck, setAutoForwardCheck] = useState(true);
  const [payoutSaving, setPayoutSaving] = useState(false);

  // Treasury Payout Modal Form
  const [tpCurrency, setTpCurrency] = useState('USDT_BSC');
  const [tpAddress, setTpAddress] = useState('');
  const [tpAmount, setTpAmount] = useState('');
  const [tpNote, setTpNote] = useState('Treasury on-chain payout');
  const [tpStatus, setTpStatus] = useState(null);
  const [tpLoading, setTpLoading] = useState(false);

  // Treasury Settings Modal Form
  const [tsAutoSweep, setTsAutoSweep] = useState(true);
  const [tsColdStorage, setTsColdStorage] = useState('');
  const [tsStatus, setTsStatus] = useState(null);

  // Treasury QR Modal Form
  const [treasuryQrDataUrl, setTreasuryQrDataUrl] = useState('');

  // UI Toast & Copy State
  const [toast, setToast] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');

  const copyText = async (text, key, customMsg = 'Copied to clipboard! ✓') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setToast({ msg: customMsg, type: 'success' });
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedKey(key);
      setToast({ msg: customMsg, type: 'success' });
      setTimeout(() => setCopiedKey(''), 2000);
    }
  };

  // 1. Initial Authentication Check
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate('/login');
      return;
    }

    authApi.getMe()
      .then((res) => {
        if (res?.user) {
          setUser(res.user);
          setStoredUser(res.user);
          setIsAdmin(res.user.role === 'admin');
          if (res.user.payoutAddress) {
            setPayoutAddressInput(res.user.payoutAddress);
          }
          if (res.user.autoForward !== undefined) {
            setAutoForwardCheck(res.user.autoForward);
          }
        }
      })
      .catch(() => {
        clearAuth();
        navigate('/login');
      });
  }, [navigate]);

  // 2. Fetch Tab Specific Data
  const refreshAll = useCallback(async (silent = true) => {
    if (!getAuthToken()) return;
    if (!silent) setIsSyncing(true);
    try {
      const [netRes, statsRes] = await Promise.allSettled([
        adminApi.getNetworkStatus(),
        adminApi.getStats(),
      ]);

      if (netRes.status === 'fulfilled') setNetworkStatus(netRes.value);
      if (statsRes.status === 'fulfilled') {
        const s = statsRes.value;
        setStats(s?.stats ? { ...s.stats, ...s } : s);
      }

      // Fetch according to active tab
      if (activeTab === 'overview' || activeTab === 'invoices') {
        const invRes = await adminApi.getInvoices(invoiceFilter);
        setInvoices(Array.isArray(invRes) ? invRes : (invRes?.invoices || []));
      }

      if (activeTab === 'overview' || activeTab === 'wallet') {
        const wRes = await adminApi.getWallet();
        setWallet(wRes);
      }

      if (activeTab === 'ledger') {
        const ledRes = await adminApi.getLedger();
        setLedger(Array.isArray(ledRes) ? ledRes : (ledRes?.history || []));
      }

      if (activeTab === 'payment-links') {
        const linksRes = await adminApi.getPaymentLinks();
        setPaymentLinks(Array.isArray(linksRes) ? linksRes : (linksRes?.links || []));
      }

      if (activeTab === 'emails') {
        const emailRes = await adminApi.getEmailLogs();
        setEmails(Array.isArray(emailRes) ? emailRes : (emailRes?.emails || []));
      }

      if (activeTab === 'merchants') {
        const mRes = await adminApi.getMerchants();
        setMerchants(Array.isArray(mRes) ? mRes : (mRes?.merchants || []));
      }

      if (activeTab === 'treasury') {
        const [tRes, sRes] = await Promise.allSettled([
          adminApi.getTreasury(),
          adminApi.getTreasurySweeps(25),
        ]);
        if (tRes.status === 'fulfilled') setTreasury(tRes.value);
        if (sRes.status === 'fulfilled') {
          const swList = sRes.value;
          setSweeps(Array.isArray(swList) ? swList : (swList?.sweeps || []));
        }
      }

      setLastSyncTime(Date.now());
    } catch (err) {
      console.error('Refresh error:', err);
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, [activeTab, invoiceFilter]);

  // 3. Live Sync Loop (every 3 seconds)
  useEffect(() => {
    if (!getAuthToken()) return;
    refreshAll(true);
    const interval = setInterval(() => {
      refreshAll(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Handle deposit address modal update
  const loadDepositAddress = useCallback(async (curr) => {
    try {
      const res = await adminApi.getDepositAddress(curr);
      if (res?.address) {
        setDepositAddress(res.address);
        const qrUrl = await QRCode.toDataURL(res.address, { width: 180, margin: 1 });
        setDepositQrUrl(qrUrl);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (modalDepositOpen) {
      loadDepositAddress(depositCurrency);
    }
  }, [modalDepositOpen, depositCurrency, loadDepositAddress]);

  // Handle Create Invoice Submit
  const handleCreateInvoiceSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        amount: invoiceAmount.trim(),
        currency: invoiceCurrency,
        orderId: invoiceOrderRef.trim() || undefined,
        customerEmail: invoiceEmail.trim() || undefined,
        customerName: invoiceName.trim() || undefined,
        description: invoiceDesc.trim() || undefined,
        expiresInMinutes: parseInt(invoiceExpiry, 10) || 30,
        webhookUrl: invoiceWebhook.trim() || undefined,
      };
      const res = await adminApi.createInvoice(payload);
      setToast({ msg: `Invoice created! Code: ${res.id.slice(0, 8)}`, type: 'success' });
      setModalInvoiceOpen(false);
      setInvoiceAmount('');
      setInvoiceOrderRef('');
      setInvoiceEmail('');
      setInvoiceName('');
      setInvoiceDesc('');
      setInvoiceWebhook('');
      refreshAll(false);
    } catch (err) {
      setToast({ msg: err.message || 'Failed to create invoice', type: 'error' });
    }
  };

  // Handle Withdraw Submit
  const handleWithdrawSubmit = async (e) => {
    e.preventDefault();
    const cleanAddr = withdrawAddress.trim();
    if (!cleanAddr) {
      setWithdrawStatus({ type: 'error', msg: 'Destination EVM address (0x...) is required' });
      return;
    }
    setWithdrawLoading(true);
    setWithdrawStatus({ type: 'info', msg: 'Signing and broadcasting real on-chain transaction…' });
    try {
      const payload = {
        currency: withdrawCurrency,
        toAddress: cleanAddr,
        address: cleanAddr,
        amount: withdrawAmount.trim(),
        note: withdrawNote.trim(),
      };
      const res = await adminApi.withdraw(payload);
      setWithdrawStatus({
        type: 'success',
        msg: `Transaction Broadcasted! TxID: ${res.txid ? res.txid.slice(0, 16) + '…' : 'Confirmed'}`,
        explorerUrl: res.explorerUrl || getTxExplorerUrl(res.txid, withdrawCurrency),
      });
      setToast({ msg: 'Withdrawal submitted successfully!', type: 'success' });
      setTimeout(() => {
        setModalWithdrawOpen(false);
        setWithdrawAmount('');
        setWithdrawStatus(null);
        refreshAll(false);
      }, 2000);
    } catch (err) {
      const errMsg = err.message || '';
      if (errMsg.includes('insufficient token balance') || errMsg.includes('insufficient native balance')) {
        setWithdrawStatus({
          type: 'error',
          isLiquidityNotice: true,
          msg: errMsg,
        });
      } else {
        setWithdrawStatus({ type: 'error', msg: `Error: ${errMsg}` });
      }
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Handle Internal Transfer Submit
  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    setTransferLoading(true);
    setTransferStatus({ type: 'info', msg: 'Processing instant transfer…' });
    try {
      const payload = {
        currency: transferCurrency,
        toWalletId: transferWalletId.trim(),
        amount: transferAmount.trim(),
        note: transferNote.trim(),
      };
      const res = await adminApi.transfer(payload);
      setTransferStatus({
        type: 'success',
        msg: `Transfer Successful: Sent ${res.amount} ${res.currency} to ${res.toWalletId}`,
      });
      setToast({ msg: 'Internal transfer completed! ✓', type: 'success' });
      setTimeout(() => {
        setModalTransferOpen(false);
        setTransferAmount('');
        setTransferWalletId('');
        setTransferStatus(null);
        refreshAll(false);
      }, 1800);
    } catch (err) {
      setTransferStatus({ type: 'error', msg: `Error: ${err.message}` });
    } finally {
      setTransferLoading(false);
    }
  };

  // Handle Create Payment Link Submit
  const handleCreatePaymentLinkSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title: linkTitle.trim(),
        description: linkDesc.trim() || undefined,
        amount: linkAmount.trim(),
        currency: linkCurrency,
        redirectUrl: linkRedirect.trim() || undefined,
      };
      const res = await adminApi.createPaymentLink(payload);
      setToast({ msg: `Payment link created! Code: ${res.code}`, type: 'success' });
      setModalPaymentLinkOpen(false);
      setLinkTitle('');
      setLinkDesc('');
      setLinkAmount('');
      setLinkRedirect('');
      refreshAll(false);
    } catch (err) {
      setToast({ msg: err.message || 'Failed to create payment link', type: 'error' });
    }
  };

  // Handle Save Payout Address
  const handleSavePayoutAddress = async (e) => {
    e.preventDefault();
    const addr = payoutAddressInput.trim();
    if (addr && !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setToast({ msg: 'Invalid EVM address! Must be 42 characters starting with 0x', type: 'error' });
      return;
    }
    setPayoutSaving(true);
    try {
      await authApi.updatePayoutAddress(addr, autoForwardCheck);
      setToast({ msg: 'Payout settlement destination saved! ✓', type: 'success' });
      const meRes = await authApi.getMe();
      if (meRes?.user) {
        setUser(meRes.user);
        setStoredUser(meRes.user);
      }
    } catch (err) {
      setToast({ msg: err.message || 'Failed to save address', type: 'error' });
    } finally {
      setPayoutSaving(false);
    }
  };

  // Handle Auto-Generate / Rotate Production API Key
  const handleRegenerateApiKey = async () => {
    if (!window.confirm("⚠️ Are you sure you want to regenerate your production API Key? Any backend application or script using your current key will immediately lose access until updated.")) {
      return;
    }
    setRotatingKey(true);
    try {
      const res = await authApi.regenerateApiKey();
      if (res?.apiKey) {
        const updated = { ...user, apiKey: res.apiKey };
        setUser(updated);
        setStoredUser(updated);
        setToast({ msg: '⚡ Fresh production API Key generated! Update your backend config.', type: 'success' });
      }
    } catch (err) {
      setToast({ msg: err.message || 'Failed to rotate API Key', type: 'error' });
    } finally {
      setRotatingKey(false);
    }
  };

  // Handle Auto-Generate / Rotate Webhook Secret
  const handleRegenerateWebhookSecret = async () => {
    if (!window.confirm("⚠️ Are you sure you want to regenerate your Webhook Signing Secret? Any server validating HMAC-SHA256 signatures with your current secret will fail until updated.")) {
      return;
    }
    setRotatingSecret(true);
    try {
      const res = await authApi.regenerateWebhookSecret();
      if (res?.webhookSecret) {
        const updated = { ...user, webhookSecret: res.webhookSecret };
        setUser(updated);
        setStoredUser(updated);
        setToast({ msg: '⚡ Fresh Webhook Signing Secret generated!', type: 'success' });
      }
    } catch (err) {
      setToast({ msg: err.message || 'Failed to rotate Webhook Secret', type: 'error' });
    } finally {
      setRotatingSecret(false);
    }
  };

  // Handle Batch Sweep
  const handleTriggerSweepAll = async () => {
    try {
      const res = await adminApi.sweepAll();
      setToast({ msg: `⚡ Batch Sweep: ${res.sweptCount || 'All'} payments swept to Treasury!`, type: 'success' });
      refreshAll(false);
    } catch (err) {
      setToast({ msg: err.message || 'Sweep failed', type: 'error' });
    }
  };

  // Handle Single Invoice Sweep
  const handleSweepSingle = async (invId) => {
    if (!window.confirm(`Trigger on-chain sweep for invoice #${invId.slice(0, 8)} to Central Treasury?`)) return;
    try {
      await adminApi.sweepSingle(invId);
      setToast({ msg: `✓ Invoice #${invId.slice(0, 8)} swept to Treasury!`, type: 'success' });
      refreshAll(false);
    } catch (err) {
      setToast({ msg: err.message || 'Sweep failed', type: 'error' });
    }
  };

  // Handle Treasury Payout Submit
  const handleTreasuryPayoutSubmit = async (e) => {
    e.preventDefault();
    const cleanAddr = tpAddress.trim();
    if (!cleanAddr) {
      setTpStatus({ type: 'error', msg: 'Recipient address (0x...) is required' });
      return;
    }
    setTpLoading(true);
    setTpStatus({ type: 'info', msg: 'Broadcasting payout transaction to blockchain network…' });
    try {
      const payload = {
        currency: tpCurrency,
        toAddress: cleanAddr,
        address: cleanAddr,
        amount: tpAmount.trim(),
        note: tpNote.trim() || undefined,
      };
      const res = await adminApi.treasuryPayout(payload);
      setTpStatus({
        type: 'success',
        msg: `✓ Broadcasted payout! TX: ${res.txid?.slice(0, 14)}…`,
        explorerUrl: res.explorerUrl,
      });
      setTimeout(() => {
        setModalTreasuryPayoutOpen(false);
        setTpAddress('');
        setTpAmount('');
        setTpStatus(null);
        refreshAll(false);
      }, 2500);
    } catch (err) {
      setTpStatus({ type: 'error', msg: `Payout error: ${err.message}` });
    } finally {
      setTpLoading(false);
    }
  };

  // Handle Treasury Settings Submit
  const handleTreasurySettingsSubmit = async (e) => {
    e.preventDefault();
    try {
      await adminApi.updateTreasurySettings({
        autoSweepEnabled: tsAutoSweep,
        coldStorageAddress: tsColdStorage.trim() || undefined,
      });
      setTsStatus({ type: 'success', msg: '✓ Treasury settings updated successfully!' });
      setTimeout(() => {
        setModalTreasurySettingsOpen(false);
        setTsStatus(null);
        refreshAll(false);
      }, 1500);
    } catch (err) {
      setTsStatus({ type: 'error', msg: `Error: ${err.message}` });
    }
  };

  // Handle Load Treasury QR
  const handleOpenTreasuryQr = async () => {
    try {
      const res = await adminApi.getTreasuryQr();
      if (res?.qrDataUrl) {
        setTreasuryQrDataUrl(res.qrDataUrl);
      }
      setModalTreasuryQrOpen(true);
    } catch (err) {
      setToast({ msg: 'Failed to generate QR: ' + err.message, type: 'error' });
    }
  };

  // Handle Reveal Key Backup
  const handleRevealBackup = async () => {
    try {
      const res = await adminApi.getWalletBackup();
      setBackupData({
        mnemonic: res.mnemonic || 'Mnemonic not configured in software. Using external XPUB or private key.',
        treasuryAddress: res.treasuryAddress || '',
        treasuryPrivateKey: res.treasuryPrivateKey || 'Private key not available (Watch-only mode)',
      });
      setModalBackupOpen(true);
    } catch (err) {
      setToast({ msg: 'Error loading backup: ' + err.message, type: 'error' });
    }
  };

  // Handle Toggle Merchant Status
  const handleToggleMerchantStatus = async (merchantId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    if (!window.confirm(`Are you sure you want to set this merchant to ${newStatus.toUpperCase()}?`)) return;
    try {
      await adminApi.setMerchantStatus(merchantId, newStatus);
      setToast({ msg: `Merchant status changed to ${newStatus}`, type: 'success' });
      refreshAll(false);
    } catch (err) {
      setToast({ msg: err.message || 'Failed to update merchant', type: 'error' });
    }
  };

  const handleLogout = () => {
    clearAuth();
    navigate('/login?logged_out=1');
  };

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'invoices', label: 'Invoices', icon: Receipt },
    { id: 'wallet', label: 'Merchant Ledger Wallet', icon: Wallet },
    { id: 'ledger', label: 'Ledger History', icon: History },
    { id: 'payment-links', label: 'Payment Links', icon: LinkIcon },
    { id: 'integration', label: 'API & Integration', icon: Code2 },
    { id: 'emails', label: 'Email Delivery Logs', icon: Mail },
    ...(isAdmin ? [
      { id: 'merchants', label: 'Merchants Management', icon: Users },
      { id: 'treasury', label: 'Central Wallet (Treasury)', icon: Landmark },
    ] : []),
    { id: 'settings', label: 'API & Settings', icon: Settings },
  ];

  // Helper for available balances lookup
  const balancesList = wallet?.balances || stats?.balances || [];
  const bnbBalance = balancesList.find((b) => b.symbol === 'BNB' || b.currency?.startsWith('BNB'))?.available;
  const usdtBalance = balancesList.find((b) => b.symbol === 'USDT' || b.currency?.startsWith('USDT'))?.available;

  // Generate Embed Snippet
  const origin = window.location.origin;
  const embedPayUrl = `${origin}/link/${embedData.code}`;
  const embedDisplayCurrency = embedData.currency ? embedData.currency.split('_')[0] : 'Crypto';
  const embedSnippet = `<!-- AnonyGateway Crypto Payment Button -->\n<a href="${embedPayUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#00f0ff,#00a3ff);color:#061520;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 4px 14px rgba(0,240,255,0.3);font-family:system-ui,sans-serif;">\n  ⚡ Pay ${embedData.amount || ''} ${embedDisplayCurrency} with Crypto\n</a>`;

  return (
    <div className="dashboard-container">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Mobile Sidebar Overlay */}
      <div
        className={`dashboard-sidebar-overlay ${mobileSidebarOpen ? 'open' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      {/* Mobile Top Header */}
      <div className="dashboard-mobile-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#00e5ff',
              padding: '7px 10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
            aria-label="Open Navigation Menu"
          >
            <Menu size={20} />
          </button>
          <BrandLogo to="/dashboard" size="xs" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="pulse-dot" />
          <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Mainnet 56</span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SIDEBAR                                                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      <aside className={`dashboard-sidebar ${mobileSidebarOpen ? 'open' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', padding: '6px 10px' }}>
          <BrandLogo to="/dashboard" size="md" />
          {mobileSidebarOpen && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '6px',
              }}
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileSidebarOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: active ? '1px solid rgba(0, 229, 255, 0.2)' : '1px solid transparent',
                  background: active ? 'var(--accent-cyan-dim)' : 'transparent',
                  color: active ? '#00e5ff' : 'var(--text-secondary)',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.18s ease',
                  fontFamily: 'inherit',
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer with Live Block Height */}
        <div style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', fontSize: '0.74rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span className="pulse-dot" />
            <span>BSC Mainnet (56)</span>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            Block: {networkStatus?.bsc?.blockNumber || networkStatus?.blockNumber || 'Syncing…'}
          </div>
        </div>
      </aside>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MAIN CONTENT AREA                                             */}
      {/* ───────────────────────────────────────────────────────────── */}
      <main className="dashboard-main">
        {/* Topbar Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', textTransform: 'capitalize' }}>
            {activeTab.replace('-', ' ')}
          </h1>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Live Sync 3s indicator */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                background: 'rgba(0, 229, 255, 0.08)',
                border: '1px solid rgba(0, 229, 255, 0.25)',
                borderRadius: '20px',
                fontSize: '0.76rem',
                fontWeight: 700,
                color: '#00e5ff',
              }}
            >
              <span className="pulse-dot" />
              <span>Live Sync (3s)</span>
            </div>

            <button
              type="button"
              onClick={() => refreshAll(false)}
              className="btn btn-secondary btn-sm"
              title="Manual Instant Sync"
            >
              <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
              <span>{isSyncing ? 'Syncing…' : 'Sync'}</span>
            </button>

            {/* Quick Sweep to Treasury button for Admin */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('treasury')}
                className="btn btn-secondary btn-sm"
                style={{ border: '1px solid rgba(245, 158, 11, 0.4)', color: '#fbbf24' }}
              >
                <Zap size={14} /> Sweep to Treasury
              </button>
            )}

            {/* User Profile Badge */}
            {user && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                }}
              >
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    background: isAdmin ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 229, 255, 0.15)',
                    color: isAdmin ? '#34d399' : '#00e5ff',
                    border: isAdmin ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(0, 229, 255, 0.3)',
                  }}
                >
                  {isAdmin ? 'Super Admin' : 'Merchant'}
                </span>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.businessName || user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign Out"
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <button
              type="button"
              onClick={() => setModalDepositOpen(true)}
              className="btn btn-secondary btn-sm"
            >
              <ArrowDownLeft size={14} /> Deposit Crypto
            </button>
            <button
              type="button"
              onClick={() => {
                if (user?.payoutAddress) setWithdrawAddress(user.payoutAddress);
                setModalWithdrawOpen(true);
              }}
              className="btn btn-secondary btn-sm"
            >
              <ArrowUpRight size={14} /> Withdraw
            </button>
            <button
              type="button"
              onClick={() => setModalInvoiceOpen(true)}
              className="btn btn-primary btn-sm"
            >
              <Plus size={15} /> New Invoice
            </button>
          </div>
        </header>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 1: OVERVIEW                                               */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div>
            {/* Metric Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="glass-card" style={{ padding: '22px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Total Invoices
                </span>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#fff', margin: '8px 0 2px' }}>
                  {stats?.totalInvoices ?? (invoices?.length || 0)}
                </div>
                <span style={{ fontSize: '0.78rem', color: '#10b981', fontWeight: 600 }}>
                  {stats?.confirmedInvoices ?? 0} Confirmed
                  {stats?.paidInvoices ? ` (${stats.paidInvoices} Confirming)` : ''}
                </span>
              </div>

              <div className="glass-card" style={{ padding: '22px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Pending Invoices
                </span>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#fbbf24', margin: '8px 0 2px' }}>
                  {stats?.pendingInvoices ?? 0}
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Awaiting on-chain deposits
                </span>
              </div>

              <div className="glass-card" style={{ padding: '22px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Wallet Balance (BNB)
                </span>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#00e5ff', margin: '8px 0 2px' }}>
                  {formatCrypto(bnbBalance)} BNB
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  BSC Mainnet Native Gas
                </span>
              </div>

              <div className="glass-card" style={{ padding: '22px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Wallet Balance (USDT)
                </span>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#10b981', margin: '8px 0 2px' }}>
                  {formatCrypto(usdtBalance)} USDT
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  BEP-20 Stablecoin Vault
                </span>
              </div>
            </div>

            {/* Recent Invoices Table Card */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 750, color: '#fff' }}>Recent Invoices</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Live on-chain settlements refreshed every 3 seconds
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('invoices')}
                  style={{ background: 'none', border: 'none', color: '#00e5ff', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  View all invoices →
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 14px' }}>Invoice ID</th>
                      <th style={{ padding: '10px 14px' }}>Amount</th>
                      <th style={{ padding: '10px 14px' }}>Network</th>
                      <th style={{ padding: '10px 14px' }}>Status</th>
                      <th style={{ padding: '10px 14px' }}>Deposit Address</th>
                      <th style={{ padding: '10px 14px' }}>Created</th>
                      <th style={{ padding: '10px 14px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!invoices || invoices.length === 0) ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          No invoices created yet. Click "+ New Invoice" to create one.
                        </td>
                      </tr>
                    ) : (
                      invoices.slice(0, 8).map((inv) => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <code style={{ color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>
                              {inv.id.slice(0, 8)}…
                            </code>
                            {inv.order_id && (
                              <div style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, marginTop: '2px' }}>
                                🏷️ {inv.order_id}
                              </div>
                            )}
                            {inv.customer_email && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }} title={inv.customer_email}>
                                📧 {inv.customer_email.slice(0, 16)}{inv.customer_email.length > 16 ? '…' : ''}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                            {inv.amount} {inv.symbol || inv.currency?.split('_')[0]}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {inv.currency?.split('_')[1] || 'BSC'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {inv.status === 'confirmed' && (
                              <span style={{ background: 'rgba(16, 185, 129, 0.18)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.35)', fontWeight: 700, padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem' }}>
                                ✓ Confirmed
                              </span>
                            )}
                            {inv.status === 'paid' && (
                              <span style={{ background: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.35)', fontWeight: 700, padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem' }}>
                                ⚡ Paid ({inv.confirmations || 1}/{inv.confirmations_required || 12})
                              </span>
                            )}
                            {inv.status === 'pending' && (
                              <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700 }}>
                                Pending
                              </span>
                            )}
                            {inv.status === 'expired' && (
                              <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700 }}>
                                Expired
                              </span>
                            )}
                            {inv.receipt_email_sent && (
                              <div style={{ fontSize: '0.72rem', color: '#34d399', marginTop: '2px', fontWeight: 600 }}>
                                ✓ Receipt Emailed
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                              {inv.address ? `${inv.address.slice(0, 6)}…${inv.address.slice(-4)}` : '—'}
                            </code>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            {formatDate(inv.created_at || inv.createdAt)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => copyText(`${window.location.origin}/pay?invoice=${inv.id}`, inv.id, 'Checkout URL copied!')}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                title="Copy Hosted Checkout URL"
                              >
                                {copiedKey === inv.id ? '✓ Copied' : '📋 Copy'}
                              </button>
                              <a
                                href={`/pay?invoice=${inv.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-primary btn-sm"
                                style={{ padding: '4px 8px', fontSize: '0.74rem', textDecoration: 'none' }}
                                title="Open Hosted Checkout"
                              >
                                Open ↗
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 2: INVOICES                                               */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'invoices' && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>All Payment Invoices</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Complete merchant invoice ledger and customer checkout statuses
                </p>
              </div>

              {/* Status Filter & Action */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={invoiceFilter}
                  onChange={(e) => setInvoiceFilter(e.target.value)}
                  className="form-input select-mini"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.82rem' }}
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid (Confirming)</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="expired">Expired</option>
                </select>
                <button
                  type="button"
                  onClick={() => setModalInvoiceOpen(true)}
                  className="btn btn-primary btn-sm"
                >
                  + Create Invoice
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 14px' }}>Invoice ID</th>
                    <th style={{ padding: '10px 14px' }}>Amount</th>
                    <th style={{ padding: '10px 14px' }}>Currency</th>
                    <th style={{ padding: '10px 14px' }}>Status</th>
                    <th style={{ padding: '10px 14px' }}>Deposit Address</th>
                    <th style={{ padding: '10px 14px' }}>Tx Hash</th>
                    <th style={{ padding: '10px 14px' }}>Created At</th>
                    <th style={{ padding: '10px 14px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(!invoices || invoices.length === 0) ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No invoices found for this criteria.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '12px 14px' }}>
                          <code style={{ color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>
                            {inv.id.slice(0, 8)}…
                          </code>
                          {inv.order_id && (
                            <div style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600, marginTop: '2px' }}>
                              🏷️ {inv.order_id}
                            </div>
                          )}
                          {inv.customer_email && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }} title={inv.customer_email}>
                              📧 {inv.customer_email.slice(0, 16)}{inv.customer_email.length > 16 ? '…' : ''}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                          <div>{inv.amount} {inv.symbol || inv.currency?.split('_')[0]}</div>
                          {inv.status === 'confirmed' && (
                            <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 500, marginTop: '2px' }}>
                              Net: {inv.net_amount || (Number(inv.amount) * 0.99).toFixed(4)} (1% fee: {inv.fee_amount || (Number(inv.amount) * 0.01).toFixed(4)})
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {inv.currency}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {inv.status === 'confirmed' && (
                            <span style={{ background: 'rgba(16, 185, 129, 0.18)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.35)', fontWeight: 700, padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem' }}>
                              ✓ Confirmed
                            </span>
                          )}
                          {inv.status === 'paid' && (
                            <span style={{ background: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.35)', fontWeight: 700, padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem' }}>
                              ⚡ Paid ({inv.confirmations || 1}/{inv.confirmations_required || 12})
                            </span>
                          )}
                          {inv.status === 'pending' && (
                            <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700 }}>
                              Pending
                            </span>
                          )}
                          {inv.status === 'expired' && (
                            <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700 }}>
                              Expired
                            </span>
                          )}
                          {inv.receipt_email_sent && (
                            <div style={{ fontSize: '0.72rem', color: '#34d399', marginTop: '2px', fontWeight: 600 }}>
                              ✓ Receipt Emailed
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {inv.address ? `${inv.address.slice(0, 6)}…${inv.address.slice(-4)}` : '—'}
                          </code>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {inv.txid ? (
                            inv.txid.startsWith('0x') ? (
                              <a href={getTxExplorerUrl(inv.txid, inv.currency)} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>
                                {inv.txid.slice(0, 10)}… ↗
                              </a>
                            ) : inv.txid.startsWith('onchain-') ? (
                              <a href={getAddressExplorerUrl(inv.address, inv.currency)} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }} title="View On-Chain on BscScan">
                                On-Chain BSC ↗
                              </a>
                            ) : (
                              <code>{inv.txid.slice(0, 10)}…</code>
                            )
                          ) : '—'}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                          {formatDate(inv.created_at || inv.createdAt)}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => copyText(`${window.location.origin}/pay?invoice=${inv.id}`, inv.id, 'Checkout URL copied!')}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                              title="Copy Hosted Checkout URL"
                            >
                              {copiedKey === inv.id ? '✓ Copied' : '📋 Copy'}
                            </button>
                            <a
                              href={`/pay?invoice=${inv.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-primary btn-sm"
                              style={{ padding: '4px 8px', fontSize: '0.74rem', textDecoration: 'none' }}
                              title="Open Hosted Checkout"
                            >
                              Open ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 3: MERCHANT LEDGER WALLET                                 */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'wallet' && (
          <div>
            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Merchant Treasury Wallet</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    Multi-currency balances, automated on-chain deposit monitoring &amp; real payout engine
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setModalTransferOpen(true)}
                    className="btn btn-secondary btn-sm"
                  >
                    ⇄ Internal Transfer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (user?.payoutAddress) setWithdrawAddress(user.payoutAddress);
                      setModalWithdrawOpen(true);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    ⬆ Withdraw to Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalDepositOpen(true)}
                    className="btn btn-primary btn-sm"
                  >
                    ⬇ Deposit Crypto
                  </button>
                </div>
              </div>

              {/* Wallet Balances Grid */}
              <div className="wallet-cards-grid">
                {(wallet?.balances || []).map((bal) => (
                  <div key={bal.currency} className="wallet-card">
                    <div>
                      <div className="wallet-card-header">
                        <span className="wallet-asset-title">{bal.name || bal.currency}</span>
                        <span className="wallet-chain-tag">{(bal.chain || 'BSC').toUpperCase()}</span>
                      </div>
                      <div className="wallet-balance-num">
                        {formatCrypto(bal.available)} <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>{bal.symbol}</span>
                      </div>
                      <div className="wallet-balance-sub">
                        Pending confirmations: {formatCrypto(bal.pending)} {bal.symbol}
                      </div>
                    </div>
                    <div className="wallet-card-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setDepositCurrency(bal.currency);
                          setModalDepositOpen(true);
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        ⬇ Deposit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawCurrency(bal.currency);
                          if (user?.payoutAddress) setWithdrawAddress(user.payoutAddress);
                          setModalWithdrawOpen(true);
                        }}
                        className="btn btn-primary btn-sm"
                      >
                        ⬆ Withdraw
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Personal Settlement / Payout Destination Card */}
              <div
                style={{
                  marginTop: '24px',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(6, 78, 59, 0.15))',
                  borderRadius: '14px',
                  padding: '22px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.4rem' }}>💼</span>
                  <h3 style={{ color: '#34d399', margin: 0, fontSize: '1.15rem' }}>My Personal Payout / Settlement Destination</h3>
                  <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', fontWeight: 700, fontSize: '0.72rem', padding: '3px 8px', borderRadius: '6px' }}>
                    Direct Funds Routing
                  </span>
                </div>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
                  Configure where your customer payments reach you. Enter your personal Binance, MetaMask, Trust Wallet, or cold storage address (BEP-20 EVM 0x...).
                </p>

                <form onSubmit={handleSavePayoutAddress} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem', display: 'block', marginBottom: '6px' }}>
                      Personal Receiving EVM Wallet Address (0x...)
                    </label>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="e.g. 0x71C... (Your Personal MetaMask / Binance / Trust Wallet Address)"
                        value={payoutAddressInput}
                        onChange={(e) => setPayoutAddressInput(e.target.value)}
                        className="form-input"
                        style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.88rem', minWidth: '280px' }}
                      />
                      <button type="submit" disabled={payoutSaving} className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                        {payoutSaving ? 'Saving…' : '💾 Save Payout Address'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.3)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <input
                      type="checkbox"
                      id="merchant-auto-forward"
                      checked={autoForwardCheck}
                      onChange={(e) => setAutoForwardCheck(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#00e5ff', cursor: 'pointer' }}
                    />
                    <label htmlFor="merchant-auto-forward" style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: '#e2e8f0', cursor: 'pointer' }}>
                      ⚡ <strong>Auto-Forward Payments:</strong> Automatically sweep every confirmed customer payment directly into my personal wallet address above.
                    </label>
                  </div>

                  <div style={{ fontSize: '0.84rem' }}>
                    {user?.payoutAddress ? (
                      <span style={{ color: '#34d399', fontWeight: 700 }}>
                        ✓ Active Settlement Destination: <code style={{ color: '#00f0ff' }}>{user.payoutAddress}</code> — On-chain payments automatically route to your personal wallet.
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        No personal settlement address saved yet. Save your address above so payments reach your personal wallet.
                      </span>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 4: LEDGER HISTORY                                         */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'ledger' && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
              Wallet Double-Entry Ledger
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Audit journal recording all on-chain deposits, withdrawals, invoice settlements, and transfers
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 14px' }}>Date &amp; Time</th>
                    <th style={{ padding: '10px 14px' }}>Type</th>
                    <th style={{ padding: '10px 14px' }}>Amount</th>
                    <th style={{ padding: '10px 14px' }}>Currency</th>
                    <th style={{ padding: '10px 14px' }}>Tx Hash / Reference</th>
                    <th style={{ padding: '10px 14px' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(!ledger || ledger.length === 0) ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No ledger transactions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    ledger.map((row, idx) => {
                      const isCredit = ['DEPOSIT', 'INVOICE_SETTLEMENT', 'REFUND', 'credit'].includes(row.type?.toUpperCase?.() || row.type);
                      const color = isCredit ? '#10b981' : '#ef4444';
                      const sign = isCredit ? '+' : '-';

                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {formatDate(row.created_at || row.createdAt)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 600 }}>
                              {row.type}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', color, fontWeight: 700 }}>
                            {sign}{formatCrypto(row.amount)}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {row.currency}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {row.txid ? (
                              row.txid.startsWith('onchain-') ? (
                                <a
                                  href="https://bscscan.com/address/0x7A2BA70d9B9fEFCb53aE08e09D359857Be0fc2c1"
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#00f0ff', textDecoration: 'underline' }}
                                >
                                  On-Chain Deposit (BscScan) ↗
                                </a>
                              ) : (
                                <a
                                  href={getTxExplorerUrl(row.txid, row.currency)}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#00f0ff' }}
                                >
                                  {row.txid.slice(0, 12)}… ↗
                                </a>
                              )
                            ) : row.destination_address ? (
                              <a
                                href={getAddressExplorerUrl(row.destination_address, row.currency)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#00f0ff' }}
                              >
                                {row.destination_address.slice(0, 8)}… ↗
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {row.note || row.description || '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 5: PAYMENT LINKS                                          */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'payment-links' && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Payment Links &amp; Embeds</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Shareable payment URLs for e-commerce checkout, donations, or SaaS invoices
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalPaymentLinkOpen(true)}
                className="btn btn-primary btn-sm"
              >
                + Create Payment Link
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 14px' }}>Title</th>
                    <th style={{ padding: '10px 14px' }}>Amount</th>
                    <th style={{ padding: '10px 14px' }}>Currency</th>
                    <th style={{ padding: '10px 14px' }}>Code</th>
                    <th style={{ padding: '10px 14px' }}>Link URL</th>
                    <th style={{ padding: '10px 14px' }}>Created</th>
                    <th style={{ padding: '10px 14px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(!paymentLinks || paymentLinks.length === 0) ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No payment links created yet. Click "+ Create Payment Link".
                      </td>
                    </tr>
                  ) : (
                    paymentLinks.map((link) => {
                      const payUrl = `${window.location.origin}/link/${link.code}`;
                      return (
                        <tr key={link.code} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                            {link.title || 'Untitled Checkout'}
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#10b981' }}>
                            {link.amount} {link.currency?.split('_')[0]}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {link.currency}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code style={{ color: '#00e5ff', fontFamily: 'JetBrains Mono, monospace' }}>
                              {link.code}
                            </code>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => copyText(payUrl, link.code, 'Payment link copied!')}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                              >
                                {copiedKey === link.code ? '✓ Copied' : '📋 Copy Link'}
                              </button>
                              <a
                                href={payUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '4px 8px', fontSize: '0.74rem', textDecoration: 'none' }}
                              >
                                Open ↗
                              </a>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            {formatDate(link.created_at || link.createdAt)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEmbedData({
                                  code: link.code,
                                  title: link.title || '',
                                  amount: link.amount || '',
                                  currency: link.currency || '',
                                });
                                setModalEmbedOpen(true);
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                            >
                              &lt;/&gt; Embed Code
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 6: API & DEVELOPER INTEGRATION                            */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'integration' && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Developer API &amp; Instant Integration</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Integrate real-time crypto payments into your checkout, SaaS, or app using your API Key
                </p>
              </div>
              <span style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', fontWeight: 700, padding: '6px 12px', borderRadius: '6px', fontSize: '0.8rem' }}>
                Live &amp; Fully Functional
              </span>
            </div>

            <div className="credentials-grid">
              <div className="cred-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="cred-card-title">Live Merchant API Key</span>
                  <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>PRODUCTION LIVE</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    readOnly
                    value={user?.apiKey || 'Auto-generating key...'}
                    className="form-input"
                    style={{ flex: 1, minWidth: '200px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="btn btn-secondary btn-sm"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(user?.apiKey, 'mchApiKey', 'Merchant API Key copied!')}
                    className="btn btn-primary btn-sm"
                  >
                    {copiedKey === 'mchApiKey' ? '✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateApiKey}
                    disabled={rotatingKey}
                    className="btn btn-secondary btn-sm"
                    title="Rotate and auto-generate new production API key"
                    style={{ borderColor: 'rgba(245, 158, 11, 0.6)', color: '#f59e0b' }}
                  >
                    {rotatingKey ? 'Generating...' : '⚡ Regenerate'}
                  </button>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  Pass as header: <code>X-API-Key: &lt;your_key&gt;</code> or <code>Authorization: Bearer &lt;key&gt;</code>
                </p>
              </div>

              <div className="cred-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="cred-card-title">Webhook Signing Secret</span>
                  <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>HMAC-SHA256</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    readOnly
                    value={user?.webhookSecret || 'Auto-generating secret...'}
                    className="form-input"
                    style={{ flex: 1, minWidth: '200px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                    className="btn btn-secondary btn-sm"
                  >
                    {showWebhookSecret ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(user?.webhookSecret, 'mchWhSec', 'Webhook Secret copied!')}
                    className="btn btn-primary btn-sm"
                  >
                    {copiedKey === 'mchWhSec' ? '✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateWebhookSecret}
                    disabled={rotatingSecret}
                    className="btn btn-secondary btn-sm"
                    title="Rotate and auto-generate new webhook secret"
                    style={{ borderColor: 'rgba(245, 158, 11, 0.6)', color: '#f59e0b' }}
                  >
                    {rotatingSecret ? 'Generating...' : '⚡ Regenerate'}
                  </button>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  Used to verify HMAC-SHA256 signatures on incoming payment webhooks.
                </p>
              </div>

              <div className="cred-card">
                <span className="cred-card-title">Account Identifiers</span>
                <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  <div>Merchant ID: <code style={{ color: '#00e5ff' }}>{user?.id || 'admin'}</code></div>
                  <div>Ledger Wallet: <code style={{ color: '#34d399' }}>{user?.walletId || 'super_admin_wallet'}</code></div>
                  <div>Status: <span className="status-active" style={{ fontSize: '0.7rem' }}>ACTIVE</span></div>
                </div>
              </div>
            </div>

            {/* Code Integration Snippets */}
            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h4 style={{ fontSize: '1rem', color: '#fff' }}>1. Create an Invoice &amp; Hosted Checkout (API Call)</h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div className="snippet-tabs" style={{ marginBottom: 0 }}>
                    <button
                      type="button"
                      onClick={() => setSnippetLang('curl')}
                      className={`snippet-tab-btn ${snippetLang === 'curl' ? 'active' : ''}`}
                    >
                      cURL
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnippetLang('node')}
                      className={`snippet-tab-btn ${snippetLang === 'node' ? 'active' : ''}`}
                    >
                      Node.js
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnippetLang('python')}
                      className={`snippet-tab-btn ${snippetLang === 'python' ? 'active' : ''}`}
                    >
                      Python
                    </button>
                  </div>
                </div>
              </div>

              <div className="code-snippet-box">
                {snippetLang === 'curl' && `# Create an on-chain BNB checkout invoice
curl -X POST ${window.location.origin}/v1/merchant/invoices \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${user?.apiKey || 'YOUR_MERCHANT_API_KEY'}" \\
  -d '{
    "currency": "BNB_BSC",
    "amount": "0.05",
    "expiresInMinutes": 30,
    "webhookUrl": "https://yoursite.com/api/crypto-webhook",
    "metadata": { "orderId": "ORD-9981", "customer": "alex@mail.com" }
  }'`}

                {snippetLang === 'node' && `// Node.js (Fetch) - Create invoice with email alerts & receipt
const res = await fetch('${window.location.origin}/v1/merchant/invoices', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${user?.apiKey || 'YOUR_MERCHANT_API_KEY'}',
  },
  body: JSON.stringify({
    currency: 'BNB_BSC',
    amount: '0.05',
    customerEmail: 'customer@example.com',
    customerName: 'Alex Rivera',
    orderId: 'ORD-9981',
    description: 'Premium Order',
    expiresInMinutes: 30,
    webhookUrl: 'https://yoursite.com/api/crypto-webhook'
  }),
});
const invoice = await res.json();
console.log('Customer Payment Address:', invoice.address);
console.log('Checkout URL: ${window.location.origin}/pay?invoice=' + invoice.id);`}

                {snippetLang === 'python' && `# Python (Requests) - Create invoice with email alerts & receipt
import requests

url = "${window.location.origin}/v1/merchant/invoices"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "${user?.apiKey || 'YOUR_MERCHANT_API_KEY'}"
}
payload = {
    "currency": "BNB_BSC",
    "amount": "0.05",
    "customerEmail": "customer@example.com",
    "customerName": "Alex Rivera",
    "orderId": "ORD-9981",
    "description": "Premium Order",
    "expiresInMinutes": 30,
    "webhookUrl": "https://yoursite.com/api/crypto-webhook"
}

response = requests.post(url, json=payload, headers=headers)
invoice = response.json()
print("Payment Address:", invoice["address"])
print("Checkout URL: ${window.location.origin}/pay?invoice=" + invoice["id"])`}
              </div>
            </div>

            {/* Webhook Verification Guide */}
            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ fontSize: '1rem', margin: 0, color: '#fff' }}>2. Webhook Verification (HMAC-SHA256)</h4>
                <button
                  type="button"
                  onClick={() => copyText(`import crypto from 'crypto';\n\napp.post('/api/crypto-webhook', express.raw({ type: 'application/json' }), (req, res) => {\n  const signature = req.headers['x-signature'];\n  const expected = crypto.createHmac('sha256', '${user?.webhookSecret || 'YOUR_WEBHOOK_SECRET'}').update(req.body).digest('hex');\n  if (signature !== expected) return res.status(401).send('Invalid signature');\n  const event = JSON.parse(req.body);\n  if (event.status === 'confirmed') {\n    console.log(\`Order \${event.metadata?.orderId} paid \${event.amount} \${event.currency}! Tx: \${event.txid}\`);\n  }\n  res.status(200).send('OK');\n});`, 'whSnippet', 'Webhook code copied!')}
                  className="btn btn-secondary btn-sm"
                >
                  📋 Copy
                </button>
              </div>
              <div className="code-snippet-box">
{`// Node.js Express example to verify and credit order
import crypto from 'crypto';

app.post('/api/crypto-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-signature'];
  const expected = crypto.createHmac('sha256', '${user?.webhookSecret || 'YOUR_WEBHOOK_SECRET'}')
    .update(req.body)
    .digest('hex');

  if (signature !== expected) return res.status(401).send('Invalid signature');
  const event = JSON.parse(req.body);

  if (event.status === 'confirmed') {
    // Deliver digital goods, grant access, or mark order fulfilled
    console.log(\`Order \${event.metadata?.orderId} paid \${event.amount} \${event.currency}! Tx: \${event.txid}\`);
  }
  res.status(200).send('OK');
});`}
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 7: EMAIL NOTIFICATIONS & AUDIT LOGS                       */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'emails' && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Automated Email Delivery Logs</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Audit trail of all automated payment alerts sent to business owners and official receipts delivered to customers
                </p>
              </div>
              <button
                type="button"
                onClick={() => refreshAll(false)}
                className="btn btn-secondary btn-sm"
              >
                🔄 Refresh Logs
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 14px' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px' }}>Recipient</th>
                    <th style={{ padding: '10px 14px' }}>Recipient Role</th>
                    <th style={{ padding: '10px 14px' }}>Template Type</th>
                    <th style={{ padding: '10px 14px' }}>Subject</th>
                    <th style={{ padding: '10px 14px' }}>Delivery Status</th>
                    <th style={{ padding: '10px 14px' }}>Invoice ID</th>
                  </tr>
                </thead>
                <tbody>
                  {(!emails || emails.length === 0) ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No email delivery records logged yet.
                      </td>
                    </tr>
                  ) : (
                    emails.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {formatDate(m.created_at || m.createdAt)}
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 600, color: '#fff' }}>
                          {m.recipient || m.to || '—'}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {m.recipient_type === 'merchant' ? (
                            <span style={{ background: 'rgba(37,99,235,0.2)', color: '#60a5fa', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}>
                              Merchant (Owner)
                            </span>
                          ) : (
                            <span style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}>
                              Customer (Payer)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code style={{ fontSize: '0.78rem' }}>{m.template}</code>
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {m.subject}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {m.status === 'sent' && (
                            <span className="status-active" style={{ fontSize: '0.72rem' }}>✓ Delivered (SMTP)</span>
                          )}
                          {m.status === 'simulated' && (
                            <span style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}>
                              ⚡ Simulated (Dev)
                            </span>
                          )}
                          {m.status !== 'sent' && m.status !== 'simulated' && (
                            <span className="status-suspended" style={{ fontSize: '0.72rem' }}>Failed</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {m.invoice_id ? (
                            <code style={{ color: '#00e5ff', fontSize: '0.78rem' }}>{m.invoice_id.slice(0, 8)}…</code>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 8: MERCHANTS MANAGEMENT (Super Admin Only)               */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'merchants' && isAdmin && (
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Merchants &amp; Business Accounts</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Manage registered merchant accounts, monitor business volumes, and configure access
                </p>
              </div>
              <button
                type="button"
                onClick={() => refreshAll(false)}
                className="btn btn-secondary btn-sm"
              >
                🔄 Refresh Merchants
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 14px' }}>Business Name</th>
                    <th style={{ padding: '10px 14px' }}>Email</th>
                    <th style={{ padding: '10px 14px' }}>Merchant ID</th>
                    <th style={{ padding: '10px 14px' }}>Wallet ID</th>
                    <th style={{ padding: '10px 14px' }}>Invoices (Total / Confirmed)</th>
                    <th style={{ padding: '10px 14px' }}>Status</th>
                    <th style={{ padding: '10px 14px' }}>Created</th>
                    <th style={{ padding: '10px 14px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(!merchants || merchants.length === 0) ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No registered merchants found.
                      </td>
                    </tr>
                  ) : (
                    merchants.map((m) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                          {m.business_name || m.businessName}
                          {m.role === 'admin' && (
                            <span style={{ background: '#00f0ff', color: '#000', fontSize: '0.65rem', marginLeft: '6px', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>
                              ADMIN
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {m.email}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code style={{ fontSize: '0.78rem' }}>{m.id}</code>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code style={{ fontSize: '0.78rem' }}>{m.wallet_id || m.walletId}</code>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <strong>{m.total_invoices || 0}</strong> total / <span style={{ color: '#10b981' }}>{m.confirmed_invoices || 0} confirmed</span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span className={m.status === 'suspended' ? 'status-suspended' : 'status-active'}>
                            {(m.status || 'active').toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                          {formatDate(m.created_at || m.createdAt)}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {m.role === 'admin' ? (
                            '—'
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleMerchantStatus(m.id, m.status || 'active')}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                            >
                              {m.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 9: CENTRAL WALLET / TREASURY (Super Admin Only)           */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'treasury' && isAdmin && (
          <div>
            {/* Master Vault Header Card */}
            <div
              className="glass-card"
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 78, 59, 0.2))',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '18px',
                padding: '26px',
                marginBottom: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '20px',
              }}
            >
              <div style={{ flex: 1, minWidth: '300px' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '20px' }}>
                    {treasury?.hasHotSigner ? '🟢 Hot Vault Active (Auto-Signing)' : '🟡 Watch-Only Vault (Manual Signing)'}
                  </span>
                  <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '20px' }}>
                    {treasury?.autoSweepEnabled !== false ? '⚡ Auto-Sweep ON' : '⏸ Auto-Sweep Paused'}
                  </span>
                </div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
                  Central Master Treasury Wallet
                </h2>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', maxWidth: '620px' }}>
                  The master on-chain vault for your payment gateway. Customer deposits across all derived invoice addresses are swept here into central custody.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Master Vault:</span>
                  <code style={{ fontSize: '0.84rem', color: '#00e5ff', fontFamily: 'JetBrains Mono, monospace' }}>
                    {treasury?.treasuryAddress || treasury?.masterAddress || 'Loading…'}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText(treasury?.treasuryAddress || treasury?.masterAddress, 'treasuryAddr', 'Central Treasury Address copied!')}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '3px 7px' }}
                  >
                    {copiedKey === 'treasuryAddr' ? '✓' : '📋 Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenTreasuryQr}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '3px 7px' }}
                  >
                    📱 QR
                  </button>
                  <a
                    href={`https://bscscan.com/address/${treasury?.treasuryAddress || treasury?.masterAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '3px 7px', textDecoration: 'none' }}
                  >
                    Explorer ↗
                  </a>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleTriggerSweepAll}
                  className="btn btn-primary"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#000', fontWeight: 800 }}
                >
                  <Zap size={16} /> Sweep All to Central Vault
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setModalTreasuryPayoutOpen(true)}
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                  >
                    ⬆ Cold Storage / Payout
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTsAutoSweep(treasury?.autoSweepEnabled !== false);
                      setTsColdStorage(treasury?.coldStorageAddress || '');
                      setModalTreasurySettingsOpen(true);
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                  >
                    ⚙️ Sweep Settings
                  </button>
                </div>
              </div>
            </div>

            {/* Pending Sweeps Alert Card */}
            <div className="unswept-alert-card">
              <div className="unswept-icon">⚡</div>
              <div className="unswept-info">
                <h4>
                  {treasury?.unsweptInvoices && treasury.unsweptInvoices.length > 0
                    ? `${treasury.unsweptInvoices.length} Confirmed Payments Ready to Sweep`
                    : 'All Payments Swept to Treasury Vault'}
                </h4>
                <p>
                  {treasury?.unsweptInvoices && treasury.unsweptInvoices.length > 0
                    ? `Total unswept: ${(treasury.unsweptSummary || []).map((s) => `${formatCrypto(s.total_amount)} ${s.currency}`).join(', ') || 'Funds awaiting transfer'} stored in child invoice addresses.`
                    : 'All customer invoice addresses have been consolidated into your central treasury vault.'}
                </p>
              </div>
              {treasury?.unsweptInvoices && treasury.unsweptInvoices.length > 0 && (
                <button
                  type="button"
                  onClick={handleTriggerSweepAll}
                  className="btn btn-primary btn-sm"
                  style={{ background: '#f59e0b', color: '#000', fontWeight: 800 }}
                >
                  Run Sweep Now
                </button>
              )}
            </div>

            {/* Live On-Chain Balances in Central Treasury */}
            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 750, color: '#fff' }}>Live On-Chain Treasury Balances</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Real-time balances fetched directly from blockchain RPC nodes (not simulated)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => refreshAll(false)}
                  className="btn btn-secondary btn-sm"
                >
                  🔄 Refresh On-Chain
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                {(treasury?.onChainBalances || []).map((bal) => (
                  <div key={bal.symbol} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 800, color: '#00e5ff' }}>{bal.symbol}</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                        {bal.chain?.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
                      {formatCrypto(bal.balance)} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{bal.symbol}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <span>{bal.name}</span>
                      {bal.explorerAddress && (
                        <a href={bal.explorerAddress} target="_blank" rel="noreferrer" style={{ color: '#00e5ff' }}>
                          ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confirmed Invoices Awaiting Sweep */}
            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 750, color: '#fff', marginBottom: '4px' }}>
                Confirmed Payments Awaiting Sweep
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
                Customer payments confirmed on derived child addresses ready to be forwarded to Central Treasury
              </p>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 14px' }}>Invoice ID</th>
                      <th style={{ padding: '10px 14px' }}>Amount</th>
                      <th style={{ padding: '10px 14px' }}>Currency</th>
                      <th style={{ padding: '10px 14px' }}>Child Deposit Address</th>
                      <th style={{ padding: '10px 14px' }}>Confirmed At</th>
                      <th style={{ padding: '10px 14px' }}>Sweep Status</th>
                      <th style={{ padding: '10px 14px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!treasury?.unsweptInvoices || treasury.unsweptInvoices.length === 0) ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '28px', textAlign: 'center', color: '#34d399', fontWeight: 600 }}>
                          ✓ All payments consolidated into Central Treasury. No pending sweeps!
                        </td>
                      </tr>
                    ) : (
                      treasury.unsweptInvoices.map((inv) => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <code style={{ color: '#38bdf8' }}>{inv.id.slice(0, 8)}…</code>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                            {formatCrypto(inv.amount)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="tag-currency">{inv.currency}</span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code>{inv.address ? `${inv.address.slice(0, 8)}…${inv.address.slice(-6)}` : '—'}</code>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {formatDate(inv.confirmed_at || inv.created_at)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="status-unswept">{inv.sweep_status || 'unswept'}</span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              type="button"
                              onClick={() => handleSweepSingle(inv.id)}
                              className="btn btn-primary btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                            >
                              ⚡ Sweep
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sweeps Audit History */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 750, color: '#fff', marginBottom: '4px' }}>
                Sweeps Audit Journal
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
                On-chain audit history of all sweep transactions from customer invoice addresses to Central Treasury
              </p>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 14px' }}>Date &amp; Time</th>
                      <th style={{ padding: '10px 14px' }}>Invoice</th>
                      <th style={{ padding: '10px 14px' }}>Amount</th>
                      <th style={{ padding: '10px 14px' }}>Currency</th>
                      <th style={{ padding: '10px 14px' }}>From</th>
                      <th style={{ padding: '10px 14px' }}>To</th>
                      <th style={{ padding: '10px 14px' }}>Status</th>
                      <th style={{ padding: '10px 14px' }}>Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!sweeps || sweeps.length === 0) ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          No sweep transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      sweeps.map((sw, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {formatDate(sw.created_at || sw.createdAt)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code>{sw.invoice_id ? sw.invoice_id.slice(0, 8) + '…' : 'Manual'}</code>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#fff' }}>
                            {formatCrypto(sw.amount)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="tag-currency">{sw.currency}</span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code>{sw.from_address ? sw.from_address.slice(0, 8) + '…' : '—'}</code>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <code>{sw.to_address ? sw.to_address.slice(0, 8) + '…' : '—'}</code>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="status-swept">{sw.status}</span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {sw.txid ? (
                              <a
                                href={getTxExplorerUrl(sw.txid, sw.currency)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#00e5ff' }}
                              >
                                {sw.txid.slice(0, 10)}… ↗
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 10: SETTINGS & API                                        */}
        {/* ───────────────────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>
                  Production API &amp; Webhook Credentials
                </h3>
                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>
                  256-BIT ENCRYPTED
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                High-entropy production keys for merchant backend authorization and webhook signature validation.
              </p>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Production API Key</label>
                  <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Header: X-API-Key</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    readOnly
                    value={user?.apiKey || 'Auto-generating key...'}
                    className="form-input"
                    style={{ flex: 1, minWidth: '200px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="btn btn-secondary btn-sm"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(user?.apiKey, 'apiKeySettings', 'API Key copied!')}
                    className="btn btn-primary btn-sm"
                  >
                    {copiedKey === 'apiKeySettings' ? '✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateApiKey}
                    disabled={rotatingKey}
                    className="btn btn-secondary btn-sm"
                    title="Auto-generate fresh production API key"
                    style={{ borderColor: 'rgba(245, 158, 11, 0.6)', color: '#f59e0b' }}
                  >
                    {rotatingKey ? 'Generating...' : '⚡ Regenerate'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Cryptographically secure 256-bit token. Keep confidential — never commit to public code repositories.
                </p>
              </div>

              <div className="form-group" style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Webhook HMAC Secret</label>
                  <span style={{ fontSize: '0.72rem', color: '#38bdf8' }}>Header: X-Signature</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    readOnly
                    value={user?.webhookSecret || 'Auto-generating secret...'}
                    className="form-input"
                    style={{ flex: 1, minWidth: '200px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                    className="btn btn-secondary btn-sm"
                  >
                    {showWebhookSecret ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(user?.webhookSecret, 'whSecSettings', 'Webhook Secret copied!')}
                    className="btn btn-primary btn-sm"
                  >
                    {copiedKey === 'whSecSettings' ? '✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateWebhookSecret}
                    disabled={rotatingSecret}
                    className="btn btn-secondary btn-sm"
                    title="Auto-generate fresh webhook signing secret"
                    style={{ borderColor: 'rgba(245, 158, 11, 0.6)', color: '#f59e0b' }}
                  >
                    {rotatingSecret ? 'Generating...' : '⚡ Regenerate'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Used to verify HMAC-SHA256 signatures on payment notification webhooks received by your server.
                </p>
              </div>

              <div className="form-group" style={{ marginTop: '16px' }}>
                <label className="form-label">API Gateway Base URL</label>
                <input
                  type="text"
                  readOnly
                  value={window.location.origin}
                  className="form-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                />
              </div>
            </div>

            <div className="glass-card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
                Active Blockchain RPC
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Live blockchain nodes connected to your payment gateway
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.86rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>BSC Network:</span>
                  <strong style={{ color: '#34d399' }}>Connected</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Chain ID:</span>
                  <strong style={{ color: '#fff' }}>{networkStatus?.bsc?.chainId || 56}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Current Block:</span>
                  <strong style={{ color: '#00e5ff', fontFamily: 'JetBrains Mono, monospace' }}>
                    {networkStatus?.bsc?.blockNumber || networkStatus?.blockNumber || 'Syncing…'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Gas Price:</span>
                  <strong style={{ color: '#fff' }}>{networkStatus?.bsc?.gasPriceGwei || '1.0'} Gwei</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Derivation Scheme:</span>
                  <strong style={{ color: '#cbd5e1' }}>BIP-44 (m/44'/60'/0'/0/x)</strong>
                </div>
              </div>
            </div>

            {/* Wallet Recovery Key Backup Card (Admin Only) */}
            {isAdmin && (
              <div className="glass-card" style={{ gridColumn: '1 / -1', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
                      Wallet Recovery Phrase &amp; Key Backup
                    </h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      View your master 12-word seed phrase or export the Central Treasury private key into Trust Wallet / MetaMask so you never lose funds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRevealBackup}
                    className="btn btn-secondary"
                    style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                  >
                    🔑 Reveal Seed Phrase &amp; Keys
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 1: CREATE INVOICE                                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalInvoiceOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Create New Invoice</h3>
              <button
                type="button"
                onClick={() => setModalInvoiceOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateInvoiceSubmit}>
              <div className="form-group">
                <label className="form-label">Cryptocurrency &amp; Network</label>
                <select
                  value={invoiceCurrency}
                  onChange={(e) => setInvoiceCurrency(e.target.value)}
                  className="form-input"
                  style={{ cursor: 'pointer' }}
                >
                  <option value="USDT_TRC20">USDT — TRON Network (TRC-20)</option>
                  <option value="BTC">BTC — Bitcoin (Native SegWit)</option>
                  <option value="USDT_BSC">USDT — BNB Smart Chain (BEP-20)</option>
                  <option value="BNB_BSC">BNB — BNB Smart Chain (Native)</option>
                  <option value="ETH_SEPOLIA">ETH — Sepolia Testnet (Native)</option>
                  <option value="USDT_SEPOLIA">USDT — Sepolia Testnet (ERC-20)</option>
                  <option value="MATIC_POLYGON">MATIC/POL — Polygon (Native)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 0.05 or 15.00"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Customer Email (for Receipt) 📧</label>
                  <input
                    type="email"
                    placeholder="customer@example.com"
                    value={invoiceEmail}
                    onChange={(e) => setInvoiceEmail(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Order Reference / ID 🏷️</label>
                  <input
                    type="text"
                    placeholder="e.g. ORD-8812"
                    value={invoiceOrderRef}
                    onChange={(e) => setInvoiceOrderRef(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Customer Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Alice Smith"
                    value={invoiceName}
                    onChange={(e) => setInvoiceName(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Item / Service Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Digital License"
                    value={invoiceDesc}
                    onChange={(e) => setInvoiceDesc(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(16, 185, 129, 0.08)', borderLeft: '3px solid #10b981', borderRadius: '6px', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '14px' }}>
                ⚡ <strong>Automatic Email Dispatch:</strong> When paid, the business owner receives an immediate payment alert, and the customer receives an official crypto receipt with blockchain transaction verification!
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(6, 182, 212, 0.08)', borderLeft: '3px solid #06B6D4', borderRadius: '6px', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '14px' }}>
                ℹ️ <strong>Transparent 1.0% Platform Fee:</strong> A flat 1% processing fee is automatically deducted upon on-chain confirmation (99% net proceeds settle directly into your merchant wallet).
              </div>

              <div className="form-group">
                <label className="form-label">Expiry in Minutes</label>
                <input
                  type="number"
                  min="5"
                  max="1440"
                  value={invoiceExpiry}
                  onChange={(e) => setInvoiceExpiry(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Merchant Webhook URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://your-store.com/webhook"
                  value={invoiceWebhook}
                  onChange={(e) => setInvoiceWebhook(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalInvoiceOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 2: DEPOSIT CRYPTO                                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalDepositOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Deposit Crypto to Wallet</h3>
              <button
                type="button"
                onClick={() => setModalDepositOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Select Asset</label>
              <select
                value={depositCurrency}
                onChange={(e) => {
                  setDepositCurrency(e.target.value);
                  loadDepositAddress(e.target.value);
                }}
                className="form-input"
              >
                <option value="USDT_TRC20">USDT (TRC-20 TRON)</option>
                <option value="BTC">BTC (Bitcoin Native)</option>
                <option value="BNB_BSC">BNB (BNB Smart Chain)</option>
                <option value="USDT_BSC">USDT (BEP-20)</option>
                <option value="ETH_SEPOLIA">ETH (Sepolia)</option>
                <option value="USDT_SEPOLIA">USDT (Sepolia)</option>
                <option value="MATIC_POLYGON">MATIC/POL (Polygon)</option>
              </select>
            </div>

            <div style={{ textAlign: 'center', margin: '20px 0' }}>
              <div
                style={{
                  width: '180px',
                  height: '180px',
                  margin: '0 auto 12px',
                  background: '#fff',
                  borderRadius: '12px',
                  padding: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {depositQrUrl ? (
                  <img src={depositQrUrl} alt="Deposit QR" style={{ width: '100%', height: '100%' }} />
                ) : (
                  <span style={{ color: '#000', fontSize: '0.8rem' }}>Generating QR…</span>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Deposit Address</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={depositAddress}
                  className="form-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem' }}
                />
                <button
                  type="button"
                  onClick={() => copyText(depositAddress, 'depositAddr', 'Deposit address copied!')}
                  className="btn btn-primary btn-sm"
                >
                  {copiedKey === 'depositAddr' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '12px' }}>
              Send funds to this address. The monitor automatically verifies incoming transactions and credits your wallet ledger.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
              <a
                href={getAddressExplorerUrl(depositAddress, depositCurrency)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
              >
                View on Explorer ↗
              </a>
              <button
                type="button"
                onClick={() => setModalDepositOpen(false)}
                className="btn btn-primary btn-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 3: WITHDRAW CRYPTO                                      */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalWithdrawOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Withdraw Crypto (Real On-Chain Payout)</h3>
              <button
                type="button"
                onClick={() => setModalWithdrawOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleWithdrawSubmit}>
              <div className="form-group">
                <label className="form-label">Asset to Withdraw</label>
                <select
                  value={withdrawCurrency}
                  onChange={(e) => setWithdrawCurrency(e.target.value)}
                  className="form-input"
                >
                  <option value="USDT_TRC20">USDT (TRC-20 TRON)</option>
                  <option value="BTC">BTC (Bitcoin Native)</option>
                  <option value="BNB_BSC">BNB (BNB Smart Chain)</option>
                  <option value="USDT_BSC">USDT (BEP-20)</option>
                  <option value="ETH_SEPOLIA">ETH (Sepolia)</option>
                  <option value="USDT_SEPOLIA">USDT (Sepolia)</option>
                  <option value="MATIC_POLYGON">MATIC/POL (Polygon)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Available Balance</label>
                <div className="avail-badge">
                  Available: {formatCrypto((wallet?.balances || []).find((b) => b.currency === withdrawCurrency)?.available)} {(wallet?.balances || []).find((b) => b.currency === withdrawCurrency)?.symbol || withdrawCurrency.split('_')[0]}
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Destination Address (0x...)</label>
                  {user?.payoutAddress && (
                    <button
                      type="button"
                      onClick={() => {
                        setWithdrawAddress(user.payoutAddress);
                        setToast({ msg: 'Pre-filled with your saved payout address! ✓', type: 'info' });
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 10px', fontSize: '0.76rem' }}
                    >
                      ⚡ Use My Saved Address
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="0x... (Your EVM wallet address)"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  className="form-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.84rem' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  type="text"
                  required
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Transfer Note</label>
                <input
                  type="text"
                  value={withdrawNote}
                  onChange={(e) => setWithdrawNote(e.target.value)}
                  className="form-input"
                />
              </div>

              {withdrawStatus && (
                <div
                  className={`alert-box ${withdrawStatus.type === 'error' ? 'alert-error' : withdrawStatus.type === 'success' ? 'alert-success' : ''}`}
                >
                  {withdrawStatus.isLiquidityNotice ? (
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '0.92rem' }}>⚠️ Treasury Hot Wallet Liquidity Notice</div>
                      <div style={{ fontSize: '0.82rem', lineHeight: 1.5, opacity: 0.95 }}>
                        {withdrawStatus.msg}<br /><br />
                        <strong>Why this happened:</strong> Real on-chain payouts are broadcast by the gateway's Central Treasury Hot Wallet. Your customer payment is safely on the invoice deposit address, which requires a small amount of BNB gas (~$0.05) to sweep.<br /><br />
                        <span style={{ color: '#34d399' }}>✓ Your available balance is 100% safe and refunded in your wallet.</span><br /><br />
                        <strong>To complete on-chain payouts:</strong> Fund the Central Treasury address with a tiny amount of BNB for network gas, or reveal your recovery keys in <strong>Settings → Key Backup</strong> to manage child address funds directly in Trust Wallet / MetaMask.
                      </div>
                    </div>
                  ) : (
                    <div>
                      {withdrawStatus.msg}
                      {withdrawStatus.explorerUrl && (
                        <div>
                          <a href={withdrawStatus.explorerUrl} target="_blank" rel="noreferrer" style={{ color: '#00f0ff', textDecoration: 'underline' }}>
                            View on Explorer ↗
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalWithdrawOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={withdrawLoading} className="btn btn-primary btn-sm">
                  {withdrawLoading ? 'Broadcasting…' : 'Broadcast Real Payout 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 4: INTERNAL TRANSFER                                    */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalTransferOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Instant Internal Transfer (0 Gas)</h3>
              <button
                type="button"
                onClick={() => setModalTransferOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit}>
              <div className="form-group">
                <label className="form-label">Asset</label>
                <select
                  value={transferCurrency}
                  onChange={(e) => setTransferCurrency(e.target.value)}
                  className="form-input"
                >
                  <option value="USDT_TRC20">USDT (TRC-20 TRON)</option>
                  <option value="BTC">BTC (Bitcoin Native)</option>
                  <option value="BNB_BSC">BNB (BNB Smart Chain)</option>
                  <option value="USDT_BSC">USDT (BEP-20)</option>
                  <option value="ETH_SEPOLIA">ETH (Sepolia)</option>
                  <option value="USDT_SEPOLIA">USDT (Sepolia)</option>
                  <option value="MATIC_POLYGON">MATIC/POL (Polygon)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Recipient Wallet ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. user_123 or merchant_partner"
                  value={transferWalletId}
                  onChange={(e) => setTransferWalletId(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  type="text"
                  required
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Note</label>
                <input
                  type="text"
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  className="form-input"
                />
              </div>

              {transferStatus && (
                <div className={`alert-box ${transferStatus.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                  {transferStatus.msg}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalTransferOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={transferLoading} className="btn btn-primary btn-sm">
                  {transferLoading ? 'Sending…' : 'Send Instant Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 5: CREATE PAYMENT LINK                                  */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalPaymentLinkOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Create Reusable Payment Link</h3>
              <button
                type="button"
                onClick={() => setModalPaymentLinkOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreatePaymentLinkSubmit}>
              <div className="form-group">
                <label className="form-label">Product / Item Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pro Monthly Subscription"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  placeholder="Brief details about the payment"
                  value={linkDesc}
                  onChange={(e) => setLinkDesc(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Currency</label>
                <select
                  value={linkCurrency}
                  onChange={(e) => setLinkCurrency(e.target.value)}
                  className="form-input"
                >
                  <option value="USDT_TRC20">USDT (TRC-20 TRON)</option>
                  <option value="BTC">BTC (Bitcoin Native)</option>
                  <option value="BNB_BSC">BNB (BNB Smart Chain)</option>
                  <option value="USDT_BSC">USDT (BEP-20)</option>
                  <option value="ETH_SEPOLIA">ETH (Sepolia)</option>
                  <option value="USDT_SEPOLIA">USDT (Sepolia)</option>
                  <option value="MATIC_POLYGON">MATIC/POL (Polygon)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 25.00"
                  value={linkAmount}
                  onChange={(e) => setLinkAmount(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Redirect URL after payment (Optional)</label>
                <input
                  type="url"
                  placeholder="https://yourstore.com/thankyou"
                  value={linkRedirect}
                  onChange={(e) => setLinkRedirect(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(6, 182, 212, 0.08)', borderLeft: '3px solid #06B6D4', borderRadius: '6px', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '14px' }}>
                ℹ️ <strong>Transparent 1.0% Platform Fee:</strong> A flat 1% processing fee is deducted upon confirmation. 99% net proceeds settle directly into your merchant wallet with zero chargebacks.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalPaymentLinkOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create Payment Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 6: EMBED CODE                                           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalEmbedOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Embed Payment Button</h3>
              <button
                type="button"
                onClick={() => setModalEmbedOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Copy and paste this HTML snippet directly into your website, blog, or Shopify / WordPress store to accept one-click crypto payments.
            </p>

            <div className="form-group">
              <label className="form-label">Live Button Preview</label>
              <div style={{ padding: '24px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <a
                  href={embedPayUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'linear-gradient(135deg,#00f0ff,#00a3ff)',
                    color: '#061520',
                    padding: '12px 22px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '15px',
                    textDecoration: 'none',
                    boxShadow: '0 4px 14px rgba(0,240,255,0.3)',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                >
                  ⚡ Pay {embedData.amount} {embedDisplayCurrency} with Crypto
                </a>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">HTML Embed Snippet</label>
              <textarea
                readOnly
                rows={5}
                value={embedSnippet}
                className="form-input"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', lineHeight: 1.5 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => copyText(embedSnippet, 'embedSnippet', 'Embed snippet copied!')}
                className="btn btn-primary btn-sm"
              >
                {copiedKey === 'embedSnippet' ? '✓ Copied' : '📋 Copy Embed Code'}
              </button>
              <button
                type="button"
                onClick={() => setModalEmbedOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 7: CENTRAL TREASURY PAYOUT                              */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalTreasuryPayoutOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Central Treasury On-Chain Payout</h3>
              <button
                type="button"
                onClick={() => setModalTreasuryPayoutOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleTreasuryPayoutSubmit}>
              <div className="form-group">
                <label className="form-label">Asset to Transfer</label>
                <select
                  value={tpCurrency}
                  onChange={(e) => setTpCurrency(e.target.value)}
                  className="form-input"
                >
                  <option value="USDT_TRC20">USDT (TRC-20 TRON)</option>
                  <option value="BTC">BTC (Bitcoin Native)</option>
                  <option value="BNB_BSC">BNB (BNB Smart Chain)</option>
                  <option value="USDT_BSC">USDT (BEP-20)</option>
                  <option value="ETH_SEPOLIA">ETH (Sepolia)</option>
                  <option value="USDT_SEPOLIA">USDT (Sepolia)</option>
                  <option value="MATIC_POLYGON">MATIC/POL (Polygon)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Recipient Address (Cold Storage / Exchange / Wallet)</label>
                <input
                  type="text"
                  required
                  placeholder="0x..."
                  value={tpAddress}
                  onChange={(e) => setTpAddress(e.target.value)}
                  className="form-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.84rem' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  type="text"
                  required
                  placeholder="0.00"
                  value={tpAmount}
                  onChange={(e) => setTpAmount(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Transfer Note / Memo</label>
                <input
                  type="text"
                  value={tpNote}
                  onChange={(e) => setTpNote(e.target.value)}
                  className="form-input"
                />
              </div>

              {tpStatus && (
                <div className={`alert-box ${tpStatus.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                  {tpStatus.msg}
                  {tpStatus.explorerUrl && (
                    <div>
                      <a href={tpStatus.explorerUrl} target="_blank" rel="noreferrer" style={{ color: '#00f0ff' }}>
                        View on Explorer ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalTreasuryPayoutOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={tpLoading} className="btn btn-primary btn-sm">
                  {tpLoading ? 'Broadcasting…' : 'Broadcast On-Chain 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 8: CENTRAL TREASURY SETTINGS                            */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalTreasurySettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Central Treasury &amp; Sweeper Configuration</h3>
              <button
                type="button"
                onClick={() => setModalTreasurySettingsOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleTreasurySettingsSubmit}>
              <div className="form-group">
                <label className="form-label">Auto-Sweep Incoming Payments</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    id="ts-auto-sweep"
                    checked={tsAutoSweep}
                    onChange={(e) => setTsAutoSweep(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: '#00e5ff' }}
                  />
                  <label htmlFor="ts-auto-sweep" style={{ fontWeight: 500, cursor: 'pointer', fontSize: '0.88rem' }}>
                    Automatically sweep confirmed payments from invoice addresses into Central Treasury
                  </label>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '14px' }}>
                <label className="form-label">Cold Storage Address (Optional Auto-Forwarding Destination)</label>
                <input
                  type="text"
                  placeholder="0x... (e.g. Hardware Wallet or Multisig)"
                  value={tsColdStorage}
                  onChange={(e) => setTsColdStorage(e.target.value)}
                  className="form-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.84rem' }}
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Destination address for cold storage sweeps and profits.
                </p>
              </div>

              {tsStatus && (
                <div className={`alert-box ${tsStatus.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                  {tsStatus.msg}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setModalTreasurySettingsOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 9: CENTRAL TREASURY QR CODE                             */}
      {modalTreasuryQrOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Central Master Treasury Address</h3>
              <button
                type="button"
                onClick={() => setModalTreasuryQrOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'inline-block', background: '#fff', padding: '12px', borderRadius: '12px', margin: '14px 0' }}>
              {treasuryQrDataUrl ? (
                <img src={treasuryQrDataUrl} alt="Treasury Address QR" style={{ width: '220px', height: '220px', display: 'block' }} />
              ) : (
                <span>Generating QR…</span>
              )}
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.84rem', margin: '10px 0 16px' }}>
              {treasury?.treasuryAddress || treasury?.masterAddress}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={() => copyText(treasury?.treasuryAddress || treasury?.masterAddress, 'trQrAddr', 'Central Treasury Address copied!')}
                className="btn btn-primary btn-sm"
              >
                {copiedKey === 'trQrAddr' ? '✓ Copied' : '📋 Copy Address'}
              </button>
              <button
                type="button"
                onClick={() => setModalTreasuryQrOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 10: WALLET RECOVERY PHRASE & KEYS BACKUP                */}
      {/* ───────────────────────────────────────────────────────────── */}
      {modalBackupOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Wallet Key Backup &amp; Recovery Phrase</h3>
              <button
                type="button"
                onClick={() => setModalBackupOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '12px 14px', background: 'rgba(239, 68, 68, 0.1)', borderLeft: '3px solid #ef4444', borderRadius: '6px', fontSize: '0.8rem', color: '#fca5a5', marginBottom: '16px' }}>
              ⚠️ <strong>CONFIDENTIAL SECURITY DATA:</strong> Never share these private keys or mnemonic phrase with anyone. Anyone with this phrase has full on-chain control of all merchant and treasury funds.
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0 }}>Master 12-Word BIP-39 Recovery Phrase</label>
                <button
                  type="button"
                  onClick={() => setShowSeedPhrase(!showSeedPhrase)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.74rem' }}
                >
                  {showSeedPhrase ? '🔒 Hide Seed Phrase' : '👁️ Reveal Seed Phrase'}
                </button>
              </div>
              <div
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  padding: '14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.88rem',
                  lineHeight: 1.6,
                  color: '#00e5ff',
                  filter: showSeedPhrase ? 'none' : 'blur(8px)',
                  userSelect: showSeedPhrase ? 'text' : 'none',
                  transition: 'filter 0.2s ease',
                }}
              >
                {backupData.mnemonic}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Central Master Treasury Address</label>
              <input
                type="text"
                readOnly
                value={backupData.treasuryAddress}
                className="form-input"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0 }}>Treasury Private Key (EVM Hex)</label>
                <button
                  type="button"
                  onClick={() => setShowBackupKey(!showBackupKey)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.74rem' }}
                >
                  {showBackupKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showBackupKey ? 'text' : 'password'}
                  readOnly
                  value={backupData.treasuryPrivateKey}
                  className="form-input"
                  style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem' }}
                />
                <button
                  type="button"
                  onClick={() => copyText(backupData.treasuryPrivateKey, 'privKey', 'Private Key copied!')}
                  className="btn btn-primary btn-sm"
                >
                  {copiedKey === 'privKey' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setModalBackupOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
