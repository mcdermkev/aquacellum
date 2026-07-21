/**
 * deliveryEligibility.js
 *
 * Local-courier delivery safety-eligibility engine (Task 12, Tier A). Decides
 * whether a live-animal order may go out for local courier delivery, and if
 * not, whether the buyer should reschedule or fall back to pickup. Live animals
 * make this a safety decision, not just a logistics one: a courier leg that is
 * too long, too hot/cold, or improperly packaged is lethal.
 *
 * Provider-agnostic: it takes a normalized context (seller limits, distance,
 * conditions, packaging, provider capabilities) so the same rules apply to any
 * courier adapter (mock, DoorDash Drive, etc.).
 *
 * Pure and dependency-free. When no safe courier option exists it returns a
 * PICKUP_FALLBACK verdict (the plan's required "always offer pickup when courier
 * isn't safe").
 */

// ─── Safety thresholds (documented, tunable) ─────────────────────────────────

// Max time live animals should sit in a courier bag for a LOCAL leg.
export const MAX_LIVESTOCK_TRANSIT_MINUTES = 120;
// Ambient safe band (°F) for an insulated-but-unheated parcel.
export const SAFE_TEMP_MIN_F = 45;
export const SAFE_TEMP_MAX_F = 90;
// A thermal pack widens the tolerable ambient band.
export const THERMAL_PACK_TEMP_MARGIN_F = 12;
// Adult size (cm) above which a specimen needs special handling (caution).
export const LARGE_SPECIMEN_CM = 30;

export const DELIVERY_VERDICT = Object.freeze({
  ELIGIBLE: "eligible", // safe to dispatch a courier now
  RESCHEDULE: "reschedule", // courier is possible, but not for the requested time
  PICKUP_FALLBACK: "pickup_fallback", // no safe courier option — offer pickup
});

export const DELIVERY_BLOCKERS = Object.freeze({
  OUT_OF_RADIUS: "out_of_radius",
  TRANSIT_TOO_LONG: "transit_too_long",
  PROVIDER_MAX_TRAVEL: "provider_max_travel",
  PROVIDER_PROHIBITS_LIVESTOCK: "provider_prohibits_livestock",
  INADEQUATE_PACKAGING: "inadequate_packaging",
  UNSAFE_TEMPERATURE: "unsafe_temperature",
});

export const DELIVERY_TIMING = Object.freeze({
  OUTSIDE_OPERATING_HOURS: "outside_operating_hours",
  INSUFFICIENT_PREP_LEAD: "insufficient_prep_lead",
});

/**
 * Evaluate delivery eligibility.
 *
 * @param {Object} ctx
 * @param {Object} ctx.seller - { radiusMiles, prepLeadTimeMinutes, operatingHours? }
 * @param {number} ctx.distanceMiles - seller→buyer distance
 * @param {number} ctx.etaMinutes - estimated courier travel time
 * @param {Object} ctx.provider - { maxTravelMinutes, allowsLivestock, operatingHours? }
 * @param {Object} ctx.packaging - { sealed, insulated, leakProof, thermalPack }
 * @param {Object} ctx.conditions - { originTempF, destTempF }
 * @param {Object} [ctx.window] - { startAt, now } requested pickup start + current time (epoch ms)
 * @param {Object[]} [ctx.speciesProfiles] - normalized species (for size cautions)
 * @returns {{
 *   verdict:string, eligibleNow:boolean,
 *   blockers: Array<{code:string, message:string}>,
 *   timingIssues: Array<{code:string, message:string}>,
 *   cautions: Array<{code:string, message:string}>,
 *   recommendedFallback: ('pickup'|null)
 * }}
 */
