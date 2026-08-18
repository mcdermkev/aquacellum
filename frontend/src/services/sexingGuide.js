/**
 * sexingGuide.js — the single interpreter for "how do you tell a male from a
 * female?" in the species catalog.
 *
 * WHY THIS EXISTS
 *
 * The data was already there and almost nobody could see it. Every record in
 * `frontend/public/fishbase_master.json` may carry a `sexualDimorphism` block:
 *
 *   { identifiable: boolean, male: string, female: string, maturityAge: string }
 *
 * It is populated on 20 of 316 species (the ones flagged `enhanced: true`) and,
 * before this module, it rendered on exactly ONE surface — the static
 * `species.html` detail page (its dimorphism section). It was absent from
 * `database.html`, from every React species panel, and from the public
 * `/api/species` projection, which whitelists fields and simply omitted it.
 * Nothing anywhere read `identifiable`.
 *
 * THREE STATES, AND WHY THE THIRD ONE MATTERS
 *
 * The naive reading is "has dimorphism data or doesn't". That loses the most
 * useful distinction in the data. Of the 20 populated records, 13 say
 * `identifiable: true` and 7 say `false` — and the 7 still carry real prose:
 *
 *   Oscar   → male:   "No reliable external dimorphism; some mature males
 *                      develop slightly more pointed dorsal/anal fin extensions."
 *             female: "…sexing generally requires examining the genital papilla
 *                      during breeding condition."
 *
 * That is not missing data. That is the answer: you cannot sex this fish by
 * looking at it, and here is what you would actually have to do. Collapsing it
 * into "no data" would throw away the single most valuable thing an authoritative
 * reference can say — what is NOT knowable by the method you were about to try.
 * A keeper who buys two Oscars expecting to sex them by eye is the person this
 * state exists for.
 *
 * So: RELIABLE (sex it by eye), UNRELIABLE (documented, but don't trust your
 * eyes), UNDOCUMENTED (we genuinely don't have it yet — say so plainly rather
 * than rendering nothing, because silence reads as "no differences exist").
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It derives nothing. It does not parse the prose into structured cues, does not
 * guess `identifiable` from wording, and does not infer dimorphism from family or
 * genus. The catalog's accuracy is the product, so an inferred sexing claim is a
 * liability dressed as coverage. `cues` is read only when the data supplies it.
 *
 * `cues` is accepted but is empty for every record today. It is the forward slot
 * for the structured, per-trait form (`{ trait, male, female }`) that a
 * comparison table and a "can I sex this by eye?" filter need — prose cannot be
 * compared trait-by-trait. Wiring the reader now means the authoring work later
 * needs no second pass through every consumer.
 *
 * Pure, dependency-free, and safe to call on any record including null.
 */

/** Sexing states. `key` is what surfaces switch on. */
export const SEXING_STATUS = Object.freeze({
  RELIABLE: "reliable",
  UNRELIABLE: "unreliable",
  UNDOCUMENTED: "undocumented",
});

export const MALE_SYMBOL = "♂";
export const FEMALE_SYMBOL = "♀";

/**
 * Copy, in one place, with pro and casual variants — the convention used by
 * services/orderCopy.js and utils/specimenSex.js PAIRING_COPY.
 *
 * Casual strings deliberately avoid "specimen" (finderCopy's off-vocabulary
 * list) and say "fish". They also avoid implying certainty the data does not
 * have: the unreliable variant never says "you can tell", it says what to look
 * at and that it is not dependable.
 */
export const SEXING_COPY = Object.freeze({
  reliable: Object.freeze({
    label: Object.freeze({ pro: "Visually sexable", casual: "You can tell males from females" }),
    // `short` is mode-independent on purpose: it is for a catalog card badge,
    // and the public database page has no casual/pro mode to switch on.
    short: "Sexable",
    blurb: Object.freeze({
      pro: "Males and females differ visibly once mature.",
      casual: "Once they grow up, males and females look different.",
    }),
  }),
  unreliable: Object.freeze({
    label: Object.freeze({ pro: "Not reliably visual", casual: "Hard to tell apart" }),
    short: "Hard to sex",
    blurb: Object.freeze({
      pro: "External differences are subtle or absent — treat visual sexing as a guess.",
      casual: "The differences are very subtle, so guessing by eye is unreliable.",
    }),
  }),
  undocumented: Object.freeze({
    label: Object.freeze({ pro: "Sexing not documented", casual: "Not documented yet" }),
    short: "Not documented",
    blurb: Object.freeze({
      pro: "We have not documented how to sex this species yet.",
      casual: "We haven't written up how to tell males from females yet.",
    }),
  }),
  maturityPrefix: Object.freeze({ pro: "Sexual maturity", casual: "Grown up at" }),
  maleHeading: Object.freeze({ pro: "Male", casual: "Male" }),
  femaleHeading: Object.freeze({ pro: "Female", casual: "Female" }),
});

