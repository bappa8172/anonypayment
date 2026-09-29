// client/src/api/client.js — Centralized REST API Client

export const TOKEN_KEY = 'anony_token';
export const USER_KEY = 'anony_user';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('payrail_token') || '';
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('payrail_token');
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem('payrail_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('payrail_user');
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem('payrail_token');
  localStorage.removeItem('payrail_user');
}

export function sanitizeClientErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'An error occurred with this request.';

  let sanitized = msg;
  // Redact hex keys / private keys
  sanitized = sanitized.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]');
  sanitized = sanitized.replace(/\b[a-fA-F0-9]{64}\b/g, '[REDACTED_KEY]');

  // Redact live API keys and webhook secrets
  sanitized = sanitized.replace(/pr_live_[a-zA-Z0-9_\-]+/g, '[REDACTED_API_KEY]');
  sanitized = sanitized.replace(/mch_live_[a-zA-Z0-9_\-]+/g, '[REDACTED_API_KEY]');
  sanitized = sanitized.replace(/whsec_[a-zA-Z0-9_\-]+/g, '[REDACTED_SECRET]');

  // Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');

  // Check for raw HTML (e.g., 502/504 Bad Gateway from proxy)
  if (sanitized.includes('<!DOCTYPE') || sanitized.includes('<html') || sanitized.includes('502 Bad Gateway')) {
    return 'The payment server is temporarily unavailable. Please try again shortly.';
  }

  // Check for raw database or technical syntax errors
  const lower = sanitized.toLowerCase();
  if (
    lower.includes('sqlite_') ||
    lower.includes('syntax error') ||
    lower.includes('no such table') ||
    lower.includes('no such column') ||
    lower.includes('econnrefused') ||
    lower.includes('cannot read properties')
  ) {
    return 'An unexpected service error occurred. Please try again.';
  }

  return sanitized;
}

export async function apiFetch(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    let errorMsg = data?.error || (typeof data === 'string' ? data : 'API Request Failed');
    if (typeof errorMsg === 'string' && errorMsg.trim().startsWith('[') && errorMsg.includes('"message"')) {
      try {
        const parsed = JSON.parse(errorMsg);
        if (Array.isArray(parsed) && parsed.length > 0) {
          errorMsg = parsed.map((p) => `${p.path?.join('.') || 'Field'}: ${p.message}`).join(', ');
        }
      } catch {}
    } else if (Array.isArray(errorMsg)) {
      errorMsg = errorMsg.map((p) => `${p.path?.join('.') || 'Field'}: ${p.message}`).join(', ');
    }
    const safeMsg = sanitizeClientErrorMessage(errorMsg);
    const err = new Error(safeMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Auth Endpoints
// ─────────────────────────────────────────────────────────────
export const authApi = {
  async getMe() {
    return apiFetch('/auth/me');
  },
  async loginDirect(email, password) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  async loginApiKey(apiKey) {
    return apiFetch('/auth/login/api-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
  },
  async requestLoginOtp(email, password) {
    return apiFetch('/auth/login/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  async verifyLoginOtp(email, otp) {
    return apiFetch('/auth/login/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },
  async requestSignupOtp(payload) {
    return apiFetch('/auth/signup/request-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async verifySignupOtp(email, otp) {
    return apiFetch('/auth/signup/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  },
  async updatePayoutAddress(payoutAddress, autoForward = true) {
    return apiFetch('/auth/profile/payout-address', {
      method: 'POST',
      body: JSON.stringify({ payoutAddress, autoForward }),
    });
  },
  async regenerateApiKey() {
    return apiFetch('/auth/profile/api-key/regenerate', {
      method: 'POST',
    });
  },
  async regenerateWebhookSecret() {
    return apiFetch('/auth/profile/webhook-secret/regenerate', {
      method: 'POST',
    });
  },
};

// ─────────────────────────────────────────────────────────────
// Admin / Merchant Dashboard Endpoints
// ─────────────────────────────────────────────────────────────
export const adminApi = {
  async getStats() {
    const res = await apiFetch('/admin/stats');
    return res?.stats ? { ...res.stats, balances: res.balances, networkMode: res.networkMode, activeChainId: res.activeChainId } : res;
  },
  async getInvoices(status = '') {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await apiFetch(`/admin/invoices${query}`);
    return Array.isArray(res) ? res : (res?.invoices || []);
  },
  async createInvoice(payload) {
    return apiFetch('/admin/invoices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async getWallet() {
    return apiFetch('/admin/wallet');
  },
  async getDepositAddress(currency = 'BNB_BSC') {
    return apiFetch(`/admin/wallet/deposit-address?currency=${encodeURIComponent(currency)}`);
  },
  async withdraw(payload) {
    return apiFetch('/admin/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async transfer(payload) {
    return apiFetch('/admin/wallet/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async getLedger() {
    const res = await apiFetch('/admin/wallet/ledger');
    return Array.isArray(res) ? res : (res?.history || []);
  },
  async getPaymentLinks() {
    const res = await apiFetch('/admin/payment-links');
    return Array.isArray(res) ? res : (res?.links || []);
  },
  async createPaymentLink(payload) {
    return apiFetch('/admin/payment-links', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async getNetworkStatus() {
    return apiFetch('/admin/network-status');
  },
  async getWalletBackup() {
    return apiFetch('/admin/wallet/backup');
  },
  async getTreasury() {
    return apiFetch('/admin/treasury');
  },
  async getTreasurySweeps(limit = 25) {
    const res = await apiFetch(`/admin/treasury/sweeps?limit=${limit}`);
    return Array.isArray(res) ? res : (res?.sweeps || []);
  },
  async sweepAll() {
    return apiFetch('/admin/treasury/sweep', {
      method: 'POST',
    });
  },
  async sweepSingle(invoiceId) {
    return apiFetch(`/admin/treasury/sweep/${encodeURIComponent(invoiceId)}`, {
      method: 'POST',
    });
  },
  async getTreasuryQr() {
    return apiFetch('/admin/treasury/qr');
  },
  async treasuryPayout(payload) {
    return apiFetch('/admin/treasury/payout', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateTreasurySettings(payload) {
    return apiFetch('/admin/treasury/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async getMerchants() {
    const res = await apiFetch('/admin/merchants');
    return Array.isArray(res) ? res : (res?.merchants || []);
  },
  async setMerchantStatus(merchantId, status) {
    return apiFetch(`/admin/merchants/${encodeURIComponent(merchantId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
  async getEmailLogs() {
    const res = await apiFetch('/admin/emails');
    return Array.isArray(res) ? res : (res?.emails || []);
  },
};

// ─────────────────────────────────────────────────────────────
// Public Checkout Endpoints
// ─────────────────────────────────────────────────────────────
export const publicApi = {
  async getInvoice(id) {
    return apiFetch(`/v1/invoices/${encodeURIComponent(id)}`, { cache: 'no-store' });
  },
  async getInvoiceQr(id) {
    return apiFetch(`/v1/invoices/${encodeURIComponent(id)}/qr`);
  },
  async updateCustomerEmail(invoiceId, email, name = '') {
    return apiFetch(`/v1/invoices/${encodeURIComponent(invoiceId)}/customer-email`, {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
  },
  async getPaymentLink(code) {
    return apiFetch(`/v1/payment-links/${encodeURIComponent(code)}`);
  },
  async checkoutPaymentLink(code, customerEmail, customerName = '') {
    return apiFetch(`/v1/payment-links/${encodeURIComponent(code)}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ customerEmail, customerName }),
    });
  },
};
