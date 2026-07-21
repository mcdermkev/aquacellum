/**
 * parcelPlanner.js
 *
 * Packs a cart into shipping parcels (Task 13) so checkout can recalculate
 * rates from the actual packed cart rather than a flat per-item guess. Composes
 * the Tier A engines: packing profiles come from packingEngine (which already
 * encodes co-bag separation from temperament via shippingSafety), and the box
 * count comes from packingEngine.boxesRequired.
 *
 * Bagging vs. boxing: shipping bags isolate specimens, so different species may
 * share a BOX (each in its own bag) even when they could never share a BAG.
 * Co-bag safety therefore determines bag COUNT (already baked into each
 * packing profile), while this planner sums bags/weight/volume/livestock into
 * boxes. That keeps the safety guarantee intact while packing efficiently.
 *
 * Pure and dependency-free (aside from packingEngine).
 */

import {
  deriveDefaultPackingProfile,
  computeUsage,
  boxesRequired,
  remainingCapacity,
} from "./packingEngine.js";

/**
 * Resolve a cart item to its packing profile: use the explicit one, else derive
 * from the species profile + quantity.
 */
function resolveProfile(item) {
  if (item.packingProfile) return item.packingProfile;
  return deriveDefaultPackingProfile(item.speciesProfile || {}, item.quantity || 1);
}

/**
 * Plan the parcels needed for a cart.
 *
 * @param {Array<{ sku?:string, speciesProfile?:Object, packingProfile?:Object, quantity?:number }>} items
 * @param {Object} preset - normalizeParcelPreset output (the box)
 * @returns {{
 *   parcels:number, usage:Object, remainingInLastBoxSet:Object,
 *   perItem: Array<{ sku:(string|undefined), bagCount:number, livestock:number, separationRequired:boolean }>
 * }}
 */
export function planParcels(items = [], preset) {
  const profiles = items.map(resolveProfile);
  const usage = computeUsage(profiles);
  const parcels = boxesRequired(preset, usage);

  const perItem = items.map((item, i) => ({
    sku: item.sku,
    bagCount: Math.max(1, Math.round(Number(profiles[i].bagCount) || 1)),
    livestock: Math.max(0, Math.round(Number(profiles[i].livestock) || 0)),
    separationRequired: !!profiles[i].separationRequired,
  }));

  return {
    parcels,
    usage,
    // Capacity left in the box "budget" (one box's capacity minus the remainder
    // that spills past whole boxes) — useful for the add-on recommender.
    remainingInLastBoxSet: remainingCapacity(preset, usage),
    perItem,
  };
}

/**
 * Compute the shipping cost for a packed cart given a per-box rate. Rate scales
 * with the number of parcels — this is the number that changes when an add-on
 * pushes the cart into another box.
 *
 * @param {Array} items
 * @param {Object} preset
 * @param {number} perBoxRateCents - the carrier/courier rate for one box
 * @returns {{ parcels:number, shippingCents:number, plan:Object }}
 */
export function planParcelsForRate(items, preset, perBoxRateCents) {
  const plan = planParcels(items, preset);
  const rate = Math.max(0, Math.round(Number(perBoxRateCents) || 0));
  return { parcels: plan.parcels, shippingCents: plan.parcels * rate, plan };
}

/**
 * The parcel-count delta from adding one item to a cart — i.e. does this add-on
 * change the shipping rate? (Mirrors packingEngine.canAddToParcel at the whole-
 * cart level, for the "add without changing shipping" flow.)
 *
 * @param {Array} currentItems
 * @param {Object} candidateItem
 * @param {Object} preset
 * @returns {{ parcelsBefore:number, parcelsAfter:number, addedParcel:boolean }}
 */
export function parcelDeltaForItem(currentItems, candidateItem, preset) {
  const parcelsBefore = planParcels(currentItems, preset).parcels;
  const parcelsAfter = planParcels([...currentItems, candidateItem], preset).parcels;
  return { parcelsBefore, parcelsAfter, addedParcel: parcelsAfter > parcelsBefore };
}
