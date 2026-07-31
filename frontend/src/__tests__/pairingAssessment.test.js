/**
 * Pairing assessment (docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md §2.4,
 * acceptance criteria 7–14).
 *
 * The headline case is the COUSIN fixture. The engine this replaces
 * (`SpawningWizard.calculateInbreeding`) compared only the two candidates'
 * immediate parents, so cousins — who share grandparents but no parent — came
 * back as a confident "0% Safe Lineage". That number was then written onto every
 * offspring certificate as the "Inbreeding Coefficient" attribute.
 *
 * The second case that matters is WILD-CAUGHT × WILD-CAUGHT: with no recorded
 * ancestry on either side there is nothing to search, so the answer is "no
 * pedigree data" — not 0%. A zero has to mean "verified outbred across three
 * generations" or it means nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

let localSpecimens = [];

vi.mock("../db", () => ({
  db: {
    specimens: {
      get: async (id) => localSpecimens.find((s) => String(s.id) === String(id)) || undefined,
      filter: (fn) => ({ first: async () => localSpecimens.find(fn) || undefined }),
    },
  },
}));

const { assessPairing, pairingMetadataAttributes } = await import("../services/pairingAssessment");
const { PAIRING_SEVERITY, SEX } = await import("../utils/specimenSex");
const { PEDIGREE_DEPTH } = await import("../services/pedigree");

/** A local specimen record. Sex defaults to unknown, like most real rows. */
function fish(id, { sire = 0, dam = 0, gender = SEX.UNSEXED, speciesId = 10 } = {}) {
  return {
    id,
    speciesId,
    commonName: `Fish ${id}`,
    scientificName: "Amatitlania nigrofasciata",
    sireId: sire,
    damId: dam,
    status: 0,
    gender,
  };
}

beforeEach(() => {
  localSpecimens = [];
});

describe("relatedness — the cases the old engine got wrong", () => {
  it("FULL SIBLINGS report ~25% and a critical risk level", async () => {
    // 10 and 11 share both parents (1, 2).
    localSpecimens = [
      fish(1), fish(2),
      fish(10, { sire: 1, dam: 2, gender: SEX.MALE }),
      fish(11, { sire: 1, dam: 2, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 10),
      dam: localSpecimens.find((f) => f.id === 11),
    });
    expect(res.coi.available).toBe(true);
    expect(res.coi.coi).toBeCloseTo(25, 5);
    // §9.18 CLOSED: 25% IS the full-sibling coefficient, so it now lands in
    // "critical". The old band was `<= 25 → "high"`, which labelled the single most
    // important warning this feature produces one tier too low and described it to
    // the breeder as "equivalent to half-sibling mating".
    expect(res.coi.riskLevel).toBe("critical");
    expect(res.coi.recommendation.toLowerCase()).toContain("full-sibling");
  });

  it("FIRST COUSINS report a non-zero COI — the old engine said 0% 'Safe'", async () => {
    // Grandparents 1 × 2 produced siblings 10 and 11.
    // 10 × 20 → 100 ;  11 × 21 → 101.  100 and 101 are first cousins:
    // they share BOTH grandparents (1 and 2) but no parent.
    localSpecimens = [
      fish(1), fish(2), fish(20), fish(21),
      fish(10, { sire: 1, dam: 2 }),
      fish(11, { sire: 1, dam: 2 }),
      fish(100, { sire: 10, dam: 20, gender: SEX.MALE }),
      fish(101, { sire: 11, dam: 21, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 100),
      dam: localSpecimens.find((f) => f.id === 101),
    });
    expect(res.coi.available).toBe(true);
    expect(res.coi.coi).toBeGreaterThan(0);
    // Two shared grandparents at generation 2 on each side:
    // 2 × (1/2)^(2+2+1) = 6.25%
    expect(res.coi.coi).toBeCloseTo(6.25, 5);
    expect(res.coi.sharedAncestors.map((a) => a.id).sort()).toEqual([1, 2]);
  });

  it("HALF-COUSINS (one shared grandparent) still report non-zero", async () => {
    localSpecimens = [
      fish(1), fish(2), fish(3), fish(20), fish(21),
      fish(10, { sire: 1, dam: 2 }),
      fish(11, { sire: 1, dam: 3 }),
      fish(100, { sire: 10, dam: 20, gender: SEX.MALE }),
      fish(101, { sire: 11, dam: 21, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 100),
      dam: localSpecimens.find((f) => f.id === 101),
    });
    // (1/2)^(2+2+1) = 3.125%, which the engine rounds to 2 decimals → 3.13.
    expect(res.coi.coi).toBeCloseTo(3.13, 5);
    expect(res.coi.coi).toBeGreaterThan(0);
  });

  it("PARENT × OFFSPRING reports ~25% even when the parent is wild-caught", async () => {
    // The parent has no recorded ancestry of its own, but the offspring names it,
    // so the shared ancestor is positively detected and IS reportable.
    localSpecimens = [
      fish(1, { gender: SEX.MALE }),
      fish(2),
      fish(10, { sire: 1, dam: 2, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 1),
      dam: localSpecimens.find((f) => f.id === 10),
    });
    expect(res.coi.available).toBe(true);
    expect(res.coi.coi).toBeCloseTo(25, 5);
  });

  it("UNRELATED but fully-pedigreed pair reports a verified 0%", async () => {
    localSpecimens = [
      fish(1), fish(2), fish(3), fish(4),
      fish(10, { sire: 1, dam: 2, gender: SEX.MALE }),
      fish(11, { sire: 3, dam: 4, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 10),
      dam: localSpecimens.find((f) => f.id === 11),
    });
    expect(res.coi.available).toBe(true);
    expect(res.coi.coi).toBe(0);
    expect(res.coi.riskLevel).toBe("none");
  });
});

