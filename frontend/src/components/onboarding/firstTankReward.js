/**
 * firstTankReward.js — idempotent first-tank onboarding XP grant
 * (onboarding-revamp spec, task 8.1; Req 3.4).
 *
 * When the user registers their first tank during the guided tour we award a
 * small onboarding bonus of +15 XP. This is SEPARATE from the +25
 * `REGISTER_TANK` action XP that the real registration components
 * (`FacilityTreeView` / `TankList`) already award on every tank creation — that
 * generic reward fires regardless of onboarding. The onboarding bonus is a
 * one-time "first tank" milestone.
 *
 * DOUBLE-COUNT GUARD (idempotency): the tour completion can be detected by both
 * the `aquadex:tank_registered` event AND the Dexie `verify()` poll, and the
 * step may be re-entered on resume. To ensure the +15 bonus is granted EXACTLY
 * ONCE, we latch on a `localStorage` flag. Every call after the first is a
 * no-op. This dovetails with the idempotent advance in `useTourStep`
 * (Property 4) and the resumability guarantee (Property 8).
 *
 * The reward is intentionally NOT keyed per-account: it is a single
 * first-tank-ever onboarding milestone for this install, matching how the
 * existing `addXp` profile is a single local profile (see utils/xp.js).
 *
 * Validates: Requirements 3.4
 */

import { awardXp, XP_ACTIONS } from "../../utils/xp";

/**
 * Onboarding first-tank bonus, in XP points.
 *
 * DERIVED from the canonical action rather than hardcoded. It was a literal 15 while
 * `XP_ACTIONS.REGISTER_TANK` said 25 — two values for the identical event — and the
 * mismatch is exactly why the award was rejected server-side and taken back.
 */
export const FIRST_TANK_XP = XP_ACTIONS.REGISTER_TANK.points;

/** Telemetry label recorded in the XP history for this grant. */
export const FIRST_TANK_XP_LABEL = "First Tank Set Up";

/** localStorage latch ensuring the bonus is granted only once. */
export const FIRST_TANK_XP_KEY = "aquadex_onboarding_first_tank_xp";

/** Safe localStorage read — tolerates non-browser/quota-locked environments. */
function readFlag(key) {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Safe localStorage write — never throws (the latch is best-effort). */
function writeFlag(key) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, "true");
  } catch {
    // Ignore quota/availability errors — worst case the bonus could re-grant,
    // which is a negligible, non-breaking outcome.
  }
}

/**
 * hasAwardedFirstTankXp — whether the one-time first-tank bonus already fired.
 *
 * @returns {boolean}
 */
export function hasAwardedFirstTankXp() {
  return readFlag(FIRST_TANK_XP_KEY);
}

/**
 * awardFirstTankXp — grant the +15 first-tank onboarding bonus exactly once.
 *
 * Idempotent: latches on `localStorage` so repeated calls (event + poll race,
 * resume/replay) never double-count (Req 3.4).
 *
 * @returns {{ awarded: boolean, reason?: string, points?: number }}
 *          `awarded: true`  → the bonus was granted on this call.
 *          `awarded: false` → skipped because it was already granted.
 */
export function awardFirstTankXp() {
  if (hasAwardedFirstTankXp()) {
    return { awarded: false, reason: "already-awarded" };
  }
  // Latch BEFORE granting so a re-entrant call (e.g. event + poll firing in the
  // same tick) cannot slip through and double-award.
  writeFlag(FIRST_TANK_XP_KEY);
  // Awarded as REGISTER_TANK, because that is what happened.
  //
  // This used to grant a bespoke 15 points under the label "First Tank Set Up",
  // which matched none of the server's inference rules — it fell through to
  // LOG_FEEDING (5 expected vs 15 claimed), was rejected, and was clawed back. So
  // the very first reward a new keeper ever saw was one they did not keep.
  //
  // The canonical action for registering a tank is worth 25, so the onboarding grant
  // now matches the rest of the app instead of maintaining a second, lower value for
  // the identical event.
  awardXp("REGISTER_TANK");
  return { awarded: true, points: FIRST_TANK_XP };
}

export default awardFirstTankXp;
