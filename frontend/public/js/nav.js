/**
 * Aquacellum — Shared Navigation Component
 * Injects a consistent, responsive navigation bar across all pages.
 *
 * Usage: Add <header id="site-nav"></header> in your HTML,
 *        then <script src="/js/nav.js"></script> before </body>.
 *
 * ONE PRODUCT. The React app (/app/*) draws the same bar: same logo mark, same
 * 64px white translucent strip, same type (see .app-topbar in
 * src/styles/index.css and src/components/AppTopBar.jsx). If you change the
 * lockup or the link set here, change it there too.
 */

(function () {
  'use strict';

  // Ordered to match product priority: Database (top-of-funnel) → Marketplace
  // (conversion) → the app's community destinations. Keep this list short;
  // anything niche goes in SECONDARY_LINKS (mobile menu + footer surface those).
  const NAV_LINKS = [
    { href: '/database.html', label: 'Database' },
    { href: '/marketplace.html', label: 'Marketplace' },
    { href: '/app/auctions', label: 'Auctions' },
    { href: '/app/reef', label: 'The Reef' },
    { href: '/clubs', label: 'Clubs' },
    { href: '/poseidon.html', label: 'Poseidon AI' },
  ];

  const SECONDARY_LINKS = [
    { href: '/breeds.html', label: 'Breed Gallery' },
    { href: '/breeders.html', label: 'Find Breeders' },
    { href: '/compare.html', label: 'Compare Species' },
    { href: '/leaderboard.html', label: 'Leaderboard' },
    { href: '/how-it-works.html', label: 'How It Works' },
    { href: '/developers.html', label: 'Developers / API' },
    { href: '/about.html', label: 'About' },
    { href: '/legal.html', label: 'Legal' },
  ];

  // Detail pages light up the section they belong to.
  const SECTION_ALIASES = {
    '/species': '/database',
    '/compare': '/database',
    '/store': '/marketplace',
    '/club': '/clubs',
  };

  // "/database.html", "/database" and "/database/" are the same page (the host
  // serves clean URLs), and "/" is "/index".
  function normalize(path) {
    let p = String(path || '/').split(/[?#]/)[0];
    if (p.length > 1) p = p.replace(/\/+$/, '');
    p = p.replace(/\.html$/, '');
    if (p === '' || p === '/index') p = '/';
    return p;
  }

  function currentSection() {
    const p = normalize(window.location.pathname);
    // A single club (/clubs/<slug>, or club.html in dev) lights up Clubs.
    if (p.startsWith('/clubs/')) return '/clubs';
    return SECTION_ALIASES[p] || p;
  }

  function isActive(href) {
    return normalize(href) === currentSection();
  }

  // The app writes this flag on mount (App.jsx). A returning keeper gets a
  // direct way back to their tanks instead of a generic "Open the app".
  function isReturningUser() {
    try { return localStorage.getItem('aquadex_entered_dashboard') === 'true'; } catch { return false; }
  }

  function linkHTML(l) {
    const active = isActive(l.href);
    return `<a href="${l.href}"${active ? ' class="active" aria-current="page"' : ''}>${l.label}</a>`;
  }

  function buildNav() {
    const target = document.getElementById('site-nav');
    if (!target) return;

    const cta = isReturningUser()
      ? { href: '/app/tanks', label: 'My tanks' }
      : { href: '/app', label: 'Open the app' };

    const linksHTML = NAV_LINKS.map(linkHTML).join('');
    const mobilePrimaryHTML = NAV_LINKS.map(linkHTML).join('');
    const mobileSecondaryHTML = SECONDARY_LINKS.map(linkHTML).join('');

    target.innerHTML = `
      <nav class="nav" aria-label="Main navigation">
        <div class="nav-inner">
          <a href="/" class="nav-logo" aria-label="Aquacellum home">
            <div class="nav-logo-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
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

          <a href="${cta.href}" class="nav-cta">${cta.label}</a>

          <button type="button" class="nav-mobile-toggle" id="navMobileToggle" aria-label="Open menu" aria-expanded="false" aria-controls="navMobileMenu">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
              <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
        </div>
      </nav>
      <nav class="nav-mobile-menu" id="navMobileMenu" aria-label="Site menu" hidden>
        <a href="${cta.href}" class="nav-mobile-cta">${cta.label}</a>
        ${mobilePrimaryHTML}
        <div class="nav-mobile-divider" role="presentation"></div>
        ${mobileSecondaryHTML}
      </nav>
    `;

    const toggle = document.getElementById('navMobileToggle');
    const menu = document.getElementById('navMobileMenu');
    if (!toggle || !menu) return;

    function setOpen(open, { restoreFocus = false } = {}) {
      menu.hidden = !open;
      menu.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (!open && restoreFocus) toggle.focus();
    }

    toggle.addEventListener('click', () => setOpen(menu.hidden));

    // Close on link click, on Escape, and if the viewport grows past the
    // breakpoint (the desktop links take over there).
    menu.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => setOpen(false));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) setOpen(false, { restoreFocus: true });
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(min-width: 769px)');
      const onChange = (e) => { if (e.matches) setOpen(false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNav);
  } else {
    buildNav();
  }
})();
