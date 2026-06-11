/**
 * persistCompanion — idempotent persistence of the Echo companion on hatch.
 *
 * When the Echo egg hatches (see `EchoStage`), we write a single
 * `breederCompanion` Dexie row for the connected account capturing Echo's
 * initial state: hatched egg, Bronze tier, and a small starting XP grant.
 *
 * Idempotency (Property 8 — resumability): if a `breederCompanion` row already
 * exists for the account we DO NOT overwrite or duplicate it. Re-entering the
 * hatch phase after an interruption is therefore a no-op for the companion
 * record. This guards XP/tier from being reset on replay/resume.
 *
 * Convention notes (kept consistent with the rest of the codebase):
 *   - `eggState: 1` is the "hatched/active" egg state. This matches the
 *     existing write in `OnboardingWizard.jsx` and the mapping documented in
 *     `db.js` (Version 8 comment: "1 = active egg/hatched state").
 *   - Initial `companionXp` is 15 and `currentTier` is "Bronze", per design.md
 *     ("Set on hatch: { ... eggState: hatched, companionXp: 15, currentTier:
 *     'Bronze', selectedStats:{}, zoneHash:null }").
 *   - The `breederCompanion` schema is keyed on `walletAddress` (see `db.js`).
 *
 * Validates: Requirements 2.4 (persist Echo's initial state on hatch).
 */

import { db } from "../../db.js";

// Numeric egg-state code for a hatched/active Echo. See db.js Version 8 notes
// and the existing OnboardingWizard hatch write for the source of this mapping.
export const ECHO_EGG_STATE_HATCHED = 1;

// Starting XP granted to Echo at hatch (mirrors design.md + existing wizard).
export const ECHO_INITIAL_XP = 15;

// Starting tier for a freshly hatched Echo.
export const ECHO_INITIAL_TIER = "Bronze";

/**
 * Build the initial `breederCompanion` record for a freshly hatched Echo.
 *
 * Pure/side-effect-free so the shape can be asserted in unit tests without a DB.
 *
 * @param {string} account  The connected wallet address (primary key).
 * @returns {{
 *   walletAddress: string,
 *   eggState: number,
 *   companionXp: number,
 *   currentTier: string,
 *   selectedStats: object,
 *   zoneHash: null,
 * }}
 */
export function buildInitialCompanion(account) {
  return {
    walletAddress: account,
    eggState: ECHO_EGG_STATE_HATCHED,
    companionXp: ECHO_INITIAL_XP,
    currentTier: ECHO_INITIAL_TIER,
    selectedStats: {},
    zoneHash: null,
  };
}

/**
 * persistCompanionOnHatch — write the initial Echo companion row, once.
 *
 * Idempotent by an existence check: if a row already exists for `account` the
 * call is a no-op and the existing row is left untouched (Property 8).
 *
 * Failures are swallowed (logged as a warning) so a Dexie hiccup never blocks
 * the hatch animation / onboarding progression — matching the resilience
 * posture of the existing wizard.
 *
 * @param {string} account  The connected wallet address. When falsy, this is a
 *        no-op (Property 3 — no per-account writes before an account exists).
 * @returns {Promise<{ created: boolean, reason?: string }>}
 *          `created: true`  → a new companion row was written.
 *          `created: false` → skipped (no account, already existed, or error).
 */
export async function persistCompanionOnHatch(account) {
  if (!account) {
    return { created: false, reason: "no-account" };
  }

  try {
    // Existence guard: never overwrite or duplicate an existing companion.
    const existing = await db.breederCompanion.get(account);
    if (existing) {
      return { created: false, reason: "exists" };
    }

    await db.breederCompanion.add(buildInitialCompanion(account));
    return { created: true };
  } catch (err) {
    // Non-fatal: log and report skipped so onboarding can proceed regardless.
    console.warn("Failed to persist Echo companion on hatch:", err);
    return { created: false, reason: "error" };
  }
}

export default persistCompanionOnHatch;
