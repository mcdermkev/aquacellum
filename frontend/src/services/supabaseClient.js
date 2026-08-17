/**
 * supabaseClient.js
 * 
 * Supabase client initialization with Privy wallet auth bridge.
 * 
 * Architecture:
 * - Privy handles authentication (email/Google → embedded wallet)
 * - We bridge the authenticated wallet address into Supabase requests using a
 *   custom JWT minted by the /api/mint-session Vercel function, attached as the
 *   Authorization header (NOT as a GoTrue session — see _mintedToken below)
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
 * The Supabase-compatible JWT minted by /api/mint-session, attached directly to
 * outgoing REST requests.
 *
 * WHY NOT supabase.auth.setSession(): GoTrue validates its own tokens. It
 * requires `sub` to be a UUID and then looks that UUID up in `auth.users`.
 * These are wallet-identified users minted from a Privy DID — there is no
 * `auth.users` row and `sub` is not a UUID — so setSession failed with
 * "invalid claim: sub claim must be a UUID" (and a 400 on /auth/v1/user),
 * dropping every session into the anon fallback. Making `sub` a UUID alone
 * would not fix it; the user lookup would still miss.
 *
 * PostgREST does not care: it verifies the HS256 signature against the project
 * JWT secret and reads `role` and `wallet_address` straight from the claims.
 * Attaching the token here therefore reaches the `authenticated` role and the
 * listings_*_jwt policies without involving GoTrue at all.
 */
let _mintedToken = null;

/**
 * The in-flight mint, if one is running.
 *
 * Requests issued while the bridge is still minting must WAIT for it, because the
 * JWT is now the only credential that carries any authority. RLS previously also
 * accepted an `x-wallet-address` header, which is set synchronously the moment a
 * wallet connects — so that header quietly covered this window.
 *
 * Those header policies are gone (they were forgeable: a probe with a fabricated
 * header returned another wallet's 38 specimens, 6 tanks and 200 XP events). With
 * them removed, a query that races the mint is no longer merely unauthenticated —
 * it comes back as a clean, cacheable EMPTY RESULT, which looks exactly like "you
 * own nothing" rather than like a failure.
 */
let _mintInFlight = null;

/**
 * Custom fetch wrapper that injects the x-wallet-address header
 * into every Supabase request for RLS enforcement, plus the minted JWT when the
 * bridge is active.
 *
 * IMPORTANT: supabase-js passes `options.headers` as a `Headers` instance.
 * Spreading it with `{...options.headers}` yields an empty object and silently
 * drops the `apikey` and `Authorization` headers, causing "No API key found in
 * request" → 401 on every request once a wallet is connected. We must merge via
 * the Headers API to preserve the existing headers.
 */
async function supabaseFetchWithWallet(url, options = {}) {
  // Wait for an in-flight mint so a request cannot land credential-less during
  // sign-in and cache an empty result. Never block /auth/v1/* (which must not
  // receive the minted token at all) and never block the mint itself.
  if (_mintInFlight && !String(url).includes("/auth/v1/")) {
    try {
      await _mintInFlight;
    } catch {
      /* a failed mint must not block the request — it just goes out unauthenticated */
    }
  }

  const headers = new Headers(options.headers || {});
  if (_walletForHeader) {
    headers.set("x-wallet-address", _walletForHeader);
  }
  // Never send the minted token to GoTrue — it would reject it and these are
  // exactly the /auth/v1/* 400s this approach exists to avoid. `apikey` stays
  // the anon key either way; Supabase requires it on every request.
  if (_mintedToken && !String(url).includes("/auth/v1/")) {
    headers.set("Authorization", "Bearer " + _mintedToken);
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
      // The minted JWT is NOT stored as a GoTrue session — it is attached per
      // request by supabaseFetchWithWallet (see _mintedToken). These settings
      // are therefore inert for the bridge; they only govern any legacy stored
      // session, which the cleanup block below clears. Re-minting happens on
      // mount via AuthContext and every 5 min via refreshSession.
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
 * Event name fired whenever the Reef session state changes (bridge minted,
 * re-minted, downgraded to header mode, or cleared).
 *
 * WHY THIS EXISTS. `_isAuthenticated` and `_mintedToken` are module-level, and
 * `AuthContext` kicks `authenticateWithWallet()` off inside an async effect
 * without publishing anything to React when it completes. So a component that
 * reads `isFullyAuthenticated()` on mount can latch a "not signed in" answer
 * that is already stale by the time it renders — and never learn otherwise.
 *
 * That was a real, visible bug: on mobile, where `getAccessToken()` plus the
 * `/api/mint-session` round trip is slower than on desktop, the Settings
 * notification panel mounted before the bridge landed and showed "Sign in to
 * enable notifications" permanently, even while signed in. Logging out and back
 * in did not help, because the panel still only read the value once.
 *
 * Emitting an event is deliberately additive: no auth behaviour changes, and
 * consumers opt in. Anything deriving UI from bridge state should listen.
 */
export const REEF_SESSION_EVENT = "aquadex:reef-session";

function publishSessionState() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(REEF_SESSION_EVENT, {
        detail: { wallet: _currentWallet, authenticated: _isAuthenticated },
      })
    );
  } catch {
    // CustomEvent unavailable (non-browser test env) — nothing to publish to.
  }
}

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
 * Cache of lowercased-wallet -> exact-casing-stored-in-profiles.
 * Avoids repeated profile lookups for the same wallet within a session.
 */
const _walletCaseCache = new Map();

