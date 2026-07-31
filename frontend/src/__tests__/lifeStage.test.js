/**
 * Life-stage vocabulary (docs/BREEDER_STATE_MODEL.md §12.4, T3 §2.7).
 *
 * "Eggs" was not representable: a listing had free-text `age`/`size` and an
 * `isBatch` boolean, so nothing could tell an egg from a juvenile. That blocked the
 * sold-lot model, because §4.2's rule — eggs and fry are counts, individually
 * tracked fish are certificates — had nothing to read.
 *
 * The two rules with teeth are `canBeCertificated` and `requiresCohort`, and they
 * fail in OPPOSITE directions on unknown. That asymmetry is deliberate and is the
 * thing most likely to get "simplified" into a bug, so it is asserted explicitly.
 */
import { describe, it, expect } from "vitest";
import {
  COHORT_ONLY_STAGES,
  LIFE_STAGE,
  LIFE_STAGE_COPY,
  LIFE_STAGE_OPTIONS,
  LIFE_STAGE_ORDER,
  LIFE_STAGE_UNKNOWN_LABEL,
  allLifeStageCopy,
  canBeCertificated,
  compareLifeStages,
  isKnownLifeStage,
  lifeStageLabel,
  lifeStageOptionLabel,
  normalizeLifeStage,
  promotedLifeStage,
  requiresCohort,
} from "../utils/lifeStage";
import { containsProhibitedTerm } from "../services/orderCopy";

