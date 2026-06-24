/**
 * supabaseClient.js
 * 
 * Supabase client initialization with Privy wallet auth bridge.
 * 
 * Architecture:
 * - Privy handles authentication (email/Google → embedded wallet)
 * - We bridge the authenticated wallet address into a Supabase session
 *   using a custom JWT minted by the /api/mint-session Vercel function
 * - The mint-session endpoint verifies the Privy token via JWKS, then
 *   signs a Supabase-compatible JWT with the wallet_address claim
 * - RLS policies on Supabase use `auth.jwt()->>'wallet_address'` to
 *   scope reads/writes to the connected wallet
 * 
 * Fallback: If the JWT bridge fails (endpoint not deployed, missing env,
 * network error), we fall back to anon mode with the x-wallet-address
 * header for backward-compatible RLS enforcement.
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
 *
 * IMPORTANT: supabase-js passes `options.headers` as a `Headers` instance.
 * Spreading it with `{...options.headers}` yields an empty object and silently
 * drops the `apikey` and `Authorization` headers, causing "No API key found in
 * request" → 401 on every request once a wallet is connected. We must merge via
 * the Headers API to preserve the existing headers.
 */
function supabaseFetchWithWallet(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (_walletForHeader) {
    headers.set("x-wallet-address", _walletForHeader);
  }
  return fetch(url, { ...options, headers });
}

/**
 * The base Supabase client (anon key, no auth session initially).
 * Uses a custom fetch wrapper to inject wallet address headers for RLS fallback.
 * 
 * When the JWT bridge is active, the Authorization header carries the minted JWT
 * and RLS uses auth.jwt() claims. The x-wallet-address header is still sent as a
 * fallback for any policies that haven't been updated yet.
 */
export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-key",
  {
    auth: {
      // Enable session persistence now that we have a proper JWT bridge.
      // The minted token (1hr lifetime) is stored in localStorage and the
      // client will use it as the Authorization header on every request.
      autoRefreshToken: false, // We handle refresh via re-minting from Privy token
      persistSession: true,
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

// Clean up stale sessions from builds before the JWT bridge was deployed.
// If the stored token doesn't have a wallet_address claim, it's from the old
// anon-only era and will cause 401s. Remove it so we start fresh.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    const stored = window.localStorage.getItem("aquacellum-reef-auth");
    if (stored) {
      const parsed = JSON.parse(stored);
      const token = parsed?.access_token || parsed?.currentSession?.access_token;
      if (token) {
        // Decode payload (base64url) to check for wallet_address claim
        const payloadB64 = token.split(".")[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
          if (!payload.wallet_address) {
            // Old-style token without wallet claim — clear it
            window.localStorage.removeItem("aquacellum-reef-auth");
          }
        }
      } else {
        // Malformed stored session — clear it
        window.localStorage.removeItem("aquacellum-reef-auth");
      }
    }
  } catch {
    // If anything goes wrong parsing, just clear it
    try { window.localStorage.removeItem("aquacellum-reef-auth"); } catch {}
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
 * Calls the /api/mint-session endpoint with the Privy access token to get
 * a Supabase-compatible JWT, then sets a real authenticated session.
 * 
 * Fallback: If the JWT bridge fails (network error, endpoint not deployed,
 * missing secret), falls back to anon mode with x-wallet-address header.
 * 
 * @param {string} walletAddress - The authenticated wallet address from Privy/MetaMask
 * @param {string} [privyToken] - Privy access token for server-side verification
 * @returns {Promise<{success: boolean, authenticated: boolean, error?: string}>}
 */
export async function authenticateWithWallet(walletAddress, privyToken = null) {
  _currentWallet = walletAddress ? walletAddress.toLowerCase() : walletAddress;
  _isAuthenticated = false;
  setWalletHeader(walletAddress);

  if (!isSupabaseConfigured()) {
    return { success: false, authenticated: false, error: "Supabase not configured" };
  }

  // If we have a Privy token, attempt the JWT bridge
  if (privyToken) {
    try {
      const response = await fetch("/api/mint-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${privyToken}`,
        },
        body: JSON.stringify({ walletAddress: _currentWallet }),
      });

      if (response.ok) {
        const { access_token, expires_at } = await response.json();

        if (access_token) {
          // Set the real Supabase session with the minted JWT.
          // We use a dummy refresh token since we handle re-minting ourselves
          // when the Privy token refreshes.
          const { error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token: access_token, // No refresh token — we re-mint from Privy
          });

          if (!sessionError) {
            _isAuthenticated = true;
            _sessionExpiresAt = expires_at;
            return { success: true, authenticated: true };
          } else {
            console.warn("[Reef] setSession failed, falling back to header mode:", sessionError.message);
          }
        }
      } else if (response.status === 503) {
        // JWT bridge not configured (SUPABASE_JWT_SECRET missing) — expected in some envs
        console.info("[Reef] JWT bridge not configured (503), using header-based RLS");
      } else {
        const errBody = await response.json().catch(() => ({}));
        console.warn("[Reef] mint-session failed:", response.status, errBody.error || "");
      }
    } catch (err) {
      // Network error, endpoint not deployed, etc. — fall back gracefully
      console.warn("[Reef] JWT bridge unavailable, falling back to header mode:", err.message);
    }
  }

  // Fallback: anon mode with x-wallet-address header
  // Clear any lingering session so requests use the anon key + header
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // ignore — no session to clear
  }

  return { success: true, authenticated: false };
}

/**
 * Refresh the Supabase session by re-minting from a fresh Privy token.
 * Called when the existing session is about to expire.
 * 
 * @param {string} privyToken - Fresh Privy access token
 * @returns {Promise<boolean>} Whether the refresh succeeded
 */
export async function refreshSession(privyToken) {
  if (!_currentWallet || !privyToken) return false;

  try {
    const response = await fetch("/api/mint-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${privyToken}`,
      },
      body: JSON.stringify({ walletAddress: _currentWallet }),
    });

    if (response.ok) {
      const { access_token, expires_at } = await response.json();
      if (access_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token: access_token,
        });
        if (!error) {
          _isAuthenticated = true;
          _sessionExpiresAt = expires_at;
          return true;
        }
      }
    }
  } catch (err) {
    console.warn("[Reef] Session refresh failed:", err.message);
  }

  return false;
}

/** Timestamp (unix seconds) when the current session token expires */
let _sessionExpiresAt = null;

/**
 * Check if the current session needs refresh (within 5 min of expiry).
 */
export function sessionNeedsRefresh() {
  if (!_isAuthenticated || !_sessionExpiresAt) return false;
  const now = Math.floor(Date.now() / 1000);
  return (now + 300) >= _sessionExpiresAt; // 5 min buffer
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
