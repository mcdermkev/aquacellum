/**
 * provenance.js — how a fish entered this keeper's collection.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Beta feedback: "if you buy from someone outside of the app, it may not be
 * necessarily wild, but the owner is not on the app so we need an unverified."
 *
 * Before this module, provenance was not stored anywhere — not on-chain (the
 * `Specimen` struct in AquadexStorage.sol has no such field and no setter), not in
 * Dexie, not in Supabase. It was INFERRED, in four separate places, from whether
 * the fish had recorded parents:
 *
 *     if (sireId === 0 && damId === 0) pedigreeLabel = "Wild Caught";
 *
 * So a fish bought at a local shop and registered was labelled wild-caught founder
 * stock. Absence of a recorded parent was being read as a positive claim about
 * origin. It even fed a suggested sale price.
 *
 * That is the §7.1 verified-vs-self-reported line, crossed. "I have no record of
 * this fish's parents" and "this fish was taken from the wild" are different
 * statements, and only one of them is supportable.
 *
 * ── STORED, NOT DERIVED ─────────────────────────────────────────────────────
 *
 * Provenance is a STORED value, following the `sex` precedent (§4.4) rather than
 * the `lifeStage` one. `lifeStage` uses `null` for unknown because there was no
 * legacy default to match. Here there is a distinction worth keeping that `null`
 * cannot express:
 *
 *   "bought from someone off-app, origin genuinely unknowable"   → UNVERIFIED
 *   "nobody ever recorded this"                                  → UNRECORDED
 *
 * Collapsing those loses the thing the feedback asked for. A keeper who tells us
 * they bought a fish outside Aquadex has given us real information: the chain of
 * custody ends at them. That is not the same as an empty field.
 *
 * ── THERE IS NO "WILD CAUGHT" RUNG ──────────────────────────────────────────
 *
 * Deliberately. A keeper buying from a shop usually cannot know whether the fish
 * was wild-collected or farmed, so offering the option mostly invites a guess that
 * then renders as fact — which is how the inferred label went wrong in the first
 * place. If a genuine wild-collection record is ever needed it should arrive with
 * evidence behind it (a collector, a locality), not as a dropdown entry.
 *
 * ── PROVENANCE NEVER GATES ANYTHING ─────────────────────────────────────────
 *
 * It is a label and a disclosure, not a permission. Unlike `canBeCertificated` in
 * lifeStage.js, nothing here fails closed, because there is no action that an
 * unverified origin should block: an unverified fish is still yours, still
 * certificatable, still sellable — the buyer is simply told what is and is not
 * known. Withholding capability would punish honesty and push keepers toward
 * leaving the field blank.
 *
 * Related: services/pedigreeDocument.js grades the trust of a pedigree DOCUMENT.
 * This grades how the fish ARRIVED. Both follow the same rule — the honest resting
 * state gets its own name and is never silently promoted.
 */

/** Canonical stored values. */
export const PROVENANCE = Object.freeze({
  /** Sire and/or dam recorded in-app, or promoted out of a spawn this keeper logged. */
  BRED_BY_KEEPER: "bredByKeeper",
  /** Acquired through an Aquadex sale, so a chain of custody exists in the app. */
  ACQUIRED_IN_APP: "acquiredInApp",
  /**
   * Acquired from outside Aquadex — a shop, a club auction, a hobbyist who is not
   * a user. The keeper is the first link we can see. This is the rung the beta
   * feedback asked for, and the honest default for a fish typed in by hand.
   */
  UNVERIFIED: "unverified",
  /** Nothing recorded. Legacy rows, and anything predating this field. */
  UNRECORDED: "unrecorded",
});

/** Strongest to weakest. Used for sorting; NOT a quality judgement about the fish. */
export const PROVENANCE_ORDER = Object.freeze([
  PROVENANCE.BRED_BY_KEEPER,
  PROVENANCE.ACQUIRED_IN_APP,
  PROVENANCE.UNVERIFIED,
  PROVENANCE.UNRECORDED,
]);

/** How it reads when nothing is recorded. Never a guessed origin. */
export const PROVENANCE_UNKNOWN_LABEL = "—";

const LABELS = Object.freeze({
  [PROVENANCE.BRED_BY_KEEPER]: { pro: "Bred in collection", casual: "Bred here" },
  [PROVENANCE.ACQUIRED_IN_APP]: { pro: "Acquired via Aquadex", casual: "Bought on Aquadex" },
  [PROVENANCE.UNVERIFIED]: { pro: "Unverified origin", casual: "Origin unknown" },
  [PROVENANCE.UNRECORDED]: { pro: PROVENANCE_UNKNOWN_LABEL, casual: PROVENANCE_UNKNOWN_LABEL },
});

