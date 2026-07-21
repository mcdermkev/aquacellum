/**
 * shippingSafety.js
 *
 * The shipping co-bagging safety engine (Task 11, Tier A). Shipping safety is a
 * HARD constraint: this engine decides whether two (or more) specimens may
 * legally share a shipping bag. When in doubt it says "ship individually" —
 * which is always safe — rather than risk a lethal co-bag.
 *
 * Live-animal shipping reality: a shipping bag is a tiny, sealed, oxygenated
 * volume for hours in transit. Aggression, predation, and mismatched water
 * chemistry that a large aquarium can absorb are fatal in a bag. So the rules
 * here are deliberately conservative and are NOT the same as tank-mate
 * suitability (which is soft guidance handled elsewhere).
 *
 * Pure and dependency-free. The messy source data (free-text temperament,
 * maxLengthCm, trophicLevel from fishbase_master.json) is normalized first via
 * normalizeSpeciesProfile so the rules operate on structured, confidence-tagged
 * fields.
 */

// ─── Temperament ────────────────────────────────────────────────────────────

export const TEMPERAMENT = Object.freeze({
  PEACEFUL: "peaceful",
  SEMI_AGGRESSIVE: "semi_aggressive",
  TERRITORIAL: "territorial",
  AGGRESSIVE: "aggressive",
  PREDATORY: "predatory",
  UNKNOWN: "unknown",
});

// Temperaments that make a specimen unsafe to co-bag with ANY other specimen.
const CONFINED_UNSAFE = Object.freeze([
  TEMPERAMENT.AGGRESSIVE,
  TEMPERAMENT.TERRITORIAL,
  TEMPERAMENT.PREDATORY,
]);

// Keyword → temperament, first match wins. SEMI_AGGRESSIVE is checked before
// AGGRESSIVE because "semi-aggressive" contains the "aggressiv" substring; the
// specific phrase must win over the generic one. (Block-vs-allow outcomes are
// otherwise driven by CONFINED_UNSAFE, so ordering only affects the label.)
const TEMPERAMENT_KEYWORDS = [
  [TEMPERAMENT.PREDATORY, ["predator", "piscivore", "will eat", "eats smaller", "eats other", "prey"]],
  [TEMPERAMENT.SEMI_AGGRESSIVE, ["semi-aggressive", "semi aggressive", "feisty", "nippy", "fin nip", "fin-nip"]],
  [TEMPERAMENT.AGGRESSIVE, ["aggressiv", "pugnacious", "bully", "boisterous", "combative", "hostile"]],
  [TEMPERAMENT.TERRITORIAL, ["territorial", "defends", "guards fiercely", "defend its territory"]],
  [TEMPERAMENT.PEACEFUL, ["peaceful", "docile", "community", "gentle", "shy", "timid"]],
];

/**
 * Classify a free-text behavior/social-behavior description into a temperament.
 * @param {string} text
 * @returns {{ value:string, confidence:('high'|'low') }}
 */
export function classifyTemperament(text) {
  const t = (text || "").toLowerCase();
  if (!t) return { value: TEMPERAMENT.UNKNOWN, confidence: "low" };
  for (const [value, keywords] of TEMPERAMENT_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return { value, confidence: "high" };
  }
  return { value: TEMPERAMENT.UNKNOWN, confidence: "low" };
}

// ─── Species normalization ───────────────────────────────────────────────────

const CARNIVORE_TROPHIC = ["carnivore", "piscivore"];

/**
 * Normalize a fishbase_master.json record (or a partial listing-derived record)
 * into the structured profile the safety rules consume. Missing fields become
 * null and are surfaced in `dataConfidence` so rules can be conservative.
 *
 * @param {Object} record
 * @returns {{
 *   speciesId:(number|null), scientificName:(string|null), commonName:(string|null),
 *   adultSizeCm:(number|null), tempRange:([number,number]|null), phRange:([number,number]|null),
 *   minVolumeGallons:(number|null), trophicLevel:(string|null), carnivore:boolean,
 *   temperament:{value:string, confidence:string},
 *   dataConfidence:{ size:boolean, temp:boolean, ph:boolean, temperament:boolean, diet:boolean }
 * }}
 */
export function normalizeSpeciesProfile(record = {}) {
  const tankMetrics = record.tankMetrics || {};

  const tempRange = pickRange(
    tankMetrics.tempRangeCelsius,
    record.minTemp != null && record.maxTemp != null ? [record.minTemp, record.maxTemp] : null
  );
  const phRange = pickRange(
    tankMetrics.phRange,
    record.minPh != null && record.maxPh != null ? [record.minPh, record.maxPh] : null
  );

  const adultSizeCm = num(record.maxLengthCm ?? record.adultSizeCm);
  const minVolumeGallons = num(tankMetrics.minVolumeGallons ?? record.minVolumeGallons);
  const trophicLevel = record.diet?.trophicLevel ?? record.trophicLevel ?? null;

  const temperamentText =
    record.behavior?.temperament || record.ecology?.socialBehavior || record.temperamentText || "";
  const temperament = classifyTemperament(temperamentText);

  return {
    speciesId: num(record.speciesId ?? record.specCode),
    scientificName: record.scientificName || null,
    commonName: record.commonName || null,
    adultSizeCm,
    tempRange,
    phRange,
    minVolumeGallons,
    trophicLevel,
    carnivore: trophicLevel ? CARNIVORE_TROPHIC.includes(String(trophicLevel).toLowerCase()) : false,
    temperament,
    dataConfidence: {
      size: adultSizeCm != null,
      temp: tempRange != null,
      ph: phRange != null,
      temperament: temperament.confidence === "high",
      diet: trophicLevel != null,
    },
  };
}

