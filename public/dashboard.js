let authToken = localStorage.getItem('payrail_token') || '';
let currentUser = null;

function getAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) {
    h['Authorization'] = `Bearer ${authToken}`;
  }
  return h;
}

const headers = new Proxy({}, {
  get(target, prop) {
    const authH = getAuthHeaders();
    return authH[prop];
  },
  has(target, prop) {
    const authH = getAuthHeaders();
    return prop in authH;
  },
  ownKeys(target) {
    return Object.keys(getAuthHeaders());
  },
  getOwnPropertyDescriptor(target, prop) {
    return {
      enumerable: true,
      configurable: true,
      value: getAuthHeaders()[prop],
    };
  },
});

let currentBalances = [];
let allInvoices = [];

// Smart Crypto Amount Formatter - preserves micro amounts like 0.00006365 without rounding to 0
function formatCrypto(val, maxDecimals = 8) {
  if (val === null || val === undefined || val === '' || val === '0' || val === '0.0') return '0.00';
  const num = Number(val);
  if (isNaN(num) || num === 0) return '0.00';
  if (num < 0.0001) {
    // Show exact non-zero precision for micro-amounts (e.g. 0.00006365534)
    return String(val);
  }
  if (num < 1) {
    return num.toFixed(6).replace(/\.?0+$/, '');
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// Explorer URL Helpers based on network mode
function getTxExplorerUrl(txid, currency = 'BNB_BSC') {
  if (!txid) return '#';
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
  if (currency && currency.includes('SEPOLIA')) {
    return `https://sepolia.etherscan.io/address/${address}`;
  }
  if (currency && currency.includes('POLYGON')) {
    return `https://polygonscan.com/address/${address}`;
  }
  return `https://bscscan.com/address/${address}`;
}

// Modern Floating Toast Notification
window.showToast = function(msg = 'Copied to clipboard! ✓', type = 'success') {
  const toast = document.getElementById('dashboard-toast');
  const toastMsg = document.getElementById('dashboard-toast-msg');
  if (!toast) return;
  if (toastMsg) toastMsg.textContent = msg;

  if (type === 'error') {
    toast.style.background = 'rgba(239, 68, 68, 0.95)';
    toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(239, 68, 68, 0.4)';
  } else if (type === 'info') {
    toast.style.background = 'rgba(59, 130, 246, 0.95)';
    toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(59, 130, 246, 0.4)';
  } else {
    toast.style.background = 'rgba(16, 185, 129, 0.95)';
    toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(16, 185, 129, 0.3)';
  }

  toast.classList.add('show');
  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
};

// Universal Bulletproof Clipboard Copy with Automatic Fallback & Visual Feedback
window.copyToClipboard = async function(text, triggerEl = null, toastMsg = 'Copied to clipboard! ✓') {
  if (!text) return false;
  let success = false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch (err) {
      console.warn('navigator.clipboard failed, using fallback:', err);
    }
  }

  if (!success) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      success = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      console.error('execCommand copy failed:', err);
    }
  }

  // Visual button feedback
  if (triggerEl) {
    const originalHtml = triggerEl.innerHTML;
    triggerEl.classList.add('btn-copied');
    triggerEl.innerHTML = '✓ Copied!';
    setTimeout(() => {
      triggerEl.classList.remove('btn-copied');
      triggerEl.innerHTML = originalHtml;
    }, 1800);
  }

  showToast(toastMsg);
  return success;
};

window.copyText = (text, btn) => window.copyToClipboard(text, btn);

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const pageTitle = document.getElementById('page-title');

// Tab Navigation
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const tabName = item.dataset.tab;
    navItems.forEach(i => i.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    item.classList.add('active');
    const targetPane = document.getElementById(`tab-${tabName}`);
    if (targetPane) targetPane.classList.add('active');
    pageTitle.textContent = item.textContent.trim();

    if (tabName === 'emails') loadEmailLogs();
    if (tabName === 'merchants') loadMerchantsList();
    if (tabName === 'invoices') loadInvoices();
  });
});

// Modal Management
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'grid';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.close);
  });
});

// Quick Action Buttons
document.getElementById('btn-create-invoice').addEventListener('click', () => openModal('modal-invoice'));
document.getElementById('btn-new-invoice-2')?.addEventListener('click', () => openModal('modal-invoice'));
document.getElementById('btn-quick-deposit').addEventListener('click', () => {
  openModal('modal-deposit');
  loadDepositAddress();
});
document.getElementById('btn-wallet-deposit')?.addEventListener('click', () => {
  openModal('modal-deposit');
  loadDepositAddress();
});
document.getElementById('btn-quick-withdraw')?.addEventListener('click', () => {
  if (currentUser && currentUser.payoutAddress) {
    const addrField = document.getElementById('withdraw-to-address');
    if (addrField) addrField.value = currentUser.payoutAddress;
  }
  openModal('modal-withdraw');
  updateWithdrawAvailableBal();
});
document.getElementById('btn-wallet-withdraw')?.addEventListener('click', () => {
  if (currentUser && currentUser.payoutAddress) {
    const addrField = document.getElementById('withdraw-to-address');
    if (addrField) addrField.value = currentUser.payoutAddress;
  }
  openModal('modal-withdraw');
  updateWithdrawAvailableBal();
});
document.getElementById('btn-wallet-transfer')?.addEventListener('click', () => openModal('modal-transfer'));
document.getElementById('btn-new-payment-link')?.addEventListener('click', () => openModal('modal-payment-link'));
document.getElementById('view-all-invoices')?.addEventListener('click', () => {
  document.querySelector('[data-tab="invoices"]').click();
});

// Load Overview & Stats
async function loadOverview() {
  try {
    const res = await fetch('/admin/stats', { headers });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('metric-total-invoices').textContent = data.stats.totalInvoices;
    const paidSuffix = data.stats.paidInvoices ? ` (${data.stats.paidInvoices} Confirming)` : '';
    document.getElementById('metric-confirmed-invoices').textContent = `${data.stats.confirmedInvoices} Confirmed${paidSuffix}`;
    document.getElementById('metric-pending-invoices').textContent = data.stats.pendingInvoices;

    currentBalances = data.balances;
    const bnb = data.balances.find(b => b.symbol === 'BNB');
    if (bnb) document.getElementById('metric-bnb-balance').textContent = `${formatCrypto(bnb.available)} BNB`;

    const usdt = data.balances.find(b => b.symbol === 'USDT');
    if (usdt) document.getElementById('metric-usdt-balance').textContent = `${formatCrypto(usdt.available)} USDT`;
  } catch (err) {
    console.error('Stats error:', err);
  }
}

// Load Invoices
async function loadInvoices() {
  try {
    const filter = document.getElementById('invoice-filter-status')?.value || '';
    const url = filter ? `/admin/invoices?status=${encodeURIComponent(filter)}` : '/admin/invoices';
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const data = await res.json();
    allInvoices = data.invoices;

    renderInvoicesTable('invoices-table-body', data.invoices);
    renderInvoicesTable('overview-invoices-body', data.invoices.slice(0, 5), true);
  } catch (err) {
    console.error('Invoices error:', err);
  }
}

