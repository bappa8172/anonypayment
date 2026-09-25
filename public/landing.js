// landing.js — Client logic for Payrail Landing Page

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

document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();
  initCalculator();
});
