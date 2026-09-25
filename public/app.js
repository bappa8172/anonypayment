// app.js — Next-Gen Modern Web3 Crypto Checkout Controller

const urlParams = new URLSearchParams(location.search);
let invoiceId = urlParams.get('invoice') || urlParams.get('invoiceId');
const linkCode = urlParams.get('link') || urlParams.get('code');

// DOM Elements
const paymentCard = document.getElementById('payment-card');
const noInvoiceCard = document.getElementById('no-invoice-card');

const amountEl = document.getElementById('amount');
const copyAmountBtn = document.getElementById('copy-amount');
const networkBadge = document.getElementById('network-badge');
const networkDesc = document.getElementById('network-desc');
const qrImage = document.getElementById('qr-image');
const qrLoading = document.getElementById('qr-loading');
const addressEl = document.getElementById('address');
const copyAddressBtn = document.getElementById('copy-address');
const statusBox = document.getElementById('status-box');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const txLinkRow = document.getElementById('tx-link-row');
const txLink = document.getElementById('tx-link');
const timerValue = document.getElementById('timer-value');
const payMetaMaskBtn = document.getElementById('pay-metamask');
const web3Status = document.getElementById('web3-status');
const orderMetaBox = document.getElementById('order-meta-box');
const orderRefBadge = document.getElementById('order-ref-badge');
const orderDesc = document.getElementById('order-desc');
const merchantNameLabel = document.getElementById('merchant-name-label');
const customerEmailInput = document.getElementById('customer-email-input');
const btnSaveEmail = document.getElementById('btn-save-email');
const emailStatusMsg = document.getElementById('email-status-msg');
const toastMsg = document.getElementById('toast-msg');

let currentInvoice = null;
let timerInterval = null;
let pollInterval = null;

// Toast Message Helper
function showToast(msg) {
  if (!toastMsg) return;
  toastMsg.textContent = msg;
  toastMsg.classList.add('show');
  setTimeout(() => {
    toastMsg.classList.remove('show');
  }, 2000);
}

// Bulletproof Clipboard Copy with Automatic Fallback
async function copyToClipboard(text) {
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
  return success;
}

// Payment Mode Tab Switcher
window.switchCheckoutTab = function(mode) {
  const qrTabBtn = document.getElementById('tab-btn-qr');
  const web3TabBtn = document.getElementById('tab-btn-web3');
  const qrContainer = document.getElementById('checkout-tab-qr-container');
  const web3Container = document.getElementById('checkout-tab-web3-container');

  if (mode === 'qr') {
    qrTabBtn?.classList.add('active');
    web3TabBtn?.classList.remove('active');
    if (qrContainer) qrContainer.style.display = 'block';
    if (web3Container) web3Container.style.display = 'none';
  } else {
    web3TabBtn?.classList.add('active');
    qrTabBtn?.classList.remove('active');
    if (qrContainer) qrContainer.style.display = 'none';
    if (web3Container) web3Container.style.display = 'block';
  }
};

// QR Code Generator
async function loadQrCode(id) {
  try {
    const res = await fetch(`/v1/invoices/${encodeURIComponent(id)}/qr`);
    if (res.ok) {
      const data = await res.json();
      qrImage.src = data.qrDataUrl;
      qrImage.style.display = 'block';
      if (qrLoading) qrLoading.style.display = 'none';
    }
  } catch (e) {
    if (qrLoading) qrLoading.textContent = 'Scan deposit address';
  }
}

// Expiry Countdown
function startCountdown(expiresAt) {
  if (timerInterval) clearInterval(timerInterval);
  const target = new Date(expiresAt).getTime();

  function update() {
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      timerValue.textContent = 'Expired';
      timerValue.style.color = '#ef4444';
      clearInterval(timerInterval);
      return;
    }

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    timerValue.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

    if (minutes < 5) {
      timerValue.style.color = '#f59e0b';
    }
  }

  update();
  timerInterval = setInterval(update, 1000);
}

