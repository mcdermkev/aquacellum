/**
 * Aquacellum Shared Auth Module
 * Uses @privy-io/js-sdk-core for vanilla JS authentication.
 * Provides email-based login with OTP code flow.
 * 
 * Usage: import from any HTML page via <script type="module" src="/js/privy-auth.js">
 * Or call window.AquacellumAuth.login() from inline scripts after loading.
 */

import PrivyClient from '@privy-io/js-sdk-core';
import { LocalStorage } from '@privy-io/js-sdk-core';

const PRIVY_APP_ID = 'cmprm8kqd000l0cl54w0e9jn3';
const SUPABASE_URL = 'https://yahsdztnvsykzecjatsl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaHNkenRudnN5a3plY2phdHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTQwMDgsImV4cCI6MjA5NjA3MDAwOH0.3anqDFU9hUjZg2AFWJlXSBbwSM-knNrmb-uQ_Baq98I';

let privyClient = null;
let currentUser = null;

// ── Initialize Privy ───────────────────────────────────────────────
function getPrivy() {
  if (!privyClient) {
    privyClient = new PrivyClient({
      appId: PRIVY_APP_ID,
      storage: new LocalStorage(),
    });
  }
  return privyClient;
}

// ── Session Persistence ────────────────────────────────────────────
function saveSession(user) {
  const session = {
    walletAddress: user.wallet?.address || null,
    email: user.email?.address || null,
    name: user.displayName || user.email?.address?.split('@')[0] || 'Keeper',
    userId: user.id,
    timestamp: Date.now(),
  };
  localStorage.setItem('aquacellum_session', JSON.stringify(session));
  // Legacy support
  localStorage.setItem('aquacellum_reef_session', JSON.stringify({
    walletAddress: session.walletAddress,
    name: session.name,
    email: session.email,
  }));
  return session;
}

