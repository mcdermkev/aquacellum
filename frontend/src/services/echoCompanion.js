/**
 * echoCompanion.js
 *
 * Persistence helper for Echo's companion record on hatch (onboarding-revamp
 * spec, task 5.2). When the Echo egg hatches during onboarding we initialize the
 * account's `breederCompanion` Dexie row to its starting state (hatched egg,
 * Bronze tier, initial XP).
 *
 * IDEMPOTENCY (Property 8 — resumability): the write is guarded by an existence
 * check so re-entering the hatch flow (resumed/interrupted session, double-fire
 * of the hatch callback, replay) never overwrites or duplicates an existing
 * companion. If a row already exists for the account it is left untouched.
 *
 * EGG-STATE CONVENTION: this mirrors the value written by the original
 * `OnboardingWizard.jsx` hatch path exactly — `eggState: 1`. (The db.js note
 * describes `1 = active egg / hatched state`.) Matching the existing onboarding
 * write keeps the companion record consistent with what downstream consumers
 * (`useReefProfile`, `TankList`, `BreedersCouncil`) already expect from an
 * onboarding-initialized companion. The design's `eggState: hatched` shorthand
 * maps to this value.
 *
 * Validates: Requirements 2.4 (persist Echo's initial state on hatch).
 */

import { db } from "../db";

/** Egg state written on hatch (1 = active/hatched egg; see db.js schema note). */
export const HATCHED_EGG_STATE = 1;
/** Initial companion XP granted at hatch. */
export const INITIAL_COMPANION_XP = 15;
/** Starting companion tier. */
export const INITIAL_COMPANION_TIER = "Bronze";

/**
 * Build the initial `breederCompanion` record for an account.
 *
 * Shape (per design.md):
 *   { walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash }
 *
 * @param {string} account - wallet address (primary key).
 * @returns {object} the new companion record.
 */
export function buildEchoCompanionRecord(account) {
  return {
    walletAddress: account,
    eggState: HATCHED_EGG_STATE,
    companionXp: INITIAL_COMPANION_XP,
    currentTier: INITIAL_COMPANION_TIER,
    selectedStats: {},
    zoneHash: null,
  };
}

/**
 * Idempotently persist Echo's hatched companion record for `account`.
 *
 * Behavior:
 *   - No account → no-op (pre-account phases never write account-keyed data,
 *     Property 3). Returns `{ created: false, reason: "no-account" }`.
 *   - Existing row → left untouched (idempotent guard). Returns
 *     `{ created: false, reason: "exists" }`.
 *   - Otherwise → inserts the initial record and returns `{ created: true }`.
 *
 * Errors are swallowed (logged) so a hatch can never crash the onboarding flow;
 * a constraint error from a concurrent insert is treated as an idempotent no-op.
 *
 * @param {string} account - connected wallet address.
 * @param {{ database?: import("dexie").Dexie }} [opts] - inject a db for testing.
 * @returns {Promise<{created: boolean, reason?: string, error?: unknown}>}
 */
export async function persistEchoCompanion(account, { database = db } = {}) {
  if (!account) {
    return { created: false, reason: "no-account" };
  }

  try {
    const existing = await database.breederCompanion.get(account);
    if (existing) {
      // Guard by existence check — do not overwrite or duplicate (Property 8).
      return { created: false, reason: "exists" };
    }

    await database.breederCompanion.add(buildEchoCompanionRecord(account));
    return { created: true };
  } catch (err) {
    // A ConstraintError here means a row was added concurrently between our
    // existence check and insert — that is still the idempotent outcome.
    if (err && (err.name === "ConstraintError" || err.name === "DataError")) {
      return { created: false, reason: "exists" };
    }
    console.warn("[onboarding] Failed to persist Echo companion:", err?.message);
    return { created: false, reason: "error", error: err };
  }
}

export default persistEchoCompanion;