// Render Invoice to DOM
function renderInvoice(invoice) {
  currentInvoice = invoice;

  amountEl.textContent = `${invoice.amount} ${invoice.symbol || invoice.currency.split('_')[0]}`;
  networkBadge.innerHTML = `<span class="pulse-dot"></span> <span>${invoice.network || 'BSC Network'}</span>`;
  networkDesc.textContent = `Send exact amount on BNB Smart Chain (Chain ID: ${invoice.chainId || 56})`;

  addressEl.textContent = invoice.address;
  copyAddressBtn.disabled = false;

  if (invoice.status === 'confirmed') {
    statusIndicator.className = 'status-indicator confirmed';
    const conf = invoice.confirmations || invoice.confirmationsRequired || 12;
    const req = invoice.confirmationsRequired || 12;
    statusText.innerHTML = `<strong>✓ Payment Confirmed!</strong> (${conf}/${req} Confirmations)`;
    statusText.style.color = '#10b981';
    timerValue.textContent = 'Completed';
    timerValue.style.color = '#10b981';
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
  } else if (invoice.status === 'paid') {
    statusIndicator.className = 'status-indicator paid';
    const conf = invoice.confirmations || 1;
    const req = invoice.confirmationsRequired || 12;
    statusText.innerHTML = `<strong>⚡ Payment Detected!</strong> Confirming on BSC (${conf}/${req} Confirmations)`;
    statusText.style.color = '#38bdf8';
    timerValue.textContent = 'Confirming…';
    timerValue.style.color = '#38bdf8';
    if (timerInterval) clearInterval(timerInterval);
  } else if (invoice.status === 'expired') {
    statusIndicator.className = 'status-indicator expired';
    statusText.textContent = 'Invoice expired';
    statusText.style.color = '#ef4444';
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
  } else {
    statusIndicator.className = 'status-indicator';
    statusText.textContent = 'Awaiting payment on BNB Smart Chain…';
    statusText.style.color = '#f8fafc';
    startCountdown(invoice.expiresAt);
  }

  loadQrCode(invoice.id);

  // Order Details
  if (orderMetaBox) {
    if (invoice.orderId || invoice.description) {
      orderMetaBox.style.display = 'block';
      orderRefBadge.textContent = invoice.orderId ? `Order #${invoice.orderId}` : 'Payment';
      orderDesc.textContent = invoice.description || '';
    } else {
      orderMetaBox.style.display = 'none';
    }
  }

  // Customer Email Receipt Section
  if (customerEmailInput) {
    if (invoice.customerEmail) {
      customerEmailInput.value = invoice.customerEmail;
      if (invoice.status === 'confirmed') {
        emailStatusMsg.innerHTML = `<span style="color: #34d399;">✓ Official receipt sent to <strong>${invoice.customerEmail}</strong></span>`;
        if (btnSaveEmail) btnSaveEmail.style.display = 'none';
        customerEmailInput.disabled = true;
      } else {
        emailStatusMsg.innerHTML = `<span style="color: #94a3b8;">Receipt will be emailed to <strong>${invoice.customerEmail}</strong> on confirmation.</span>`;
      }
    }
  }

  // Transaction Explorer Link
  if (invoice.explorerTx) {
    txLinkRow.style.display = 'block';
    txLink.href = invoice.explorerTx;
  } else {
    txLinkRow.style.display = 'none';
  }
}

