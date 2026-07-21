/**
 * addOnRecommender.js
 *
 * Add-on recommendation ranker (Task 11, Tier B). Composes the already-built,
 * Opus-reviewed Tier A safety engines (`shippingSafety.js` normalization,
 * `packingEngine.js` capacity math) — it does NOT reimplement any safety
 * logic. It answers: "which same-seller listings can I safely recommend to
 * fill remaining shipping capacity, and in what order?"
 *
 * Two exports:
 *   - evaluateTankFit(speciesProfile, displayTank) — the single tank-fit
 *     scorer, consolidating the formula duplicated in MarketplaceBoard.jsx
 *     and CheckoutSummary.jsx, plus a `verdict` (blocked/caution/ok).
 *   - recommendAddOns(candidates, ctx) — filters candidates for safety and
 *     stock, then ranks the survivors deterministically.
 *
 * Pure and dependency-free (aside from packingEngine helpers). See
 * docs/TASK_11_RANKER_SPEC.md for the authoritative spec. The tank "blocked"
 * threshold in §3 is the one judgment call specified there and should not be
 * loosened without an Opus review.
 */

import { deriveDefaultPackingProfile, canAddToParcel } from "./packingEngine.js";

// ─── Tank-fit evaluator (§3) ────────────────────────────────────────────────

// "Will not survive" thresholds — a known, critical mismatch. These are
// deliberately conservative (see shippingSafety.js's design note): a bag is a
// tiny sealed volume, but a tank is much more forgiving, so these thresholds
// are looser than co-bagging rules. They gate *recommendations*, not shipping.
const BLOCK_VOLUME_RATIO = 0.5; // tank < 50% of species minimum volume
const BLOCK_TEMP_DELTA_C = 3; // °C outside range
const BLOCK_PH_DELTA = 1.0; // pH units outside range

// Legacy default when a species' minimum tank volume is unknown. Preserved
// for score parity with the pre-refactor MarketplaceBoard/CheckoutSummary
// formula; it does NOT count as "known" data for blocking purposes (§3: never
// block on missing data).
const DEFAULT_MIN_VOLUME_GALLONS = 30;

const CAUTION_SCORE_THRESHOLD = 80;

/**
 * Evaluate how well a species fits a buyer's tank.
 *
 * Score model (ported verbatim from the legacy `calculateCompatibility`,
 * duplicated in MarketplaceBoard.jsx and CheckoutSummary.jsx): a multiplicative
 * penalty across volume, pH, and temperature, each 0-100, combined as
 * `(sVol/100)*(sPh/100)*(sTemp/100)*100`. Constants are kept exact so scores
 * match today's UI.
 *
 * @param {Object} speciesProfile - normalizeSpeciesProfile output (or any
 *   object exposing `minVolumeGallons`, `tempRange:[min,max]`, `phRange:[min,max]`)
 * @param {{volume:number, temp:number, ph:number}|null|undefined} displayTank
 * @returns {{ score:number, verdict:('blocked'|'caution'|'ok'), reasons:string[] }}
 */
export function evaluateTankFit(speciesProfile = {}, displayTank) {
  if (!displayTank) {
    return { score: 0, verdict: "caution", reasons: ["No tank context provided."] };
  }

  const knownVolume = typeof speciesProfile.minVolumeGallons === "number" && Number.isFinite(speciesProfile.minVolumeGallons);
  const minVolumeGallons = knownVolume ? speciesProfile.minVolumeGallons : DEFAULT_MIN_VOLUME_GALLONS;

  const tempRange = isRange(speciesProfile.tempRange) ? speciesProfile.tempRange : null;
  const phRange = isRange(speciesProfile.phRange) ? speciesProfile.phRange : null;
  const knownTemp = tempRange !== null;
  const knownPh = phRange !== null;

  const simVolume = Number(displayTank.volume);
  const simPh = Number(displayTank.ph);
  const simTemp = Number(displayTank.temp);

  // ── Score (0-100), exact legacy formula ──────────────────────────────────

  let pVol = 0;
  if (simVolume < minVolumeGallons) {
    pVol = ((minVolumeGallons - simVolume) / minVolumeGallons) * 100;
  }

  let pPh = 0;
  if (knownPh) {
    const [minPh, maxPh] = phRange;
    if (simPh < minPh) {
      pPh = ((minPh - simPh) / 1.5) * 100;
    } else if (simPh > maxPh) {
      pPh = ((simPh - maxPh) / 1.5) * 100;
    }
  }
  pPh = Math.min(100, pPh);

  let pTemp = 0;
  if (knownTemp) {
    const [minTemp, maxTemp] = tempRange;
    if (simTemp < minTemp) {
      pTemp = ((minTemp - simTemp) / 5.0) * 100;
    } else if (simTemp > maxTemp) {
      pTemp = ((simTemp - maxTemp) / 5.0) * 100;
    }
  }
  pTemp = Math.min(100, pTemp);

  const sVol = Math.max(0, 100 - pVol);
  const sPh = Math.max(0, 100 - pPh);
  const sTemp = Math.max(0, 100 - pTemp);

  const score = Math.round((sVol / 100) * (sPh / 100) * (sTemp / 100) * 100);

  // ── Verdict ───────────────────────────────────────────────────────────────
  //
  // Never blocked on missing data: if any of volume/temp/pH is unknown, we
  // cannot judge a *known* critical mismatch, so the verdict is capped at
  // "caution" even if the (data-incomplete) score happens to be high.

  const reasons = [];

  if (!knownVolume || !knownTemp || !knownPh) {
    if (!knownVolume) reasons.push("Species minimum tank volume is unknown.");
    if (!knownTemp) reasons.push("Species temperature range is unknown.");
    if (!knownPh) reasons.push("Species pH range is unknown.");
    return { score, verdict: "caution", reasons };
  }

  let blocked = false;

  if (simVolume < BLOCK_VOLUME_RATIO * minVolumeGallons) {
    blocked = true;
    reasons.push(`Tank volume (${simVolume}gal) is less than half the species' minimum (${minVolumeGallons}gal).`);
  }

  const [minTemp, maxTemp] = tempRange;
  if (simTemp < minTemp - BLOCK_TEMP_DELTA_C || simTemp > maxTemp + BLOCK_TEMP_DELTA_C) {
    blocked = true;
    reasons.push(`Tank temperature (${simTemp}°C) is more than ${BLOCK_TEMP_DELTA_C}°C outside the species range.`);
  }

  const [minPh, maxPh] = phRange;
  if (simPh < minPh - BLOCK_PH_DELTA || simPh > maxPh + BLOCK_PH_DELTA) {
    blocked = true;
    reasons.push(`Tank pH (${simPh}) is more than ${BLOCK_PH_DELTA} outside the species range.`);
  }

  if (blocked) {
    return { score, verdict: "blocked", reasons };
  }

  if (score < CAUTION_SCORE_THRESHOLD) {
    return { score, verdict: "caution", reasons: ["Tank fit is borderline; review compatibility before adding."] };
  }

  return { score, verdict: "ok", reasons: ["Good fit for the buyer's tank."] };
}