function renderInvoicesTable(tbodyId, invoices, isOverview = false) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="${isOverview ? 7 : 8}" class="empty-td" style="text-align:center; padding: 24px; color: #64748b;">No invoices created yet. Click "+ New Invoice" to create one.</td></tr>`;
    return;
  }

  tbody.innerHTML = invoices.map(inv => {
    const date = new Date(inv.created_at).toLocaleString();
    const shortId = inv.id.slice(0, 8);
    const shortAddr = `${inv.address.slice(0, 6)}…${inv.address.slice(-4)}`;
    const checkoutUrl = `/pay?invoice=${inv.id}`;

    let badgeHtml = `<span class="badge badge-${inv.status}">${inv.status}</span>`;
    if (inv.status === 'confirmed') {
      badgeHtml = `<span class="badge badge-confirmed" style="background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700;">✓ Confirmed</span>`;
    } else if (inv.status === 'paid') {
      const conf = inv.confirmations || 1;
      const req = inv.confirmations_required || 12;
      badgeHtml = `<span class="badge badge-paid" style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700;">⚡ Paid (${conf}/${req})</span>`;
    } else if (inv.status === 'pending') {
      badgeHtml = `<span class="badge badge-pending">Pending</span>`;
    } else if (inv.status === 'expired') {
      badgeHtml = `<span class="badge badge-expired" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Expired</span>`;
    }

    let txDisplay = '—';
    if (inv.txid) {
      if (inv.txid.startsWith('0x')) {
        txDisplay = `<a href="${getTxExplorerUrl(inv.txid, inv.currency)}" target="_blank" style="color: #38bdf8;">${inv.txid.slice(0, 10)}… ↗</a>`;
      } else if (inv.txid.startsWith('onchain-')) {
        txDisplay = `<a href="${getAddressExplorerUrl(inv.address, inv.currency)}" target="_blank" style="color: #38bdf8;" title="View On-Chain on BscScan">On-Chain BSC ↗</a>`;
      } else {
        txDisplay = `<code>${inv.txid.slice(0, 10)}…</code>`;
      }
    }

    return `
      <tr>
        <td>
          <code title="${inv.id}">${shortId}</code>
          ${inv.order_id ? `<div style="font-size:0.75rem; color:#38bdf8; font-weight:600;">🏷️ ${inv.order_id}</div>` : ''}
          ${inv.customer_email ? `<div style="font-size:0.75rem; color:#94a3b8;" title="${inv.customer_email}">📧 ${inv.customer_email.slice(0, 16)}${inv.customer_email.length > 16 ? '…' : ''}</div>` : ''}
        </td>
        <td><strong>${inv.amount} ${inv.currency.split('_')[0]}</strong></td>
        ${isOverview ? `<td>${inv.currency.split('_')[1] || 'EVM'}</td>` : `<td>${inv.currency}</td>`}
        <td>
          ${badgeHtml}
          ${inv.receipt_email_sent ? '<div style="font-size:0.72rem; color:#34d399; margin-top:2px;">✓ Receipt Emailed</div>' : ''}
        </td>
        <td><code title="${inv.address}">${shortAddr}</code></td>
        ${!isOverview ? `<td>${txDisplay}</td>` : ''}
        <td>${date}</td>
        <td>
          <div style="display:inline-flex; gap:6px; align-items:center;">
            <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('${window.location.origin}${checkoutUrl}', this, 'Checkout link copied!')" title="Copy Hosted Checkout URL">📋 Copy</button>
            <a class="btn btn-primary btn-sm" href="${checkoutUrl}" target="_blank" style="text-decoration:none;" title="Open Hosted Checkout">Open ↗</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('invoice-filter-status')?.addEventListener('change', loadInvoices);

// Load Wallet Balances & Cards
async function loadWalletBalances() {
  try {
    const res = await fetch('/admin/wallet', { headers });
    if (!res.ok) return;
    const data = await res.json();
    currentBalances = data.balances;

    const grid = document.getElementById('wallet-cards-grid');
    if (!grid) return;

    grid.innerHTML = data.balances.map(bal => `
      <div class="wallet-card">
        <div>
          <div class="wallet-card-header">
            <span class="wallet-asset-title">${bal.name}</span>
            <span class="wallet-chain-tag">${bal.chain.toUpperCase()}</span>
          </div>
          <div class="wallet-balance-num">${formatCrypto(bal.available)} <span style="font-size: 1.1rem; color: #94a3b8;">${bal.symbol}</span></div>
          <div class="wallet-balance-sub">Pending confirmations: ${formatCrypto(bal.pending)} ${bal.symbol}</div>
        </div>
        <div class="wallet-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="openDepositFor('${bal.currency}')">⬇ Deposit</button>
          <button class="btn btn-primary btn-sm" onclick="openWithdrawFor('${bal.currency}')">⬆ Withdraw</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Wallet error:', err);
  }
}

// Deposit flow
window.openDepositFor = (currency) => {
  document.getElementById('deposit-currency-select').value = currency;
  openModal('modal-deposit');
  loadDepositAddress();
};

async function loadDepositAddress() {
  const currency = document.getElementById('deposit-currency-select').value;
  try {
    const res = await fetch(`/admin/wallet/deposit-address?currency=${encodeURIComponent(currency)}`, { headers });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('deposit-address-input').value = data.address;
    document.getElementById('deposit-qr-img').src = data.qrDataUrl;
    document.getElementById('deposit-explorer-link').href = data.explorerAddress;
  } catch (err) {
    console.error('Deposit addr error:', err);
  }
}

document.getElementById('deposit-currency-select')?.addEventListener('change', loadDepositAddress);
document.getElementById('btn-copy-deposit-addr')?.addEventListener('click', function() {
  const addr = document.getElementById('deposit-address-input').value;
  copyToClipboard(addr, this, 'Deposit address copied!');
});

// Withdraw flow
window.openWithdrawFor = (currency) => {
  document.getElementById('withdraw-currency').value = currency;
  if (currentUser && currentUser.payoutAddress) {
    const addrField = document.getElementById('withdraw-to-address');
    if (addrField) addrField.value = currentUser.payoutAddress;
  }
  openModal('modal-withdraw');
  updateWithdrawAvailableBal();
};

function updateWithdrawAvailableBal() {
  const currency = document.getElementById('withdraw-currency').value;
  const bal = currentBalances.find(b => b.currency === currency);
  const display = bal ? `${bal.available} ${bal.symbol}` : '0.00';
  document.getElementById('withdraw-avail-bal').textContent = `Available: ${display}`;
}

document.getElementById('withdraw-currency')?.addEventListener('change', updateWithdrawAvailableBal);