// ─── Co-bagging rules (HARD constraint) ──────────────────────────────────────

export const COBAG_REASONS = Object.freeze({
  AGGRESSIVE_CONFINED: "aggressive_species_confined",
  PREDATION_RISK: "predation_risk",
  SIZE_DISPARITY: "size_disparity",
  INCOMPATIBLE_TEMPERATURE: "incompatible_temperature",
  INCOMPATIBLE_PH: "incompatible_ph",
  INSUFFICIENT_TEMPERAMENT_DATA: "insufficient_temperament_data",
  INSUFFICIENT_ENVIRONMENT_DATA: "insufficient_environment_data",
});

// A carnivore this many times larger than a bagmate can eat it in transit.
export const PREDATION_SIZE_RATIO = 2.5;
// Any specimen this many times larger risks physical harm regardless of diet.
export const SIZE_DISPARITY_RATIO = 4;

function rangesOverlap(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * Decide whether specimens A and B may share a single shipping bag.
 * Returns every reason a co-bag is unsafe (empty => safe to share).
 *
 * @param {Object} aProfile - normalized profile (from normalizeSpeciesProfile)
 * @param {Object} bProfile
 * @returns {{ canShareBag:boolean, block:boolean, requiresIndividualBag:boolean,
 *            reasons: Array<{code:string, message:string}> }}
 */
export function evaluateCoBagging(aProfile, bProfile) {
  const reasons = [];
  const add = (code, message) => reasons.push({ code, message });

  const aName = aProfile.commonName || aProfile.scientificName || "Specimen A";
  const bName = bProfile.commonName || bProfile.scientificName || "Specimen B";

  // 1. Aggression / territoriality / predatory temperament — must ship alone.
  for (const [p, name] of [[aProfile, aName], [bProfile, bName]]) {
    if (CONFINED_UNSAFE.includes(p.temperament.value)) {
      add(COBAG_REASONS.AGGRESSIVE_CONFINED, `${name} is ${p.temperament.value} and must ship in its own bag.`);
    }
  }

  // 2. Conservative on unknown temperament: never co-bag an unknown with anything.
  if (aProfile.temperament.value === TEMPERAMENT.UNKNOWN || bProfile.temperament.value === TEMPERAMENT.UNKNOWN) {
    add(COBAG_REASONS.INSUFFICIENT_TEMPERAMENT_DATA, "Temperament data is incomplete; shipping individually to stay safe.");
  }

  // 3. Shared water chemistry must overlap; missing data is treated as unsafe.
  if (!aProfile.tempRange || !bProfile.tempRange) {
    add(COBAG_REASONS.INSUFFICIENT_ENVIRONMENT_DATA, "Temperature tolerance data is incomplete.");
  } else if (!rangesOverlap(aProfile.tempRange, bProfile.tempRange)) {
    add(COBAG_REASONS.INCOMPATIBLE_TEMPERATURE, `${aName} and ${bName} need non-overlapping temperatures.`);
  }
  if (!aProfile.phRange || !bProfile.phRange) {
    add(COBAG_REASONS.INSUFFICIENT_ENVIRONMENT_DATA, "pH tolerance data is incomplete.");
  } else if (!rangesOverlap(aProfile.phRange, bProfile.phRange)) {
    add(COBAG_REASONS.INCOMPATIBLE_PH, `${aName} and ${bName} need non-overlapping pH.`);
  }

  // 4. Size / predation (only when both sizes are known).
  if (aProfile.adultSizeCm != null && bProfile.adultSizeCm != null && aProfile.adultSizeCm > 0 && bProfile.adultSizeCm > 0) {
    const larger = Math.max(aProfile.adultSizeCm, bProfile.adultSizeCm);
    const smaller = Math.min(aProfile.adultSizeCm, bProfile.adultSizeCm);
    const ratio = larger / smaller;
    const eitherCarnivore = aProfile.carnivore || bProfile.carnivore;
    if (eitherCarnivore && ratio >= PREDATION_SIZE_RATIO) {
      add(COBAG_REASONS.PREDATION_RISK, `Predation risk: size ratio ${ratio.toFixed(1)}x with a carnivore present.`);
    } else if (ratio >= SIZE_DISPARITY_RATIO) {
      add(COBAG_REASONS.SIZE_DISPARITY, `Size disparity ${ratio.toFixed(1)}x risks physical harm in a shared bag.`);
    }
  }

  // De-duplicate reason codes (e.g. both temp and pH missing → one env reason is enough per code).
  const seen = new Set();
  const deduped = reasons.filter((r) => (seen.has(r.code) ? false : seen.add(r.code)));

  const block = deduped.length > 0;
  return { canShareBag: !block, block, requiresIndividualBag: block, reasons: deduped };
}

/**
 * Evaluate whether a group of specimens can all share ONE bag. Deterministic:
 * evaluates every unordered pair in index order.
 *
 * @param {Object[]} profiles - normalized profiles
 * @returns {{ canShareBag:boolean, conflicts: Array<{a:number, b:number, reasons:Array}> }}
 */
export function evaluateBagGroup(profiles) {
  const conflicts = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const res = evaluateCoBagging(profiles[i], profiles[j]);
      if (res.block) conflicts.push({ a: i, b: j, reasons: res.reasons });
    }
  }
  return { canShareBag: conflicts.length === 0, conflicts };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickRange(primary, fallback) {
  const r = Array.isArray(primary) && primary.length === 2 ? primary : fallback;
  if (!Array.isArray(r) || r.length !== 2) return null;
  const lo = Number(r[0]);
  const hi = Number(r[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}
