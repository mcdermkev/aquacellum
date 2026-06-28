/**
 * Aquacellum Shared Navigation
 * Injects a consistent navigation bar across all pages.
 * 
 * Usage: <script type="module" src="/js/shared-nav.js"></script>
 * Place a <header id="aqua-nav"></header> element where you want the nav.
 * Or call window.AquacellumNav.inject() to auto-inject at top of body.
 */

const NAV_LINKS = [
  { href: '/app/tanks', label: 'My Tanks', icon: '🐠' },
  { href: '/app/breeder', label: 'Breeder Tools', icon: '🧬' },
  { href: '/app/directory', label: 'Marketplace', icon: '🏪' },
  { href: '/database', label: 'Database', icon: '📚' },
  { href: '/app/reef', label: 'The Reef', icon: '🪸' },
  { href: '/app/orders', label: 'Orders', icon: '📦' },
  { href: '/poseidon', label: 'Poseidon AI', icon: '🔱' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
];

const SECONDARY_LINKS = [
  { href: '/app/map', label: 'Find Breeders' },
  { href: '/app/gallery', label: 'Breed Gallery' },
  { href: '/app/incoming', label: 'Incoming' },
  { href: '/app/storefront', label: 'My Store' },
  { href: '/app/settings', label: 'Settings' },
];

function getCurrentPage() {
  const path = window.location.pathname.replace('.html', '').replace(/^\//, '');
  return '/' + (path || 'index');
}

function inject() {
  const target = document.getElementById('aqua-nav');
  if (!target) return;
  
  const currentPath = getCurrentPage();
  
  target.innerHTML = `
    <div class="aqua-nav-inner">
      <a href="/" class="aqua-nav-logo">
        <div class="aqua-nav-logo-mark">
          <svg width="22" height="22" viewBox="0 0 38 38" fill="none">
            <defs><linearGradient id="nav-lg" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#34d399"/><stop offset="50%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs>
            <circle cx="19" cy="19" r="15" stroke="url(#nav-lg)" stroke-width="2.4" fill="none"/>
            <circle cx="19" cy="19" r="4" fill="url(#nav-lg)"/>
          </svg>
        </div>
        <div class="aqua-nav-logo-text">
          <span class="aqua-nav-brand">AQUACELLUM</span>
        </div>
      </a>

      <nav class="aqua-nav-links" id="aquaNavLinks">
        ${NAV_LINKS.map(l => `<a href="${l.href}" class="${currentPath === l.href ? 'active' : ''}">${l.label}</a>`).join('')}
        <div class="aqua-nav-more" id="aquaNavMore">
          <button class="aqua-nav-more-btn" onclick="window.AquacellumNav.toggleMore()">More ▾</button>
          <div class="aqua-nav-dropdown" id="aquaNavDropdown">
            ${SECONDARY_LINKS.map(l => `<a href="${l.href}" class="${currentPath === l.href ? 'active' : ''}">${l.label}</a>`).join('')}
          </div>
        </div>
      </nav>

      <div class="aqua-nav-actions">
        <button class="aqua-nav-auth" id="aquaNavAuth" onclick="window.AquacellumAuth ? window.AquacellumAuth.login() : alert('Loading...')">
          Sign In
        </button>
      </div>

      <button class="aqua-nav-mobile-toggle" id="aquaMobileToggle" onclick="window.AquacellumNav.toggleMobile()">
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>

    <!-- Mobile Menu -->
    <div class="aqua-nav-mobile hidden" id="aquaMobileMenu">
      ${NAV_LINKS.map(l => `<a href="${l.href}" class="aqua-mob-link ${currentPath === l.href ? 'active' : ''}">${l.icon} ${l.label}</a>`).join('')}
      <div class="aqua-mob-divider"></div>
      ${SECONDARY_LINKS.map(l => `<a href="${l.href}" class="aqua-mob-link secondary ${currentPath === l.href ? 'active' : ''}">${l.label}</a>`).join('')}
    </div>
  `;
  target.className = 'aqua-nav';

  // Listen for auth events to update button
  window.addEventListener('aquacellum:auth', (e) => {
    const btn = document.getElementById('aquaNavAuth');
    if (btn && e.detail) {
      btn.textContent = e.detail.name || e.detail.email?.split('@')[0] || 'Connected';
      btn.classList.add('connected');
      btn.onclick = () => window.AquacellumAuth.logout();
    }
  });

  window.addEventListener('aquacellum:logout', () => {
    const btn = document.getElementById('aquaNavAuth');
    if (btn) {
      btn.textContent = 'Sign In';
      btn.classList.remove('connected');
      btn.onclick = () => window.AquacellumAuth.login();
    }
  });
}

function toggleMore() {
  const dropdown = document.getElementById('aquaNavDropdown');
  if (dropdown) dropdown.classList.toggle('show');
}

function toggleMobile() {
  const menu = document.getElementById('aquaMobileMenu');
  if (menu) menu.classList.toggle('hidden');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.aqua-nav-more')) {
    const dd = document.getElementById('aquaNavDropdown');
    if (dd) dd.classList.remove('show');
  }
});

window.AquacellumNav = { inject, toggleMore, toggleMobile };

// Auto-inject on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}

export { inject, NAV_LINKS, SECONDARY_LINKS };
