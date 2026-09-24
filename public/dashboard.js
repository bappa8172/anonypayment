const API_KEY = 'gateway_admin_secret_key_prod_test_32chars';
const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

let currentBalances = [];
let allInvoices = [];

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
    document.getElementById(`tab-${tabName}`).classList.add('active');
    pageTitle.textContent = item.textContent.trim();
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
document.getElementById('btn-quick-withdraw').addEventListener('click', () => {
  openModal('modal-withdraw');
  updateWithdrawAvailableBal();
});
document.getElementById('btn-wallet-withdraw')?.addEventListener('click', () => {
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
    document.getElementById('metric-confirmed-invoices').textContent = `${data.stats.confirmedInvoices} Confirmed`;
    document.getElementById('metric-pending-invoices').textContent = data.stats.pendingInvoices;

    currentBalances = data.balances;
    const bnb = data.balances.find(b => b.symbol === 'BNB');
    if (bnb) document.getElementById('metric-bnb-balance').textContent = `${parseFloat(bnb.available).toFixed(4)} BNB`;

    const usdt = data.balances.find(b => b.symbol === 'USDT');
    if (usdt) document.getElementById('metric-usdt-balance').textContent = `${parseFloat(usdt.available).toFixed(2)} USDT`;
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

    return `
      <tr>
        <td><code title="${inv.id}">${shortId}</code></td>
        <td><strong>${inv.amount} ${inv.currency.split('_')[0]}</strong></td>
        ${isOverview ? `<td>${inv.currency.split('_')[1] || 'EVM'}</td>` : `<td>${inv.currency}</td>`}
        <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
        <td><code title="${inv.address}">${shortAddr}</code></td>
        ${!isOverview ? `<td>${inv.txid ? `<a href="${inv.txid.startsWith('0x') ? `https://testnet.bscscan.com/tx/${inv.txid}` : '#'}" target="_blank">${inv.txid.slice(0, 10)}… ↗</a>` : '—'}</td>` : ''}
        <td>${date}</td>
        <td>
          <a class="btn-text" href="${checkoutUrl}" target="_blank">Checkout ↗</a>
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
          <div class="wallet-balance-num">${parseFloat(bal.available).toFixed(4)} <span style="font-size: 1.1rem; color: #94a3b8;">${bal.symbol}</span></div>
          <div class="wallet-balance-sub">Pending confirmations: ${bal.pending} ${bal.symbol}</div>
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
document.getElementById('btn-copy-deposit-addr')?.addEventListener('click', async () => {
  const addr = document.getElementById('deposit-address-input').value;
  await navigator.clipboard.writeText(addr);
  const btn = document.getElementById('btn-copy-deposit-addr');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// Withdraw flow
window.openWithdrawFor = (currency) => {
  document.getElementById('withdraw-currency').value = currency;
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
    statusEl.textContent = `Error: ${err.message}`;
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
      const txidDisplay = row.txid ? `<a href="https://testnet.bscscan.com/tx/${row.txid}" target="_blank">${row.txid.slice(0, 12)}… ↗</a>` : (row.destination_address || '—');

      return `
        <tr>
          <td>${date}</td>
          <td><span class="badge" style="background: rgba(255,255,255,0.06);">${row.type}</span></td>
          <td style="color: ${color}; font-weight: 700;">${sign}${row.amount}</td>
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
      const payUrl = `${origin}/v1/payment-links/${link.code}/checkout`;

      return `
        <tr>
          <td><strong>${link.title}</strong></td>
          <td>${link.amount} ${link.currency.split('_')[0]}</td>
          <td>${link.currency}</td>
          <td><code>${link.code}</code></td>
          <td><button class="btn-text" onclick="copyText('${payUrl}')">Copy Checkout URL</button></td>
          <td>${date}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="embedSnippet('${link.code}', '${link.title}', '${link.amount}')">Get Embed Code</button>
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

window.copyText = async (text) => {
  await navigator.clipboard.writeText(text);
  alert('Copied to clipboard: ' + text);
};

window.embedSnippet = (code, title, amount) => {
  const origin = window.location.origin;
  const snippet = `<!-- Payrail Crypto Button -->\n<a href="${origin}/v1/payment-links/${code}/checkout" target="_blank" style="background:#00f0ff; color:#000; padding:10px 18px; border-radius:8px; font-weight:bold; text-decoration:none;">Pay with Crypto (${amount})</a>`;
  prompt('Copy this HTML snippet to embed on your website:', snippet);
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

    // Offer to open the checkout page immediately
    if (confirm(`Invoice created for ${data.amount} ${data.currency}!\n\nOpen hosted checkout page now?`)) {
      window.open(`/pay?invoice=${data.id}`, '_blank');
    }
  } catch (err) {
    alert(`Failed to create invoice: ${err.message}`);
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
    document.getElementById('rpc-block-num').textContent = data.bsc.blockNumber;
    document.getElementById('rpc-gas-price').textContent = `${data.bsc.gasPriceGwei} Gwei`;
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

document.getElementById('btn-copy-api-key')?.addEventListener('click', async () => {
  const input = document.getElementById('api-key-input');
  await navigator.clipboard.writeText(input.value);
  const btn = document.getElementById('btn-copy-api-key');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
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
    alert('Error loading backup: ' + err.message);
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

document.getElementById('btn-copy-backup-key')?.addEventListener('click', async () => {
  const input = document.getElementById('backup-treasury-key');
  await navigator.clipboard.writeText(input.value);
  const btn = document.getElementById('btn-copy-backup-key');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// Initial Load & Refresh Loop
function refreshAll() {
  loadOverview();
  loadTreasuryOverview();
  loadInvoices();
  loadWalletBalances();
  loadLedger();
  loadPaymentLinks();
  loadNetworkStatus();
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
      explorerLinkEl.href = `https://testnet.bscscan.com/address/${data.treasuryAddress}`;
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
      const summaryText = (data.unsweptSummary || []).map(s => `${parseFloat(s.total_amount).toFixed(4)} ${s.currency}`).join(', ');
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
          <div class="bal-amount">${parseFloat(bal.balance).toFixed(bal.isNative ? 4 : 2)} <span class="bal-unit">${bal.symbol}</span></div>
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
            <td><strong>${inv.amount}</strong></td>
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
        <td><strong>${sw.amount}</strong></td>
        <td><span class="tag-currency">${sw.currency}</span></td>
        <td><code>${sw.from_address.slice(0, 8)}…</code></td>
        <td><code>${sw.to_address.slice(0, 8)}…</code></td>
        <td><span class="status-swept">${sw.status}</span></td>
        <td>${sw.txid ? `<a href="https://testnet.bscscan.com/tx/${sw.txid}" target="_blank" class="tx-link">${sw.txid.slice(0, 10)}… ↗</a>` : '—'}</td>
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
    alert(`⚡ Batch Sweep Completed!\nChecked: ${result.totalChecked} invoices\nSuccessfully Swept: ${result.sweptCount}`);
    loadTreasuryOverview();
  } catch (err) {
    alert(`Batch sweep error: ${err.message}`);
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
    alert(`✓ Swept successfully!\nAmount: ${result.amount || result.status} ${result.currency || ''}\nTx: ${result.txid || result.status}`);
    loadTreasuryOverview();
  } catch (err) {
    alert(`Sweep error: ${err.message}`);
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
    alert('Failed to load QR: ' + e.message);
  }
});

document.getElementById('btn-copy-treasury-address')?.addEventListener('click', async () => {
  const addr = document.getElementById('treasury-master-address').textContent;
  if (addr && addr !== 'Loading…') {
    await navigator.clipboard.writeText(addr);
    alert('Copied Central Treasury Address:\n' + addr);
  }
});

document.getElementById('btn-copy-treasury-qr-addr')?.addEventListener('click', async () => {
  const addr = document.getElementById('treasury-qr-addr-text').textContent;
  if (addr && addr !== 'Loading…') {
    await navigator.clipboard.writeText(addr);
    alert('Copied Central Treasury Address:\n' + addr);
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

refreshAll();
setInterval(refreshAll, 6000);