function isRange(r) {
  return Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]));
}

// ─── Ranking (§4) ────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = Object.freeze({
  boxFit: 0.45,
  tankFit: 0.3,
  inventory: 0.1,
  price: 0.1,
  sellerBoost: 0.05,
});

const DEFAULT_PRICE_CAP_CENTS = 10000;

/**
 * Rank same-seller add-on candidates for a shipping order's remaining box
 * capacity. Deterministic: identical inputs (including candidate order)
 * always produce the same ranked output.
 *
 * @param {Object[]} candidates - same-seller listings not already in the cart.
 *   Each: { listingId, speciesProfile, packingProfile?, quantityAvailable,
 *           priceCents, sellerBoost? (0..1) }
 * @param {Object} ctx
 * @param {Object} ctx.preset - normalizeParcelPreset output (the box)
 * @param {Object[]} [ctx.cartProfiles] - packing profiles already in the cart
 * @param {{volume:number, temp:number, ph:number}|null} [ctx.buyerTank]
 * @param {Object} [ctx.weights] - optional ranking weight overrides (see §4),
 *   plus an optional `priceCapCents` override
 * @returns {Array<{ listingId, tankFit:Object, boxFit:Object, score:number, reasons:string[] }>}
 */
export function recommendAddOns(candidates = [], ctx = {}) {
  const { preset, cartProfiles = [], buyerTank = null } = ctx;
  const weights = { ...DEFAULT_WEIGHTS, ...(ctx.weights || {}) };
  const priceCapCents = ctx.weights?.priceCapCents ?? DEFAULT_PRICE_CAP_CENTS;

  const ranked = [];

  for (const candidate of candidates) {
    const quantityAvailable = Number(candidate.quantityAvailable) || 0;
    if (quantityAvailable <= 0) continue; // out of stock

    const tankFit = evaluateTankFit(candidate.speciesProfile, buyerTank);
    if (buyerTank && tankFit.verdict === "blocked") continue; // critical mismatch

    const packingProfile = candidate.packingProfile || deriveDefaultPackingProfile(candidate.speciesProfile, 1);
    const boxFit = canAddToParcel(preset, cartProfiles, packingProfile);

    const boxFitComponent = boxFit.addedBox ? 0 : 1;
    const tankFitComponent = tankFit.score / 100;
    const inventoryComponent = Math.min(quantityAvailable, 10) / 10;
    const priceCents = Math.max(0, Number(candidate.priceCents) || 0);
    const priceComponent = 1 - Math.min(priceCents, priceCapCents) / priceCapCents;
    const sellerBoostComponent = clamp01(Number(candidate.sellerBoost) || 0);

    const score =
      boxFitComponent * weights.boxFit +
      tankFitComponent * weights.tankFit +
      inventoryComponent * weights.inventory +
      priceComponent * weights.price +
      sellerBoostComponent * weights.sellerBoost;

    const reasons = [];
    reasons.push(
      boxFit.addedBox
        ? "Would require an additional box (shipping rate changes)."
        : "Fits in the current box at no extra shipping cost."
    );
    reasons.push(...tankFit.reasons);
    if (sellerBoostComponent > 0) reasons.push("Seller-promoted item.");

    ranked.push({ listingId: candidate.listingId, tankFit, boxFit, score, reasons });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return compareListingIds(a.listingId, b.listingId);
  });

  return ranked;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Deterministic ascending comparator for listingId tiebreaks. Works for
 * numeric ids, numeric-looking strings, and arbitrary strings alike.
 */
function compareListingIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}
