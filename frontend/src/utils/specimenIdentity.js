/**
 * specimenIdentity.js — canonical specimen status + certificate serial display.
 *
 * Single source of truth for two things that had drifted into four hand-rolled
 * copies across the app:
 *
 *   1. STATUS. `contracts/AquadexStorage.sol` declares
 *      `enum SpecimenStatus { Active, Deceased, Rehomed }`. PedigreeTree,
 *      BreedGallery, and SpecimenDetailModal each inlined that mapping
 *      correctly; SpawningDashboard inlined it *incorrectly* (it rendered 1 as
 *      "Transferred" and 2 as "Inactive"), so a fish recorded as deceased in My
 *      Aquariums read as "Transferred" in the Breeder Tools certificate list.
 *
 *   2. SERIALS. `relayMintSpecimen` assigns sequential serials (1, 2, 3…) and
 *      the display convention is a zero-padded minimum of 3 digits — "001".
 *      SpawningDashboard instead did `.toString().slice(-3)`, which TRUNCATES:
 *      cert 1042 rendered as "042" and its sire #1007 as "007", both of which
 *      are other real certificates. Serials are identity for a birth
 *      certificate, so they are never truncated here — `formatCertSerial` only
 *      ever pads.
 *
 * Legacy note: records created before the sequential-serial switch carry
 * `Date.now()` ids (~1.7e12). Those are left at full length rather than
 * shortened, because any shortening of a timestamp collides with the real
 * low-numbered serial space. `isLegacySerial` lets a caller badge them instead.
 *
 * See docs/BREEDER_STATE_MODEL.md for the authoritative model this implements.
 */

import { summarizeGrowout } from "./growoutFunnel";

/**
 * Mirrors `SpecimenStatus` in contracts/AquadexStorage.sol. The ordinal values
 * are on-chain ABI — do not reorder or renumber.
 */
export const SPECIMEN_STATUS = Object.freeze({
  ACTIVE: 0,
  DECEASED: 1,
  REHOMED: 2,
});

const STATUS_LABELS = Object.freeze({
  [SPECIMEN_STATUS.ACTIVE]: "Active",
  [SPECIMEN_STATUS.DECEASED]: "Deceased",
  [SPECIMEN_STATUS.REHOMED]: "Rehomed",
});

/** Casual-mode copy. Same states, gentler words. */
const STATUS_LABELS_CASUAL = Object.freeze({
  [SPECIMEN_STATUS.ACTIVE]: "In your care",
  [SPECIMEN_STATUS.DECEASED]: "Passed away",
  [SPECIMEN_STATUS.REHOMED]: "Rehomed",
});

export const UNKNOWN_STATUS_LABEL = "Unknown";

/**
 * Display tones, matching the colors the existing correct call sites already
 * use (PedigreeTree / BreedGallery / SpecimenDetailModal) so surfaces agree.
 */
export const SPECIMEN_STATUS_TONE = Object.freeze({
  [SPECIMEN_STATUS.ACTIVE]: {
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.12)",
    border: "rgba(52, 211, 153, 0.3)",
  },
  [SPECIMEN_STATUS.DECEASED]: {
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.12)",
    border: "rgba(248, 113, 113, 0.3)",
  },
  [SPECIMEN_STATUS.REHOMED]: {
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.12)",
    border: "rgba(251, 191, 36, 0.3)",
  },
  unknown: {
    color: "#9ca3af",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.3)",
  },
});

/**
 * Normalize a stored status into a known ordinal, or `null` if it isn't one.
 *
 * `null`/`undefined` normalizes to ACTIVE because that is what every write path
 * defaults to (`relayMintSpecimen` sets `status: 0`, as does the E2E seeder), so
 * a record missing the field is an active fish rather than an unknown one.
 * Anything else out of range returns `null` — deliberately NOT the highest
 * state, so a bad value can never read as "Rehomed" or "Deceased".
 *
 * @param {number|string|null|undefined} status
 * @returns {number|null}
 */
export function normalizeSpecimenStatus(status) {
  if (status === null || status === undefined || status === "") {
    return SPECIMEN_STATUS.ACTIVE;
  }
  const n = Number(status);
  if (!Number.isInteger(n)) return null;
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, n) ? n : null;
}

/**
 * Human label for a specimen status.
 *
 * @param {number|string|null|undefined} status
 * @param {{ casual?: boolean }} [options]
 * @returns {string}
 */
export function specimenStatusLabel(status, { casual = false } = {}) {
  const normalized = normalizeSpecimenStatus(status);
  if (normalized === null) return UNKNOWN_STATUS_LABEL;
  return (casual ? STATUS_LABELS_CASUAL : STATUS_LABELS)[normalized];
}

