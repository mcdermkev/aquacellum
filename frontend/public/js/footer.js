/**
 * Aquacellum — Shared Footer Component
 * Injects a consistent footer across all pages.
 * 
 * Usage: Add <footer id="site-footer"></footer> in your HTML,
 *        then <script src="/js/footer.js"></script> before </body>.
 */

(function () {
  'use strict';

  function buildFooter() {
    const target = document.getElementById('site-footer');
    if (!target) return;

    target.className = 'footer';
    target.innerHTML = `
      <div class="footer-inner">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="/index.html" class="nav-logo" style="margin-bottom:4px">
              <div class="nav-logo-mark">
                <svg width="22" height="22" viewBox="0 0 38 38" fill="none">
                  <defs>
                    <linearGradient id="ft-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#2dd4bf"/>
                      <stop offset="50%" stop-color="#22d3ee"/>
                      <stop offset="100%" stop-color="#8b5cf6"/>
                    </linearGradient>
                  </defs>
                  <circle cx="19" cy="19" r="15" stroke="url(#ft-grad)" stroke-width="2.4" fill="none"/>
                  <path d="M19 4 C22.5 9.5, 24 14, 22.8 19 C21.6 24, 22.5 28.5, 19 34" stroke="url(#ft-grad)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
                  <path d="M19 4 C15.5 9.5, 14 14, 15.2 19 C16.4 24, 15.5 28.5, 19 34" stroke="url(#ft-grad)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
                  <path d="M4 19 C9.5 17, 14 16.2, 19 16.2 C24 16.2, 28.5 17, 34 19" stroke="#5eead4" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8"/>
                  <path d="M4 19 C9.5 21, 14 21.8, 19 21.8 C24 21.8, 28.5 21, 34 19" stroke="#a78bfa" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8"/>
                  <circle cx="19" cy="19" r="4" fill="url(#ft-grad)"/>
                  <circle cx="17.5" cy="17.5" r="1.3" fill="#fff" opacity="0.7"/>
                </svg>
              </div>
              <div>
                <span class="nav-logo-text">AQUACELLUM</span>
                <span class="nav-logo-sub">Living Registry</span>
              </div>
            </a>
            <p class="footer-brand-desc">
              The intelligent platform for aquarium hobbyists and professional breeders. 
              Track lineage, trade specimens, and discover 300+ species.
            </p>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Platform</h4>
            <a href="/database.html">Species Database</a>
            <a href="/marketplace.html">Marketplace</a>
            <a href="/breeds.html">Breed Gallery</a>
            <a href="/compare.html">Compare Species</a>
            <a href="/breeders.html">Find Breeders</a>
            <a href="/poseidon.html">Poseidon AI</a>
            <a href="/app.html">Open the App</a>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Community</h4>
            <a href="/reef.html">The Reef</a>
            <a href="/leaderboard.html">Leaderboard</a>
            <a href="/hobbyist.html">For Hobbyists</a>
            <a href="/breeder.html">For Breeders</a>
            <a href="/how-it-works.html">How It Works</a>
            <a href="/about.html">About Us</a>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Resources</h4>
            <a href="/how-it-works.html#faq">FAQ</a>
            <a href="/how-it-works.html#escrow">Escrow Guide</a>
            <a href="/about.html#roadmap">Roadmap</a>
            <a href="/about.html#conservation">Conservation</a>
            <a href="/developers.html">Developer API</a>
            <a href="/legal.html">Legal</a>
          </div>
        </div>

        <div class="footer-bottom">
          <span class="footer-copy">&copy; ${new Date().getFullYear()} Aquacellum Protocol. All rights reserved.</span>
          <!-- Social links intentionally omitted until real profiles exist —
               dead href="#" placeholders shipped on every page. Add real URLs here
               (Twitter/X, Discord, GitHub) to restore the socials row. -->
        </div>
      </div>
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildFooter);
  } else {
    buildFooter();
  }
})();