document.getElementById('form-withdraw')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('withdraw-status');
  const submitBtn = document.getElementById('btn-submit-withdraw');
  statusEl.style.display = 'block';
  statusEl.className = 'alert-box';
  statusEl.textContent = 'Signing and broadcasting real on-chain transaction…';
  submitBtn.disabled = true;

  try {
    const body = {
      currency: document.getElementById('withdraw-currency').value,
      toAddress: document.getElementById('withdraw-to-address').value.trim(),
      amount: document.getElementById('withdraw-amount').value.trim(),
      note: document.getElementById('withdraw-note').value.trim(),
    };

    const res = await fetch('/admin/wallet/withdraw', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Withdrawal failed');

    statusEl.className = 'alert-box alert-success';
    statusEl.innerHTML = `Transaction Broadcasted! TxID: <a href="${data.explorerUrl}" target="_blank" style="color: #00f0ff;">${data.txid.slice(0, 16)}… ↗</a>`;
    loadWalletBalances();
    loadLedger();
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    if (err.message.includes('insufficient token balance') || err.message.includes('insufficient native balance')) {
      statusEl.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 6px; font-size: 0.92rem;">⚠️ Treasury Hot Wallet Liquidity Notice</div>
        <div style="font-size: 0.82rem; line-height: 1.5; opacity: 0.95;">
          ${err.message}<br><br>
          <strong>Why this happened:</strong> Real on-chain payouts are broadcast by the gateway's Central Treasury Hot Wallet (<code>0xB829...</code>). Your customer payment is safely on the invoice deposit address (<code>0x805f...</code> on BscScan), which requires a small amount of BNB gas (~$0.05) to sweep.<br><br>
          <span style="color: #34d399;">✓ Your 0.01 USDT available balance is 100% safe and refunded in your wallet.</span><br><br>
          <strong>To complete on-chain payouts:</strong> Fund the Central Treasury address with a tiny amount of BNB for network gas, or reveal your recovery keys in <strong>Settings → Key Backup</strong> to manage child address funds directly in Trust Wallet / MetaMask.
        </div>
      `;
    } else {
      statusEl.textContent = `Error: ${err.message}`;
    }
  } finally {
    submitBtn.disabled = false;
  }
});

// Internal Transfer flow
document.getElementById('form-transfer')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('transfer-status');
  const submitBtn = document.getElementById('btn-submit-transfer');
  statusEl.style.display = 'block';
  statusEl.textContent = 'Processing instant transfer…';
  submitBtn.disabled = true;

  try {
    const body = {
      currency: document.getElementById('transfer-currency').value,
      toWalletId: document.getElementById('transfer-to-wallet').value.trim(),
      amount: document.getElementById('transfer-amount').value.trim(),
      note: document.getElementById('transfer-note').value.trim(),
    };

    const res = await fetch('/admin/wallet/transfer', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transfer failed');

    statusEl.className = 'alert-box alert-success';
    statusEl.textContent = `Transfer Successful: Sent ${data.amount} ${data.currency} to ${data.toWalletId}`;
    loadWalletBalances();
    loadLedger();
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

// Load Ledger History
async function loadLedger() {
  try {
    const res = await fetch('/admin/wallet/ledger', { headers });
    if (!res.ok) return;
    const data = await res.json();

    const tbody = document.getElementById('ledger-table-body');
    if (!tbody) return;

    if (!data.history.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #64748b;">No ledger transactions yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.history.map(row => {
      const date = new Date(row.created_at).toLocaleString();
      const isCredit = ['DEPOSIT', 'INVOICE_SETTLEMENT', 'REFUND'].includes(row.type);
      const color = isCredit ? '#10b981' : '#ef4444';
      const sign = isCredit ? '+' : '-';
      let txidDisplay = '—';
      if (row.txid) {
        if (row.txid.startsWith('onchain-')) {
          txidDisplay = `<a href="https://bscscan.com/address/0x7A2BA70d9B9fEFCb53aE08e09D359857Be0fc2c1" target="_blank" style="color: #00f0ff; text-decoration: underline;">On-Chain Deposit (BscScan) ↗</a>`;
        } else {
          txidDisplay = `<a href="${getTxExplorerUrl(row.txid, row.currency)}" target="_blank" style="color: #00f0ff;">${row.txid.slice(0, 12)}… ↗</a>`;
        }
      } else if (row.destination_address) {
        txidDisplay = `<a href="${getAddressExplorerUrl(row.destination_address, row.currency)}" target="_blank">${row.destination_address.slice(0, 8)}… ↗</a>`;
      }

      return `
        <tr>
          <td>${date}</td>
          <td><span class="badge" style="background: rgba(255,255,255,0.06);">${row.type}</span></td>
          <td style="color: ${color}; font-weight: 700;">${sign}${formatCrypto(row.amount)}</td>
          <td>${row.currency}</td>
          <td><code>${txidDisplay}</code></td>
          <td style="color: #94a3b8;">${row.note || '—'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Ledger error:', err);
  }
}

// Payment Links
async function loadPaymentLinks() {
  try {
    const res = await fetch('/admin/payment-links', { headers });
    if (!res.ok) return;
    const data = await res.json();

    const tbody = document.getElementById('payment-links-body');
    if (!tbody) return;

    if (!data.links.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: #64748b;">No payment links created yet. Click "+ Create Payment Link".</td></tr>`;
      return;
    }

    tbody.innerHTML = data.links.map(link => {
      const date = new Date(link.created_at).toLocaleDateString();
      const origin = window.location.origin;
      const payUrl = `${origin}/link/${link.code}`;
      const safeTitle = (link.title || '').replace(/'/g, "\\'");

      return `
        <tr>
          <td><strong>${link.title}</strong></td>
          <td>${link.amount} ${link.currency.split('_')[0]}</td>
          <td>${link.currency}</td>
          <td><code>${link.code}</code></td>
          <td>
            <div style="display:inline-flex; gap:6px; align-items:center;">
              <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('${payUrl}', this, 'Payment link copied!')">📋 Copy Link</button>
              <a class="btn btn-text btn-sm" href="${payUrl}" target="_blank" style="text-decoration:none;">Open ↗</a>
            </div>
          </td>
          <td>${date}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="openEmbedModal('${link.code}', '${safeTitle}', '${link.amount}', '${link.currency}')">&lt;/&gt; Embed Code</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Payment links error:', err);
  }
}

document.getElementById('form-payment-link')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = {
      title: document.getElementById('pl-title').value.trim(),
      description: document.getElementById('pl-desc').value.trim(),
      currency: document.getElementById('pl-currency').value,
      amount: document.getElementById('pl-amount').value.trim(),
      redirectUrl: document.getElementById('pl-redirect').value.trim(),
    };

    const res = await fetch('/admin/payment-links', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      closeModal('modal-payment-link');
      document.getElementById('form-payment-link').reset();
      loadPaymentLinks();
    }
  } catch (err) {
    console.error('Error creating payment link:', err);
  }
});

window.openEmbedModal = (code, title, amount, currency) => {
  const origin = window.location.origin;
  const payUrl = `${origin}/link/${code}`;
  const displayCurrency = currency ? currency.split('_')[0] : 'Crypto';
  const displayAmount = amount || '';
  const snippet = `<!-- Payrail Crypto Payment Button -->\n<a href="${payUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#00f0ff,#00a3ff);color:#061520;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 4px 14px rgba(0,240,255,0.3);font-family:system-ui,sans-serif;">\n  ⚡ Pay ${displayAmount} ${displayCurrency} with Crypto\n</a>`;

  const previewEl = document.getElementById('modal-embed-preview');
  if (previewEl) {
    previewEl.innerHTML = `<a href="${payUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#00f0ff,#00a3ff);color:#061520;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 4px 14px rgba(0,240,255,0.3);font-family:system-ui,sans-serif;pointer-events:none;">⚡ Pay ${displayAmount} ${displayCurrency} with Crypto</a>`;
  }

  const snippetBox = document.getElementById('modal-embed-snippet-text');
  if (snippetBox) {
    snippetBox.textContent = snippet;
  }

  const copyBtn1 = document.getElementById('btn-copy-embed-code');
  if (copyBtn1) {
    copyBtn1.onclick = function() { copyToClipboard(snippet, this, 'Embed snippet copied!'); };
  }
  const copyBtn2 = document.getElementById('btn-copy-embed-code-footer');
  if (copyBtn2) {
    copyBtn2.onclick = function() { copyToClipboard(snippet, this, 'Embed snippet copied!'); };
  }

  openModal('modal-embed-code');
};

window.embedSnippet = (code, title, amount, currency) => {
  openEmbedModal(code, title, amount, currency);
};

// Create Invoice Form
document.getElementById('form-create-invoice')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-invoice');
  submitBtn.disabled = true;

  try {
    const body = {
      currency: document.getElementById('inv-currency').value,
      amount: document.getElementById('inv-amount').value.trim(),
      customerEmail: document.getElementById('inv-customer-email')?.value.trim() || undefined,
      orderId: document.getElementById('inv-order-id')?.value.trim() || undefined,
      customerName: document.getElementById('inv-customer-name')?.value.trim() || undefined,
      description: document.getElementById('inv-description')?.value.trim() || undefined,
      expiresInMinutes: parseInt(document.getElementById('inv-expiry').value, 10),
      webhookUrl: document.getElementById('inv-webhook').value.trim() || undefined,
    };

    const res = await fetch('/admin/invoices', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invoice creation failed');

    closeModal('modal-invoice');
    document.getElementById('form-create-invoice').reset();
    loadInvoices();
    loadOverview();

    // Show sleek success modal instead of native browser confirm()
    const payUrl = `${window.location.origin}/pay?invoice=${data.id}`;
    const amountEl = document.getElementById('new-inv-amount');
    if (amountEl) amountEl.textContent = `${data.amount} ${data.currency.split('_')[0]}`;
    const urlEl = document.getElementById('new-inv-url');
    if (urlEl) urlEl.value = payUrl;
    const addrEl = document.getElementById('new-inv-addr');
    if (addrEl) addrEl.value = data.address;

    const copyUrlBtn = document.getElementById('btn-copy-new-inv-url');
    if (copyUrlBtn) {
      copyUrlBtn.onclick = function() { copyToClipboard(payUrl, this, 'Checkout URL copied!'); };
    }
    const copyAddrBtn = document.getElementById('btn-copy-new-inv-addr');
    if (copyAddrBtn) {
      copyAddrBtn.onclick = function() { copyToClipboard(data.address, this, 'Deposit address copied!'); };
    }
    const openBtn = document.getElementById('btn-open-new-inv-checkout');
    if (openBtn) {
      openBtn.onclick = function() { window.open(payUrl, '_blank'); };
    }

    openModal('modal-invoice-success');
  } catch (err) {
    showToast(`Failed to create invoice: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// Network Status
async function loadNetworkStatus() {
  try {
    const res = await fetch('/admin/network-status', { headers });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('current-block-height').textContent = data.bsc.blockNumber;
    if (document.getElementById('rpc-block-num')) document.getElementById('rpc-block-num').textContent = data.bsc.blockNumber;
    if (document.getElementById('rpc-chain-id')) document.getElementById('rpc-chain-id').textContent = data.bsc.chainId;
    if (document.getElementById('rpc-gas-price')) document.getElementById('rpc-gas-price').textContent = `${data.bsc.gasPriceGwei} Gwei`;
    document.getElementById('active-network-name').textContent = `BSC (${data.bsc.chainId}) · ${data.networkMode.toUpperCase()}`;
  } catch (err) {
    console.error('Network status error:', err);
  }
}

// Settings & API
document.getElementById('api-base-url').value = window.location.origin;
document.getElementById('btn-toggle-api-key')?.addEventListener('click', () => {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-toggle-api-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});

document.getElementById('btn-copy-api-key')?.addEventListener('click', function() {
  const input = document.getElementById('api-key-input');
  copyToClipboard(input.value, this, 'Admin API Key copied!');
});

// Reveal Recovery Phrase / Backup
document.getElementById('btn-reveal-backup')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/admin/wallet/backup', { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load backup');

    document.getElementById('backup-mnemonic-text').textContent = data.mnemonic || 'Mnemonic not configured in software. Using external XPUB or private key.';
    document.getElementById('backup-treasury-address').value = data.treasuryAddress;
    document.getElementById('backup-treasury-key').value = data.treasuryPrivateKey || 'Private key not available (Watch-only mode)';
    openModal('modal-backup');
  } catch (err) {
    showToast('Error loading backup: ' + err.message, 'error');
  }
});

document.getElementById('btn-toggle-backup-key')?.addEventListener('click', () => {
  const input = document.getElementById('backup-treasury-key');
  const btn = document.getElementById('btn-toggle-backup-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});

document.getElementById('btn-toggle-seed-phrase')?.addEventListener('click', () => {
  const box = document.getElementById('backup-mnemonic-text');
  const btn = document.getElementById('btn-toggle-seed-phrase');
  if (box.style.filter === 'none') {
    box.style.filter = 'blur(8px)';
    box.style.userSelect = 'none';
    btn.textContent = '👁️ Reveal Seed Phrase';
  } else {
    box.style.filter = 'none';
    box.style.userSelect = 'text';
    btn.textContent = '🔒 Hide Seed Phrase';
  }
});

document.getElementById('btn-copy-backup-key')?.addEventListener('click', function() {
  const input = document.getElementById('backup-treasury-key');
  copyToClipboard(input.value, this, 'Central Treasury Private Key copied!');
});

// Initial Load & Refresh Loop
function refreshAll() {
  loadOverview();
  loadInvoices();
  loadWalletBalances();
  loadLedger();
  loadPaymentLinks();
  loadNetworkStatus();

  if (currentUser && currentUser.role === 'admin') {
    loadTreasuryOverview();
    loadMerchantsList();
  }
}

// ----------------------------------------------------
// Central Treasury & Sweeper Functions
// ----------------------------------------------------
async function loadTreasuryOverview() {
  try {
    const res = await fetch('/admin/treasury', { headers });
    if (!res.ok) return;
    const data = await res.json();

    // 1. Master Address & Badges
    const masterAddrEl = document.getElementById('treasury-master-address');
    if (masterAddrEl) masterAddrEl.textContent = data.treasuryAddress;

    const explorerLinkEl = document.getElementById('treasury-explorer-link');
    if (explorerLinkEl) {
      explorerLinkEl.href = `https://bscscan.com/address/${data.treasuryAddress}`;
    }

    const hotBadge = document.getElementById('treasury-hot-badge');
    if (hotBadge) {
      if (data.hasHotSigner) {
        hotBadge.textContent = '🟢 Hot Vault Active (Auto-Signing)';
        hotBadge.style.color = '#34d399';
      } else {
        hotBadge.textContent = '🟡 Watch-Only Vault (Manual Signing)';
        hotBadge.style.color = '#fbbf24';
      }
    }

    const sweepBadge = document.getElementById('treasury-sweep-badge');
    if (sweepBadge) {
      sweepBadge.textContent = data.autoSweepEnabled ? '⚡ Auto-Sweep ON' : '⏸ Auto-Sweep Paused';
    }

    // 2. Alert Container for Unswept Payments
    const alertContainer = document.getElementById('unswept-alert-container');
    const alertTitle = document.getElementById('unswept-alert-title');
    const statusText = document.getElementById('unswept-status-text');
    const btnBatch = document.getElementById('btn-trigger-batch-sweep');

    if (data.unsweptInvoices && data.unsweptInvoices.length > 0) {
      const summaryText = (data.unsweptSummary || []).map(s => `${formatCrypto(s.total_amount)} ${s.currency}`).join(', ');
      if (alertTitle) alertTitle.textContent = `${data.unsweptInvoices.length} Confirmed Payments Ready to Sweep`;
      if (statusText) statusText.textContent = `Total unswept: ${summaryText || 'Funds awaiting transfer'} stored in child invoice addresses.`;
      if (alertContainer) {
        alertContainer.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.15))';
        alertContainer.style.borderColor = 'rgba(245, 158, 11, 0.35)';
      }
      if (btnBatch) btnBatch.style.display = 'inline-block';
    } else {
      if (alertTitle) alertTitle.textContent = 'All Payments Swept to Treasury Vault';
      if (statusText) statusText.textContent = 'All customer invoice addresses have been consolidated into your central treasury vault.';
      if (alertContainer) {
        alertContainer.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 78, 59, 0.15))';
        alertContainer.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      }
      if (btnBatch) btnBatch.style.display = 'none';
    }

    // 3. Live On-Chain Balances Grid
    const balancesGrid = document.getElementById('treasury-balances-grid');
    if (balancesGrid && data.onChainBalances) {
      balancesGrid.innerHTML = data.onChainBalances.map(bal => `
        <div class="balance-card">
          <div class="bal-header">
            <span class="bal-sym">${bal.symbol}</span>
            <span class="bal-chain">${bal.chain.toUpperCase()}</span>
          </div>
          <div class="bal-amount">${formatCrypto(bal.balance)} <span class="bal-unit">${bal.symbol}</span></div>
          <div class="bal-footer">
            <span class="bal-sub">${bal.name}</span>
            <a href="${bal.explorerAddress}" target="_blank" class="bal-explorer" title="View on explorer">↗</a>
          </div>
        </div>
      `).join('');
    }

    // 4. Unswept Invoices Table
    const unsweptBody = document.getElementById('unswept-invoices-body');
    if (unsweptBody) {
      if (!data.unsweptInvoices || data.unsweptInvoices.length === 0) {
        unsweptBody.innerHTML = '<tr><td colspan="7" class="loading-td" style="color: #34d399;">✓ All payments consolidated into Central Treasury. No pending sweeps!</td></tr>';
      } else {
        unsweptBody.innerHTML = data.unsweptInvoices.map(inv => `
          <tr>
            <td><code>${inv.id.slice(0, 8)}…</code></td>
            <td><strong>${formatCrypto(inv.amount)}</strong></td>
            <td><span class="tag-currency">${inv.currency}</span></td>
            <td><code>${inv.address.slice(0, 8)}…${inv.address.slice(-6)}</code></td>
            <td>${inv.confirmed_at ? new Date(inv.confirmed_at).toLocaleTimeString() : 'Recently'}</td>
            <td><span class="status-unswept">${inv.sweep_status || 'unswept'}</span></td>
            <td><button class="btn btn-sm btn-primary" onclick="sweepSingleInvoice('${inv.id}')">⚡ Sweep</button></td>
          </tr>
        `).join('');
      }
    }

    // 5. Sweeps Audit History
    loadSweepsHistory();
  } catch (err) {
    console.error('Failed to load treasury overview:', err);
  }
}

async function loadSweepsHistory() {
  try {
    const res = await fetch('/admin/treasury/sweeps?limit=25', { headers });
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById('sweeps-table-body');
    if (!tbody) return;

    if (!data.sweeps || data.sweeps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-td">No sweep transactions recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.sweeps.map(sw => `
      <tr>
        <td>${new Date(sw.created_at).toLocaleString()}</td>
        <td><code>${sw.invoice_id ? sw.invoice_id.slice(0, 8) + '…' : 'Manual'}</code></td>
        <td><strong>${formatCrypto(sw.amount)}</strong></td>
        <td><span class="tag-currency">${sw.currency}</span></td>
        <td><code>${sw.from_address.slice(0, 8)}…</code></td>
        <td><code>${sw.to_address.slice(0, 8)}…</code></td>
        <td><span class="status-swept">${sw.status}</span></td>
        <td>${sw.txid ? `<a href="${getTxExplorerUrl(sw.txid, sw.currency)}" target="_blank" class="tx-link">${sw.txid.slice(0, 10)}… ↗</a>` : '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load sweeps history:', err);
  }
}

async function triggerBatchSweep() {
  const btn1 = document.getElementById('btn-treasury-sweep-all');
  const btn2 = document.getElementById('btn-trigger-batch-sweep');
  if (btn1) btn1.disabled = true;
  if (btn2) btn2.disabled = true;

  try {
    const res = await fetch('/admin/treasury/sweep', {
      method: 'POST',
      headers,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Batch sweep failed');
    showToast(`⚡ Batch Sweep: ${result.sweptCount} payment(s) swept to Treasury!`, 'success');
    loadTreasuryOverview();
  } catch (err) {
    showToast(`Batch sweep error: ${err.message}`, 'error');
  } finally {
    if (btn1) btn1.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}

window.sweepSingleInvoice = async (invoiceId) => {
  if (!confirm(`Trigger on-chain sweep for invoice #${invoiceId.slice(0, 8)} to Central Treasury?`)) return;
  try {
    const res = await fetch(`/admin/treasury/sweep/${invoiceId}`, {
      method: 'POST',
      headers,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Sweep failed');
    showToast(`✓ Invoice #${invoiceId.slice(0, 8)} swept to Treasury!`, 'success');
    loadTreasuryOverview();
  } catch (err) {
    showToast(`Sweep error: ${err.message}`, 'error');
  }
};

// Central Treasury Button Events
document.getElementById('btn-quick-sweep')?.addEventListener('click', () => {
  document.querySelector('[data-tab="treasury"]').click();
});
document.getElementById('btn-treasury-sweep-all')?.addEventListener('click', triggerBatchSweep);
document.getElementById('btn-trigger-batch-sweep')?.addEventListener('click', triggerBatchSweep);

document.getElementById('btn-treasury-payout')?.addEventListener('click', () => {
  openModal('modal-treasury-payout');
});

document.getElementById('btn-treasury-settings')?.addEventListener('click', async () => {
  openModal('modal-treasury-settings');
  try {
    const res = await fetch('/admin/treasury', { headers });
    const data = await res.json();
    if (data.coldStorageAddress) {
      document.getElementById('ts-cold-storage').value = data.coldStorageAddress;
    }
    document.getElementById('ts-auto-sweep').checked = data.autoSweepEnabled !== false;
  } catch (e) {}
});

document.getElementById('btn-show-treasury-qr')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/admin/treasury/qr', { headers });
    const data = await res.json();
    document.getElementById('treasury-qr-img').src = data.qrDataUrl;
    document.getElementById('treasury-qr-addr-text').textContent = data.address;
    openModal('modal-treasury-qr');
  } catch (e) {
    showToast('Failed to load QR: ' + e.message, 'error');
  }
});

document.getElementById('btn-copy-treasury-address')?.addEventListener('click', function() {
  const addr = document.getElementById('treasury-master-address').textContent;
  if (addr && addr !== 'Loading…') {
    copyToClipboard(addr, this, 'Central Treasury Address copied!');
  }
});

document.getElementById('btn-copy-treasury-qr-addr')?.addEventListener('click', function() {
  const addr = document.getElementById('treasury-qr-addr-text').textContent;
  if (addr && addr !== 'Loading…') {
    copyToClipboard(addr, this, 'Central Treasury Address copied!');
  }
});

document.getElementById('btn-refresh-treasury')?.addEventListener('click', () => {
  loadTreasuryOverview();
});

// Central Treasury Payout Form
document.getElementById('form-treasury-payout')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-treasury-payout');
  const statusEl = document.getElementById('tp-status');
  submitBtn.disabled = true;
  statusEl.style.display = 'none';

  try {
    const body = {
      currency: document.getElementById('tp-currency').value,
      toAddress: document.getElementById('tp-to-address').value.trim(),
      amount: document.getElementById('tp-amount').value.trim(),
      note: document.getElementById('tp-note').value.trim() || undefined,
    };

    const res = await fetch('/admin/treasury/payout', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Treasury payout failed');

    statusEl.className = 'alert-box alert-success';
    statusEl.innerHTML = `✓ Broadcasted payout! TX: <a href="${result.explorerUrl}" target="_blank" style="color: #34d399;">${result.txid.slice(0, 14)}… ↗</a>`;
    statusEl.style.display = 'block';

    setTimeout(() => {
      closeModal('modal-treasury-payout');
      document.getElementById('form-treasury-payout').reset();
      loadTreasuryOverview();
    }, 2500);
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = `Payout error: ${err.message}`;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Central Treasury Settings Form
document.getElementById('form-treasury-settings')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('ts-status');
  statusEl.style.display = 'none';

  try {
    const body = {
      autoSweepEnabled: document.getElementById('ts-auto-sweep').checked,
      coldStorageAddress: document.getElementById('ts-cold-storage').value.trim() || undefined,
    };

    const res = await fetch('/admin/treasury/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to update settings');

    statusEl.className = 'alert-box alert-success';
    statusEl.textContent = '✓ Treasury settings updated successfully!';
    statusEl.style.display = 'block';

    setTimeout(() => {
      closeModal('modal-treasury-settings');
      loadTreasuryOverview();
    }, 1500);
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.display = 'block';
  }
});

// =========================================================================
// Authentication, Multi-Merchant & User Mode Frontend Handlers
// =========================================================================

// =========================================================================
// Authentication, Multi-Merchant & User Mode Frontend Handlers (With OTP)
// =========================================================================

let loginPendingEmail = '';
let loginPendingPassword = '';
let loginTimerInterval = null;

let regPendingData = null;
let regTimerInterval = null;

function startCooldownTimer(buttonEl, secEl, cooldownSec) {
  let remaining = cooldownSec;
  buttonEl.disabled = true;
  if (secEl) secEl.textContent = remaining;

  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Resend Code';
    } else {
      if (secEl) secEl.textContent = remaining;
    }
  }, 1000);

  return interval;
}

async function checkAuth() {
  if (!authToken) {
    currentUser = null;
    window.location.href = '/login';
    return false;
  }

  try {
    const res = await fetch('/auth/me', { headers });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      renderUserSession(currentUser);
      closeModal('modal-auth');
      return true;
    }
  } catch (err) {
    console.warn('Auth check error:', err);
  }

  // Not authenticated or token invalid
  currentUser = null;
  authToken = '';
  localStorage.removeItem('payrail_token');
  window.location.href = '/login';
  return false;
}

function renderUserSession(user) {
  const roleBadge = document.getElementById('user-role-badge');
  const nameEl = document.getElementById('user-display-name');
  const profileEl = document.getElementById('user-profile-badge');
  const btnAuth = document.getElementById('btn-open-auth-modal');

  profileEl.style.display = 'flex';
  btnAuth.style.display = 'none';
  nameEl.textContent = user.businessName || user.email;

  const navMerchants = document.getElementById('nav-item-merchants');
  const navTreasury = document.getElementById('nav-item-treasury');
  const btnSweep = document.getElementById('btn-quick-sweep');
  const cardBackup = document.getElementById('card-backup-keys');

  if (user.role === 'admin') {
    roleBadge.textContent = 'Super Admin';
    roleBadge.className = 'user-badge-tag user-badge-admin';
    if (navMerchants) navMerchants.style.display = 'flex';
    if (navTreasury) navTreasury.style.display = 'flex';
    if (btnSweep) btnSweep.style.display = 'inline-block';
    if (cardBackup) cardBackup.style.display = 'block';
  } else {
    roleBadge.textContent = 'Merchant';
    roleBadge.className = 'user-badge-tag user-badge-merchant';
    if (navMerchants) navMerchants.style.display = 'none';
    if (navTreasury) navTreasury.style.display = 'none';
    if (btnSweep) btnSweep.style.display = 'none';
    if (cardBackup) cardBackup.style.display = 'none';

    // If currently on an admin-restricted tab, fallback to overview
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'treasury' || activeTab === 'merchants') {
      document.querySelector('[data-tab="overview"]').click();
    }
  }

  // Populate Developer Integration Tab with Merchant Credentials
  if (document.getElementById('mch-api-key-input')) {
    document.getElementById('mch-api-key-input').value = user.apiKey || 'Admin mode - using ADMIN_API_KEY';
  }
  if (document.getElementById('mch-webhook-secret-input')) {
    document.getElementById('mch-webhook-secret-input').value = user.webhookSecret || 'whsec_platform_super_admin';
  }
  if (document.getElementById('mch-id-text')) {
    document.getElementById('mch-id-text').textContent = user.id;
  }
  if (document.getElementById('mch-wallet-text')) {
    document.getElementById('mch-wallet-text').textContent = user.walletId;
  }
  if (document.getElementById('mch-status-badge')) {
    document.getElementById('mch-status-badge').textContent = (user.status || 'active').toUpperCase();
    document.getElementById('mch-status-badge').className = user.status === 'suspended' ? 'status-suspended' : 'status-active';
  }
  updateCodeSnippets(user.apiKey || 'YOUR_API_KEY');

  // Populate Personal Payout / Settlement Destination
  const payoutInput = document.getElementById('merchant-payout-address-input');
  const autoFwdCheck = document.getElementById('merchant-auto-forward-check');
  const payoutStatusEl = document.getElementById('merchant-payout-status-msg');
  const btnUseSaved = document.getElementById('btn-use-saved-payout-addr');

  if (payoutInput) {
    payoutInput.value = user.payoutAddress || '';
  }
  if (autoFwdCheck) {
    autoFwdCheck.checked = user.autoForward !== false;
  }
  if (btnUseSaved) {
    btnUseSaved.style.display = user.payoutAddress ? 'inline-block' : 'none';
  }
  if (payoutStatusEl) {
    payoutStatusEl.style.display = 'block';
    if (user.payoutAddress) {
      payoutStatusEl.innerHTML = `<span style="color:#34d399; font-weight:700;">✓ Active Settlement Destination:</span> <code style="color:#00f0ff;">${user.payoutAddress}</code> — On-chain payments automatically route to your personal wallet.`;
    } else {
      payoutStatusEl.innerHTML = `<span style="color:#94a3b8;">No personal settlement address saved yet. Save your address above so payments reach your personal wallet.</span>`;
    }
  }
}

