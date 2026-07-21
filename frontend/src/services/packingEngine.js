/**
 * packingEngine.js
 *
 * Seller-controlled packing capacity engine (Task 11, Tier A). Replaces the old
 * flat "6 fish per box" cap with real capacity math: weight, bag count, usable
 * volume, thermal-pack space, and a seller livestock cap. It answers two
 * questions deterministically:
 *
 *   1. How much of a box is used / left?
 *   2. If I add this candidate, does it still fit the current box, or does it
 *      push the order into an additional box (which changes the shipping rate)?
 *
 * Pure and dependency-free. Separation (which specimens must ship in their own
 * bag) comes from shippingSafety.js; here a packing profile just carries a
 * `separationRequired` flag and a `bagCount`, and the engine sums bag counts.
 *
 * Units: weight in ounces, volume in cubic inches (matching seller_parcel_presets).
 */

// ─── Defaults (used when a preset column or profile field is null) ───────────

export const PACKING_DEFAULTS = Object.freeze({
  // Derived from the stripe.js fallback parcel (48oz total, 12x10x8in box).
  usableWeightOz: 40, // livestock payload capacity (box total minus packaging)
  maxBags: 4,
  usableVolumeIn3: 720, // ~75% of a 12x10x8 interior, reserving pack space
  thermalPackSpaceIn3: 240,
  maxLivestock: 6, // preserves the old default cap as a floor unless overridden
});

const clampPos = (n, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Normalize a seller_parcel_presets row (post-migration) into the capacity
 * shape the engine consumes, applying defaults for null columns.
 * @param {Object} row
 */
export function normalizeParcelPreset(row = {}) {
  return {
    label: row.label || "Parcel",
    usableWeightOz: clampPos(row.usable_weight_oz ?? row.usableWeightOz, PACKING_DEFAULTS.usableWeightOz),
    maxBags: Math.round(clampPos(row.max_bags ?? row.maxBags, PACKING_DEFAULTS.maxBags)),
    usableVolumeIn3: clampPos(row.usable_volume_in3 ?? row.usableVolumeIn3, PACKING_DEFAULTS.usableVolumeIn3),
    thermalPackSpaceIn3: clampPos(row.thermal_pack_space_in3 ?? row.thermalPackSpaceIn3, PACKING_DEFAULTS.thermalPackSpaceIn3),
    maxLivestock: Math.round(clampPos(row.max_livestock ?? row.maxLivestock, PACKING_DEFAULTS.maxLivestock)),
  };
}

/**
 * Derive a default packing profile for a species/listing when the seller hasn't
 * set one. Heuristic and deterministic; sellers override per listing.
 *
 * @param {Object} normalizedSpecies - from shippingSafety.normalizeSpeciesProfile
 * @param {number} [quantity=1]
 * @returns {{ bagCount:number, packedWeightOz:number, volumeIn3:number,
 *            requiresThermalPack:boolean, maxPerBag:number, separationRequired:boolean, livestock:number }}
 */
export function deriveDefaultPackingProfile(normalizedSpecies = {}, quantity = 1) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const sizeCm = normalizedSpecies.adultSizeCm && normalizedSpecies.adultSizeCm > 0 ? normalizedSpecies.adultSizeCm : 8;

  // Bigger fish need more water per bag → more weight/volume, fewer per bag.
  const weightPerFishOz = round1(6 + sizeCm * 0.9);
  const volumePerFishIn3 = round1(40 + sizeCm * 6);
  const maxPerBag = Math.max(1, Math.floor(30 / Math.max(4, sizeCm))); // small fish share; large fish solo-ish

  // Aggressive/territorial/predatory (or unknown) → each specimen ships alone.
  const temperament = normalizedSpecies.temperament?.value;
  const separationRequired = temperament == null
    || temperament === "unknown"
    || ["aggressive", "territorial", "predatory"].includes(temperament);

  const perBag = separationRequired ? 1 : maxPerBag;
  const bagCount = Math.ceil(qty / perBag);

  return {
    bagCount,
    packedWeightOz: round1(weightPerFishOz * qty),
    volumeIn3: round1(volumePerFishIn3 * qty),
    requiresThermalPack: true, // live fish default; seller can disable for hardy locals
    maxPerBag: perBag,
    separationRequired,
    livestock: qty,
  };
}

