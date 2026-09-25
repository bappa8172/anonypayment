// auth.js — Dedicated Merchant Authentication Controller for /login and /signup

let regPendingData = null;
let loginPendingEmail = '';
let loginPendingPassword = '';
let signupCooldownTimer = null;
let loginCooldownTimer = null;

// DOM Elements
const authTabs = document.querySelectorAll('.auth-pill-btn, .tab-btn');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const containerLogin = document.getElementById('container-login');
const containerSignup = document.getElementById('container-signup');

const formLoginStep1 = document.getElementById('form-login-step1');
const formLoginStep2 = document.getElementById('form-login-step2');
const formSignupStep1 = document.getElementById('form-signup-step1');
const formSignupStep2 = document.getElementById('form-signup-step2');

const alertSignup = document.getElementById('alert-signup');
const alertLogin = document.getElementById('alert-login');
const subText = document.getElementById('auth-sub-text');

// Utility: Show alerts
function showAlert(el, msg, type = 'danger') {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert-box alert-${type}`;
  el.style.display = 'block';
}

function hideAlert(el) {
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

// Tab Switching
function switchTab(tab) {
  hideAlert(alertSignup);
  hideAlert(alertLogin);

  authTabs.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  if (tab === 'signup') {
    containerLogin.style.display = 'none';
    containerSignup.style.display = 'block';
    if (subText) subText.textContent = 'Create a New Merchant Account in 60s';
    document.title = 'Create Business Account — Payrail Gateway';
  } else {
    containerLogin.style.display = 'block';
    containerSignup.style.display = 'none';
    if (subText) subText.textContent = 'High-Security Merchant Portal Sign In';
    document.title = 'Sign In — Payrail Gateway';
  }
}

tabLogin?.addEventListener('click', () => switchTab('login'));
tabSignup?.addEventListener('click', () => switchTab('signup'));

// 60-Second Cooldown Timer
function startCooldown(buttonEl, seconds = 60) {
  let remaining = seconds;
  buttonEl.disabled = true;
  buttonEl.textContent = `Resend in (${remaining}s)`;

  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Resend Code';
    } else {
      buttonEl.textContent = `Resend in (${remaining}s)`;
    }
  }, 1000);

  return timer;
}

// ─────────────────────────────────────────────────────────────
// 1. SIGNUP FLOW (Request OTP → Verify OTP → /dashboard)
// ─────────────────────────────────────────────────────────────

formSignupStep1?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertSignup);

  const firstName = document.getElementById('reg-firstname').value.trim();
  const lastName = document.getElementById('reg-lastname').value.trim();
  const businessName = document.getElementById('reg-businessname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (password.length < 8) {
    showAlert(alertSignup, 'Password must be at least 8 characters long.');
    return;
  }

  const btn = document.getElementById('btn-submit-signup');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending Verification Code…';

  try {
    const res = await fetch('/auth/signup/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, businessName, email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send verification code');
    }

    regPendingData = { firstName, lastName, businessName, email, password };
    document.getElementById('otp-signup-email-preview').textContent = email;

    formSignupStep1.style.display = 'none';
    formSignupStep2.style.display = 'block';

    const resendBtn = document.getElementById('btn-resend-signup-otp');
    if (signupCooldownTimer) clearInterval(signupCooldownTimer);
    signupCooldownTimer = startCooldown(resendBtn, data.cooldownSeconds || 60);

    showAlert(alertSignup, `Verification code sent to ${email}. Please check your inbox.`, 'success');
  } catch (err) {
    showAlert(alertSignup, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

formSignupStep2?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertSignup);

  const otp = document.getElementById('reg-otp-code').value.trim();
  if (otp.length !== 6) {
    showAlert(alertSignup, 'Please enter the 6-digit verification code.');
    return;
  }

  const btn = document.getElementById('btn-verify-signup');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying Account…';

  try {
    const res = await fetch('/auth/signup/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: regPendingData.email,
        otp,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid or expired verification code');
    }

    // Success! Store session token
    localStorage.setItem('payrail_token', data.token);

    showAlert(alertSignup, 'Account verified! Opening your merchant dashboard…', 'success');

    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 600);
  } catch (err) {
    showAlert(alertSignup, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Back from Signup OTP
document.getElementById('btn-back-signup')?.addEventListener('click', () => {
  hideAlert(alertSignup);
  formSignupStep2.style.display = 'none';
  formSignupStep1.style.display = 'block';
});

// Resend Signup OTP
document.getElementById('btn-resend-signup-otp')?.addEventListener('click', async () => {
  if (!regPendingData) return;
  hideAlert(alertSignup);

  const resendBtn = document.getElementById('btn-resend-signup-otp');
  resendBtn.disabled = true;

  try {
    const res = await fetch('/auth/signup/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPendingData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resend code');

    if (signupCooldownTimer) clearInterval(signupCooldownTimer);
    signupCooldownTimer = startCooldown(resendBtn, data.cooldownSeconds || 60);
    showAlert(alertSignup, 'A new verification code was sent to your email.', 'success');
  } catch (err) {
    showAlert(alertSignup, err.message);
    resendBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 2. SIGNIN FLOW (Request 2FA OTP → Verify OTP → /dashboard)
// ─────────────────────────────────────────────────────────────

// Toggle between Password Login and API Key Login
const formLoginApiKey = document.getElementById('form-login-apikey');
const btnToggleApiKeyLogin = document.getElementById('btn-toggle-apikey-login');
const btnBackToPassword = document.getElementById('btn-back-to-password');

btnToggleApiKeyLogin?.addEventListener('click', () => {
  hideAlert(alertLogin);
  if (formLoginStep1) formLoginStep1.style.display = 'none';
  if (formLoginApiKey) formLoginApiKey.style.display = 'block';
});

btnBackToPassword?.addEventListener('click', () => {
  hideAlert(alertLogin);
  if (formLoginApiKey) formLoginApiKey.style.display = 'none';
  if (formLoginStep1) formLoginStep1.style.display = 'block';
});

// API Key Submission Handler
formLoginApiKey?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertLogin);

  const apiKeyInput = document.getElementById('login-apikey-input');
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
  if (!apiKey) {
    showAlert(alertLogin, 'Please enter your API Key or Master Admin Key.');
    return;
  }

  const btn = document.getElementById('btn-submit-apikey-login');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying API Key…';

  try {
    const res = await fetch('/auth/login/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid API Key');

    localStorage.setItem('payrail_token', data.token);
    if (data.user) localStorage.setItem('payrail_user', JSON.stringify(data.user));

    showAlert(alertLogin, 'Authenticated! Redirecting to Dashboard...', 'success');
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 600);
  } catch (err) {
    showAlert(alertLogin, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

formLoginStep1?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertLogin);

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const btn = document.getElementById('btn-submit-login');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Authenticating…';

  try {
    // Master Super Admin logs in directly without requiring an external email OTP
    if (email.toLowerCase() === 'admin@gateway.local') {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid Master Admin credentials');

      localStorage.setItem('payrail_token', data.token);
      if (data.user) localStorage.setItem('payrail_user', JSON.stringify(data.user));

      showAlert(alertLogin, 'Master Admin verified! Redirecting to Dashboard…', 'success');
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 600);
      return;
    }

    const res = await fetch('/auth/login/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid email or password');
    }

    loginPendingEmail = email;
    loginPendingPassword = password;
    document.getElementById('otp-login-email-preview').textContent = email;

    formLoginStep1.style.display = 'none';
    formLoginStep2.style.display = 'block';

    const resendBtn = document.getElementById('btn-resend-login-otp');
    if (loginCooldownTimer) clearInterval(loginCooldownTimer);
    loginCooldownTimer = startCooldown(resendBtn, data.cooldownSeconds || 60);

    showAlert(alertLogin, `Security verification code sent to ${email}`, 'success');
  } catch (err) {
    showAlert(alertLogin, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

formLoginStep2?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertLogin);

  const otp = document.getElementById('login-otp-code').value.trim();
  if (otp.length !== 6) {
    showAlert(alertLogin, 'Please enter the 6-digit security code.');
    return;
  }

  const btn = document.getElementById('btn-verify-login');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying 2FA…';

  try {
    const res = await fetch('/auth/login/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginPendingEmail,
        otp,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid or expired security code');
    }

    // Success! Store session token
    localStorage.setItem('payrail_token', data.token);

    showAlert(alertLogin, 'Authentication verified! Entering dashboard…', 'success');

    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 600);
  } catch (err) {
    showAlert(alertLogin, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Back from Login OTP
document.getElementById('btn-back-login')?.addEventListener('click', () => {
  hideAlert(alertLogin);
  formLoginStep2.style.display = 'none';
  formLoginStep1.style.display = 'block';
});

// Resend Login OTP
document.getElementById('btn-resend-login-otp')?.addEventListener('click', async () => {
  if (!loginPendingEmail) return;
  hideAlert(alertLogin);

  const resendBtn = document.getElementById('btn-resend-login-otp');
  resendBtn.disabled = true;

  try {
    const res = await fetch('/auth/login/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginPendingEmail,
        password: loginPendingPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resend code');

    if (loginCooldownTimer) clearInterval(loginCooldownTimer);
    loginCooldownTimer = startCooldown(resendBtn, data.cooldownSeconds || 60);
    showAlert(alertLogin, 'A fresh 2FA code was sent to your email.', 'success');
  } catch (err) {
    showAlert(alertLogin, err.message);
    resendBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 3. CHECK ALREADY LOGGED IN
// ─────────────────────────────────────────────────────────────

async function checkAlreadyLoggedIn() {
  const token = localStorage.getItem('payrail_token');
  if (!token) return;

  try {
    const res = await fetch('/auth/me', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const user = data.user;

      const card = document.getElementById('card-already-logged');
      const nameEl = document.getElementById('logged-user-name');
      const mainBox = document.getElementById('main-auth-box');

      if (card && nameEl) {
        nameEl.textContent = `${user.businessName || user.email} (${user.role})`;
        card.style.display = 'block';
      }
    } else {
      localStorage.removeItem('payrail_token');
    }
  } catch {
    // Keep standard form
  }
}

document.getElementById('btn-switch-account')?.addEventListener('click', () => {
  localStorage.removeItem('payrail_token');
  document.getElementById('card-already-logged').style.display = 'none';
});

// Password Visibility Toggles with Vector SVGs
function setupPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;

  const svgEyeOpen = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
  const svgEyeSlash = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>`;

  btn.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = svgEyeSlash;
    } else {
      input.type = 'password';
      btn.innerHTML = svgEyeOpen;
    }
  });
}