/**
 * Display tone for a specimen status. Unknown statuses get the neutral tone.
 *
 * @param {number|string|null|undefined} status
 * @returns {{ color: string, bg: string, border: string }}
 */
export function specimenStatusTone(status) {
  const normalized = normalizeSpecimenStatus(status);
  if (normalized === null) return SPECIMEN_STATUS_TONE.unknown;
  return SPECIMEN_STATUS_TONE[normalized];
}

/** True when the specimen is still in the owner's care. */
export function isSpecimenActive(status) {
  return normalizeSpecimenStatus(status) === SPECIMEN_STATUS.ACTIVE;
}

/**
 * The two ways a specimen leaves the owner's care. Retiring a fish is ALWAYS a
 * choice between these — never an implicit one.
 *
 * This exists because `FryNursery.retireFish` used to hard-write `Deceased`
 * under copy that said "marks it inactive", so rehoming a batch of fry recorded
 * a batch of deaths. That corrupts pedigree display (the fish reads "Deceased"
 * in every tree) and the grow-out survivor math. `TankList`'s Farewell modal had
 * the correct two-outcome flow but its own inline copy; both now read from here.
 *
 * There is deliberately no "inactive" outcome: the model has three states and
 * "inactive" is not one of them.
 */
export const RETIREMENT_OUTCOMES = Object.freeze([
  Object.freeze({
    key: "rehomed",
    status: SPECIMEN_STATUS.REHOMED,
    icon: "🏠",
    label: "Rehomed / Sold",
    casualLabel: "Went to a new home",
    detail: "Fish has been moved to a new home.",
  }),
  Object.freeze({
    key: "deceased",
    status: SPECIMEN_STATUS.DECEASED,
    icon: "🕊️",
    label: "Deceased",
    casualLabel: "Passed away",
    detail: "Recorded as deceased to preserve history.",
  }),
]);

/** Copy for a retirement outcome, respecting casual mode. */
export function retirementOutcomeLabel(outcome, { casual = false } = {}) {
  if (!outcome) return "";
  return casual ? outcome.casualLabel : outcome.label;
}

// ─── Spawn status ───────────────────────────────────────────────────────────

/**
 * Mirrors `SpawnStatus` in contracts/AquadexStorage.sol. Ordinals are on-chain
 * ABI — do not reorder.
 *
 * KNOWN GAP: `relaySpawn` writes `FRY` at creation and nothing ever advances it
 * (the only later write sets `offspringIds`). So this label is currently
 * descriptive of what is stored, not of the cohort's real stage. Advancing it
 * from grow-out checkpoints is tracked in docs/BREEDER_STATE_MODEL.md.
 * The previous inline mapping invented "Juvenile" and "Adult", which are not
 * states this model has.
 */
export const SPAWN_STATUS = Object.freeze({
  EGG: 0,
  FRY: 1,
  RAISED: 2,
  FAILED: 3,
});

const SPAWN_STATUS_LABELS = Object.freeze({
  [SPAWN_STATUS.EGG]: "Egg",
  [SPAWN_STATUS.FRY]: "Fry",
  [SPAWN_STATUS.RAISED]: "Raised",
  [SPAWN_STATUS.FAILED]: "Failed",
});