// Fetch Invoice from Server
async function fetchInvoice() {
  if (!invoiceId) return;

  try {
    const res = await fetch(`/v1/invoices/${encodeURIComponent(invoiceId)}`, { cache: 'no-store' });
    if (!res.ok) {
      paymentCard.style.display = 'none';
      noInvoiceCard.style.display = 'block';
      return;
    }
    const invoice = await res.json();
    renderInvoice(invoice);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

// Payment Link Auto-Resolver
async function resolvePaymentLink(code) {
  if (statusText) statusText.textContent = 'Generating on-chain checkout for payment link…';
  try {
    const res = await fetch(`/v1/payment-links/${encodeURIComponent(code)}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      paymentCard.style.display = 'none';
      noInvoiceCard.style.display = 'block';
      return;
    }

    const invoice = await res.json();
    invoiceId = invoice.id;
    window.history.replaceState({}, '', `/pay?invoice=${invoice.id}`);
    renderInvoice(invoice);
    pollInterval = setInterval(fetchInvoice, 3000);
  } catch (err) {
    paymentCard.style.display = 'none';
    noInvoiceCard.style.display = 'block';
  }
}

// Copy Buttons
copyAddressBtn?.addEventListener('click', async () => {
  if (!currentInvoice || !currentInvoice.address) return;
  await copyToClipboard(currentInvoice.address);
  showToast('Deposit address copied! ✓');
  copyAddressBtn.textContent = 'Copied!';
  setTimeout(() => { copyAddressBtn.textContent = 'Copy'; }, 1500);
});

copyAmountBtn?.addEventListener('click', async () => {
  if (!currentInvoice || !currentInvoice.amount) return;
  await copyToClipboard(String(currentInvoice.amount));
  showToast('Amount copied! ✓');
  copyAmountBtn.textContent = 'Copied!';
  setTimeout(() => { copyAmountBtn.textContent = 'Copy Amount'; }, 1500);
});

// Pay with Web3 / MetaMask / Trust Wallet
payMetaMaskBtn?.addEventListener('click', async () => {
  if (!window.ethereum || !currentInvoice) {
    web3Status.textContent = 'No Web3 wallet extension detected. Please scan the QR code above.';
    return;
  }

  web3Status.textContent = 'Connecting to Web3 wallet…';
  payMetaMaskBtn.disabled = true;

  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const userAccount = accounts[0];

    const targetChainHex = '0x' + Number(currentInvoice.chainId || 56).toString(16);
    const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });

    if (currentChainHex.toLowerCase() !== targetChainHex.toLowerCase()) {
      web3Status.textContent = `Please switch your wallet network to BSC Mainnet (Chain ID ${currentInvoice.chainId || 56})…`;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainHex }],
        });
      } catch (switchError) {
        web3Status.textContent = `Please switch network to BNB Smart Chain in your wallet.`;
        payMetaMaskBtn.disabled = false;
        return;
      }
    }

    web3Status.textContent = 'Waiting for transaction signature in wallet…';

    const isNative = currentInvoice.currency === 'BNB_BSC' || currentInvoice.currency === 'BNB';

    if (isNative) {
      // Native BNB transfer (wei in hex)
      const weiAmount = BigInt(Math.round(Number(currentInvoice.amount) * 1e18));
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: userAccount,
          to: currentInvoice.address,
          value: '0x' + weiAmount.toString(16),
        }],
      });

      web3Status.innerHTML = `✓ Broadcasted! Tx: <code>${txHash.substring(0, 10)}…</code>. Confirming on BSC…`;
    } else {
      // ERC20 USDT transfer on BSC
      const usdtContract = '0x55d398326f99059fF775485246999027B3197955';
      const cleanAddr = currentInvoice.address.replace('0x', '').padStart(64, '0');
      const rawUnits = BigInt(Math.round(Number(currentInvoice.amount) * 1e18));
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

      web3Status.innerHTML = `✓ Broadcasted! Tx: <code>${txHash.substring(0, 10)}…</code>. Confirming on BSC…`;
    }
  } catch (err) {
    console.error('Web3 error:', err);
    web3Status.textContent = err.message || 'Transaction rejected by user.';
  } finally {
    payMetaMaskBtn.disabled = false;
  }
});

// Save Customer Email for Automated Receipt
btnSaveEmail?.addEventListener('click', async () => {
  if (!currentInvoice) return;
  const email = customerEmailInput.value.trim();
  if (!email || !email.includes('@')) {
    emailStatusMsg.innerHTML = '<span style="color: #ef4444;">Please enter a valid email address</span>';
    return;
  }

  btnSaveEmail.disabled = true;
  btnSaveEmail.textContent = 'Saving…';

  try {
    const res = await fetch(`/v1/invoices/${encodeURIComponent(currentInvoice.id)}/customer-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const d = await res.json();
    if (res.ok) {
      if (currentInvoice) currentInvoice.customerEmail = email;
      emailStatusMsg.innerHTML = `<span style="color: #34d399;">✓ Receipt will be emailed to <strong>${email}</strong></span>`;
      showToast('Email saved for receipt! ✓');
    } else {
      emailStatusMsg.innerHTML = `<span style="color: #ef4444;">${d.error || 'Failed to save email'}</span>`;
    }
  } catch (e) {
    emailStatusMsg.innerHTML = '<span style="color: #ef4444;">Network error saving email</span>';
  } finally {
    btnSaveEmail.disabled = false;
    btnSaveEmail.textContent = 'Save';
  }
});

// Entry Point Initialization
document.addEventListener('DOMContentLoaded', () => {
  if (invoiceId) {
    fetchInvoice();
    pollInterval = setInterval(fetchInvoice, 3000);
  } else if (linkCode) {
    resolvePaymentLink(linkCode);
  } else {
    // No invoice or link provided in URL
    if (paymentCard) paymentCard.style.display = 'none';
    if (noInvoiceCard) noInvoiceCard.style.display = 'block';
  }
});