// Save Merchant Personal Payout Address
document.getElementById('btn-save-merchant-payout')?.addEventListener('click', async function() {
  const addrInput = document.getElementById('merchant-payout-address-input');
  const autoFwdCheck = document.getElementById('merchant-auto-forward-check');
  const statusEl = document.getElementById('merchant-payout-status-msg');
  const btn = this;

  const payoutAddress = addrInput?.value.trim() || '';
  const autoForward = autoFwdCheck ? autoFwdCheck.checked : true;

  if (payoutAddress && !/^0x[a-fA-F0-9]{40}$/.test(payoutAddress)) {
    showToast('Invalid address! Must be a valid 42-character 0x EVM address', 'error');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="color:#ef4444; font-weight:700;">✗ Please enter a valid BEP-20 / EVM address starting with 0x (42 characters).</span>';
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch('/auth/profile/payout-address', {
      method: 'POST',
      headers,
      body: JSON.stringify({ payoutAddress, autoForward }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save payout address');

    if (currentUser) {
      currentUser.payoutAddress = payoutAddress;
      currentUser.autoForward = autoForward;
    }

    showToast('Payout address saved! Customer payments will reach you directly. ✓', 'success');

    const btnUseSaved = document.getElementById('btn-use-saved-payout-addr');
    if (btnUseSaved) btnUseSaved.style.display = payoutAddress ? 'inline-block' : 'none';

    if (statusEl) {
      statusEl.style.display = 'block';
      if (payoutAddress) {
        statusEl.innerHTML = `<span style="color:#34d399; font-weight:700;">✓ Active Settlement Destination:</span> <code style="color:#00f0ff;">${payoutAddress}</code> — On-chain payments automatically route to your personal wallet.`;
      } else {
        statusEl.innerHTML = `<span style="color:#94a3b8;">No personal settlement address saved yet. Save your address above so payments reach your personal wallet.</span>`;
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Payout Address';
  }
});

// Use saved payout address in withdraw modal
document.getElementById('btn-use-saved-payout-addr')?.addEventListener('click', () => {
  if (currentUser?.payoutAddress) {
    document.getElementById('withdraw-to-address').value = currentUser.payoutAddress;
    showToast('Pre-filled with your saved payout address! ✓');
  }
});

window.switchAuthTab = (tab) => {
  const signinContainer = document.getElementById('auth-signin-container');
  const signupContainer = document.getElementById('auth-signup-container');
  const btnLogin = document.getElementById('auth-tab-btn-login');
  const btnReg = document.getElementById('auth-tab-btn-register');

  // Reset status alerts
  const lStatus = document.getElementById('login-status');
  const loStatus = document.getElementById('login-otp-status');
  const rStatus = document.getElementById('register-status');
  const roStatus = document.getElementById('reg-otp-status');
  if (lStatus) lStatus.style.display = 'none';
  if (loStatus) loStatus.style.display = 'none';
  if (rStatus) rStatus.style.display = 'none';
  if (roStatus) roStatus.style.display = 'none';

  if (tab === 'login') {
    if (signinContainer) signinContainer.style.display = 'block';
    if (signupContainer) signupContainer.style.display = 'none';
    btnLogin.classList.add('active');
    btnReg.classList.remove('active');
  } else {
    if (signinContainer) signinContainer.style.display = 'none';
    if (signupContainer) signupContainer.style.display = 'block';
    btnLogin.classList.remove('active');
    btnReg.classList.add('active');
  }
};

// Login Step 1: Request 2FA OTP
document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('login-status');
  const submitBtn = document.getElementById('btn-submit-login');
  statusEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const res = await fetch('/auth/login/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to request login security code');

    loginPendingEmail = email;
    loginPendingPassword = password;

    // Switch to OTP step
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('form-login-otp').style.display = 'flex';
    document.getElementById('login-sent-email').textContent = email;
    const otpInput = document.getElementById('login-otp-code');
    otpInput.value = '';
    otpInput.focus();

    // Start cooldown timer
    if (loginTimerInterval) clearInterval(loginTimerInterval);
    const resendBtn = document.getElementById('btn-resend-login-otp');
    resendBtn.innerHTML = 'Resend (<span id="login-resend-sec">60</span>s)';
    loginTimerInterval = startCooldownTimer(resendBtn, document.getElementById('login-resend-sec'), data.cooldownSeconds || 60);

  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Login Step 2: Verify OTP
document.getElementById('form-login-otp')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('login-otp-status');
  const submitBtn = document.getElementById('btn-verify-login-otp');
  statusEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const otp = document.getElementById('login-otp-code').value.trim();
    if (!otp || otp.length !== 6) throw new Error('Please enter the 6-digit security code');

    const res = await fetch('/auth/login/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginPendingEmail, otp }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verification failed');

    authToken = data.token;
    localStorage.setItem('payrail_token', data.token);
    currentUser = data.user;
    renderUserSession(currentUser);
    closeModal('modal-auth');

    // Reset login forms
    document.getElementById('form-login').reset();
    document.getElementById('form-login-otp').reset();
    document.getElementById('form-login').style.display = 'flex';
    document.getElementById('form-login-otp').style.display = 'none';
    if (loginTimerInterval) clearInterval(loginTimerInterval);

    refreshAll();
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Back button from Login OTP
document.getElementById('btn-back-to-login')?.addEventListener('click', () => {
  document.getElementById('form-login-otp').style.display = 'none';
  document.getElementById('form-login').style.display = 'flex';
  document.getElementById('login-otp-status').style.display = 'none';
  if (loginTimerInterval) clearInterval(loginTimerInterval);
});

// Resend Login OTP
document.getElementById('btn-resend-login-otp')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('login-otp-status');
  try {
    const res = await fetch('/auth/login/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginPendingEmail, password: loginPendingPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resend code');

    statusEl.className = 'alert-box alert-success';
    statusEl.textContent = 'A new security code has been sent to your email.';
    statusEl.style.display = 'block';

    const resendBtn = document.getElementById('btn-resend-login-otp');
    resendBtn.innerHTML = 'Resend (<span id="login-resend-sec">60</span>s)';
    if (loginTimerInterval) clearInterval(loginTimerInterval);
    loginTimerInterval = startCooldownTimer(resendBtn, document.getElementById('login-resend-sec'), data.cooldownSeconds || 60);
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  }
});

// Signup Step 1: Request Registration OTP
document.getElementById('form-register')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('register-status');
  const submitBtn = document.getElementById('btn-submit-register');
  statusEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const firstName = document.getElementById('reg-first-name').value.trim();
    const lastName = document.getElementById('reg-last-name').value.trim();
    const businessName = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const payload = { firstName, lastName, businessName, email, password };

    const res = await fetch('/auth/signup/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to request registration code');

    regPendingData = payload;

    // Switch to OTP step
    document.getElementById('form-register').style.display = 'none';
    document.getElementById('form-register-otp').style.display = 'flex';
    document.getElementById('reg-sent-email').textContent = email;
    const otpInput = document.getElementById('reg-otp-code');
    otpInput.value = '';
    otpInput.focus();

    // Start cooldown timer
    if (regTimerInterval) clearInterval(regTimerInterval);
    const resendBtn = document.getElementById('btn-resend-reg-otp');
    resendBtn.innerHTML = 'Resend (<span id="reg-resend-sec">60</span>s)';
    regTimerInterval = startCooldownTimer(resendBtn, document.getElementById('reg-resend-sec'), data.cooldownSeconds || 60);

  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Signup Step 2: Verify Registration OTP
document.getElementById('form-register-otp')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('reg-otp-status');
  const submitBtn = document.getElementById('btn-verify-reg-otp');
  statusEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const otp = document.getElementById('reg-otp-code').value.trim();
    if (!otp || otp.length !== 6) throw new Error('Please enter the 6-digit verification code');

    const res = await fetch('/auth/signup/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: regPendingData.email, otp }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration verification failed');

    authToken = data.token;
    localStorage.setItem('payrail_token', data.token);
    currentUser = data.user;
    renderUserSession(currentUser);
    closeModal('modal-auth');

    // Reset forms
    document.getElementById('form-register').reset();
    document.getElementById('form-register-otp').reset();
    document.getElementById('form-register').style.display = 'flex';
    document.getElementById('form-register-otp').style.display = 'none';
    if (regTimerInterval) clearInterval(regTimerInterval);

    alert(`🎉 Account Created!\n\nWelcome ${data.user.businessName}!\nYour account is live and active. You can now accept BNB, USDT, and crypto payments.`);
    refreshAll();
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Back button from Registration OTP
document.getElementById('btn-back-to-reg')?.addEventListener('click', () => {
  document.getElementById('form-register-otp').style.display = 'none';
  document.getElementById('form-register').style.display = 'flex';
  document.getElementById('reg-otp-status').style.display = 'none';
  if (regTimerInterval) clearInterval(regTimerInterval);
});

// Resend Registration OTP
document.getElementById('btn-resend-reg-otp')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('reg-otp-status');
  try {
    const res = await fetch('/auth/signup/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPendingData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resend code');

    statusEl.className = 'alert-box alert-success';
    statusEl.textContent = 'A new verification code has been dispatched to your email.';
    statusEl.style.display = 'block';

    const resendBtn = document.getElementById('btn-resend-reg-otp');
    resendBtn.innerHTML = 'Resend (<span id="reg-resend-sec">60</span>s)';
    if (regTimerInterval) clearInterval(regTimerInterval);
    regTimerInterval = startCooldownTimer(resendBtn, document.getElementById('reg-resend-sec'), data.cooldownSeconds || 60);
  } catch (err) {
    statusEl.className = 'alert-box alert-error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  }
});

// Logout
document.getElementById('btn-logout')?.addEventListener('click', () => {
  authToken = '';
  localStorage.removeItem('payrail_token');
  currentUser = null;
  window.location.href = '/login?logged_out=1';
});

document.getElementById('btn-open-auth-modal')?.addEventListener('click', () => {
  openModal('modal-auth');
});

// Integration Tab Show/Copy Key buttons
document.getElementById('btn-toggle-mch-api-key')?.addEventListener('click', () => {
  const input = document.getElementById('mch-api-key-input');
  const btn = document.getElementById('btn-toggle-mch-api-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});

document.getElementById('btn-copy-mch-api-key')?.addEventListener('click', function() {
  const input = document.getElementById('mch-api-key-input');
  copyToClipboard(input.value, this, 'Merchant API Key copied!');
});

document.getElementById('btn-toggle-mch-wh-sec')?.addEventListener('click', () => {
  const input = document.getElementById('mch-webhook-secret-input');
  const btn = document.getElementById('btn-toggle-mch-wh-sec');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});

document.getElementById('btn-copy-mch-wh-sec')?.addEventListener('click', function() {
  const input = document.getElementById('mch-webhook-secret-input');
  copyToClipboard(input.value, this, 'Webhook Secret copied!');
});

// Switch snippet languages
let currentSnippetLang = 'curl';
window.switchSnippetLang = (lang) => {
  currentSnippetLang = lang;
  document.querySelectorAll('.snippet-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(lang));
  });
  updateCodeSnippets(currentUser?.apiKey || 'YOUR_MERCHANT_API_KEY');
};

function updateCodeSnippets(apiKey) {
  const origin = window.location.origin;
  const box = document.getElementById('snippet-create-invoice');
  if (!box) return;

  if (currentSnippetLang === 'curl') {
    box.textContent = `# Create a crypto invoice with automated email notifications
curl -X POST ${origin}/v1/merchant/invoices \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{
    "currency": "BNB_BSC",
    "amount": "0.05",
    "customerEmail": "customer@example.com",
    "customerName": "Alex Rivera",
    "orderId": "ORD-9981",
    "description": "Premium E-commerce Order",
    "expiresInMinutes": 30,
    "webhookUrl": "https://yoursite.com/api/crypto-webhook"
  }'`;
  } else if (currentSnippetLang === 'node') {
    box.textContent = `// Node.js (Fetch) - Create invoice with email alerts & receipt
const res = await fetch('${origin}/v1/merchant/invoices', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${apiKey}',
  },
  body: JSON.stringify({
    currency: 'BNB_BSC',
    amount: '0.05',
    customerEmail: 'customer@example.com',
    customerName: 'Alex Rivera',
    orderId: 'ORD-9981',
    description: 'Premium E-commerce Order',
    expiresInMinutes: 30,
    webhookUrl: 'https://yoursite.com/api/crypto-webhook'
  }),
});
const invoice = await res.json();
console.log('Customer Payment Address:', invoice.address);
console.log('Checkout URL: ${origin}/pay?invoice=' + invoice.id);`;
  } else if (currentSnippetLang === 'python') {
    box.textContent = `# Python (Requests) - Create invoice with email alerts & receipt
import requests

url = "${origin}/v1/merchant/invoices"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "${apiKey}"
}
payload = {
    "currency": "BNB_BSC",
    "amount": "0.05",
    "customerEmail": "customer@example.com",
    "customerName": "Alex Rivera",
    "orderId": "ORD-9981",
    "description": "Premium E-commerce Order",
    "expiresInMinutes": 30,
    "webhookUrl": "https://yoursite.com/api/crypto-webhook"
}

response = requests.post(url, json=payload, headers=headers)
invoice = response.json()
print("Payment Address:", invoice["address"])
print("Checkout URL: ${origin}/pay?invoice=" + invoice["id"])`;
  }
}

// Merchants Management Tab (Super Admin Only)
async function loadMerchantsList() {
  try {
    const res = await fetch('/admin/merchants', { headers });
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById('merchants-table-body');
    if (!tbody) return;

    if (!data.merchants || data.merchants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-td">No merchant accounts registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.merchants.map(m => {
      const isSuspended = m.status === 'suspended';
      const statusBadge = isSuspended
        ? '<span class="status-suspended">SUSPENDED</span>'
        : '<span class="status-active">ACTIVE</span>';

      const toggleAction = isSuspended
        ? `<button class="btn btn-sm btn-primary" onclick="toggleMerchantStatus('${m.id}', 'active')">✓ Activate</button>`
        : `<button class="btn btn-sm btn-secondary" onclick="toggleMerchantStatus('${m.id}', 'suspended')" style="color: #f87171; border-color: rgba(239,68,68,0.3);">⏸ Suspend</button>`;

      return `
        <tr>
          <td><strong>${m.business_name}</strong> ${m.role === 'admin' ? '<span class="badge" style="background:#00f0ff; color:#000; font-size:0.65rem; margin-left:4px;">ADMIN</span>' : ''}</td>
          <td>${m.email}</td>
          <td><code>${m.id}</code></td>
          <td><code>${m.wallet_id}</code></td>
          <td><strong>${m.total_invoices || 0}</strong> total / <span style="color:#10b981;">${m.confirmed_invoices || 0} confirmed</span></td>
          <td>${statusBadge}</td>
          <td>${new Date(m.created_at).toLocaleDateString()}</td>
          <td>${m.role === 'admin' ? '—' : toggleAction}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load merchants list:', err);
  }
}

window.toggleMerchantStatus = async (merchantId, newStatus) => {
  if (!confirm(`Are you sure you want to set this merchant to ${newStatus.toUpperCase()}?`)) return;
  try {
    const res = await fetch(`/admin/merchants/${merchantId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update status');
    loadMerchantsList();
  } catch (err) {
    alert('Error updating merchant status: ' + err.message);
  }
};

// Email Notification Audit Logs
async function loadEmailLogs() {
  const tbody = document.getElementById('emails-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="loading-td">Loading email delivery logs…</td></tr>';

  try {
    const res = await fetch('/admin/emails', { headers });
    if (!res.ok) throw new Error('Failed to load email logs');
    const data = await res.json();
    const emails = data.emails || [];

    if (emails.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-td" style="text-align:center; padding: 24px; color: #64748b;">No emails dispatched yet. Emails will be logged here automatically when invoices are created or paid.</td></tr>';
      return;
    }

    tbody.innerHTML = emails.map(m => {
      const date = new Date(m.created_at).toLocaleString();
      const statusBadge = m.status === 'sent'
        ? '<span class="status-active" style="font-size:0.75rem;">✓ Delivered (SMTP)</span>'
        : (m.status === 'simulated'
            ? '<span class="status-active" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.75rem;">⚡ Simulated (Dev)</span>'
            : '<span class="status-suspended" style="font-size:0.75rem;">Failed</span>');

      const roleBadge = m.recipient_type === 'merchant'
        ? '<span class="badge" style="background:rgba(37,99,235,0.2); color:#60a5fa; font-size:0.72rem;">Merchant (Owner)</span>'
        : '<span class="badge" style="background:rgba(16,185,129,0.2); color:#34d399; font-size:0.72rem;">Customer (Payer)</span>';

      return `
        <tr>
          <td style="font-size:0.8rem; color:#94a3b8;">${date}</td>
          <td><strong>${m.recipient}</strong></td>
          <td>${roleBadge}</td>
          <td><code>${m.template}</code></td>
          <td>${m.subject}</td>
          <td>${statusBadge}</td>
          <td>${m.invoice_id ? `<code title="${m.invoice_id}">${m.invoice_id.slice(0, 8)}…</code>` : '—'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-td" style="color:#f87171; text-align:center;">Failed to fetch email logs: ${err.message}</td></tr>`;
  }
}
window.loadEmailLogs = loadEmailLogs;
document.getElementById('btn-refresh-emails')?.addEventListener('click', loadEmailLogs);

// Start: Check auth state and initiate refresh loop
checkAuth().then(() => {
  refreshAll();
  setInterval(refreshAll, 6000);
});
