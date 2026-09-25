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

document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();
});
