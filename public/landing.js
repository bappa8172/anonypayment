// landing.js — Client logic for Payrail Landing & Merchant Auth

let regPendingData = null;
let loginPendingEmail = '';
let loginPendingPassword = '';
let signupCooldownTimer = null;
let loginCooldownTimer = null;

// DOM Elements
const authTabs = document.querySelectorAll('.tab-btn');
const containerLogin = document.getElementById('container-login');
const containerSignup = document.getElementById('container-signup');

const formLoginStep1 = document.getElementById('form-login-step1');
const formLoginStep2 = document.getElementById('form-login-step2');
const formSignupStep1 = document.getElementById('form-signup-step1');
const formSignupStep2 = document.getElementById('form-signup-step2');

const alertSignup = document.getElementById('alert-signup');
const alertLogin = document.getElementById('alert-login');

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

  if (tab === 'login') {
    containerLogin.style.display = 'block';
    containerSignup.style.display = 'none';
  } else {
    containerLogin.style.display = 'none';
    containerSignup.style.display = 'block';
  }
}

authTabs.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Cooldown Countdown Timer
function startCooldown(buttonEl, secEl, seconds = 60) {
  let remaining = seconds;
  buttonEl.disabled = true;
  buttonEl.textContent = `Resend in (${remaining}s)`;
  if (secEl) secEl.textContent = remaining;

  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Resend Code';
    } else {
      buttonEl.textContent = `Resend in (${remaining}s)`;
      if (secEl) secEl.textContent = remaining;
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
    signupCooldownTimer = startCooldown(resendBtn, null, data.cooldownSeconds || 60);

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
    }, 800);
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
    signupCooldownTimer = startCooldown(resendBtn, null, data.cooldownSeconds || 60);
    showAlert(alertSignup, 'A new verification code was sent to your email.', 'success');
  } catch (err) {
    showAlert(alertSignup, err.message);
    resendBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 2. SIGNIN FLOW (Request 2FA OTP → Verify OTP → /dashboard)
// ─────────────────────────────────────────────────────────────

formLoginStep1?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(alertLogin);

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const btn = document.getElementById('btn-submit-login');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Checking credentials…';

  try {
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
    loginCooldownTimer = startCooldown(resendBtn, null, data.cooldownSeconds || 60);

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
    }, 800);
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
    loginCooldownTimer = startCooldown(resendBtn, null, data.cooldownSeconds || 60);
    showAlert(alertLogin, 'A fresh 2FA code was sent to your email.', 'success');
  } catch (err) {
    showAlert(alertLogin, err.message);
    resendBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 3. CHECK EXISTING SESSION ON PAGE LOAD
// ─────────────────────────────────────────────────────────────

async function checkExistingSession() {
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

      // Show top logged in banner
      const banner = document.getElementById('logged-in-banner');
      const nameEl = document.getElementById('banner-user-name');
      const navBtn = document.getElementById('nav-btn-auth');

      if (banner && nameEl) {
        nameEl.textContent = user.businessName || user.email;
        banner.style.display = 'flex';
      }

      if (navBtn) {
        navBtn.textContent = 'Go to Dashboard →';
        navBtn.href = '/dashboard';
        navBtn.classList.remove('btn-ghost');
        navBtn.classList.add('btn-primary');
      }

      const heroCta = document.getElementById('hero-cta-btn');
      if (heroCta) {
        heroCta.textContent = 'Open Dashboard →';
        heroCta.href = '/dashboard';
      }
    } else {
      // Invalid token
      localStorage.removeItem('payrail_token');
    }
  } catch {
    // Keep local view
  }
}

// ─────────────────────────────────────────────────────────────
// 4. URL HASH & QUERY PARAMETERS
// ─────────────────────────────────────────────────────────────

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const authMode = params.get('auth');

  if (authMode === 'login') {
    switchTab('login');
    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
  } else if (authMode === 'signup') {
    switchTab('signup');
    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
  } else if (authMode === 'logout') {
    switchTab('login');
    showAlert(alertLogin, 'You have been safely logged out.', 'success');
  }
}

// Smooth scroll buttons
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href.startsWith('#') && href.length > 1) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
});

// Run on page initialization
document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();
  handleUrlParams();
});