/**
 * Resolve a wallet address to the EXACT casing stored in the profiles table.
 *
 * Social tables (follows, school_members, school_invites, tide_attendees,
 * conversations, messages, connection_requests, mentorships, ...) have foreign
 * keys to profiles.wallet_address, and that equality is CASE-SENSITIVE. Profiles
 * exist in mixed casing — most are legacy checksummed rows, some are newer
 * lowercase rows — so a blindly-lowercased wallet (what getCurrentWallet returns)
 * frequently matches no profile row and every INSERT is rejected by the FK.
 *
 * Looking up the stored value first keeps the write valid regardless of how the
 * profile was saved. Falls back to the lowercased input when no profile exists.
 */
export async function resolveProfileWallet(walletAddress) {
  if (!walletAddress) return walletAddress;
  const lower = walletAddress.toLowerCase();
  if (_walletCaseCache.has(lower)) return _walletCaseCache.get(lower);
  if (!isSupabaseConfigured()) return lower;

  // Exact lowercase match (newer profile rows)
  const { data: exact } = await supabase
    .from("profiles")
    .select("wallet_address")
    .eq("wallet_address", lower)
    .maybeSingle();
  if (exact?.wallet_address) {
    _walletCaseCache.set(lower, exact.wallet_address);
    return exact.wallet_address;
  }

  // Case-insensitive match (legacy checksummed profile rows)
  const { data: legacy } = await supabase
    .from("profiles")
    .select("wallet_address")
    .ilike("wallet_address", lower)
    .maybeSingle();
  if (legacy?.wallet_address) {
    _walletCaseCache.set(lower, legacy.wallet_address);
    return legacy.wallet_address;
  }

  return lower;
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
  // Drop any previous token up front so a failed re-auth cannot keep using a
  // stale one for a different wallet.
  _mintedToken = null;
  setWalletHeader(walletAddress);

  if (!isSupabaseConfigured()) {
    publishSessionState();
    return { success: false, authenticated: false, error: "Supabase not configured" };
  }

  // If we have a Privy token, attempt the JWT bridge
  if (privyToken) {
    // Published so concurrent Supabase requests can await it rather than racing
    // ahead without a credential. Resolved in the finally below whatever happens.
    let settleMint;
    _mintInFlight = new Promise((resolve) => { settleMint = resolve; });

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
          // Attach the minted JWT directly rather than handing it to GoTrue via
          // supabase.auth.setSession() — see the _mintedToken note above for why
          // that path cannot work for wallet-identified users.
          _mintedToken = access_token;
          _isAuthenticated = true;
          _sessionExpiresAt = expires_at;
          // Tell listeners the bridge is live. Without this, anything that read
          // isFullyAuthenticated() before now stays wrong forever.
          publishSessionState();
          return { success: true, authenticated: true };
        }
      } else if (response.status === 503) {
        // SUPABASE_JWT_SECRET missing on the server. This used to be survivable
        // because RLS also accepted the x-wallet-address header; it is not any
        // more. There is NO header fallback — every owner-scoped read will now
        // return empty until the bridge works, so this is an error, not a notice.
        console.error(
          "[Reef] JWT bridge not configured (503): SUPABASE_JWT_SECRET is missing. " +
          "Owner-scoped data will read as empty — RLS no longer accepts the x-wallet-address header."
        );
      } else {
        const errBody = await response.json().catch(() => ({}));
        console.error("[Reef] mint-session failed:", response.status, errBody.error || "");
      }
    } catch (err) {
      console.error(
        "[Reef] JWT bridge unavailable — owner-scoped data will read as empty. " +
        "There is no header fallback any more:", err.message
      );
    } finally {
      // Always release waiters, success or failure, or every later Supabase
      // request would hang on a promise that never settles.
      _mintInFlight = null;
      settleMint();
    }
  }

  // Fallback: anon mode with x-wallet-address header.
  // NOTE: since the RLS lockdown (20260729) this fallback can no longer READ
  // aquadex_listings — anon has no SELECT policy on it, and the read comes back
  // as an empty array with no error. cloudSync.pullCloudListings retries against
  // the aquadex_listings_public view so the in-app board degrades instead of
  // rendering empty. Writes still work here via the x-wallet-address policies.
  _mintedToken = null;
  // Clear any lingering session so requests use the anon key + header
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // ignore — no session to clear
  }

  // Publish the downgrade too: "signed in but in header mode" is a distinct
  // state from "bridge live", and push enrolment depends on the difference.
  publishSessionState();
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
        // Swap the attached token in place — same reasoning as
        // authenticateWithWallet: GoTrue is not involved.
        _mintedToken = access_token;
        _isAuthenticated = true;
        _sessionExpiresAt = expires_at;
        publishSessionState();
        return true;
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
  _mintedToken = null;
  _sessionExpiresAt = null;
  setWalletHeader(null);
  try {
    await supabase.auth.signOut();
  } catch (err) {
    // Ignore sign-out errors
  }
  publishSessionState();
}

/**
 * Get the currently authenticated wallet address.
 * Returns null if no wallet is connected.
 */
export function getCurrentWallet() {
  return _currentWallet;
}

/**
 * The minted Supabase JWT, for calling our OWN authenticated API routes.
 *
 * Exposed so a server route can establish the caller's wallet from a signature
 * it can verify (HS256 over SUPABASE_JWT_SECRET) instead of trusting a wallet
 * passed in the request body. `/api/retention?action=test-push` uses this: a
 * body parameter would let anyone send a push to any wallet, whereas this token
 * can only have been obtained by passing Privy verification at
 * `/api/mint-session`, and it carries the wallet as a signed claim.
 *
 * Returns null in anon/header fallback mode, which callers should treat as
 * "not signed in" rather than retrying.
 */
export function getMintedToken() {
  return _mintedToken;
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
