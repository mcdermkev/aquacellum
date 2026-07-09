/**
 * Aquacellum — Shared Navigation Component
 * Injects a consistent, responsive navigation bar across all pages.
 * 
 * Usage: Add <header id="site-nav"></header> in your HTML,
 *        then <script src="/js/nav.js"></script> before </body>.
 */

(function () {
  'use strict';

  // Ordered to match product priority: Database (top-of-funnel) → Marketplace
  // (conversion) → everything else. Keep this list short — anything niche goes
  // in SECONDARY_LINKS (mobile menu + footer still surface those).
  const NAV_LINKS = [
    { href: '/database.html', label: 'Database' },
    { href: '/marketplace.html', label: 'Marketplace' },
    { href: '/reef.html', label: 'The Reef' },
    { href: '/poseidon.html', label: 'Poseidon AI' },
    { href: '/leaderboard.html', label: 'Leaderboard' },
  ];

  const SECONDARY_LINKS = [
    { href: '/breeds.html', label: 'Breed Gallery' },
    { href: '/breeders.html', label: 'Find Breeders' },
    { href: '/compare.html', label: 'Compare Species' },
    { href: '/how-it-works.html', label: 'How It Works' },
    { href: '/hobbyist.html', label: 'For Hobbyists' },
    { href: '/breeder.html', label: 'For Breeders' },
    { href: '/developers.html', label: 'Developers / API' },
    { href: '/about.html', label: 'About' },
    { href: '/legal.html', label: 'Legal' },
  ];

  function getCurrentPage() {
    const path = window.location.pathname;
    // Normalize: /index.html and / both mean home
    if (path === '/' || path === '/index.html') return '/index.html';
    return path;
  }

  function isActive(href) {
    const current = getCurrentPage();
    return current === href;
  }

  function buildNav() {
    const target = document.getElementById('site-nav');
    if (!target) return;

    const linksHTML = NAV_LINKS.map(l =>
      `<a href="${l.href}" class="${isActive(l.href) ? 'active' : ''}">${l.label}</a>`
    ).join('');

    const mobileLinksHTML = NAV_LINKS.concat(SECONDARY_LINKS).map(l =>
      `<a href="${l.href}" class="${isActive(l.href) ? 'active' : ''}">${l.label}</a>`
    ).join('');

    target.innerHTML = `
      <nav class="nav" role="navigation" aria-label="Main navigation">
        <div class="nav-inner">
          <a href="/index.html" class="nav-logo" aria-label="Aquacellum Home">
            <div class="nav-logo-mark">
              <svg width="22" height="22" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="nav-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#2dd4bf"/>
                    <stop offset="50%" stop-color="#22d3ee"/>
                    <stop offset="100%" stop-color="#8b5cf6"/>
                  </linearGradient>
                </defs>
                <circle cx="19" cy="19" r="15" stroke="url(#nav-grad)" stroke-width="2.4" fill="none"/>
                <path d="M19 4 C22.5 9.5, 24 14, 22.8 19 C21.6 24, 22.5 28.5, 19 34" stroke="url(#nav-grad)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
                <path d="M19 4 C15.5 9.5, 14 14, 15.2 19 C16.4 24, 15.5 28.5, 19 34" stroke="url(#nav-grad)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
                <path d="M4 19 C9.5 17, 14 16.2, 19 16.2 C24 16.2, 28.5 17, 34 19" stroke="#5eead4" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8"/>
                <path d="M4 19 C9.5 21, 14 21.8, 19 21.8 C24 21.8, 28.5 21, 34 19" stroke="#a78bfa" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8"/>
                <circle cx="19" cy="19" r="4" fill="url(#nav-grad)"/>
                <circle cx="17.5" cy="17.5" r="1.3" fill="#fff" opacity="0.7"/>
              </svg>
            </div>
            <div>
              <span class="nav-logo-text">AQUACELLUM</span>
              <span class="nav-logo-sub">Living Registry</span>
            </div>
          </a>

          <div class="nav-links">
            ${linksHTML}
          </div>

          <a href="/index.html#waitlist" class="nav-cta">
            <span class="pulse-dot"></span>
            Join Beta
          </a>

          <button class="nav-mobile-toggle" id="navMobileToggle" aria-label="Toggle menu" aria-expanded="false">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
        </div>
      </nav>
      <div class="nav-mobile-menu" id="navMobileMenu" role="menu">
        ${mobileLinksHTML}
      </div>
    `;

    // Mobile toggle
    const toggle = document.getElementById('navMobileToggle');
    const menu = document.getElementById('navMobileMenu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => {
        const isOpen = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', isOpen);
      });
    }

    // Close mobile menu on link click
    if (menu) {
      menu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => menu.classList.remove('open'));
      });
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNav);
  } else {
    buildNav();
  }
})();