const STATUS_META = Object.freeze({
  [SEXING_STATUS.RELIABLE]: Object.freeze({
    key: SEXING_STATUS.RELIABLE,
    documented: true,
    reliable: true,
    badgeClass: "sexing-badge sexing-badge--reliable",
    order: 0,
  }),
  [SEXING_STATUS.UNRELIABLE]: Object.freeze({
    key: SEXING_STATUS.UNRELIABLE,
    documented: true,
    reliable: false,
    badgeClass: "sexing-badge sexing-badge--unreliable",
    order: 1,
  }),
  [SEXING_STATUS.UNDOCUMENTED]: Object.freeze({
    key: SEXING_STATUS.UNDOCUMENTED,
    documented: false,
    reliable: false,
    badgeClass: "sexing-badge sexing-badge--undocumented",
    order: 2,
  }),
});

/**
 * Trim to a non-empty string, or null.
 *
 * Also rejects the catalog's placeholder strings. `hooks/useSpeciesData.js`
 * backfills absent rich fields with "Information arriving soon", and
 * `database.html` has its own `real()` helper filtering the same values. Letting
 * a placeholder through here would render "Male: Information arriving soon",
 * which claims documentation that does not exist.
 */
const PLACEHOLDERS = new Set(["information arriving soon", "generic biotope details", "n/a", "unknown", "-"]);

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (PLACEHOLDERS.has(text.toLowerCase())) return null;
  return text;
}

/**
 * Read the optional structured cue list.
 *
 * Each entry needs a trait plus at least one side; a cue naming a trait with
 * neither a male nor a female description says nothing and is dropped rather
 * than rendered as an empty table row.
 */
function readCues(raw) {
  if (!Array.isArray(raw)) return [];
  const cues = [];
  for (const entry of raw) {
    if (!entry) continue;
    const trait = cleanText(entry.trait);
    const male = cleanText(entry.male);
    const female = cleanText(entry.female);
    if (!trait || (!male && !female)) continue;
    cues.push(Object.freeze({ trait, male, female }));
  }
  return cues;
}

/**
 * Normalize a species record's sexing information.
 *
 * ALWAYS returns an object — never null — so a caller cannot accidentally render
 * nothing for an undocumented species. "Not documented yet" is a state worth
 * showing: it tells a keeper the absence is ours, not the fish's, and it is the
 * hook for a contribution prompt. Callers that genuinely want to hide the
 * section can branch on `documented`.
 *
 * @param {object|null|undefined} record - a fishbase_master.json-shaped record
 * @returns {{
 *   status: string, documented: boolean, reliable: boolean,
 *   badgeClass: string, order: number,
 *   male: string|null, female: string|null, maturityAge: string|null,
 *   cues: Array<{trait: string, male: string|null, female: string|null}>,
 *   hasNotes: boolean
 * }}
 */
export function normalizeSexingGuide(record) {
  const block = record && typeof record === "object" ? record.sexualDimorphism : null;

  if (!block || typeof block !== "object") {
    return { ...STATUS_META[SEXING_STATUS.UNDOCUMENTED], status: SEXING_STATUS.UNDOCUMENTED, male: null, female: null, maturityAge: null, cues: [], hasNotes: false };
  }

  const male = cleanText(block.male);
  const female = cleanText(block.female);
  const maturityAge = cleanText(block.maturityAge);
  const cues = readCues(block.cues);
  const hasNotes = Boolean(male || female || cues.length > 0);

  // A block with a flag but no prose and no cues carries no information a reader
  // can act on, so it is undocumented regardless of what `identifiable` claims.
  if (!hasNotes) {
    return { ...STATUS_META[SEXING_STATUS.UNDOCUMENTED], status: SEXING_STATUS.UNDOCUMENTED, male, female, maturityAge, cues, hasNotes: false };
  }

  // `identifiable` must be EXACTLY true to earn the reliable state. A missing or
  // non-boolean flag on a block that has prose means someone wrote the notes and
  // never made the reliability call, and the safe reading of "unknown
  // reliability" is "don't promise the keeper it works".
  const status = block.identifiable === true ? SEXING_STATUS.RELIABLE : SEXING_STATUS.UNRELIABLE;

  return { ...STATUS_META[status], status, male, female, maturityAge, cues, hasNotes: true };
}

