// landing.js — Client logic for Payrail Landing Page & Interactive Sandbox

let currentDemoCurrency = 'BNB';
let simulationInterval = null;

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
      const heroCta = document.getElementById('hero-cta-btn');

      if (banner && nameEl) {
        nameEl.textContent = user.businessName || user.email;
        banner.style.display = 'flex';
      }

      if (navBtn) {
        navBtn.textContent = 'Dashboard →';
        navBtn.href = '/dashboard';
        navBtn.classList.remove('btn-ghost');
        navBtn.classList.add('btn-primary');
      }

      if (heroCta) {
        heroCta.textContent = 'Open Dashboard →';
        heroCta.href = '/dashboard';
      }
    } else {
      localStorage.removeItem('payrail_token');
    }
  } catch {
    // Keep local view
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

// Interactive Savings Calculator
function initCalculator() {
  const range = document.getElementById('calc-range');
  const volumeDisplay = document.getElementById('calc-volume-display');
  const traditionalFees = document.getElementById('calc-traditional-fees');
  const savingsDisplay = document.getElementById('calc-savings-display');

  if (!range || !volumeDisplay) return;

  function update() {
    const val = parseInt(range.value, 10);
    const traditional = val * 0.035; // 3.5%
    volumeDisplay.textContent = `$${val.toLocaleString()} / mo`;
    traditionalFees.textContent = `-$${traditional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo`;
    savingsDisplay.textContent = `+$${traditional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Saved`;
  }

  range.addEventListener('input', update);
  update();
}

// ============================================================
// INTERACTIVE CHECKOUT DEMO SANDBOX CONTROLLER
// ============================================================

window.setDemoCurrency = function(curr) {
  currentDemoCurrency = curr;
  const bnbBtn = document.getElementById('demo-currency-bnb');
  const usdtBtn = document.getElementById('demo-currency-usdt');
  const amountEl = document.getElementById('demo-amount-text');

  if (curr === 'BNB') {
    bnbBtn.classList.add('active');
    usdtBtn.classList.remove('active');
    if (amountEl) amountEl.innerHTML = '0.05 BNB <span style="font-size: 0.95rem; color: var(--text-muted); font-weight: 500;">($32.40 USD)</span>';
  } else {
    usdtBtn.classList.add('active');
    bnbBtn.classList.remove('active');
    if (amountEl) amountEl.innerHTML = '50.00 USDT <span style="font-size: 0.95rem; color: var(--text-muted); font-weight: 500;">($50.00 USD)</span>';
  }
  resetPaymentSimulation();
};

window.runPaymentSimulation = function() {
  const btnTrigger = document.getElementById('btn-trigger-simulation');
  const btnReset = document.getElementById('btn-reset-simulation');
  const progressBox = document.getElementById('demo-progress-box');
  const successBox = document.getElementById('demo-success-box');
  const progressBar = document.getElementById('demo-progress-bar');
  const stepText = document.getElementById('demo-step-text');
  const confCount = document.getElementById('demo-conf-count');

  if (!btnTrigger || !progressBox) return;

  btnTrigger.disabled = true;
  btnTrigger.style.display = 'none';
  if (btnReset) btnReset.style.display = 'inline-block';
  successBox.style.display = 'none';
  progressBox.style.display = 'block';

  let currentConf = 0;
  const maxConf = 12;

  if (simulationInterval) clearInterval(simulationInterval);

  stepText.textContent = `Detecting on-chain deposit on BSC…`;
  progressBar.style.width = '10%';
  confCount.textContent = `1 / 12`;

  simulationInterval = setInterval(() => {
    currentConf += 2;
    if (currentConf > maxConf) currentConf = maxConf;

    const percent = Math.round((currentConf / maxConf) * 100);
    progressBar.style.width = `${percent}%`;
    confCount.textContent = `${currentConf} / ${maxConf}`;

    if (currentConf < 6) {
      stepText.textContent = `Broadcasting block confirmations…`;
    } else if (currentConf < 12) {
      stepText.textContent = `Validating cryptographic finality (${currentConf}/12)…`;
    } else {
      // Completed!
      clearInterval(simulationInterval);
      stepText.textContent = `12/12 Blocks Finalized!`;
      setTimeout(() => {
        progressBox.style.display = 'none';
        successBox.style.display = 'block';
      }, 500);
    }
  }, 400);
};

window.resetPaymentSimulation = function() {
  if (simulationInterval) clearInterval(simulationInterval);
  const btnTrigger = document.getElementById('btn-trigger-simulation');
  const btnReset = document.getElementById('btn-reset-simulation');
  const progressBox = document.getElementById('demo-progress-box');
  const successBox = document.getElementById('demo-success-box');
  const progressBar = document.getElementById('demo-progress-bar');

  if (btnTrigger) {
    btnTrigger.disabled = false;
    btnTrigger.style.display = 'block';
  }
  if (btnReset) btnReset.style.display = 'none';
  if (progressBox) progressBox.style.display = 'none';
  if (successBox) successBox.style.display = 'none';
  if (progressBar) progressBar.style.width = '0%';
};

// Copy address button
document.getElementById('btn-demo-copy')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-demo-copy');
  const addr = '0x9f8c8AC706756Af7B5996fd8E14428DeB4b7dd59';
  try {
    await navigator.clipboard.writeText(addr);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  } catch {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();
  initCalculator();
});
