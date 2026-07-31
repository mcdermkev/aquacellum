/**
 * traitVocabulary.js — the one list of heritable traits.
 *
 * docs/BREEDER_STATE_MODEL.md §9.13. The vocabulary was written out FOUR times
 * across two components:
 *
 *   GeneticsPrediction.jsx  TRAIT_GENETICS — id, label, symbol, inheritance, colour
 *   SpawningWizard.jsx      PHENOTYPES — id + label, for the step-4 checkboxes
 *   SpawningWizard.jsx      the `geneticMarkers` state object's literal keys
 *   SpawningWizard.jsx      a hardcoded `albino && "Albino", longfin && "Longfin", …`
 *                           list in the novel-morph prompt
 *
 * Four copies is the same shape as the specimen status labels (§9.6) and the
 * grow-out funnel math (`utils/growoutFunnel.js`): adding a trait means editing
 * every copy, and **missing one is silent**. The specific silence here: a trait
 * added to `PHENOTYPES` but not to the `geneticMarkers` initial state renders a
 * checkbox whose `checked` is `undefined`, so it looks unchecked, ticks, and is
 * then dropped from `activeMarkers` — the breeder's selection disappears onto a
 * certificate that outlives the app. A trait added to the state but not to the
 * prompt list simply never prompts.
 *
 * ── WHY THE GENETICS TABLE IS THE SOURCE ────────────────────────────────────
 *
 * It is the only copy that carries `inheritance` and `symbol`, and those are not
 * decoration — `GeneticsPrediction` cannot compute a Punnett square without them.
 * A list of labels can be derived from a genetics table; a genetics table cannot be
 * derived from a list of labels. So the richest copy wins and the rest are views
 * over it.
 *
 * ── WHY THIS IS *NOT* CONNECTED TO THE MORPH PIPELINE ───────────────────────
 *
 * §9.13 also said these tables are "disconnected from the verified-morph pipeline",
 * implying they should be fed from it. They should not, and this is the reasoning so
 * nobody re-opens it as an oversight:
 *
 * `services/morphSubmissionsApi.js` stores `trait_type` as **free text** typed by
 * the submitter. It carries no `inheritance` and no allele `symbol`, because a
 * breeder registering "Blue Diamond Longfin" is making a naming claim, not declaring
 * a Mendelian model. Feeding those into the calculator would mean either guessing an
 * inheritance mode — a fabrication, and the exact class this stream exists to remove
 * (§12.1) — or rendering a trait the calculator silently cannot compute.
 *
 * The two are deliberately different things: **this** file is the set of traits with
 * a known inheritance model, and the morph pipeline is the set of names a community
 * has verified. A breeder's custom trait already has a home — the free-text
 * `custom` field on the wizard, which flows to `activeMarkers` and prompts morph
 * registration. That is the correct seam and it already exists.
 *
 * If a curated morph ever DOES carry a reviewed inheritance model, it belongs here as
 * a new entry, added by the same review that established the model.
 */

/**
 * How a trait is inherited. Drives `GENOTYPE_OPTIONS` and the Punnett outcome
 * mapping in `GeneticsPrediction`, so a value not in this set has no calculator.
 */
export const INHERITANCE = Object.freeze({
  RECESSIVE: "recessive",
  DOMINANT: "dominant",
  CODOMINANT: "codominant",
});

/**
 * The wildtype option. Present in the wizard's picker and deliberately ABSENT from
 * the genetics table: "no mutation" has no allele symbol and no Punnett square, and
 * giving it one would imply a heritable trait that is really the absence of one.
 */
export const STANDARD_TRAIT = Object.freeze({
  id: "standard",
  label: "Standard Wildtype",
  pickerLabel: "Standard Wildtype",
});

/**
 * Every trait with a known inheritance model.
 *
 * `label` is the calculator's name for it. `pickerLabel` is the wizard's, kept
 * separate because the two surfaces genuinely read differently ("Longfin" in a
 * Punnett header, "Longfin Gene" next to a checkbox) — and because collapsing them
 * would have been the kind of silent copy change that is worse than the duplication.
 * `promptLabel` is the short form the novel-morph prompt lists.
 */
