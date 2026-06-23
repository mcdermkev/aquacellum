/**
 * supabaseClient.js
 * 
 * Supabase client initialization with Privy wallet auth bridge.
 * 
 * Architecture:
 * - Privy handles authentication (email/Google → embedded wallet)
 * - We bridge the authenticated wallet address into a Supabase session
 *   using a custom JWT minted by a Supabase Edge Function
 * - RLS policies on Supabase use `auth.jwt()->>'wallet_address'` to
 *   scope reads/writes to the connected wallet
 * 
 * Until the Edge Function is deployed, the client operates in "anon" mode
 * with the wallet address passed explicitly in queries. This allows
 * development and testing of the schema/UI before the JWT bridge is live.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[Reef] Supabase credentials not configured. Social features will be unavailable. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env"
  );
}

/**
 * Mutable wallet address for RLS header injection.
 * Updated when the wallet connects/disconnects.
 */
let _walletForHeader = null;

/**
 * Custom fetch wrapper that injects the x-wallet-address header
 * into every Supabase request for RLS enforcement.
 */
function supabaseFetchWithWallet(url, options = {}) {
  if (_walletForHeader) {
    options.headers = {
      ...options.headers,
      "x-wallet-address": _walletForHeader,
    };
  }
  return fetch(url, options);
}

/**
 * The base Supabase client (anon key, no auth session initially).
 * Uses a custom fetch wrapper to inject wallet address headers for RLS.
 */
export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-key",
  {
    auth: {
      // The Privy→Supabase JWT bridge (mint-session edge function) is NOT deployed.
      // The app operates purely in anon mode with the x-wallet-address header for RLS.
      // Persisting a session is harmful here: a stale/invalid token left in localStorage
      // gets sent as the Authorization header on every request, causing 401s that silently
      // break profile reads/writes. Disable persistence and auto-refresh to guarantee
      // every request uses the anon key.
      autoRefreshToken: false,
      persistSession: false,
      storageKey: "aquacellum-reef-auth",
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      fetch: supabaseFetchWithWallet,
    },
  }
);

// One-time cleanup: remove any stale Supabase session persisted by earlier builds
// (when persistSession was true). Without this, a leftover token in localStorage
// could be loaded once and sent as an invalid Authorization header.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    window.localStorage.removeItem("aquacellum-reef-auth");
  } catch {
    // ignore storage access errors (private mode, etc.)
  }
}

/**
 * Set the wallet address header for RLS enforcement.
 * Called when a wallet connects; clears on disconnect.
 */
function setWalletHeader(walletAddress) {
  _walletForHeader = walletAddress ? walletAddress.toLowerCase() : null;
}

/**
 * Track whether we have an active authenticated session.
 */
let _isAuthenticated = false;
let _currentWallet = null;

/**
 * Check if the Supabase client has been configured with real credentials.
 */
export function isSupabaseConfigured() {
  return (
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("placeholder") &&
    !SUPABASE_URL.includes("your-project-id")
  );
}

/**
 * Authenticate the Supabase session using the connected wallet address.
 * 
 * Phase 1 (MVP): Uses a Supabase Edge Function to mint a JWT with the
 * wallet_address claim. The Edge Function verifies the wallet is legitimate
 * by checking a signed message or Privy token.
 * 
 * Fallback: If the Edge Function isn't deployed yet, we set the wallet
 * address in a module-level variable and pass it explicitly in queries.
 * 
 * @param {string} walletAddress - The authenticated wallet address from Privy/MetaMask
 * @param {string} [privyToken] - Optional Privy auth token for verification
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function authenticateWithWallet(walletAddress, privyToken = null) {
  // The mint-session edge function is not deployed (returns 404), so there is no
  // JWT bridge. We operate in anon mode: set the wallet header for RLS and record
  // the current wallet. We deliberately do NOT call supabase.auth.setSession here —
  // doing so previously planted stale tokens that broke profile reads with 401s.
  _currentWallet = walletAddress ? walletAddress.toLowerCase() : walletAddress;
  _isAuthenticated = false;
  setWalletHeader(walletAddress);

  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase not configured" };
  }

  // Defensively clear any lingering Supabase auth session so requests use the anon key.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // ignore — no session to clear
  }

  return { success: true };
}

/**
 * Clear the Supabase session on disconnect.
 */
export async function clearReefSession() {
  _currentWallet = null;
  _isAuthenticated = false;
  setWalletHeader(null);
  try {
    await supabase.auth.signOut();
  } catch (err) {
    // Ignore sign-out errors
  }
}

/**
 * Get the currently authenticated wallet address.
 * Returns null if no wallet is connected.
 */
export function getCurrentWallet() {
  return _currentWallet;
}

/**
 * Check if we have a fully authenticated Supabase session (JWT bridge active).
 * If false, the client is in anon mode and RLS won't enforce wallet-based policies.
 */
export function isFullyAuthenticated() {
  return _isAuthenticated;
}

/**
 * Helper to get the wallet for query filters.
 * Used in anon mode where RLS can't enforce ownership.
 */
export function getWalletFilter() {
  return _currentWallet;
}