function getSession() {
  try {
    const raw = localStorage.getItem('aquacellum_session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Check if session is still fresh (24 hours)
    if (Date.now() - session.timestamp > 86400000) {
      clearSession();
      return null;
    }
    return session;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem('aquacellum_session');
  localStorage.removeItem('aquacellum_reef_session');
  currentUser = null;
}

// ── Fetch Supabase Profile ─────────────────────────────────────────
async function fetchProfile(walletAddress) {
  if (!walletAddress) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?wallet_address=eq.${walletAddress.toLowerCase()}&limit=1`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (res.ok) {
      const profiles = await res.json();
      return profiles[0] || null;
    }
  } catch (e) { console.warn('[Auth] Profile fetch failed:', e); }
  return null;
}

// ── Login Modal UI ─────────────────────────────────────────────────
function createLoginModal() {
  const overlay = document.createElement('div');
  overlay.id = 'aqua-auth-overlay';
  overlay.innerHTML = `
    <div class="aqua-auth-modal">
      <button class="aqua-auth-close" onclick="window.AquacellumAuth.closeModal()">&times;</button>
      <div class="aqua-auth-logo">🐠</div>
      <h2 class="aqua-auth-title">Sign in to Aquacellum</h2>
      <p class="aqua-auth-desc">Enter your email to receive a login code</p>
      
      <div id="aqua-auth-step-email">
        <input type="email" id="aqua-auth-email" class="aqua-auth-input" placeholder="your@email.com" autocomplete="email">
        <button class="aqua-auth-submit" id="aqua-auth-send" onclick="window.AquacellumAuth.sendCode()">Send Code</button>
      </div>

      <div id="aqua-auth-step-code" style="display:none">
        <p class="aqua-auth-sent-to">Code sent to <strong id="aqua-auth-sent-email"></strong></p>
        <input type="text" id="aqua-auth-code" class="aqua-auth-input" placeholder="Enter 6-digit code" maxlength="6" autocomplete="one-time-code">
        <button class="aqua-auth-submit" id="aqua-auth-verify" onclick="window.AquacellumAuth.verifyCode()">Verify & Sign In</button>
        <button class="aqua-auth-back" onclick="window.AquacellumAuth.backToEmail()">← Use different email</button>
      </div>

      <div id="aqua-auth-step-loading" style="display:none">
        <div class="aqua-auth-spinner"></div>
        <p class="aqua-auth-loading-text">Signing you in...</p>
      </div>

      <div id="aqua-auth-step-error" style="display:none">
        <p class="aqua-auth-error" id="aqua-auth-error-msg"></p>
        <button class="aqua-auth-back" onclick="window.AquacellumAuth.backToEmail()">Try Again</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Close on overlay click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  return overlay;
}

function showStep(step) {
  ['email', 'code', 'loading', 'error'].forEach(s => {
    const el = document.getElementById(`aqua-auth-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
}

function closeModal() {
  const overlay = document.getElementById('aqua-auth-overlay');
  if (overlay) overlay.remove();
}

// ── Auth Flow ──────────────────────────────────────────────────────
let pendingEmail = '';

async function sendCode() {
  const emailInput = document.getElementById('aqua-auth-email');
  const email = emailInput?.value.trim();
  if (!email || !email.includes('@')) {
    emailInput.style.borderColor = 'rgba(249,112,102,0.5)';
    return;
  }
  pendingEmail = email;
  showStep('loading');
  
  try {
    const privy = getPrivy();
    // Privy js-sdk-core: auth.email.sendCode(email)
    await privy.auth.email.sendCode({ email });
    showStep('code');
    document.getElementById('aqua-auth-sent-email').textContent = email;
    document.getElementById('aqua-auth-code')?.focus();
  } catch (e) {
    console.error('[Auth] Send code failed:', e);
    document.getElementById('aqua-auth-error-msg').textContent = e.message || 'Failed to send code. Please try again.';
    showStep('error');
  }
}

async function verifyCode() {
  const codeInput = document.getElementById('aqua-auth-code');
  const code = codeInput?.value.trim();
  if (!code || code.length < 6) {
    codeInput.style.borderColor = 'rgba(249,112,102,0.5)';
    return;
  }
  showStep('loading');

  try {
    const privy = getPrivy();
    // Privy js-sdk-core: auth.email.loginWithCode({ email, code })
    const authState = await privy.auth.email.loginWithCode({ email: pendingEmail, code });
    const user = authState.user;
    currentUser = user;
    const session = saveSession(user);
    closeModal();
    
    // Notify the page
    window.dispatchEvent(new CustomEvent('aquacellum:auth', { detail: session }));
    
    // Fetch profile if wallet exists
    if (session.walletAddress) {
      const profile = await fetchProfile(session.walletAddress);
      if (profile) {
        session.displayName = profile.display_name;
        session.tier = profile.companion_tier;
        session.xp = profile.xp_total;
        saveSession({ ...user, displayName: profile.display_name });
        window.dispatchEvent(new CustomEvent('aquacellum:profile', { detail: profile }));
      }
    }
  } catch (e) {
    console.error('[Auth] Verify failed:', e);
    document.getElementById('aqua-auth-error-msg').textContent = e.message || 'Invalid code. Please try again.';
    showStep('error');
  }
}

function backToEmail() {
  showStep('email');
}

// ── Public API ─────────────────────────────────────────────────────
function login() {
  // Check existing session first
  const session = getSession();
  if (session) {
    window.dispatchEvent(new CustomEvent('aquacellum:auth', { detail: session }));
    return;
  }
  createLoginModal();
  showStep('email');
  setTimeout(() => document.getElementById('aqua-auth-email')?.focus(), 100);
}

function logout() {
  try {
    const privy = getPrivy();
    privy.auth.logout();
  } catch {}
  clearSession();
  window.dispatchEvent(new CustomEvent('aquacellum:logout'));
  window.location.reload();
}

function isAuthenticated() {
  return getSession() !== null;
}

// ── Auto-restore session on load ───────────────────────────────────
function autoRestore() {
  const session = getSession();
  if (session) {
    currentUser = session;
    // Fire event so page can update UI
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('aquacellum:auth', { detail: session }));
    }, 50);
  }
}

// ── Export to window ───────────────────────────────────────────────
window.AquacellumAuth = {
  login,
  logout,
  isAuthenticated,
  getSession,
  sendCode,
  verifyCode,
  backToEmail,
  closeModal,
  fetchProfile,
};

// Auto-restore on module load
autoRestore();

export { login, logout, isAuthenticated, getSession, fetchProfile };