setupPasswordToggle('btn-toggle-login-pass', 'login-password');
setupPasswordToggle('btn-toggle-reg-pass', 'reg-password');

// Live Password Strength Meter
const regPassInput = document.getElementById('reg-password');
const strengthBar = document.getElementById('strength-bar');

regPassInput?.addEventListener('input', () => {
  if (!strengthBar) return;
  const val = regPassInput.value;
  const len = val.length;

  if (len === 0) {
    strengthBar.style.width = '0%';
  } else if (len < 8) {
    strengthBar.style.width = '30%';
    strengthBar.style.background = '#ef4444';
  } else if (len < 12) {
    strengthBar.style.width = '70%';
    strengthBar.style.background = '#f59e0b';
  } else {
    strengthBar.style.width = '100%';
    strengthBar.style.background = '#10b981';
  }
});


// ─────────────────────────────────────────────────────────────
// 4. ROUTE & URL INTENT DETECTION
// ─────────────────────────────────────────────────────────────

function initRoute() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);

  if (path.includes('signup') || params.get('tab') === 'signup') {
    switchTab('signup');
  } else {
    switchTab('login');
  }

  if (params.get('logged_out') === '1') {
    showAlert(alertLogin, 'You have been safely logged out.', 'success');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initRoute();
  checkAlreadyLoggedIn();
});
