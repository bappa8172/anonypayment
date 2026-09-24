const invoiceId = new URLSearchParams(location.search).get('invoice');

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

let currentInvoice = null;
let timerInterval = null;

async function loadQrCode(id) {
  try {
    const res = await fetch(`/v1/invoices/${encodeURIComponent(id)}/qr`);
    if (res.ok) {
      const data = await res.json();
      qrImage.src = data.qrDataUrl;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
    }
  } catch (e) {
    qrLoading.textContent = 'Scan deposit address';
  }
}

function startCountdown(expiresAt) {
  if (timerInterval) clearInterval(timerInterval);
  const target = new Date(expiresAt).getTime();

  function update() {
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      timerValue.textContent = 'Expired';
      timerValue.style.color = '#ff6b6b';
      clearInterval(timerInterval);
      return;
    }

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    timerValue.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  update();
  timerInterval = setInterval(update, 1000);
}

function renderInvoice(invoice) {
  currentInvoice = invoice;

  amountEl.textContent = `${invoice.amount} ${invoice.symbol || 'USDT'}`;
  networkBadge.textContent = invoice.name || `${invoice.chain.toUpperCase()} Network`;
  networkDesc.textContent = `Send exact ${invoice.symbol} on ${invoice.name}`;

  addressEl.textContent = invoice.address;
  copyAddressBtn.disabled = false;

  // Status rendering
  statusBox.className = `status-box state-${invoice.status}`;
  if (invoice.status === 'confirmed') {
    statusText.textContent = 'Payment Confirmed on-chain! Order fulfilled.';
    statusIndicator.className = 'status-indicator green';
    timerValue.textContent = 'Paid';
    timerValue.style.color = '#70e000';
    if (timerInterval) clearInterval(timerInterval);
  } else if (invoice.status === 'paid') {
    statusText.textContent = `Payment Detected! Awaiting on-chain confirmations (${invoice.confirmationsRequired} required)...`;
    statusIndicator.className = 'status-indicator blue pulse';
  } else if (invoice.status === 'expired') {
    statusText.textContent = 'This invoice has expired. Please request a new invoice.';
    statusIndicator.className = 'status-indicator red';
  } else {
    statusText.textContent = 'Awaiting payment on blockchain...';
    statusIndicator.className = 'status-indicator amber pulse';
    startCountdown(invoice.expiresAt);
  }

  // Transaction explorer link
  if (invoice.explorerTx) {
    txLinkRow.style.display = 'flex';
    txLink.href = invoice.explorerTx;
  } else {
    txLinkRow.style.display = 'none';
  }

  // Web3 MetaMask button
  if (window.ethereum && invoice.status === 'pending') {
    payMetaMaskBtn.style.display = 'inline-flex';
  } else {
    payMetaMaskBtn.style.display = 'none';
  }
}

async function fetchInvoice() {
  if (!invoiceId) {
    statusText.textContent = 'No invoice ID provided in URL (?invoice=...)';
    statusIndicator.className = 'status-indicator red';
    amountEl.textContent = 'Invoice Not Found';
    return;
  }

  try {
    const res = await fetch(`/v1/invoices/${encodeURIComponent(invoiceId)}`, { cache: 'no-store' });
    if (!res.ok) {
      statusText.textContent = 'Invoice not found or deleted';
      statusIndicator.className = 'status-indicator red';
      amountEl.textContent = 'Not Found';
      return;
    }
    const invoice = await res.json();
    renderInvoice(invoice);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

// Copy helpers
copyAddressBtn.addEventListener('click', async () => {
  if (!currentInvoice) return;
  await navigator.clipboard.writeText(currentInvoice.address);
  copyAddressBtn.textContent = 'Copied!';
  setTimeout(() => { copyAddressBtn.textContent = 'Copy'; }, 1500);
});

copyAmountBtn.addEventListener('click', async () => {
  if (!currentInvoice) return;
  await navigator.clipboard.writeText(currentInvoice.amount);
  copyAmountBtn.textContent = 'Copied!';
  setTimeout(() => { copyAmountBtn.textContent = 'Copy Amount'; }, 1500);
});

// Pay with MetaMask / Web3 Provider
payMetaMaskBtn.addEventListener('click', async () => {
  if (!window.ethereum || !currentInvoice) return;
  web3Status.textContent = 'Connecting to wallet…';
  payMetaMaskBtn.disabled = true;

  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const userAccount = accounts[0];

    const targetChainHex = '0x' + Number(currentInvoice.chainId).toString(16);
    const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });

    if (currentChainHex.toLowerCase() !== targetChainHex.toLowerCase()) {
      web3Status.textContent = `Please switch network in MetaMask to Chain ID ${currentInvoice.chainId}…`;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainHex }],
        });
      } catch (switchError) {
        // If chain is not added, inform user
        web3Status.textContent = `Please switch your wallet to network chain ID ${currentInvoice.chainId}`;
        payMetaMaskBtn.disabled = false;
        return;
      }
    }

    web3Status.textContent = 'Confirm transaction in your wallet…';

    let txHash;
    if (currentInvoice.isNative) {
      // Native coin transfer (BNB / ETH / MATIC)
      const weiHex = '0x' + (BigInt(Math.floor(parseFloat(currentInvoice.amount) * 1e18))).toString(16);
      txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: userAccount,
          to: currentInvoice.address,
          value: weiHex,
        }],
      });
    } else {
      // ERC20 token transfer
      const decimals = currentInvoice.decimals || 18;
      const amountUnits = BigInt(Math.floor(parseFloat(currentInvoice.amount) * Math.pow(10, decimals)));
      const methodId = '0xa9059cbb'; // transfer(address,uint256)
      const paddedTo = currentInvoice.address.toLowerCase().replace('0x', '').padStart(64, '0');
      const paddedAmount = amountUnits.toString(16).padStart(64, '0');
      const data = methodId + paddedTo + paddedAmount;

      txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: userAccount,
          to: currentInvoice.tokenContract,
          data,
        }],
      });
    }

    web3Status.textContent = `Transaction sent! Verifying tx ${txHash.slice(0, 10)}…`;

    // Immediately notify backend
    await fetch(`/v1/invoices/${encodeURIComponent(currentInvoice.id)}/verify-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: txHash }),
    });

    fetchInvoice();
  } catch (err) {
    console.error('Web3 payment failed:', err);
    web3Status.textContent = err.message || 'Payment cancelled in wallet';
  } finally {
    payMetaMaskBtn.disabled = false;
  }
});

// Initialization
fetchInvoice();
if (invoiceId) {
  loadQrCode(invoiceId);
  setInterval(fetchInvoice, 4000);
}
