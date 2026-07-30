/**
 * Guards for the canonical specimen status + certificate serial model
 * (docs/BREEDER_STATE_MODEL.md), implemented by utils/specimenIdentity.js.
 *
 * Two classes of assertion here:
 *   1. Behavior of the helpers themselves.
 *   2. Source guards proving the Breeder Tools surfaces consume the helpers
 *      rather than re-inlining the mapping. Re-inlining is what let
 *      SpawningDashboard drift into rendering Deceased as "Transferred" and
 *      truncating serials with `.slice(-3)`. This project's vitest runs in a
 *      `node` environment, so component contracts are asserted statically over
 *      the comment-stripped source, per the existing catalog-test convention.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  SPECIMEN_STATUS,
  SERIAL_CEILING,
  UNKNOWN_STATUS_LABEL,
  normalizeSpecimenStatus,
  specimenStatusLabel,
  specimenStatusTone,
  isSpecimenActive,
  formatCertSerial,
  isLegacySerial,
  formatLocalRecordRef,
  SPAWN_STATUS,
  spawnStatusLabel,
  spawnStatusTone,
  RETIREMENT_OUTCOMES,
  retirementOutcomeLabel,
} from "../utils/specimenIdentity";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSource(relativePath) {
  return stripComments(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
  );
}

describe("SPECIMEN_STATUS matches the on-chain enum", () => {
  it("mirrors SpecimenStatus { Active, Deceased, Rehomed } in AquadexStorage.sol", () => {
    const solidity = readSource("../../../contracts/AquadexStorage.sol");
    const match = solidity.match(/enum\s+SpecimenStatus\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();

    const members = match[1]
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    // Ordinal position in the Solidity enum IS the stored value.
    expect(members).toEqual(["Active", "Deceased", "Rehomed"]);
    expect(members[SPECIMEN_STATUS.ACTIVE]).toBe("Active");
    expect(members[SPECIMEN_STATUS.DECEASED]).toBe("Deceased");
    expect(members[SPECIMEN_STATUS.REHOMED]).toBe("Rehomed");
  });
});

describe("specimenStatusLabel", () => {
  it("labels the three canonical states", () => {
    expect(specimenStatusLabel(0)).toBe("Active");
    expect(specimenStatusLabel(1)).toBe("Deceased");
    expect(specimenStatusLabel(2)).toBe("Rehomed");
  });

  it("never renders a deceased specimen as transferred/rehomed (the SpawningDashboard bug)", () => {
    expect(specimenStatusLabel(SPECIMEN_STATUS.DECEASED)).toBe("Deceased");
    expect(specimenStatusLabel(SPECIMEN_STATUS.DECEASED)).not.toBe("Transferred");
    expect(specimenStatusLabel(SPECIMEN_STATUS.DECEASED)).not.toBe("Rehomed");
  });

  it("treats a missing status as Active, matching the write-path default", () => {
    expect(specimenStatusLabel(undefined)).toBe("Active");
    expect(specimenStatusLabel(null)).toBe("Active");
    expect(isSpecimenActive(undefined)).toBe(true);
  });

  it("accepts numeric strings (contract reads and form values)", () => {
    expect(specimenStatusLabel("1")).toBe("Deceased");
    expect(specimenStatusLabel("2")).toBe("Rehomed");
  });

  it("reports an out-of-range status as Unknown rather than the highest state", () => {
    expect(specimenStatusLabel(3)).toBe(UNKNOWN_STATUS_LABEL);
    expect(specimenStatusLabel(-1)).toBe(UNKNOWN_STATUS_LABEL);
    expect(specimenStatusLabel(1.5)).toBe(UNKNOWN_STATUS_LABEL);
    expect(specimenStatusLabel("nonsense")).toBe(UNKNOWN_STATUS_LABEL);
    expect(normalizeSpecimenStatus(3)).toBeNull();
  });

  it("has casual copy for every canonical state", () => {
    for (const value of Object.values(SPECIMEN_STATUS)) {
      const casual = specimenStatusLabel(value, { casual: true });
      expect(casual).toBeTruthy();
      expect(casual).not.toBe(UNKNOWN_STATUS_LABEL);
    }
  });

  it("gives every state a display tone, and unknown a neutral one", () => {
    for (const value of Object.values(SPECIMEN_STATUS)) {
      expect(specimenStatusTone(value).color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(specimenStatusTone(99)).toBe(specimenStatusTone("garbage"));
  });
});

describe("RETIREMENT_OUTCOMES", () => {
  it("offers exactly the two real ways a fish leaves your care", () => {
    expect(RETIREMENT_OUTCOMES.map((o) => o.status)).toEqual([
      SPECIMEN_STATUS.REHOMED,
      SPECIMEN_STATUS.DECEASED,
    ]);
  });

  it("never lets a retirement write Active, and has no 'inactive' outcome", () => {
    for (const outcome of RETIREMENT_OUTCOMES) {
      expect(outcome.status).not.toBe(SPECIMEN_STATUS.ACTIVE);
    }
    const copy = JSON.stringify(RETIREMENT_OUTCOMES).toLowerCase();
    expect(copy).not.toContain("inactive");
  });

  it("carries pro and casual copy plus a detail line for each outcome", () => {
    for (const outcome of RETIREMENT_OUTCOMES) {
      expect(retirementOutcomeLabel(outcome)).toBeTruthy();
      expect(retirementOutcomeLabel(outcome, { casual: true })).toBeTruthy();
      expect(outcome.detail).toBeTruthy();
      expect(outcome.key).toBeTruthy();
    }
    expect(retirementOutcomeLabel(null)).toBe("");
  });

  it("labels line up with the canonical status labels", () => {
    for (const outcome of RETIREMENT_OUTCOMES) {
      expect(specimenStatusLabel(outcome.status)).not.toBe(UNKNOWN_STATUS_LABEL);
    }
  });
});

describe("FryNursery retire records an explicit outcome", () => {
  const SOURCE = readSource("../components/FryNursery.jsx");

  it("delegates the status write to the single lifecycle service", () => {
    expect(SOURCE).toContain('from "../services/specimenLifecycle"');
    expect(SOURCE).toContain("retireSpecimens(ids, status)");
    // No direct status write left in the component — the validated write, the
    // tank detach, and the cloud mirror all live in the service.
    expect(SOURCE).not.toMatch(/db\.specimens\.update\([^)]*status/);
  });

  it("drives the choice from the shared outcome list", () => {
    expect(SOURCE).toContain("RETIREMENT_OUTCOMES.map");
  });

  it("stops describing retirement as 'inactive'", () => {
    expect(SOURCE.toLowerCase()).not.toContain("marks it inactive");
    expect(SOURCE.toLowerCase()).not.toContain("inactive and removes");
  });

  it("formats cert serials through the shared helper", () => {
    expect(SOURCE).toContain("formatCertSerial(fish.id)");
  });
});

describe("TankList farewell modal shares the outcome list", () => {
  const SOURCE = readSource("../components/TankList.jsx");

  it("maps RETIREMENT_OUTCOMES instead of hardcoding status 1 and 2", () => {
    expect(SOURCE).toContain("RETIREMENT_OUTCOMES.map");
    expect(SOURCE).not.toContain("update(spec.id, { status: 1 })");
    expect(SOURCE).not.toContain("update(spec.id, { status: 2 })");
  });

  it("delegates both retire and archive to the lifecycle service", () => {
    expect(SOURCE).toContain('from "../services/specimenLifecycle"');
    expect(SOURCE).toContain("retireSpecimens(spec.id, outcome.status)");
    expect(SOURCE).toContain("archiveSpecimens(spec.id)");
  });
});

describe("formatCertSerial", () => {
  it("pads to three digits", () => {
    expect(formatCertSerial(1)).toBe("001");
    expect(formatCertSerial(42)).toBe("042");
    expect(formatCertSerial(999)).toBe("999");
  });

  it("never truncates a serial past three digits", () => {
    // The .slice(-3) bug: 1042 rendered as "042", which is another real cert.
    expect(formatCertSerial(1042)).toBe("1042");
    expect(formatCertSerial(1007)).toBe("1007");
  });

  it("keeps distinct serials distinct", () => {
    expect(formatCertSerial(42)).not.toBe(formatCertSerial(1042));
    expect(formatCertSerial(7)).not.toBe(formatCertSerial(1007));
  });

  it("renders 'no parent' cases as the fallback, not as cert 000", () => {
    expect(formatCertSerial(0)).toBe("—");
    expect(formatCertSerial(null)).toBe("—");
    expect(formatCertSerial(undefined)).toBe("—");
    expect(formatCertSerial(0, { none: "Wild" })).toBe("Wild");
  });

  it("shows legacy timestamp ids in full rather than colliding with real serials", () => {
    const legacy = 1731000000000;
    expect(formatCertSerial(legacy)).toBe(String(legacy));
    expect(isLegacySerial(legacy)).toBe(true);
    expect(isLegacySerial(1042)).toBe(false);
    expect(SERIAL_CEILING).toBe(1_000_000_000);
  });
});

describe("formatLocalRecordRef", () => {
  it("shortens timestamp ids (spawns, tanks) but shows sequential ids in full", () => {
    expect(formatLocalRecordRef(1731000123456)).toBe("123456");
    expect(formatLocalRecordRef(1731000000000)).toBe("000000");
    expect(formatLocalRecordRef(7)).toBe("7");
    expect(formatLocalRecordRef(1042)).toBe("1042");
    expect(formatLocalRecordRef(0)).toBe("—");
    expect(formatLocalRecordRef(undefined)).toBe("—");
  });
});

describe("SPAWN_STATUS matches the on-chain enum", () => {
  it("mirrors SpawnStatus { Egg, Fry, Raised, Failed } in AquadexStorage.sol", () => {
    const solidity = readSource("../../../contracts/AquadexStorage.sol");
    const match = solidity.match(/enum\s+SpawnStatus\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();

    const members = match[1]
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    expect(members).toEqual(["Egg", "Fry", "Raised", "Failed"]);
    expect(members[SPAWN_STATUS.FRY]).toBe("Fry");
  });

  it("labels only states the model actually has (not the invented Juvenile/Adult)", () => {
    const labels = Object.values(SPAWN_STATUS).map((v) => spawnStatusLabel(v));
    expect(labels).toEqual(["Egg", "Fry", "Raised", "Failed"]);
    expect(labels).not.toContain("Juvenile");
    expect(labels).not.toContain("Adult");
  });

  it("defaults a missing spawn status to Fry, matching relaySpawn's write", () => {
    expect(spawnStatusLabel(undefined)).toBe("Fry");
    expect(spawnStatusTone(undefined).color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(spawnStatusLabel(99)).toBe(UNKNOWN_STATUS_LABEL);
  });
});

describe("SpawningDashboard consumes the shared model", () => {
  const SOURCE = readSource("../components/SpawningDashboard.jsx");

  it("imports the helpers instead of inlining the status mapping", () => {
    expect(SOURCE).toContain('from "../utils/specimenIdentity"');
    expect(SOURCE).toContain("specimenStatusLabel");
    expect(SOURCE).toContain("formatCertSerial");
  });

  it("no longer mislabels statuses", () => {
    expect(SOURCE).not.toContain('"Transferred"');
    expect(SOURCE).not.toContain('"Inactive"');
  });

  it("no longer truncates serials", () => {
    expect(SOURCE).not.toContain("slice(-3)");
    expect(SOURCE).not.toContain("slice(-6)");
  });
});