export const SPAWN_STATUS_TONE = Object.freeze({
  [SPAWN_STATUS.EGG]: { color: "#fbbf24", bg: "rgba(251, 191, 36, 0.15)" },
  [SPAWN_STATUS.FRY]: { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" },
  [SPAWN_STATUS.RAISED]: { color: "#34d399", bg: "rgba(52, 211, 153, 0.15)" },
  [SPAWN_STATUS.FAILED]: { color: "#f87171", bg: "rgba(248, 113, 113, 0.15)" },
  unknown: { color: "#9ca3af", bg: "rgba(148, 163, 184, 0.15)" },
});

function normalizeSpawnStatus(status) {
  if (status === null || status === undefined || status === "") return SPAWN_STATUS.FRY;
  const n = Number(status);
  if (!Number.isInteger(n)) return null;
  return Object.prototype.hasOwnProperty.call(SPAWN_STATUS_LABELS, n) ? n : null;
}

/** Human label for a spawn record's status. */
export function spawnStatusLabel(status) {
  const normalized = normalizeSpawnStatus(status);
  if (normalized === null) return UNKNOWN_STATUS_LABEL;
  return SPAWN_STATUS_LABELS[normalized];
}

/** Display tone for a spawn record's status. */
export function spawnStatusTone(status) {
  const normalized = normalizeSpawnStatus(status);
  if (normalized === null) return SPAWN_STATUS_TONE.unknown;
  return SPAWN_STATUS_TONE[normalized];
}

// ─── Derived spawn status (§9.6) ────────────────────────────────────────────
//
// `relaySpawn` writes `Fry` at creation and NOTHING EVER MOVES IT. Every spawn a
// breeder has ever logged reads "Fry" forever, including the ones that produced
// certificated adults two years ago and the ones where nothing survived the first
// week. The badge was therefore decorative.
//
// Resolved as DERIVED, not stored. The grow-out checkpoints already say what
// happened, so status is a pure function of them:
//
//   - no migration, no backfill, and no transition guard to get wrong
//   - it cannot go stale, because there is no second copy to fall out of date
//   - it is recomputed from the same rows the funnel reads, so the badge and the
//     numbers under it can never disagree
//
// THE DERIVATION ONLY EVER ADVANCES. It never downgrades and never invents `Egg`.
// That matters: `relaySpawn` mints offspring certificates immediately, so a spawn
// with no checkpoints yet genuinely has fry — reading "no fry_count checkpoint" as
// "Egg" would mislabel every spawn a breeder hasn't logged against yet. With no
// evidence, the stored value stands.

/** States that are an outcome, not a stage. Never derived away from. */
export const SPAWN_TERMINAL_STATUSES = Object.freeze([SPAWN_STATUS.RAISED, SPAWN_STATUS.FAILED]);

/** Why `deriveSpawnStatus` returned what it did. */
export const SPAWN_DERIVATION_REASON = Object.freeze({
  /** Stored value is already an outcome — left alone. */
  TERMINAL_STORED: "terminalStored",
  /** Keepers were promoted to certificates, so the spawn demonstrably raised fish. */
  PROMOTED: "promoted",
  /** A counted cohort with nothing alive, nothing promoted, and nothing sold. */
  NO_SURVIVORS: "noSurvivors",
  /** Fry have been counted, so the spawn is at least past the egg stage. */
  FRY_COUNTED: "fryCounted",
  /** No checkpoint says anything conclusive — the stored value stands. */
  NO_EVIDENCE: "noEvidence",
});

export const SPAWN_DERIVATION_COPY = Object.freeze({
  terminalStored: Object.freeze({
    pro: "Recorded outcome.",
    casual: "This batch is finished.",
  }),
  promoted: Object.freeze({
    pro: "From grow-out: keepers were promoted to their own certificates.",
    casual: "From your notes: you kept some of these and gave them their own records.",
  }),
  noSurvivors: Object.freeze({
    pro: "From grow-out: the counted fry are all accounted for, with none remaining.",
    casual: "From your notes: none of these babies made it.",
  }),
  fryCounted: Object.freeze({
    pro: "From grow-out: fry have been counted.",
    casual: "From your notes: you've counted babies.",
  }),
  noEvidence: Object.freeze({
    pro: "No grow-out checkpoints yet.",
    casual: "You haven't added any notes for this batch yet.",
  }),
});

/** Every derivation string, flattened — used by the language invariant test. */
export function allSpawnDerivationCopy() {
  const out = [];
  for (const entry of Object.values(SPAWN_DERIVATION_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

/** Explain a derivation reason in the reader's mode. */
export function spawnDerivationText(reason, { casual = false } = {}) {
  const entry = SPAWN_DERIVATION_COPY[reason];
  if (!entry) return SPAWN_DERIVATION_COPY.noEvidence[casual ? "casual" : "pro"];
  return entry[casual ? "casual" : "pro"];
}

/**
 * The spawn's real status, derived from its grow-out checkpoints.
 *
 * @param {object} args
 * @param {number} [args.storedStatus] - `spawn.status`; the floor, never lowered
 * @param {Array<object>} [args.checkpoints] - that spawn's `spawnGrowout` rows
 * @returns {{ status: number, derived: boolean, reason: string }}
 *   `derived` is false when the stored value was used unchanged, so a caller can
 *   distinguish "we worked this out" from "this is what the record says".
 */
export function deriveSpawnStatus({ storedStatus, checkpoints = [] } = {}) {
  const stored = normalizeSpawnStatus(storedStatus);
  // An unrecognized stored value is not something to build on top of, so it is
  // passed through UNCHANGED rather than converted to a null.
  //
  // Deliberate: `spawnStatusLabel` already renders an unrecognized ordinal as
  // "Unknown", but it reads null/undefined as *absent* and defaults those to Fry.
  // Returning null here would collide those two meanings and quietly relabel a
  // corrupt status as Fry. Handing back the raw value lets the existing label
  // helper say "Unknown", which is the honest answer.
  if (stored === null) {
    return { status: storedStatus, derived: false, reason: SPAWN_DERIVATION_REASON.NO_EVIDENCE };
  }

  // An outcome already on the record wins. Nothing here downgrades it, and a
  // future writer (or an on-chain reconciliation) may know something the local
  // checkpoints don't.
  if (SPAWN_TERMINAL_STATUSES.includes(stored)) {
    return { status: stored, derived: false, reason: SPAWN_DERIVATION_REASON.TERMINAL_STORED };
  }

  const funnel = summarizeGrowout(checkpoints);

  // RAISED — the strongest signal available, and a VERIFIED one: a `promoted`
  // checkpoint means certificate rows exist for fish pulled out of this cohort.
  //
  // `sold` is deliberately NOT a Raised signal even though selling fry implies
  // raising them. It is a number the breeder typed with nothing behind it, and
  // this project already learned that lesson the expensive way — self-reported
  // grow-out counts were backing the "Established Seller" badge (§9.11). A
  // status derived from an unverified count would be the same mistake in a new
  // place. It also fires too early: "sold 5" logged in week one would mark a
  // spawn Raised while the rest of the cohort is still in the tank.
  if (funnel.promoted > 0) {
    return { status: SPAWN_STATUS.RAISED, derived: true, reason: SPAWN_DERIVATION_REASON.PROMOTED };
  }

  // FAILED — the cohort was counted and is now fully accounted for, with nothing
  // alive, nothing promoted, and nothing sold. All four conditions are required:
  //
  //   - `fry > 0`, because without a fry count we don't know the cohort's size and
  //     "everything died" is indistinguishable from "nothing was logged". A spawn
  //     with loss checkpoints and no fry count stays Fry. Unknown means unknown.
  //   - `sold === 0`, because a cohort that emptied through sales is the opposite
  //     of a failure.
  //   - some real loss, so an empty cohort can't be reached by bookkeeping alone.
  if (
    funnel.fry > 0 &&
    funnel.alive === 0 &&
    funnel.promoted === 0 &&
    funnel.sold === 0 &&
    funnel.lost + funnel.culled > 0
  ) {
    return { status: SPAWN_STATUS.FAILED, derived: true, reason: SPAWN_DERIVATION_REASON.NO_SURVIVORS };
  }

  // FRY — advances a stored `Egg`, and is a no-op for the common case where the
  // record already says Fry.
  if (funnel.fry > 0) {
    return {
      status: SPAWN_STATUS.FRY,
      derived: stored !== SPAWN_STATUS.FRY,
      reason: SPAWN_DERIVATION_REASON.FRY_COUNTED,
    };
  }

  return { status: stored, derived: false, reason: SPAWN_DERIVATION_REASON.NO_EVIDENCE };
}

// ─── Certificate serials ────────────────────────────────────────────────────

/**
 * Ids at or above this are legacy `Date.now()` values from before sequential
 * serials, not real serial numbers. `relayMintSpecimen` uses the same ceiling to
 * skip them when computing the next serial.
 */
export const SERIAL_CEILING = 1_000_000_000;

/** Minimum displayed width of a certificate serial — "1" renders as "001". */
export const CERT_SERIAL_PAD = 3;

/**
 * Format a certificate serial for display. Pads to {@link CERT_SERIAL_PAD} and
 * never truncates, because a truncated serial points at a different, real
 * certificate.
 *
 * @param {number|string|null|undefined} id
 * @param {{ none?: string }} [options] value for "no parent / unregistered"
 * @returns {string}
 */
export function formatCertSerial(id, { none = "—" } = {}) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return none;
  return Math.trunc(n).toString().padStart(CERT_SERIAL_PAD, "0");
}

/**
 * True for pre-sequential-serial records (timestamp ids). Useful for badging
 * them in the UI, since their serials are long and not human-meaningful.
 */
export function isLegacySerial(id) {
  const n = Number(id);
  return Number.isFinite(n) && n >= SERIAL_CEILING;
}

/**
 * Format a reference to a local record whose id is a `Date.now()` value rather
 * than a sequential serial — spawns (`relaySpawn`) and tanks
 * (`relayRegisterTank`) both still mint ids that way.
 *
 * Timestamp ids are shortened to their last 6 digits for legibility. Sequential
 * ids are shown in FULL: shortening those is what turns one record's id into
 * another record's id, which is the bug this module exists to prevent.
 *
 * Not for certificate serials — use {@link formatCertSerial} for those.
 *
 * @param {number|string|null|undefined} id
 * @param {{ none?: string }} [options]
 * @returns {string}
 */
export function formatLocalRecordRef(id, { none = "—" } = {}) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return none;
  const asString = Math.trunc(n).toString();
  return isLegacySerial(n) ? asString.slice(-6) : asString;
}