export const HERITABLE_TRAITS = Object.freeze([
  Object.freeze({
    id: "albino",
    label: "Albino (Amelanistic)",
    pickerLabel: "Albino (Amelanistic)",
    promptLabel: "Albino",
    symbol: "a",
    inheritance: INHERITANCE.RECESSIVE,
    description:
      "Amelanistic mutation. Both parents must carry the gene to produce albino offspring.",
    color: "#fbbf24",
  }),
  Object.freeze({
    id: "longfin",
    label: "Longfin",
    pickerLabel: "Longfin Gene",
    promptLabel: "Longfin",
    symbol: "Lf",
    inheritance: INHERITANCE.DOMINANT,
    description:
      "Dominant fin extension. One copy produces longfin phenotype. Homozygous (Lf/Lf) can be lethal in some species.",
    color: "#60a5fa",
  }),
  Object.freeze({
    id: "veil",
    label: "Veiltail",
    pickerLabel: "Veiltail Mutation",
    promptLabel: "Veiltail",
    symbol: "Vt",
    inheritance: INHERITANCE.DOMINANT,
    description: "Dominant veil mutation affecting caudal fin elongation.",
    color: "#c084fc",
  }),
  Object.freeze({
    id: "melanistic",
    label: "Melanistic (Dark)",
    pickerLabel: "Melanistic (Dark)",
    promptLabel: "Melanistic",
    symbol: "m",
    inheritance: INHERITANCE.RECESSIVE,
    description:
      "Excessive melanin production. Recessive — both parents must carry the allele.",
    color: "#6b7280",
  }),
  Object.freeze({
    id: "metallic",
    label: "Metallic / Iridescent",
    pickerLabel: "Metallic / Iridescent Scale",
    promptLabel: "Metallic",
    symbol: "Mt",
    inheritance: INHERITANCE.CODOMINANT,
    description:
      "Codominant iridophore expression. Heterozygotes show partial metallic sheen; homozygotes show full metallic.",
    color: "#34d399",
  }),
]);

/** Just the ids, in order. */
export const HERITABLE_TRAIT_IDS = Object.freeze(HERITABLE_TRAITS.map((t) => t.id));

/**
 * The wizard's picker options: wildtype first, then every heritable trait.
 *
 * Derived, so a trait added above appears here — and in the state below, and in the
 * prompt — without a second edit.
 */
export const TRAIT_PICKER_OPTIONS = Object.freeze([
  Object.freeze({ id: STANDARD_TRAIT.id, label: STANDARD_TRAIT.pickerLabel }),
  ...HERITABLE_TRAITS.map((t) => Object.freeze({ id: t.id, label: t.pickerLabel })),
]);

/**
 * The wizard's initial marker state.
 *
 * A FUNCTION, not a shared constant: this is React state and a shared object would
 * be mutated across mounts. Wildtype starts selected; `custom` is the free-text
 * escape hatch that carries a trait this vocabulary does not know, which is the seam
 * to the morph pipeline (see the header).
 */
export function initialTraitMarkers() {
  const markers = { [STANDARD_TRAIT.id]: true };
  for (const id of HERITABLE_TRAIT_IDS) markers[id] = false;
  markers.custom = "";
  return markers;
}

/** True when anything other than plain wildtype was selected. */
export function hasNonStandardTrait(markers) {
  if (!markers) return false;
  if (String(markers.custom || "").trim()) return true;
  return HERITABLE_TRAIT_IDS.some((id) => !!markers[id]);
}

/**
 * The non-standard traits selected, as short display labels, plus the custom entry.
 *
 * Order follows `HERITABLE_TRAITS` so the prompt reads consistently regardless of
 * the order the breeder ticked them.
 */
export function selectedTraitLabels(markers) {
  if (!markers) return [];
  const labels = HERITABLE_TRAITS.filter((t) => markers[t.id]).map((t) => t.promptLabel);
  const custom = String(markers.custom || "").trim();
  if (custom) labels.push(custom);
  return labels;
}

/** Look one up by id. `null` for wildtype, which has no genetics entry by design. */
export function findHeritableTrait(id) {
  return HERITABLE_TRAITS.find((t) => t.id === id) || null;
}
