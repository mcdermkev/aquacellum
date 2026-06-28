/**
 * Aquacellum — Shared Navigation Component
 * Injects a consistent, responsive navigation bar across all pages.
 * 
 * Usage: Add <header id="site-nav"></header> in your HTML,
 *        then <script src="/js/nav.js"></script> before </body>.
 */

(function () {
  'use strict';

  const NAV_LINKS = [
    { href: '/database.html', label: 'Database' },
    { href: '/breeds.html', label: 'Breeds' },
    { href: '/breeders.html', label: 'Breeders' },
    { href: '/marketplace.html', label: 'Marketplace' },
    { href: '/reef.html', label: 'The Reef' },
    { href: '/poseidon.html', label: 'Poseidon AI' },
  ];

  const SECONDARY_LINKS = [
    { href: '/how-it-works.html', label: 'How It Works' },
    { href: '/hobbyist.html', label: 'For Hobbyists' },
    { href: '/about.html', label: 'About' },
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
                  <linearGradient id="nav-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#34d399"/>
                    <stop offset="50%" stop-color="#38bdf8"/>
                    <stop offset="100%" stop-color="#a78bfa"/>
                  </linearGradient>
                </defs>
                <circle cx="19" cy="19" r="15" stroke="url(#nav-grad)" stroke-width="2.4" fill="none"/>
                <circle cx="19" cy="19" r="4" fill="url(#nav-grad)"/>
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
