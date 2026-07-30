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
  SPAWN_TERMINAL_STATUSES,
  SPAWN_DERIVATION_REASON,
  SPAWN_DERIVATION_COPY,
  allSpawnDerivationCopy,
  spawnDerivationText,
  deriveSpawnStatus,
  RETIREMENT_OUTCOMES,
  retirementOutcomeLabel,
} from "../utils/specimenIdentity";
import { containsProhibitedTerm } from "../services/orderCopy";

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

/**
 * Derived spawn status (§9.6).
 *
 * `relaySpawn` writes Fry and nothing ever moved it, so every spawn ever logged
 * read "Fry" forever — including the ones that produced certificated adults and
 * the ones where nothing survived. Resolved as DERIVED rather than stored: no
 * migration, no transition guard, and no second copy that can go stale.
 *
 * The property that matters most is that the derivation ONLY ADVANCES. It must
 * never downgrade a stored value and never invent `Egg`, because `relaySpawn`
 * mints offspring immediately — a spawn with no checkpoints genuinely has fry.
 */
describe("deriveSpawnStatus", () => {
  const at = (type, count, timestamp = 1000) => ({ type, count, timestamp });

  it("leaves a spawn with no checkpoints exactly as stored", () => {
    // The regression that would mislabel every spawn a breeder hasn't logged
    // against yet. `relaySpawn` mints offspring certificates at creation, so
    // "no fry_count checkpoint" is not evidence of an egg-stage spawn.
    const result = deriveSpawnStatus({ storedStatus: SPAWN_STATUS.FRY, checkpoints: [] });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
    expect(result.derived).toBe(false);
    expect(result.reason).toBe(SPAWN_DERIVATION_REASON.NO_EVIDENCE);
  });

  it("never derives Egg from anything", () => {
    for (const checkpoints of [
      [],
      [at("note", 0)],
      [at("narration", 0)],
      [at("fry_count", 20)],
      [at("fry_count", 20), at("loss", 20)],
      [at("fry_count", 20), at("promoted", 2)],
    ]) {
      expect(deriveSpawnStatus({ storedStatus: SPAWN_STATUS.FRY, checkpoints }).status)
        .not.toBe(SPAWN_STATUS.EGG);
    }
  });

  it("advances a stored Egg to Fry once fry are counted", () => {
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.EGG,
      checkpoints: [at("fry_count", 30)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
    expect(result.derived).toBe(true);
    expect(result.reason).toBe(SPAWN_DERIVATION_REASON.FRY_COUNTED);
  });

  it("reports derived: false when the stored value already said Fry", () => {
    // Nothing was worked out, so the UI shouldn't claim it was.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 30)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
    expect(result.derived).toBe(false);
  });

  it("reads a promotion as Raised — the one verified signal", () => {
    // A `promoted` checkpoint means certificate rows exist for fish pulled out of
    // this cohort. That is evidence, not a claim.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 40), at("promoted", 3)],
    });
    expect(result.status).toBe(SPAWN_STATUS.RAISED);
    expect(result.derived).toBe(true);
    expect(result.reason).toBe(SPAWN_DERIVATION_REASON.PROMOTED);
  });

  it("does NOT read a self-reported sale as Raised", () => {
    // §9.11 in a new place: `sold` is a number the breeder typed with nothing
    // behind it, and it fires early — "sold 5" in week one would mark a spawn
    // Raised while the rest of the cohort is still in the tank.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 40), at("sold", 5)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
  });

  it("reads a fully-lost counted cohort as Failed", () => {
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 12), at("loss", 8), at("cull", 4)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FAILED);
    expect(result.derived).toBe(true);
    expect(result.reason).toBe(SPAWN_DERIVATION_REASON.NO_SURVIVORS);
  });

  it("does not call a cohort that emptied through sales a failure", () => {
    // Selling out is the opposite of failing.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 10), at("sold", 10)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
  });

  it("does not conclude Failed without a fry count", () => {
    // No cohort size means "everything died" is indistinguishable from "nothing
    // was logged". Unknown stays unknown — the same rule as a null survival rate.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("loss", 50)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
    expect(result.reason).toBe(SPAWN_DERIVATION_REASON.NO_EVIDENCE);
  });

  it("does not reach Failed by bookkeeping alone", () => {
    // An empty cohort with no recorded loss is not a failed one.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 0)],
    });
    expect(result.status).toBe(SPAWN_STATUS.FRY);
  });

  it("prefers Raised over Failed when a cohort was fully promoted", () => {
    // fry 4, promoted 4 → alive 0. Every fish left as a certificate, which is the
    // best possible outcome, and the ordering of the checks is what guarantees it
    // isn't reported as a total loss.
    const result = deriveSpawnStatus({
      storedStatus: SPAWN_STATUS.FRY,
      checkpoints: [at("fry_count", 4), at("promoted", 4)],
    });
    expect(result.status).toBe(SPAWN_STATUS.RAISED);
  });

  it("never downgrades a stored terminal status", () => {
    for (const stored of SPAWN_TERMINAL_STATUSES) {
      const result = deriveSpawnStatus({ storedStatus: stored, checkpoints: [at("fry_count", 5)] });
      expect(result.status).toBe(stored);
      expect(result.derived).toBe(false);
      expect(result.reason).toBe(SPAWN_DERIVATION_REASON.TERMINAL_STORED);
    }
  });

  it("passes an unrecognized stored status through so it still reads Unknown", () => {
    // Not converted to null: spawnStatusLabel reads null/undefined as *absent* and
    // defaults those to Fry, so a null here would quietly relabel a corrupt status
    // as Fry. Handing the raw value back lets the label helper say "Unknown".
    const result = deriveSpawnStatus({ storedStatus: 99, checkpoints: [at("fry_count", 5)] });
    expect(result.status).toBe(99);
    expect(result.derived).toBe(false);
    expect(spawnStatusLabel(result.status)).toBe(UNKNOWN_STATUS_LABEL);
  });

  it("tolerates junk input", () => {
    for (const junk of [undefined, {}, { checkpoints: null }, { checkpoints: "nope" }]) {
      expect(() => deriveSpawnStatus(junk)).not.toThrow();
    }
    // A missing stored status defaults to Fry, matching normalizeSpawnStatus.
    expect(deriveSpawnStatus({}).status).toBe(SPAWN_STATUS.FRY);
  });

  it("shares one funnel implementation with the grow-out tracker", () => {
    // Derived from summarizeGrowout, so the badge and the numbers printed under
    // it read the same rows and can't disagree.
    const src = readSource("../utils/specimenIdentity.js");
    expect(src).toContain("summarizeGrowout");
    expect(src).not.toMatch(/filter\(\s*c\s*=>\s*c\.type\s*===/);
  });
});

