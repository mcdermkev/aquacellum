/**
 * specimenSex.js — the canonical sex vocabulary and the single pairing rule.
 *
 * Implements docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md §2.1.
 *
 * WHY THIS EXISTS
 *
 * 1. THE VOCABULARY HAD ALREADY FORKED. `TankList`'s Add Fish drawer wrote the
 *    literal string "Not Sure" into Dexie, while `relayMintSpecimen`, the E2E
 *    seeder, `useUserTanks`, and `nurseryGrouping` all default to "Unsexed". So
 *    every reader had to special-case BOTH values, and three of them did
 *    (`nurseryGrouping`, `TankInhabitants`, `FryNursery`). One stored vocabulary,
 *    normalized on read; "Not Sure" survives only as casual-mode display copy.
 *
 * 2. THE PAIRING RULE HAD NOWHERE TO LIVE. The Spawning wizard's Sire/Dam
 *    pickers filtered on species alone, so two known males could be selected and
 *    the app would register offspring certificates from that pairing.
 *
 * THE RULE THAT MATTERS (spec §1.2): unknown sex must NEVER block a pairing.
 * Most aquarium species can't be reliably sexed by eye and the overwhelming
 * majority of existing records are "Unsexed", so hard-filtering the pickers to
 * male × female would make the wizard unusable on real data — a breeder would be
 * unable to record a spawn that actually happened. The single hard stop is a
 * KNOWN same-sex pair, which cannot produce offspring. Everything else warns.
 *
 * Pure and dependency-free — strings, constants, and small predicates only.
 */

/**
 * The stored vocabulary. These exact strings are what live in Dexie and sync to
 * the cloud; do not add a fourth without a migration plan for existing rows.
 */
export const SEX = Object.freeze({
  MALE: "Male",
  FEMALE: "Female",
  UNSEXED: "Unsexed",
});

/** Severity levels a pairing signal can carry. */
export const PAIRING_SEVERITY = Object.freeze({
  NONE: "none",
  NOTICE: "notice",
  ERROR: "error",
});

// ─── Copy ───────────────────────────────────────────────────────────────────
//
// Every user-facing string this feature adds lives here so the Web2-language
// invariant (orderCopy.PROHIBITED_TERMS via containsProhibitedTerm) can be
// enforced by test rather than by vigilance — the same convention as
// services/orderCopy.js, promotionEngine's PROMOTION_COPY, and
// pickupCoordination's status copy.
//
// Casual variants avoid "specimen" (finderCopy's OFF_VOCABULARY_TERMS) and say
// "fish"; Pro variants use the registry vocabulary the Breeder Tools tab uses
// everywhere else.

export const PAIRING_COPY = Object.freeze({
  sameSexMale: Object.freeze({
    pro: "Both of these are male, so this pairing cannot produce a spawn.",
    casual: "These are both males, so they can't have babies. Pick one male and one female.",
  }),
  sameSexFemale: Object.freeze({
    pro: "Both of these are female, so this pairing cannot produce a spawn.",
    casual: "These are both females, so they can't have babies. Pick one male and one female.",
  }),
  oneUnsexed: Object.freeze({
    pro: "One of these has no sex recorded. The pairing is allowed — record its sex on the certificate when you can.",
    casual: "We don't know if one of these is male or female yet. You can still pair them.",
  }),
  bothUnsexed: Object.freeze({
    pro: "Neither of these has a sex recorded, so the pairing can't be checked. It is still allowed.",
    casual: "We don't know if either of these is male or female yet. You can still pair them.",
  }),
  compatible: Object.freeze({
    pro: "Male and female — this pairing can produce a spawn.",
    casual: "One male and one female — good to go.",
  }),
  speciesMismatch: Object.freeze({
    pro: "These are different species. Any offspring would be a hybrid.",
    casual: "These are two different kinds of fish. Their babies would be a mix of both.",
  }),
  coiChecking: Object.freeze({
    pro: "Checking ancestry…",
    casual: "Checking their family tree…",
  }),
  coiUnavailable: Object.freeze({
    pro: "No pedigree data",
    casual: "No family tree yet",
  }),
  coiUnavailableDetail: Object.freeze({
    pro: "Ancestry isn't recorded for both sides, so how closely related they are can't be calculated. This is not the same as an unrelated pairing.",
    casual: "We don't know both fishes' parents, so we can't check how closely related they are.",
  }),
  coiOutbred: Object.freeze({
    pro: "No shared ancestors found across three generations.",
    casual: "No shared family found going back three generations.",
  }),
});