/**
 * The only place the words describing provenance exist.
 *
 * Blunt about the unverified case, for the same reason PEDIGREE_TRUST_COPY is blunt
 * about `unattested`: a soft phrase would read as reassurance to a buyer paying a
 * premium. "Origin unknown" is the fact.
 */
export const PROVENANCE_COPY = Object.freeze({
  bredByKeeper: Object.freeze({
    pro: "Bred by this keeper, with parents recorded in the app.",
    casual: "This fish was bred by its keeper, and its parents are on record.",
  }),
  acquiredInApp: Object.freeze({
    pro: "Acquired through Aquadex, so its handover is recorded here.",
    casual: "Bought through Aquadex, so we have a record of the sale.",
  }),
  unverified: Object.freeze({
    // Says what IS known — the keeper told us where the trail ends — without
    // implying anything about where the fish came from before that.
    pro: "Acquired outside Aquadex. Its history before this keeper is unknown, and its lineage starts here.",
    casual: "This fish came from somewhere outside the app, so we don't know its family history. Its record starts with this owner.",
  }),
  unrecorded: Object.freeze({
    pro: "No origin recorded. Unrecorded is not the same as wild-caught.",
    casual: "Nobody has said where this fish came from.",
  }),
  /** Shown on a lineage view whose root is unverified. Mirrors the gap-vs-forgery rule. */
  lineageRoot: Object.freeze({
    pro: "Lineage begins with this keeper. Earlier generations are unknown, not absent.",
    casual: "The family tree starts here — we just don't know what came before.",
  }),
});

/** Every provenance string, flattened — for the language invariant test. */
export function allProvenanceCopy() {
  const out = [];
  for (const entry of Object.values(PROVENANCE_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

/**
 * Fold input to a canonical value, or `null` when it is not one.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function normalizeProvenance(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  for (const known of PROVENANCE_ORDER) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return null;
}

/**
 * What to show for a specimen.
 *
 * Reads the stored field when present. For legacy rows it derives ONLY what can be
 * derived honestly:
 *
 *   recorded parents  → BRED_BY_KEEPER (the parents are the evidence)
 *   no parents        → UNRECORDED, never UNVERIFIED and never wild-caught
 *
 * That last line is the whole point. A pre-existing parentless row could be a
 * shop fish, a gift, or something half-entered — we cannot tell, so it reads "—".
 * Deriving UNVERIFIED there would be inventing a claim the keeper never made, the
 * same mistake as the "Wild Caught" inference this replaces.
 *
 * @param {{provenance?: string, sireId?: number|string, damId?: number|string}} specimen
 * @returns {string} one of PROVENANCE
 */
export function resolveProvenance(specimen) {
  const stored = normalizeProvenance(specimen?.provenance);
  if (stored) return stored;

  const sireId = Number(specimen?.sireId || 0);
  const damId = Number(specimen?.damId || 0);
  if (sireId > 0 || damId > 0) return PROVENANCE.BRED_BY_KEEPER;

  return PROVENANCE.UNRECORDED;
}

/**
 * Short label for a badge. "—" for unrecorded.
 *
 * @param {*} value a stored value or a specimen-shaped object
 * @param {{ casual?: boolean }} [options]
 */
export function provenanceLabel(value, { casual = false } = {}) {
  const resolved =
    typeof value === "string" || value == null
      ? normalizeProvenance(value) || PROVENANCE.UNRECORDED
      : resolveProvenance(value);
  return LABELS[resolved][casual ? "casual" : "pro"];
}

/** Longer explanation in the reader's mode. */
export function provenanceText(value, { casual = false } = {}) {
  const resolved = normalizeProvenance(value) || PROVENANCE.UNRECORDED;
  const entry = PROVENANCE_COPY[resolved];
  return entry[casual ? "casual" : "pro"];
}

/**
 * Is this fish the start of the lineage we can see?
 *
 * True for both UNVERIFIED and UNRECORDED: in either case there is no ancestor to
 * walk to. The lineage view uses this to explain the root rather than leaving six
 * empty ancestor slots to be read as "this fish has no ancestors".
 *
 * @param {*} specimen
 */
export function isLineageRoot(specimen) {
  const resolved = resolveProvenance(specimen);
  return resolved === PROVENANCE.UNVERIFIED || resolved === PROVENANCE.UNRECORDED;
}

/** Ordered options for a form control. UNRECORDED is not offerable — it is an absence. */
export const PROVENANCE_OPTIONS = Object.freeze(
  [PROVENANCE.BRED_BY_KEEPER, PROVENANCE.UNVERIFIED].map((value) =>
    Object.freeze({ value, label: LABELS[value].pro, casualLabel: LABELS[value].casual })
  )
);

/** Render one option in the reader's mode. */
export function provenanceOptionLabel(option, { casual = false } = {}) {
  if (!option) return PROVENANCE_UNKNOWN_LABEL;
  return casual ? option.casualLabel : option.label;
}
