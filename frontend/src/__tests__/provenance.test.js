/**
 * Provenance — how a fish entered the collection (utils/provenance.js).
 *
 * WHY THESE TESTS EXIST. Provenance was not stored at all; it was inferred in four
 * separate components from whether a fish had recorded parents:
 *
 *     if (sireId === 0 && damId === 0) pedigreeLabel = "Wild Caught";
 *
 * So a fish bought at a local shop and typed in by hand was advertised to buyers as
 * wild-caught founder stock, and in ListSpecimenModal that label also drove a
 * suggested price. Absence of a recorded parent was being read as a positive claim
 * about origin — the §7.1 verified-vs-self-reported line, crossed.
 *
 * The tests that matter are therefore about what is NEVER claimed: no rung means
 * wild, and a legacy row with no data does not get upgraded into a statement its
 * keeper never made.
 */
import { describe, it, expect } from "vitest";
import {
  PROVENANCE,
  PROVENANCE_ORDER,
  PROVENANCE_OPTIONS,
  PROVENANCE_UNKNOWN_LABEL,
  normalizeProvenance,
  resolveProvenance,
  provenanceLabel,
  provenanceText,
  isLineageRoot,
  allProvenanceCopy,
} from "../utils/provenance";

describe("the vocabulary", () => {
  it("has no wild-caught rung at all", () => {
    // A keeper buying from a shop cannot usually know whether a fish was
    // wild-collected or farmed, so offering the option invites a guess that then
    // renders as fact. If it is ever needed it arrives with evidence, not as a
    // dropdown entry.
    const values = Object.values(PROVENANCE).join(" ").toLowerCase();
    expect(values).not.toContain("wild");
  });

  it("never CLAIMS a fish is wild-caught", () => {
    // The unrecorded rung deliberately mentions the phrase in order to deny it
    // ("Unrecorded is not the same as wild-caught") — that sentence exists because
    // the old inference is what readers have been trained on. Every other line must
    // not contain it at all.
    const denial = provenanceText(PROVENANCE.UNRECORDED);
    expect(denial.toLowerCase()).toMatch(/not the same as wild/);

    for (const line of allProvenanceCopy()) {
      if (line === denial) continue;
      expect(line.toLowerCase()).not.toMatch(/\bwild[- ]?caught\b/);
    }
  });

  it("offers only states a keeper can actually assert", () => {
    // UNRECORDED is an absence, not a choice — offering it would be asking someone
    // to declare that they declared nothing.
    expect(PROVENANCE_OPTIONS.map((o) => o.value)).toEqual([
      PROVENANCE.BRED_BY_KEEPER,
      PROVENANCE.UNVERIFIED,
    ]);
  });

  it("orders every known value exactly once", () => {
    expect([...PROVENANCE_ORDER].sort()).toEqual(Object.values(PROVENANCE).sort());
  });
});

describe("normalizeProvenance", () => {
  it("accepts the canonical values", () => {
    for (const value of PROVENANCE_ORDER) {
      expect(normalizeProvenance(value)).toBe(value);
    }
  });

  it("is case and whitespace tolerant", () => {
    expect(normalizeProvenance("  UNVERIFIED ")).toBe(PROVENANCE.UNVERIFIED);
  });

  it("returns null for anything else, including the old inferred label", () => {
    for (const junk of ["Wild Caught", "wild", "purebred", "", null, undefined, 7, {}]) {
      expect(normalizeProvenance(junk)).toBeNull();
    }
  });
});

describe("resolveProvenance — the legacy-row rule", () => {
  it("prefers a stored value over anything derived", () => {
    // Stored UNVERIFIED must win even though the parents would suggest bred-here.
    const specimen = { provenance: PROVENANCE.UNVERIFIED, sireId: 4, damId: 5 };
    expect(resolveProvenance(specimen)).toBe(PROVENANCE.UNVERIFIED);
  });

  it("derives bredByKeeper from recorded parents — the parents ARE the evidence", () => {
    expect(resolveProvenance({ sireId: 3, damId: 4 })).toBe(PROVENANCE.BRED_BY_KEEPER);
    expect(resolveProvenance({ sireId: 3, damId: 0 })).toBe(PROVENANCE.BRED_BY_KEEPER);
    expect(resolveProvenance({ sireId: 0, damId: 4 })).toBe(PROVENANCE.BRED_BY_KEEPER);
  });

  it("THE REGRESSION: a parentless legacy row is UNRECORDED, not wild and not unverified", () => {
    // This is the entire point. The old code said "Wild Caught" here. Saying
    // UNVERIFIED would be almost as wrong in the other direction: it would invent
    // a statement ("I bought this outside the app") that the keeper never made.
    // A pre-existing parentless row could be a shop fish, a gift, or a
    // half-finished form. We cannot tell, so it reads "—".
    expect(resolveProvenance({ sireId: 0, damId: 0 })).toBe(PROVENANCE.UNRECORDED);
    expect(resolveProvenance({})).toBe(PROVENANCE.UNRECORDED);
    expect(resolveProvenance(null)).toBe(PROVENANCE.UNRECORDED);
  });

  it("ignores an unrecognized stored value rather than trusting it", () => {
    expect(resolveProvenance({ provenance: "Wild Caught", sireId: 0, damId: 0 }))
      .toBe(PROVENANCE.UNRECORDED);
  });

  it("treats string ids from a form the same as numbers", () => {
    expect(resolveProvenance({ sireId: "3", damId: "0" })).toBe(PROVENANCE.BRED_BY_KEEPER);
    expect(resolveProvenance({ sireId: "0", damId: "0" })).toBe(PROVENANCE.UNRECORDED);
  });
});

describe("labels", () => {
  it("renders unrecorded as an em dash in both modes, never a guessed origin", () => {
    expect(provenanceLabel({ sireId: 0, damId: 0 })).toBe(PROVENANCE_UNKNOWN_LABEL);
    expect(provenanceLabel({ sireId: 0, damId: 0 }, { casual: true })).toBe(PROVENANCE_UNKNOWN_LABEL);
  });

  it("has distinct pro and casual copy for every rung", () => {
    for (const value of PROVENANCE_ORDER) {
      expect(provenanceText(value, { casual: false })).toBeTruthy();
      expect(provenanceText(value, { casual: true })).toBeTruthy();
    }
  });

  it("accepts either a stored string or a specimen object", () => {
    expect(provenanceLabel(PROVENANCE.UNVERIFIED)).toBe(provenanceLabel({ provenance: PROVENANCE.UNVERIFIED }));
  });

  it("states plainly that unverified means the history is unknown", () => {
    // Must not read as reassurance — the PEDIGREE_TRUST_COPY rule about
    // `unattested` applied to origin.
    const pro = provenanceText(PROVENANCE.UNVERIFIED).toLowerCase();
    expect(pro).toContain("unknown");
  });

  it("says explicitly that unrecorded is not the same as wild-caught", () => {
    expect(provenanceText(PROVENANCE.UNRECORDED).toLowerCase()).toContain("not the same as wild");
  });
});

describe("isLineageRoot", () => {
  it("is true when there is no ancestor to walk to", () => {
    expect(isLineageRoot({ provenance: PROVENANCE.UNVERIFIED })).toBe(true);
    expect(isLineageRoot({ sireId: 0, damId: 0 })).toBe(true);
  });

  it("is false once any parent is on record", () => {
    expect(isLineageRoot({ sireId: 9, damId: 0 })).toBe(false);
  });

  it("is false for a fish acquired through the app, which has a handover record", () => {
    expect(isLineageRoot({ provenance: PROVENANCE.ACQUIRED_IN_APP })).toBe(false);
  });
});
