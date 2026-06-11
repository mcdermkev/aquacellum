/**
 * useOnboardingGate.js
 *
 * Determines whether the onboarding wizard should render for the current user.
 *
 * The per-account profile flag is the SOURCE OF TRUTH (Requirements 6.1, 6.2, 6.6);
 * `localStorage` is only a fast-path cache that avoids an onboarding "flash" on reload.
 *
 * Resolution order (see design.md → "Gating Logic"):
 *   1. localStorage cache `aquadex_onboarding_complete === "true"` → don't show (instant fast path).
 *   2. else once `account` is known, read the profile flag:
 *        - Supabase `profiles.onboarding_complete` (via reefApi/getProfile), with the Dexie
 *          `userProfile.onboardingComplete` mirror as an offline-first fallback.
 *        - complete  → don't show, and refresh the localStorage cache.
 *        - incomplete → show (first-time account).
 *   3. authenticated but no account yet → show (new user mid-provisioning).
 *
 * The cache may accelerate a "don't show" decision but never overrides a `true` server flag —
 * Property 1 (show-once per account): the cache is only ever written when the resolved flag is true.
 */

import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getProfile } from "../services/reefApi";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { db } from "../db";

/** localStorage fast-path cache key (not the source of truth). */
export const ONBOARDING_CACHE_KEY = "aquadex_onboarding_complete";

/** Read the fast-path cache, tolerating environments without localStorage. */
function readCacheComplete() {
  try {
    return localStorage.getItem(ONBOARDING_CACHE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Refresh the fast-path cache once the server flag resolves to true. */
function refreshCache() {
  try {
    localStorage.setItem(ONBOARDING_CACHE_KEY, "true");
  } catch {
    // Ignore quota/availability errors — the cache is non-authoritative.
  }
}

/**
 * Pure decision function mapping resolved inputs to the gate result.
 * Extracted so the precedence rules can be unit-tested without React.
 *
 * @returns {{ showOnboarding: boolean, loading: boolean }}
 */
export function resolveGate({
  cacheComplete,
  ready,
  authenticated,
  account,
  profileResolved,
  profileComplete,
}) {
  // 1. Fast path: cached completion → never show (instant, avoids flash).
  if (cacheComplete) return { showOnboarding: false, loading: false };

  // Auth subsystem not ready yet — decision is pending.
  if (!ready) return { showOnboarding: false, loading: true };

  // Not logged in → nothing to onboard (App renders its login surface).
  if (!authenticated) return { showOnboarding: false, loading: false };

  // 3. Authenticated but the embedded wallet/account hasn't resolved → new user, show.
  if (!account) return { showOnboarding: true, loading: false };

  // 2. Account known but the profile flag hasn't been read yet → still resolving.
  if (!profileResolved) return { showOnboarding: false, loading: true };

  // Profile flag resolved: show only when onboarding is NOT complete.
  return { showOnboarding: !profileComplete, loading: false };
}

/**
 * Read the per-account onboarding-complete flag.
 * Supabase is preferred; the Dexie mirror is the offline-first fallback (or when the
 * `onboarding_complete` column is absent).
 *
 * @param {string} account
 * @returns {Promise<boolean>}
 */
export async function fetchAccountOnboardingComplete(account) {
  let complete = null; // null = unknown, fall through to the next source.

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getProfile(account);
      if (!error && data && data.onboarding_complete !== undefined && data.onboarding_complete !== null) {
        complete = !!data.onboarding_complete;
      }
    } catch (err) {
      console.warn("[onboarding-gate] Supabase profile read failed:", err?.message);
    }
  }

  if (complete === null) {
    try {
      const profile = await db.userProfile.get(account);
      complete = !!(profile && profile.onboardingComplete);
    } catch (err) {
      console.warn("[onboarding-gate] Dexie profile read failed:", err?.message);
      complete = false;
    }
  }

  return complete;
}

/**
 * Hook: decide whether onboarding should render.
 *
 * @param {string|null} account - the connected account address (from useAuth).
 * @returns {{ showOnboarding: boolean, loading: boolean }}
 */
export function useOnboardingGate(account) {
  const { ready, authenticated } = useAuth();
  const [profileState, setProfileState] = useState({
    resolved: false,
    complete: false,
    account: null,
  });

  const cacheComplete = readCacheComplete();

  useEffect(() => {
    // Fast path or no account to resolve against → no async work needed.
    if (cacheComplete || !ready || !authenticated || !account) {
      setProfileState((prev) =>
        prev.resolved || prev.account ? { resolved: false, complete: false, account: null } : prev
      );
      return;
    }

    let cancelled = false;
    // Mark the flag as unresolved for the new account while we fetch.
    setProfileState({ resolved: false, complete: false, account });

    fetchAccountOnboardingComplete(account).then((complete) => {
      if (cancelled) return;
      if (complete) refreshCache();
      setProfileState({ resolved: true, complete, account });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheComplete, ready, authenticated, account]);

  const profileResolved = profileState.resolved && profileState.account === account;

  return resolveGate({
    cacheComplete,
    ready,
    authenticated,
    account,
    profileResolved,
    profileComplete: profileState.complete,
  });
}

export default useOnboardingGate;
