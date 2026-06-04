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
 * The base Supabase client (anon key, no auth session initially).
 * Used for public reads before the user authenticates.
 */
export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-key",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      storageKey: "aquacellum-reef-auth",
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

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
  if (!isSupabaseConfigured()) {
    _currentWallet = walletAddress;
    _isAuthenticated = false;
    return { success: false, error: "Supabase not configured" };
  }

  try {
    // Attempt to mint a session JWT via Edge Function
    const { data, error } = await supabase.functions.invoke("mint-session", {
      body: {
        wallet_address: walletAddress,
        privy_token: privyToken,
      },
    });

    if (error) {
      // Edge function not deployed yet — fall back to anon mode
      console.warn("[Reef] Auth bridge not available yet, using anon mode:", error.message);
      _currentWallet = walletAddress;
      _isAuthenticated = false;
      return { success: false, error: error.message };
    }

    if (data?.access_token) {
      // Set the Supabase session with the custom JWT
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token || data.access_token,
      });

      if (sessionError) {
        console.error("[Reef] Failed to set Supabase session:", sessionError);
        _currentWallet = walletAddress;
        _isAuthenticated = false;
        return { success: false, error: sessionError.message };
      }

      _currentWallet = walletAddress;
      _isAuthenticated = true;
      return { success: true };
    }

    // Fallback if edge function returns unexpected shape
    _currentWallet = walletAddress;
    _isAuthenticated = false;
    return { success: false, error: "Unexpected auth response" };
  } catch (err) {
    console.warn("[Reef] Auth bridge call failed, using anon mode:", err.message);
    _currentWallet = walletAddress;
    _isAuthenticated = false;
    return { success: false, error: err.message };
  }
}

/**
 * Clear the Supabase session on disconnect.
 */
export async function clearReefSession() {
  _currentWallet = null;
  _isAuthenticated = false;
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
