/**
 * Component-level guards for ListSpecimenModal.jsx's Task 9 Increment 2
 * assisted-listing enhancements (docs/TASK_09_INC2_LISTING_FLOW_SPEC.md).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * ListSpecimenModal.jsx transitively imports ethers and other browser-only
 * dependencies. Following the established pattern (BreederTerminal.catalog.
 * test.js), we verify the behavioral contract via static source guards over
 * the comment-stripped source.
 *
 * Covers spec §4 acceptance criteria 6 (composition) and 7 (Poseidon
 * grounding, review-gated) — the review-gated criterion gets the most
 * thorough coverage here since it's the trust/liability-sensitive surface.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./ListSpecimenModal.jsx", import.meta.url)), "utf8")
);

describe("ListSpecimenModal — composes the assisted-listing core (no re-parsing of species data)", () => {
  it("calls buildListingDraftFromSpecies rather than re-deriving care fields by hand", () => {
    expect(SOURCE).toContain('import { buildListingDraftFromSpecies } from "../services/listingDraft"');
    expect(SOURCE).toContain("buildListingDraftFromSpecies(record");
  });

  it("resolves the species record via the shared lookup, not a bespoke fetch", () => {
    expect(SOURCE).toContain('import { loadSpeciesRecordLookup, getSpeciesRecord } from "../utils/speciesRecordLookup"');
  });

  it("previews packing capacity via normalizeParcelPreset/computeUsage/boxesRequired (packingEngine.js), not re-derived math", () => {
    expect(SOURCE).toContain(
      'import { normalizeParcelPreset, computeUsage, boxesRequired } from "../services/packingEngine"'
    );
  });

  it("fetches the seller's own parcel presets via the parcelPresets service", () => {
    expect(SOURCE).toContain('import { listParcelPresets } from "../services/parcelPresets"');
    expect(SOURCE).toContain("await listParcelPresets()");
  });

  it("still calls relayCreateListing for the actual write — no new listing-write path", () => {
    expect(SOURCE).toContain('import { relayCreateListing } from "../services/relayer"');
    expect(SOURCE).toContain("await relayCreateListing({");
  });

  it("only fills EMPTY care fields from the draft, preserving seller overrides", () => {
    // Every auto-filled setter follows the `(v) => v || ...` pattern seen
    // pre-existing in this file, not an unconditional overwrite.
    expect(SOURCE).toMatch(/setMinTemp\(\(v\) => v \|\|/);
    expect(SOURCE).toMatch(/setTankSizeMin\(\(v\) => v \|\|/);
  });
});

describe("ListSpecimenModal — Poseidon listing-description grounding (§2.3, review-gated)", () => {
  it("uses the dedicated poseidonListingDraft service, not usePoseidon's conversational hook", () => {
    expect(SOURCE).toContain('import { draftListingDescription } from "../services/poseidonListingDraft"');
    expect(SOURCE).not.toContain('from "../hooks/usePoseidon"');
  });

  it("passes ONLY groundingFacts to the draft request — never message/sessionData/conversationHistory", () => {
    const callSite = SOURCE.indexOf("draftListingDescription(groundingFacts)");
    expect(callSite).toBeGreaterThan(-1);
    // The call is a single-argument invocation with the whitelist object —
    // assert no wider payload construction (message/session/history) exists
    // anywhere near this call.
    const window = SOURCE.slice(Math.max(0, callSite - 400), callSite + 100);
    expect(window).not.toMatch(/sessionData/);
    expect(window).not.toMatch(/conversationHistory/);
  });

  it("groundingFacts is sourced from buildListingDraftFromSpecies's whitelist output, not assembled ad hoc", () => {
    expect(SOURCE).toContain("setGroundingFacts(draft.groundingFacts)");
  });

  it("the AI draft is clearly labeled and never auto-applied to the description field", () => {
    expect(SOURCE).toContain('aria-label="AI draft, review before publishing"');
    expect(SOURCE).toMatch(/AI draft — review before publishing/);
    // Applying the draft requires an explicit seller action (a button), not
    // an automatic effect that overwrites `description`.
    expect(SOURCE).toContain("const applyAiDraft = () => {");
    expect(SOURCE).toContain("onClick={applyAiDraft}");
  });

  it("Poseidon unavailability never blocks publishing — description stays a plain editable textarea regardless", () => {
    // The textarea itself has no disabled/required-on-AI condition.
    const textareaIdx = SOURCE.indexOf("<textarea");
    const textareaBlock = SOURCE.slice(textareaIdx, textareaIdx + 400);
    expect(textareaBlock).not.toMatch(/disabled/);
  });
});

describe("ListSpecimenModal — buyer-parity compatibility preview (§2.2)", () => {
  it("renders buildCompatibilityExplanation's output via the draft, not a re-implemented verdict", () => {
    // buildListingDraftFromSpecies composes buildCompatibilityExplanation
    // internally; the component just renders draft.compatibilityPreview.
    expect(SOURCE).toContain("setCompatibilityPreview(draft.compatibilityPreview)");
    expect(SOURCE).toContain("compatibilityPreview.headline");
  });
});

describe("ListSpecimenModal — confidence pills convey known vs estimated in text, not color alone (§3/§4.10)", () => {
  it("ConfidencePill renders both an icon/symbol and a text label", () => {
    expect(SOURCE).toMatch(/✓ verified/);
    expect(SOURCE).toMatch(/≈ estimated/);
  });

  it("confidence pills are wired from careConfidence (buildListingDraftFromSpecies' dataConfidence), not hardcoded", () => {
    expect(SOURCE).toContain("setCareConfidence(care.dataConfidence)");
    expect(SOURCE).toMatch(/<ConfidencePill known=\{careConfidence\.\w+\}/);
  });
});

describe("ListSpecimenModal — price suggestion is a hint, never a promise (§2.1)", () => {
  it("renders buildPriceSuggestion's basis text alongside the suggested figure", () => {
    expect(SOURCE).toContain("priceSuggestion.basis");
  });

  it("the suggestion is only shown when present (null below the sample floor is handled, not forced)", () => {
    expect(SOURCE).toMatch(/\{priceSuggestion && \(/);
  });
});