describe("normalizeLifeStage", () => {
  it("accepts the canonical values case-insensitively", () => {
    expect(normalizeLifeStage("Egg")).toBe(LIFE_STAGE.EGG);
    expect(normalizeLifeStage("egg")).toBe(LIFE_STAGE.EGG);
    expect(normalizeLifeStage("  ADULT  ")).toBe(LIFE_STAGE.ADULT);
  });

  it("tolerates plurals and the casual word a form might submit", () => {
    expect(normalizeLifeStage("eggs")).toBe(LIFE_STAGE.EGG);
    expect(normalizeLifeStage("juveniles")).toBe(LIFE_STAGE.JUVENILE);
    expect(normalizeLifeStage("babies")).toBe(LIFE_STAGE.FRY);
  });

  it("returns null rather than guessing from the free-text fields it replaces", () => {
    // These are real `age`/`size` values from existing listings. A stage inferred
    // from "3 weeks" would be a fabrication.
    for (const junk of ["3 weeks", "0.5 inches", "", "  ", "young", "adultish", null, undefined, 42, {}]) {
      expect(normalizeLifeStage(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it("has no stored unknown, unlike sex", () => {
    // Sex uses a stored "Unsexed" because that value already existed across four
    // writers. There is no legacy default here, so unknown is null (§7.2's rule).
    expect(Object.values(LIFE_STAGE)).not.toContain("Unknown");
    expect(isKnownLifeStage(null)).toBe(false);
  });
});

describe("labels", () => {
  it("renders unknown as a dash, never a guessed stage", () => {
    expect(lifeStageLabel(null)).toBe(LIFE_STAGE_UNKNOWN_LABEL);
    expect(lifeStageLabel("3 weeks")).toBe(LIFE_STAGE_UNKNOWN_LABEL);
  });

  it("differs between modes", () => {
    expect(lifeStageLabel(LIFE_STAGE.FRY)).toBe("Fry");
    expect(lifeStageLabel(LIFE_STAGE.FRY, { casual: true })).toBe("Babies");
  });

  it("offers every stage as an option, youngest first", () => {
    expect(LIFE_STAGE_OPTIONS.map((o) => o.value)).toEqual([...LIFE_STAGE_ORDER]);
    expect(lifeStageOptionLabel(LIFE_STAGE_OPTIONS[0], { casual: true })).toBe("Eggs");
    expect(lifeStageOptionLabel(null)).toBe(LIFE_STAGE_UNKNOWN_LABEL);
  });
});

describe("canBeCertificated — §4.2's line", () => {
  it("refuses eggs and fry, allows juveniles and adults", () => {
    expect(canBeCertificated(LIFE_STAGE.EGG)).toBe(false);
    expect(canBeCertificated(LIFE_STAGE.FRY)).toBe(false);
    expect(canBeCertificated(LIFE_STAGE.JUVENILE)).toBe(true);
    expect(canBeCertificated(LIFE_STAGE.ADULT)).toBe(true);
  });

  it("FAILS CLOSED on unknown", () => {
    // Asked only before issuing a certificate, and §4.1 means a certificate issued
    // for something that turns out to be an egg cannot be withdrawn. Requiring the
    // stage be recorded is the cheap side of that trade.
    for (const unknown of [null, undefined, "", "3 weeks"]) {
      expect(canBeCertificated(unknown), JSON.stringify(unknown)).toBe(false);
    }
  });
});

describe("requiresCohort — and why it is NOT the negation of canBeCertificated", () => {
  it("is true for eggs and fry", () => {
    expect(requiresCohort(LIFE_STAGE.EGG)).toBe(true);
    expect(requiresCohort(LIFE_STAGE.FRY)).toBe(true);
    expect(requiresCohort(LIFE_STAGE.JUVENILE)).toBe(false);
  });

  it("FAILS OPEN on unknown — the opposite bias, deliberately", () => {
    // This one gates a RESTRICTION on the seller. Every listing that predates this
    // field has no stage, so failing closed here would force all of them down the
    // cohort path and break them. Absence of a stage is not evidence of an egg.
    for (const unknown of [null, undefined, "", "3 weeks"]) {
      expect(requiresCohort(unknown), JSON.stringify(unknown)).toBe(false);
    }
  });

  it("means unknown is neither certificatable nor cohort-forced", () => {
    // Both false at once. That is the point: unknown is a third state, not a
    // synonym for either answer.
    expect(canBeCertificated(null)).toBe(false);
    expect(requiresCohort(null)).toBe(false);
  });

  it("keeps the two rules reading the same list", () => {
    for (const stage of COHORT_ONLY_STAGES) {
      expect(canBeCertificated(stage), stage).toBe(false);
      expect(requiresCohort(stage), stage).toBe(true);
    }
  });
});

describe("compareLifeStages", () => {
  it("orders egg → fry → juvenile → adult", () => {
    expect(compareLifeStages(LIFE_STAGE.EGG, LIFE_STAGE.FRY)).toBeLessThan(0);
    expect(compareLifeStages(LIFE_STAGE.ADULT, LIFE_STAGE.JUVENILE)).toBeGreaterThan(0);
    expect(compareLifeStages(LIFE_STAGE.FRY, LIFE_STAGE.FRY)).toBe(0);
  });

  it("returns null when either side is unknown, so unknown is never 'youngest'", () => {
    expect(compareLifeStages(null, LIFE_STAGE.ADULT)).toBeNull();
    expect(compareLifeStages(LIFE_STAGE.ADULT, "3 weeks")).toBeNull();
  });
});

describe("promotedLifeStage", () => {
  it("is a stage that can actually hold a certificate", () => {
    // A promoted keeper has outgrown the cohort by definition. Returning Fry here
    // would let a certificate exist at a cohort-only stage and contradict
    // canBeCertificated — the two must agree.
    const stage = promotedLifeStage();
    expect(canBeCertificated(stage)).toBe(true);
    expect(requiresCohort(stage)).toBe(false);
  });
});

describe("LIFE_STAGE_COPY", () => {
  it("is free of PROHIBITED_TERMS in both modes", () => {
    for (const text of allLifeStageCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("states the cohort rule where a seller meets it", () => {
    expect(LIFE_STAGE_COPY.cohortOnly.pro.toLowerCase()).toContain("not certificated individually");
  });

  it("tells a buyer of eggs what they are actually buying", () => {
    // Selling eggs is a materially different transaction and the risk belongs in
    // the copy, not in a support conversation afterwards.
    expect(LIFE_STAGE_COPY.hatchRisk.pro.toLowerCase()).toContain("not every egg hatches");
    expect(LIFE_STAGE_COPY.hatchRisk.casual.toLowerCase()).toMatch(/not all eggs hatch/);
  });
});
