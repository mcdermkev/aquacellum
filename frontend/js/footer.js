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
                    <linearGradient id="ft-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="#34d399"/>
                      <stop offset="50%" stop-color="#38bdf8"/>
                      <stop offset="100%" stop-color="#a78bfa"/>
                    </linearGradient>
                  </defs>
                  <circle cx="19" cy="19" r="15" stroke="url(#ft-grad)" stroke-width="2.4" fill="none"/>
                  <circle cx="19" cy="19" r="4" fill="url(#ft-grad)"/>
                </svg>
              </div>
              <div>
                <span class="nav-logo-text">AQUACELLUM</span>
                <span class="nav-logo-sub">Living Registry</span>
              </div>
            </a>
            <p class="footer-brand-desc">
              The intelligent platform for aquarium hobbyists and professional breeders. 
              Track lineage, trade specimens, and discover 326+ species.
            </p>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Platform</h4>
            <a href="/database.html">Species Database</a>
            <a href="/breeds.html">Breed Gallery</a>
            <a href="/marketplace.html">Marketplace</a>
            <a href="/breeders.html">Find Breeders</a>
            <a href="/poseidon.html">Poseidon AI</a>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Community</h4>
            <a href="/reef.html">The Reef</a>
            <a href="/hobbyist.html">For Hobbyists</a>
            <a href="/how-it-works.html">How It Works</a>
            <a href="/about.html">About Us</a>
          </div>

          <div class="footer-col">
            <h4 class="footer-col-title">Resources</h4>
            <a href="/how-it-works.html#faq">FAQ</a>
            <a href="/how-it-works.html#escrow">Escrow Guide</a>
            <a href="/about.html#roadmap">Roadmap</a>
            <a href="/about.html#conservation">Conservation</a>
          </div>
        </div>

        <div class="footer-bottom">
          <span class="footer-copy">&copy; ${new Date().getFullYear()} Aquacellum Protocol. All rights reserved.</span>
          <div class="footer-socials">
            <a href="#" aria-label="Twitter / X">𝕏</a>
            <a href="#" aria-label="Discord">⟠</a>
            <a href="#" aria-label="GitHub">⌂</a>
          </div>
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