/** Localized label for a guide, e.g. for a badge. */
export function sexingLabel(guide, { casual = false } = {}) {
  const entry = SEXING_COPY[guide?.status] || SEXING_COPY[SEXING_STATUS.UNDOCUMENTED];
  return casual ? entry.label.casual : entry.label.pro;
}

/** One-line explanation of the state, for a badge tooltip or a section intro. */
export function sexingBlurb(guide, { casual = false } = {}) {
  const entry = SEXING_COPY[guide?.status] || SEXING_COPY[SEXING_STATUS.UNDOCUMENTED];
  return casual ? entry.blurb.casual : entry.blurb.pro;
}

/** Two-or-three word label for a dense catalog card badge. */
export function sexingShortLabel(guide) {
  const entry = SEXING_COPY[guide?.status] || SEXING_COPY[SEXING_STATUS.UNDOCUMENTED];
  return entry.short;
}

/**
 * True when there is something worth rendering a panel for. Undocumented
 * species return false, so a detail page can choose between a contribution
 * prompt and nothing at all.
 */
export function hasSexingNotes(guide) {
  return Boolean(guide && guide.hasNotes);
}

/**
 * Filter predicate for the catalog's sexing filter.
 *
 * `"documented"` deliberately includes the unreliable state: someone browsing
 * for "species whose sexing we have written up" wants the Oscar entry that says
 * you cannot do it by eye — that is a documented answer, and the most useful one
 * for that species.
 *
 * @param {object} record
 * @param {"any"|"reliable"|"documented"|"undocumented"} mode
 */
export function matchesSexingFilter(record, mode) {
  if (!mode || mode === "any") return true;
  const guide = normalizeSexingGuide(record);
  if (mode === "reliable") return guide.reliable;
  if (mode === "documented") return guide.documented;
  if (mode === "undocumented") return !guide.documented;
  return true;
}

/**
 * Find the catalog record for a species reference, then return its sexing guide.
 *
 * App-only (not in the browser mirror): the static pages already hold the record
 * they are rendering, whereas in-app forms hold a *reference* — a contract
 * catalog entry, or a specimen row — and have to look the reference up.
 *
 * ⚠️ MATCHES ON NAME, NEVER ON A BARE NUMERIC ID, and that is deliberate. Two
 * different numbers in this codebase are both called "speciesId": the FishBase
 * `specCode` (this catalog, Dexie `species`, `species_insights`) and the
 * sequential on-chain id (`specimens.speciesId`, `aquadex_specimens.species_id`).
 * They coincide only positionally — on-chain N == json[N-1] — which is why
 * `species_id_map` exists to record the relation explicitly. Comparing a contract
 * id against a specCode therefore reads a plausible but WRONG record, and here
 * that would mean showing one fish's sexing notes under another fish's name. A
 * `specCode` on the reference is compared to `specCode` only, like for like.
 *
 * Name matching is lowercased scientific name first — the same key
 * `buildGlobalCatalog` and `mergeAuthoredProfiles` dedupe on — then common name.
 *
 * @param {Array<object>} records - catalog records (e.g. useSpeciesData() data)
 * @param {{scientificName?: string, commonName?: string, specCode?: number}} ref
 * @returns {ReturnType<typeof normalizeSexingGuide>} always a guide, never null
 */
export function sexingGuideForSpecies(records, ref) {
  return normalizeSexingGuide(findCatalogRecord(records, ref));
}

/** @returns {object|null} the matching catalog record, or null. */
export function findCatalogRecord(records, ref) {
  if (!Array.isArray(records) || records.length === 0 || !ref) return null;

  const sci = String(ref.scientificName || "").trim().toLowerCase();
  const common = String(ref.commonName || "").trim().toLowerCase();
  const specCode = ref.specCode;

  if (sci) {
    const bySci = records.find((r) => String(r?.scientificName || "").trim().toLowerCase() === sci);
    if (bySci) return bySci;
  }

  // Only ever specCode-to-specCode. See the warning above.
  if (specCode !== null && specCode !== undefined && specCode !== "") {
    const byCode = records.find(
      (r) => r?.specCode !== undefined && Number(r.specCode) === Number(specCode)
    );
    if (byCode) return byCode;
  }

  if (common) {
    const byCommon = records.find((r) => String(r?.commonName || "").trim().toLowerCase() === common);
    if (byCommon) return byCommon;
  }

  return null;
}

/** Options for the filter control, in display order. */
export const SEXING_FILTER_OPTIONS = Object.freeze([
  Object.freeze({ value: "any", label: "Any sexing info" }),
  Object.freeze({ value: "reliable", label: "Visually sexable" }),
  Object.freeze({ value: "documented", label: "Sexing documented" }),
  Object.freeze({ value: "undocumented", label: "Sexing missing" }),
]);

export default normalizeSexingGuide;
