/**
 * install-cta.js — Shared PWA install section logic for landing pages.
 *
 * Include AFTER the #installCard HTML block. Captures `beforeinstallprompt`,
 * detects iOS, and toggles the correct UI state.
 */
(function () {
  let deferredPrompt = null;
  const btn = document.getElementById('installBtn');
  const iosHint = document.getElementById('installIos');
  const doneEl = document.getElementById('installDone');
  const fallback = document.getElementById('installFallback');

  if (!btn) return; // Section not present on this page.

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if (isStandalone) {
    doneEl.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
  } else if (isIos) {
    iosHint.style.display = 'block';
  } else {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.style.display = 'flex';
    });
  }

  window.addEventListener('appinstalled', function () {
    btn.style.display = 'none';
    iosHint.style.display = 'none';
    doneEl.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
  });

  window.triggerInstall = async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
    btn.style.display = 'none';
  };
})();