// ─── Usage + capacity ────────────────────────────────────────────────────────

/**
 * Sum a set of packing profiles into total usage.
 * @param {Object[]} profiles
 */
export function computeUsage(profiles = []) {
  return profiles.reduce(
    (acc, p) => ({
      weightOz: acc.weightOz + num(p.packedWeightOz),
      bags: acc.bags + Math.max(1, Math.round(num(p.bagCount) || 1)),
      volumeIn3: acc.volumeIn3 + num(p.volumeIn3),
      thermalPacks: acc.thermalPacks + (p.requiresThermalPack ? 1 : 0),
      livestock: acc.livestock + Math.max(0, Math.round(num(p.livestock))),
    }),
    { weightOz: 0, bags: 0, volumeIn3: 0, thermalPacks: 0, livestock: 0 }
  );
}

/**
 * Remaining capacity of a single box given current usage (never negative).
 */
export function remainingCapacity(preset, usage) {
  return {
    weightOz: Math.max(0, preset.usableWeightOz - usage.weightOz),
    bags: Math.max(0, preset.maxBags - usage.bags),
    volumeIn3: Math.max(0, preset.usableVolumeIn3 - usage.volumeIn3),
    livestock: Math.max(0, preset.maxLivestock - usage.livestock),
  };
}

/**
 * Number of identical boxes required to hold the given usage. Each constraint
 * (weight/bags/volume/livestock) is divided by the per-box capacity; the
 * binding constraint wins. Thermal-pack space is treated as a per-box reserve
 * that reduces effective bag room only if a profile needs it — modeled as a
 * volume reserve here for simplicity.
 */
export function boxesRequired(preset, usage) {
  if (usage.weightOz === 0 && usage.bags === 0 && usage.volumeIn3 === 0 && usage.livestock === 0) return 0;
  const effectiveVolume = Math.max(1, preset.usableVolumeIn3 - (usage.thermalPacks > 0 ? preset.thermalPackSpaceIn3 : 0));
  const perConstraint = [
    Math.ceil(usage.weightOz / preset.usableWeightOz),
    Math.ceil(usage.bags / preset.maxBags),
    Math.ceil(usage.volumeIn3 / effectiveVolume),
    Math.ceil(usage.livestock / preset.maxLivestock),
  ];
  return Math.max(1, ...perConstraint);
}

/**
 * Decide the effect of adding a candidate profile to a box that currently holds
 * `currentProfiles`. `addedBox` is the key signal for the UI: false means the
 * add-on rides along at no extra shipping cost; true means it forces another
 * box and the rate changes.
 *
 * @param {Object} preset - normalized parcel preset
 * @param {Object[]} currentProfiles - packing profiles already in the cart
 * @param {Object} candidateProfile - the add-on's packing profile
 * @returns {{ boxesBefore:number, boxesAfter:number, addedBox:boolean,
 *            remainingAfter:Object, usage:Object }}
 */
export function canAddToParcel(preset, currentProfiles, candidateProfile) {
  const usageBefore = computeUsage(currentProfiles);
  const usageAfter = computeUsage([...currentProfiles, candidateProfile]);
  const boxesBefore = boxesRequired(preset, usageBefore);
  const boxesAfter = boxesRequired(preset, usageAfter);
  return {
    boxesBefore,
    boxesAfter,
    addedBox: boxesAfter > boxesBefore,
    remainingAfter: remainingCapacity(preset, usageAfter),
    usage: usageAfter,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