/** Every copy string, flattened — used by the language invariant test. */
export function allPairingCopy() {
  const out = [];
  for (const entry of Object.values(PAIRING_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

const LABELS = Object.freeze({
  [SEX.MALE]: { pro: "Male", casual: "Male" },
  [SEX.FEMALE]: { pro: "Female", casual: "Female" },
  // "Not sure yet" is the casual LABEL for the stored value "Unsexed". It is
  // never itself written to the database — that fork is what this module closes.
  [SEX.UNSEXED]: { pro: "Unsexed", casual: "Not sure yet" },
});

// Legacy and loose inputs that all mean "we don't know". Matched lowercased.
const UNKNOWN_ALIASES = new Set(["not sure", "notsure", "unsexed", "unknown", "n/a", "-", "?"]);

/**
 * Normalize any stored or user-supplied sex value to one of {@link SEX}.
 *
 * Anything unrecognized — including the legacy "Not Sure", null, and empty
 * string — becomes UNSEXED. Deliberately fails to "unknown" rather than
 * guessing a sex, because a wrong sex silently permits or forbids a pairing.
 *
 * @param {string|null|undefined} value
 * @returns {string} one of SEX
 */
export function normalizeSex(value) {
  if (value === null || value === undefined) return SEX.UNSEXED;
  const raw = String(value).trim();
  if (!raw) return SEX.UNSEXED;
  const lower = raw.toLowerCase();
  if (lower === "male" || lower === "m") return SEX.MALE;
  if (lower === "female" || lower === "f") return SEX.FEMALE;
  if (UNKNOWN_ALIASES.has(lower)) return SEX.UNSEXED;
  return SEX.UNSEXED;
}

/** True only for a definitively recorded sex. */
export function isKnownSex(value) {
  const sex = normalizeSex(value);
  return sex === SEX.MALE || sex === SEX.FEMALE;
}

/**
 * Display label for a sex value.
 * @param {string} value
 * @param {{ casual?: boolean }} [options]
 */
export function sexLabel(value, { casual = false } = {}) {
  const entry = LABELS[normalizeSex(value)];
  return casual ? entry.casual : entry.pro;
}

/**
 * Display symbol, or "" for an unknown sex so callers render nothing rather
 * than a misleading placeholder.
 */
export function sexSymbol(value) {
  const sex = normalizeSex(value);
  if (sex === SEX.MALE) return "♂";
  if (sex === SEX.FEMALE) return "♀";
  return "";
}

/** Ordered options for a sex form control. */
export const SEX_OPTIONS = Object.freeze([
  Object.freeze({ value: SEX.MALE, label: LABELS[SEX.MALE].pro, casualLabel: LABELS[SEX.MALE].casual, symbol: "♂" }),
  Object.freeze({ value: SEX.FEMALE, label: LABELS[SEX.FEMALE].pro, casualLabel: LABELS[SEX.FEMALE].casual, symbol: "♀" }),
  Object.freeze({ value: SEX.UNSEXED, label: LABELS[SEX.UNSEXED].pro, casualLabel: LABELS[SEX.UNSEXED].casual, symbol: "" }),
]);

/** Label for an option, respecting mode. */
export function sexOptionLabel(option, { casual = false } = {}) {
  if (!option) return "";
  return casual ? option.casualLabel : option.label;
}

/**
 * The single pairing rule.
 *
 * @param {string} sexA
 * @param {string} sexB
 * @param {{ casual?: boolean }} [options]
 * @returns {{ ok: boolean, severity: string, reason: string }}
 *   `ok: false` is the ONLY thing that may block a pairing, and it happens for
 *   exactly one case: a known same-sex pair. See the header and spec §1.2.
 */
export function canPair(sexA, sexB, { casual = false } = {}) {
  const a = normalizeSex(sexA);
  const b = normalizeSex(sexB);
  const pick = (key) => (casual ? PAIRING_COPY[key].casual : PAIRING_COPY[key].pro);

  if (a === SEX.MALE && b === SEX.MALE) {
    return { ok: false, severity: PAIRING_SEVERITY.ERROR, reason: pick("sameSexMale") };
  }
  if (a === SEX.FEMALE && b === SEX.FEMALE) {
    return { ok: false, severity: PAIRING_SEVERITY.ERROR, reason: pick("sameSexFemale") };
  }

  const unknownCount = (a === SEX.UNSEXED ? 1 : 0) + (b === SEX.UNSEXED ? 1 : 0);
  if (unknownCount === 2) {
    return { ok: true, severity: PAIRING_SEVERITY.NOTICE, reason: pick("bothUnsexed") };
  }
  if (unknownCount === 1) {
    return { ok: true, severity: PAIRING_SEVERITY.NOTICE, reason: pick("oneUnsexed") };
  }

  return { ok: true, severity: PAIRING_SEVERITY.NONE, reason: pick("compatible") };
}

/**
 * Sort comparator that surfaces known-sex candidates ahead of unsexed ones
 * WITHOUT removing anything from a picker (spec §1.2: order, don't filter).
 *
 * When a counterpart sex is supplied, the complementary sex sorts first.
 *
 * @param {string|null} counterpartSex - the already-selected side, if any
 */
export function pairingCandidateComparator(counterpartSex = null) {
  const wanted =
    normalizeSex(counterpartSex) === SEX.MALE
      ? SEX.FEMALE
      : normalizeSex(counterpartSex) === SEX.FEMALE
        ? SEX.MALE
        : null;

  return (a, b) => {
    const rank = (spec) => {
      const sex = normalizeSex(spec?.gender);
      if (wanted) {
        if (sex === wanted) return 0;
        if (sex === SEX.UNSEXED) return 1;
        return 2; // same sex as the counterpart — still listed, just last
      }
      return sex === SEX.UNSEXED ? 1 : 0;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return Number(a?.id || 0) - Number(b?.id || 0);
  };
}
