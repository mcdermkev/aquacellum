/**
 * sellerVacation.js — seller vacation ("away") mode.
 *
 * A breeder who cannot pause their store either ships fish they cannot ship, or
 * fails an order they never wanted to take. For livestock that is not a
 * convenience feature.
 *
 * ⚠️ THE DANGEROUS VERSION OF THIS FEATURE is a Settings toggle that writes a flag
 * nothing enforces: the seller believes the store is closed while orders for live
 * animals keep arriving. So the decision function below is the single source of
 * truth and it is consumed at the checkout gate (`services/cartRevalidation.js`),
 * not just rendered.
 *
 * STATE IS A DATE, NOT A BOOLEAN (`breeder_profiles.vacation_until`):
 *   NULL / past  → accepting orders
 *   future       → paused, auto-resumes at that instant
 *
 * Auto-resume is the point. A boolean has to be switched back manually and fails
 * silently when forgotten — the store stays shut and nobody notices until sales
 * have already stopped. A date cannot forget.
 *
 * Pure functions take an injected `now` so the boundary behaviour is testable
 * without faking clocks, and so every caller in one render pass can share a single
 * timestamp rather than each reading `Date.now()` a few milliseconds apart.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";

/** Longest pause we will accept, so a typo cannot shut a store for a decade. */
export const MAX_VACATION_DAYS = 180;

/**
 * Is this seller currently paused?
 *
 * @param {{ vacation_until?: string|null }|null|undefined} profile
 * @param {number} [now] - epoch ms; defaults to the current time
 * @returns {boolean}
 */
export function isSellerPaused(profile, now = Date.now()) {
  const until = profile?.vacation_until;
  if (!until) return false;
  const untilMs = new Date(until).getTime();
  // An unparseable value must NOT read as paused — that would shut a store based
  // on corrupt data. Fail open here, because the safe default for a seller's
  // livelihood is "taking orders", and the reverse error is recoverable by the
  // seller noticing and re-pausing.
  if (!Number.isFinite(untilMs)) return false;
  return untilMs > now;
}

/**
 * Whole days remaining, rounded up, or 0 when not paused. Used for buyer-facing
 * copy ("back in 3 days") which reads better than a raw timestamp.
 */
export function vacationDaysRemaining(profile, now = Date.now()) {
  if (!isSellerPaused(profile, now)) return 0;
  const untilMs = new Date(profile.vacation_until).getTime();
  return Math.ceil((untilMs - now) / (24 * 60 * 60 * 1000));
}

/**
 * Buyer-facing notice, or null when the seller is available.
 *
 * Deliberately states a RETURN DATE rather than just "unavailable": "back on the
 * 20th" tells a buyer to wait, where "unavailable" tells them to go elsewhere.
 */
export function vacationNotice(profile, now = Date.now()) {
  if (!isSellerPaused(profile, now)) return null;
  const until = new Date(profile.vacation_until);
  const days = vacationDaysRemaining(profile, now);
  const dateText = until.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return days <= 1
    ? "This seller is away and back tomorrow."
    : `This seller is away until ${dateText} (${days} days).`;
}

/**
 * Build the lowercased wallet set that `revalidateCart` consumes.
 *
 * Lowercased because wallet casing is inconsistent across this schema — the
 * `supabaseClient` carries a whole case-resolution cache for exactly this reason,
 * and a case mismatch here would silently fail to pause a seller.
 *
 * @param {Array<{wallet_address: string, vacation_until?: string|null}>} profiles
 * @param {number} [now]
 * @returns {Set<string>}
 */
export function pausedSellerSet(profiles, now = Date.now()) {
  const paused = new Set();
  for (const profile of profiles || []) {
    if (profile?.wallet_address && isSellerPaused(profile, now)) {
      paused.add(String(profile.wallet_address).toLowerCase());
    }
  }
  return paused;
}

/**
 * Clamp a requested end date into something sane.
 *
 * @param {string|Date} until
 * @param {number} [now]
 * @returns {{ ok: boolean, iso?: string, error?: string }}
 */
export function validateVacationUntil(until, now = Date.now()) {
  const ms = until instanceof Date ? until.getTime() : new Date(until).getTime();
  if (!Number.isFinite(ms)) return { ok: false, error: "That date could not be read." };
  if (ms <= now) return { ok: false, error: "Pick a date in the future." };
  const maxMs = now + MAX_VACATION_DAYS * 24 * 60 * 60 * 1000;
  if (ms > maxMs) {
    return { ok: false, error: `Pauses are limited to ${MAX_VACATION_DAYS} days at a time.` };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Read the caller's own vacation state.
 * @param {string} walletAddress
 */
export async function getMyVacation(walletAddress) {
  if (!isSupabaseConfigured() || !walletAddress) return { data: null, error: null };
  const { data, error } = await supabase
    .from("breeder_profiles")
    .select("wallet_address, vacation_until")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  return { data: data || null, error: error?.message || null };
}

/**
 * Pause until `until`, or resume when `until` is null.
 *
 * ⚠️ Checks the write actually landed. A silent RLS failure here would leave the
 * seller believing their store is closed while it keeps taking orders — the exact
 * failure this feature exists to prevent, and the same shape as the profile-delete
 * bug that let 287 test rows accumulate (a filtered write returns success with zero
 * rows affected).
 *
 * @param {string} walletAddress
 * @param {string|null} untilIso - ISO timestamp, or null to resume
 */
export async function setMyVacation(walletAddress, untilIso) {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured" };
  if (!walletAddress) return { ok: false, error: "Not connected" };

  const wallet = walletAddress.toLowerCase();
  const { data, error } = await supabase
    .from("breeder_profiles")
    .update({ vacation_until: untilIso })
    .eq("wallet_address", wallet)
    .select("wallet_address, vacation_until");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Could not update your store status — no seller profile was changed. " +
        "Set up your storefront first, then try again.",
    };
  }
  return { ok: true, data: data[0] };
}

/**
 * Fetch vacation state for a set of sellers, for cart revalidation.
 * @param {string[]} walletAddresses
 */
export async function getPausedSellers(walletAddresses) {
  if (!isSupabaseConfigured()) return new Set();
  const wallets = [...new Set((walletAddresses || []).filter(Boolean).map((w) => String(w).toLowerCase()))];
  if (wallets.length === 0) return new Set();

  const { data, error } = await supabase
    .from("breeder_profiles")
    .select("wallet_address, vacation_until")
    .in("wallet_address", wallets)
    .not("vacation_until", "is", null);

  // Fail OPEN on a read error: blocking checkout because a lookup failed would
  // turn a transient database blip into lost sales for sellers who are available.
  if (error) {
    console.warn("[sellerVacation] paused-seller lookup failed:", error.message);
    return new Set();
  }
  return pausedSellerSet(data);
}

export default {
  isSellerPaused,
  vacationDaysRemaining,
  vacationNotice,
  pausedSellerSet,
  validateVacationUntil,
  getMyVacation,
  setMyVacation,
  getPausedSellers,
};