export function evaluateDeliveryEligibility(ctx = {}) {
  const blockers = [];
  const timingIssues = [];
  const cautions = [];
  const add = (arr, code, message) => arr.push({ code, message });

  const seller = ctx.seller || {};
  const provider = ctx.provider || {};
  const packaging = ctx.packaging || {};
  const conditions = ctx.conditions || {};

  // ── Hard safety blockers (→ pickup fallback if any) ────────────────────────

  if (num(ctx.distanceMiles) != null && num(seller.radiusMiles) != null && ctx.distanceMiles > seller.radiusMiles) {
    add(blockers, DELIVERY_BLOCKERS.OUT_OF_RADIUS, `Buyer is ${ctx.distanceMiles} mi away; seller delivers within ${seller.radiusMiles} mi.`);
  }

  if (num(ctx.etaMinutes) != null) {
    if (ctx.etaMinutes > MAX_LIVESTOCK_TRANSIT_MINUTES) {
      add(blockers, DELIVERY_BLOCKERS.TRANSIT_TOO_LONG, `Courier ETA ${ctx.etaMinutes} min exceeds the ${MAX_LIVESTOCK_TRANSIT_MINUTES} min live-animal limit.`);
    }
    if (num(provider.maxTravelMinutes) != null && ctx.etaMinutes > provider.maxTravelMinutes) {
      add(blockers, DELIVERY_BLOCKERS.PROVIDER_MAX_TRAVEL, `Courier ETA ${ctx.etaMinutes} min exceeds the provider limit of ${provider.maxTravelMinutes} min.`);
    }
  }

  if (provider.allowsLivestock === false) {
    add(blockers, DELIVERY_BLOCKERS.PROVIDER_PROHIBITS_LIVESTOCK, "The selected courier provider does not permit live animals.");
  }

  if (!(packaging.sealed && packaging.insulated && packaging.leakProof)) {
    add(blockers, DELIVERY_BLOCKERS.INADEQUATE_PACKAGING, "Live-animal courier requires sealed, insulated, leak-proof packaging.");
  }

  // Temperature band (widened when a thermal pack is included).
  const margin = packaging.thermalPack ? THERMAL_PACK_TEMP_MARGIN_F : 0;
  const lo = SAFE_TEMP_MIN_F - margin;
  const hi = SAFE_TEMP_MAX_F + margin;
  for (const [label, t] of [["origin", conditions.originTempF], ["destination", conditions.destTempF]]) {
    const v = num(t);
    if (v != null && (v < lo || v > hi)) {
      add(blockers, DELIVERY_BLOCKERS.UNSAFE_TEMPERATURE, `${label} temperature ${v}°F is outside the safe band ${lo}–${hi}°F.`);
    }
  }

  // ── Timing issues (courier is safe, just not at the requested time) ────────

  if (ctx.window && num(ctx.window.startAt) != null && num(ctx.window.now) != null && num(seller.prepLeadTimeMinutes) != null) {
    const earliest = ctx.window.now + seller.prepLeadTimeMinutes * 60000;
    if (ctx.window.startAt < earliest) {
      add(timingIssues, DELIVERY_TIMING.INSUFFICIENT_PREP_LEAD, `Seller needs ${seller.prepLeadTimeMinutes} min to prepare; choose a later window.`);
    }
  }
  if (ctx.window && seller.operatingHours && !withinHours(ctx.window.startAt, seller.operatingHours)) {
    add(timingIssues, DELIVERY_TIMING.OUTSIDE_OPERATING_HOURS, "Requested window is outside the seller's operating hours.");
  }
  if (ctx.window && provider.operatingHours && !withinHours(ctx.window.startAt, provider.operatingHours)) {
    add(timingIssues, DELIVERY_TIMING.OUTSIDE_OPERATING_HOURS, "Requested window is outside the courier's operating hours.");
  }

  // ── Cautions (allowed, but surfaced) ───────────────────────────────────────

  for (const sp of ctx.speciesProfiles || []) {
    if (num(sp.adultSizeCm) != null && sp.adultSizeCm > LARGE_SPECIMEN_CM) {
      add(cautions, "large_specimen", `${sp.commonName || "A specimen"} is large (${sp.adultSizeCm} cm) and needs extra water volume for transit.`);
    }
  }

  // De-dupe blocker codes (e.g. both temps unsafe → one code is enough).
  const seen = new Set();
  const dedupedBlockers = blockers.filter((b) => (seen.has(b.code) ? false : seen.add(b.code)));

  let verdict;
  if (dedupedBlockers.length > 0) {
    verdict = DELIVERY_VERDICT.PICKUP_FALLBACK; // no safe courier — offer pickup
  } else if (timingIssues.length > 0) {
    verdict = DELIVERY_VERDICT.RESCHEDULE; // courier is safe at a different time
  } else {
    verdict = DELIVERY_VERDICT.ELIGIBLE;
  }

  return {
    verdict,
    eligibleNow: verdict === DELIVERY_VERDICT.ELIGIBLE,
    blockers: dedupedBlockers,
    timingIssues,
    cautions,
    recommendedFallback: verdict === DELIVERY_VERDICT.PICKUP_FALLBACK ? "pickup" : null,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * operatingHours: { [0-6 dayOfWeek]: [{ open: "HH:MM", close: "HH:MM" }] }.
 * Returns true if there are no hours defined (nothing to enforce) or the
 * timestamp falls in an open window. Uses local time of the environment.
 */
function withinHours(startAt, operatingHours) {
  if (!operatingHours || num(startAt) == null) return true;
  const d = new Date(startAt);
  const day = d.getDay();
  const windows = operatingHours[day];
  if (!Array.isArray(windows) || windows.length === 0) return false;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return windows.some((w) => {
    const [oh, om] = String(w.open).split(":").map(Number);
    const [ch, cm] = String(w.close).split(":").map(Number);
    return minutes >= oh * 60 + om && minutes <= ch * 60 + cm;
  });
}
