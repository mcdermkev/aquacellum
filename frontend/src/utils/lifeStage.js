/**
 * lifeStage.js — what stage of life is being sold or tracked.
 *
 * docs/BREEDER_STATE_MODEL.md §12.4, T3 §2.7. Added because **"eggs" was not
 * representable**: a listing carried free-text `age` ("3 weeks") and `size`
 * ("0.5 inches") plus an `isBatch` boolean, so nothing in the app could tell an egg
 * from a juvenile. A buyer could not be told what they were buying, and the code
 * could not apply the one rule that matters here.
 *
 * ── THIS IS NOT JUST LABELS ─────────────────────────────────────────────────
 *
 * §4.2 locks the model: certificates are for individually tracked fish, cohorts are
 * counts. Life stage is what decides which side of that line something falls on:
 *
 *   Eggs and fry en masse CANNOT hold a birth certificate. They are counts.
 *   A juvenile or adult you track individually CAN.
 *
 * So `canBeCertificated` and `requiresCohort` are model rules with consequences —
 * they are what make the sold-lot path (§2.6) correct rather than a convention
 * someone remembers. Selling ten eggs creates a LOT with a count of ten, and
 * certificates appear only when the buyer promotes hatched keepers out of it.
 *
 * ── UNKNOWN IS null, NOT A STAGE ────────────────────────────────────────────
 *
 * `normalizeLifeStage` returns `null` for anything unrecognized, and every existing
 * listing predates this field, so `null` is the overwhelmingly common value. That
 * follows the same rule as `survivalRate` (§7.2) and the Founders metrics (§9.22):
 * unknown renders as "—" and is never guessed. Note the deliberate difference from
 * sex (§4.4), which uses a *stored* `"Unsexed"` because that value already existed
 * across four writers — there is no legacy default here to match.
 */

/** Canonical stored values. Order is meaningful — see `LIFE_STAGE_ORDER`. */
export const LIFE_STAGE = Object.freeze({
  EGG: "Egg",
  FRY: "Fry",
  JUVENILE: "Juvenile",
  ADULT: "Adult",
});

/** Youngest to oldest. Used for sorting and for comparing two stages. */
export const LIFE_STAGE_ORDER = Object.freeze([
  LIFE_STAGE.EGG,
  LIFE_STAGE.FRY,
  LIFE_STAGE.JUVENILE,
  LIFE_STAGE.ADULT,
]);

/**
 * Stages that exist only as counts (§4.2).
 *
 * Fish spawn in the hundreds; issuing a certificate per egg would be meaningless and
 * unusable. A sale at these stages is a lot, not a list of individuals.
 */
export const COHORT_ONLY_STAGES = Object.freeze([LIFE_STAGE.EGG, LIFE_STAGE.FRY]);

/** How the label reads when nothing is recorded. Never a guessed stage. */
export const LIFE_STAGE_UNKNOWN_LABEL = "—";

const LABELS = Object.freeze({
  [LIFE_STAGE.EGG]: { pro: "Egg", casual: "Eggs" },
  [LIFE_STAGE.FRY]: { pro: "Fry", casual: "Babies" },
  [LIFE_STAGE.JUVENILE]: { pro: "Juvenile", casual: "Young fish" },
  [LIFE_STAGE.ADULT]: { pro: "Adult", casual: "Grown fish" },
});

export const LIFE_STAGE_COPY = Object.freeze({
  stageLabel: Object.freeze({
    pro: "Life stage",
    casual: "How old are they?",
  }),
  unknown: Object.freeze({
    pro: "Life stage not recorded.",
    casual: "We don't know how old these are.",
  }),
  cohortOnly: Object.freeze({
    // The §4.2 rule, said in the place a seller meets it.
    pro: "Eggs and fry are sold as a group and counted, not certificated individually. Certificates are issued for the ones a buyer raises and keeps.",
    casual: "Eggs and babies are sold as a batch. Whoever raises them gets a record for each one they keep.",
  }),
  hatchRisk: Object.freeze({
    // Selling eggs is a genuinely different transaction and the buyer should be told.
    pro: "Not every egg hatches. A buyer of eggs is buying a chance at fish, not fish.",
    casual: "Not all eggs hatch, so this is a gamble rather than a guaranteed fish.",
  }),
  individualStage: Object.freeze({
    pro: "Tracked individually, so this one carries its own certificate.",
    casual: "This fish has its own record.",
  }),
});