describe("SPAWN_DERIVATION_COPY", () => {
  it("is free of PROHIBITED_TERMS in both modes", () => {
    for (const text of allSpawnDerivationCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("covers every reason the derivation can return", () => {
    for (const reason of Object.values(SPAWN_DERIVATION_REASON)) {
      expect(SPAWN_DERIVATION_COPY[reason], reason).toBeTruthy();
      expect(SPAWN_DERIVATION_COPY[reason].pro, reason).toBeTruthy();
      expect(SPAWN_DERIVATION_COPY[reason].casual, reason).toBeTruthy();
    }
  });

  it("resolves by mode and falls back rather than rendering a blank", () => {
    expect(spawnDerivationText("promoted")).toBe(SPAWN_DERIVATION_COPY.promoted.pro);
    expect(spawnDerivationText("promoted", { casual: true })).toBe(SPAWN_DERIVATION_COPY.promoted.casual);
    expect(spawnDerivationText("no-such-reason")).toBe(SPAWN_DERIVATION_COPY.noEvidence.pro);
  });
});

describe("SpawningDashboard renders the derived status, not the stored one", () => {
  const DASHBOARD = readSource("../components/SpawningDashboard.jsx");

  it("derives per spawn and labels from the result", () => {
    expect(DASHBOARD).toContain("deriveSpawnStatus({");
    expect(DASHBOARD).toContain("spawnStatusLabel(derivation.status)");
    expect(DASHBOARD).toContain("spawnStatusTone(derivation.status)");
    // The stored value must not reach the badge directly — that is the bug.
    expect(DASHBOARD).not.toContain("spawnStatusLabel(spawn.status)");
    expect(DASHBOARD).not.toContain("spawnStatusTone(spawn.status)");
  });

  it("explains where the status came from", () => {
    // A badge that changes on its own with no explanation is worse than one that
    // never moved.
    expect(DASHBOARD).toContain("spawnDerivationText(derivation.reason)");
  });

  it("indexes the checkpoints it already loads instead of scanning per row", () => {
    // `growoutData` was loaded and then never read. This is what it was for.
    expect(DASHBOARD).toContain("checkpointsBySpawn");
    expect(DASHBOARD).toContain("growoutData");
  });

  it("writes no spawn status of its own", () => {
    // Derived means derived. A write here would recreate the second copy this
    // decision exists to avoid.
    expect(DASHBOARD).not.toMatch(/db\.spawns\.(update|put)/);
  });
});