describe("never fabricate a coefficient (spec §1.7)", () => {
  it("two WILD-CAUGHT fish report 'no pedigree data', NOT 0%", async () => {
    localSpecimens = [
      fish(1, { gender: SEX.MALE }),
      fish(2, { gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 1),
      dam: localSpecimens.find((f) => f.id === 2),
    });
    expect(res.coi.available).toBe(false);
    expect(res.coi.coi).toBeUndefined();
    expect(res.coi.unavailableReason).toBeTruthy();
    expect(res.coi.depth).toBe(PEDIGREE_DEPTH);
  });

  it("one pedigreed side and one wild-caught side is also unavailable, not 0%", async () => {
    localSpecimens = [
      fish(1), fish(2),
      fish(10, { sire: 1, dam: 2, gender: SEX.MALE }),
      fish(99, { gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({
      sire: localSpecimens.find((f) => f.id === 10),
      dam: localSpecimens.find((f) => f.id === 99),
    });
    expect(res.coi.available).toBe(false);
  });

  it("an unresolvable specimen yields unavailable rather than a number", async () => {
    localSpecimens = [fish(1, { gender: SEX.MALE })];
    const res = await assessPairing({
      sire: localSpecimens[0],
      dam: { id: 404, speciesId: 10, gender: SEX.FEMALE },
    });
    expect(res.coi.available).toBe(false);
  });
});

describe("canProceed blocks ONLY a known same-sex pair (spec §1.2)", () => {
  beforeEach(() => {
    localSpecimens = [
      fish(1, { gender: SEX.MALE }),
      fish(2, { gender: SEX.MALE }),
      fish(3, { gender: SEX.FEMALE }),
      fish(4, { gender: SEX.UNSEXED }),
      fish(5, { gender: SEX.UNSEXED }),
    ];
  });
  const byId = (id) => localSpecimens.find((f) => f.id === id);

  it("blocks two males", async () => {
    const res = await assessPairing({ sire: byId(1), dam: byId(2) });
    expect(res.canProceed).toBe(false);
    expect(res.sex.severity).toBe(PAIRING_SEVERITY.ERROR);
  });

  it("does NOT block an unsexed pairing", async () => {
    for (const [a, b] of [[1, 4], [4, 1], [4, 5]]) {
      const res = await assessPairing({ sire: byId(a), dam: byId(b) });
      expect(res.canProceed, `${a} × ${b}`).toBe(true);
    }
  });

  it("does NOT block a high-COI pairing — line-breeding is deliberate", async () => {
    localSpecimens = [
      fish(1), fish(2),
      fish(10, { sire: 1, dam: 2, gender: SEX.MALE }),
      fish(11, { sire: 1, dam: 2, gender: SEX.FEMALE }),
    ];
    const res = await assessPairing({ sire: byId(10), dam: byId(11) });
    expect(res.coi.coi).toBeCloseTo(25, 5);
    // Critical since §9.18 — and still not blocked. Line-breeding is a legitimate,
    // deliberate practice; the COI is information the breeder acts on, not a gate
    // (T1 §1.3). The severity going UP must not turn the warning into a block.
    expect(res.coi.riskLevel).toBe("critical");
    expect(res.canProceed).toBe(true);
  });

  it("does NOT block a species mismatch (reported separately from relatedness)", async () => {
    localSpecimens = [
      fish(1, { gender: SEX.MALE, speciesId: 10 }),
      fish(2, { gender: SEX.FEMALE, speciesId: 77 }),
    ];
    const res = await assessPairing({ sire: byId(1), dam: byId(2) });
    expect(res.species.ok).toBe(false);
    expect(res.species.reason).toBeTruthy();
    expect(res.canProceed).toBe(true);
  });

  it("reports species match and relatedness as independent signals", async () => {
    localSpecimens = [
      fish(1, { gender: SEX.MALE, speciesId: 10 }),
      fish(2, { gender: SEX.FEMALE, speciesId: 10 }),
    ];
    const res = await assessPairing({ sire: byId(1), dam: byId(2) });
    expect(res.species.ok).toBe(true);
    // Species agreement says nothing about relatedness — these are wild-caught.
    expect(res.coi.available).toBe(false);
  });

  it("returns a blocked, empty assessment when a side is missing", async () => {
    const res = await assessPairing({ sire: null, dam: byId(1) });
    expect(res.canProceed).toBe(false);
  });
});

describe("pairingMetadataAttributes — the recorded claim is self-describing", () => {
  it("records the method and depth alongside a real coefficient", async () => {
    localSpecimens = [
      fish(1), fish(2),
      fish(10, { sire: 1, dam: 2, gender: SEX.MALE }),
      fish(11, { sire: 1, dam: 2, gender: SEX.FEMALE }),
    ];
    const sire = localSpecimens.find((f) => f.id === 10);
    const dam = localSpecimens.find((f) => f.id === 11);
    const attrs = pairingMetadataAttributes(await assessPairing({ sire, dam }), sire, dam);
    const map = Object.fromEntries(attrs.map((a) => [a.trait_type, a.value]));
    expect(map["Inbreeding Coefficient"]).toBe("25%");
    expect(map["COI Method"]).toBe(`Wright, ${PEDIGREE_DEPTH} generations`);
    expect(map["Sire Sex"]).toBe("Male");
    expect(map["Dam Sex"]).toBe("Female");
  });

  it("records an explicit unknown — never '0%' — when there is no pedigree", async () => {
    localSpecimens = [fish(1, { gender: SEX.MALE }), fish(2, { gender: SEX.FEMALE })];
    const sire = localSpecimens[0];
    const dam = localSpecimens[1];
    const attrs = pairingMetadataAttributes(await assessPairing({ sire, dam }), sire, dam);
    const map = Object.fromEntries(attrs.map((a) => [a.trait_type, a.value]));
    expect(map["Inbreeding Coefficient"]).toBe("Unknown — no pedigree data");
    expect(map["Inbreeding Coefficient"]).not.toContain("0%");
    expect(map["COI Method"]).toBe("Not calculated");
  });

  it("normalizes legacy sex values in the recorded attributes", () => {
    const attrs = pairingMetadataAttributes(
      { coi: { available: false } },
      { gender: "Not Sure" },
      { gender: null }
    );
    const map = Object.fromEntries(attrs.map((a) => [a.trait_type, a.value]));
    expect(map["Sire Sex"]).toBe("Unsexed");
    expect(map["Dam Sex"]).toBe("Unsexed");
  });
});

describe("one engine only", () => {
  function source(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("the wizard no longer carries its own heuristic", () => {
    const SOURCE = source("../components/SpawningWizard.jsx");
    expect(SOURCE).not.toContain("calculateInbreeding");
    expect(SOURCE).not.toContain("Safe Lineage");
    expect(SOURCE).not.toContain("Critical Sibling Pair");
    expect(SOURCE).not.toContain("Half-Sibling Pair");
    expect(SOURCE).not.toContain("Species Mismatch");
    expect(SOURCE).not.toMatch(/coefficient:\s*12\.5/);
    expect(SOURCE).not.toMatch(/coefficient:\s*25/);
  });

  it("the wizard composes the shared assessment service", () => {
    const SOURCE = source("../components/SpawningWizard.jsx");
    expect(SOURCE).toContain('from "../services/pairingAssessment"');
    expect(SOURCE).toContain("assessPairing");
    expect(SOURCE).toContain("pairingMetadataAttributes");
  });

  it("the assessment resolves ancestors through the shared resolver, not the contract", () => {
    const SOURCE = source("../services/pairingAssessment.js");
    expect(SOURCE).toContain('from "./pedigree"');
    expect(SOURCE).not.toContain("contract.specimens(");
  });
});