/** Every copy string, flattened — used by the language invariant test. */
export function allLifeStageCopy() {
  const out = [];
  for (const entry of Object.values(LIFE_STAGE_COPY)) out.push(entry.pro, entry.casual);
  for (const entry of Object.values(LABELS)) out.push(entry.pro, entry.casual);
  return out;
}

/**
 * Fold input to a canonical stage, or `null` when it isn't one.
 *
 * Case-insensitive, and tolerates the plural forms a form might submit ("eggs").
 * Everything else — including the free-text `age`/`size` values that predate this
 * field — becomes `null`, because a stage guessed from "3 weeks" would be a
 * fabrication.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function normalizeLifeStage(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase().replace(/s$/, "");
  for (const stage of LIFE_STAGE_ORDER) {
    if (stage.toLowerCase() === trimmed) return stage;
  }
  // "babies" → fry, since that is the casual label and a form may submit it.
  if (trimmed === "babie" || trimmed === "baby") return LIFE_STAGE.FRY;
  return null;
}

/** True only for a recognized stage. */
export function isKnownLifeStage(value) {
  return normalizeLifeStage(value) !== null;
}

/**
 * Human label, or "—" when unrecorded.
 *
 * @param {*} value
 * @param {{ casual?: boolean }} [options]
 */
export function lifeStageLabel(value, { casual = false } = {}) {
  const stage = normalizeLifeStage(value);
  if (!stage) return LIFE_STAGE_UNKNOWN_LABEL;
  return LABELS[stage][casual ? "casual" : "pro"];
}

/** Ordered options for a form control. */
export const LIFE_STAGE_OPTIONS = Object.freeze(
  LIFE_STAGE_ORDER.map((value) =>
    Object.freeze({ value, label: LABELS[value].pro, casualLabel: LABELS[value].casual })
  )
);

/** Render one option in the reader's mode. */
export function lifeStageOptionLabel(option, { casual = false } = {}) {
  if (!option) return LIFE_STAGE_UNKNOWN_LABEL;
  return casual ? option.casualLabel : option.label;
}

/**
 * Can a fish at this stage hold its own birth certificate? (§4.2)
 *
 * **Unknown returns `false`.** This fails CLOSED on purpose: the question is only
 * ever asked before issuing a certificate, and issuing one for something that turns
 * out to be an egg is not reversible — §4.1 says a certificate is never destroyed.
 * Better to require the stage be recorded than to certificate a maybe.
 *
 * @param {*} value
 */
export function canBeCertificated(value) {
  const stage = normalizeLifeStage(value);
  if (!stage) return false;
  return !COHORT_ONLY_STAGES.includes(stage);
}

/**
 * Must a sale at this stage be a lot rather than a list of individuals? (§4.2)
 *
 * Unknown returns `false` — the inverse of `canBeCertificated`'s bias, and
 * deliberately not its negation. This one gates a *restriction* on the seller, and
 * forcing every pre-existing listing (all of which have no stage) into the cohort
 * path would break them. Absence of a stage is not evidence of an egg.
 *
 * @param {*} value
 */
export function requiresCohort(value) {
  const stage = normalizeLifeStage(value);
  if (!stage) return false;
  return COHORT_ONLY_STAGES.includes(stage);
}

/**
 * Compare two stages by age. `null` for an unknown on either side, so callers can't
 * accidentally treat unknown as youngest.
 *
 * @returns {number|null} negative if a is younger, 0 if equal, positive if older
 */
export function compareLifeStages(a, b) {
  const left = normalizeLifeStage(a);
  const right = normalizeLifeStage(b);
  if (!left || !right) return null;
  return LIFE_STAGE_ORDER.indexOf(left) - LIFE_STAGE_ORDER.indexOf(right);
}

/**
 * The stage a fish promoted out of a cohort should be recorded at.
 *
 * A promoted keeper has, by definition, outgrown the cohort — so it is at least a
 * juvenile. Returning `Fry` here would let a certificate exist at a cohort-only
 * stage, contradicting `canBeCertificated`.
 */
export function promotedLifeStage() {
  return LIFE_STAGE.JUVENILE;
}
