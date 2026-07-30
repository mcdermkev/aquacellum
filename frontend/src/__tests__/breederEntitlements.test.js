/**
 * Breeder Tools entitlement classification (docs/BREEDER_STATE_MODEL.md §10,
 * closing §9.10).
 *
 * THE POINT: the entire Breeder Tools surface was absent from the entitlement
 * map. `hasEntitlement` fails CLOSED for unknown keys, so every breeder
 * capability silently read as *denied*, and — more importantly — nothing stopped
 * someone later attaching a `minTier` to certificate registration. These tests
 * make the classification enforceable rather than incidental.
 *
 * The line drawn, matching how the Breeder Terminal treats bulk fulfillment:
 *   - Doing the job on ONE thing (register a certificate, log a spawn, log a
 *     checkpoint) is REQUIRED and can never be gated. A breeder who can't record
 *     a fish they bred has lost the record.
 *   - Doing it across MANY at once is a scale convenience and may be earned.
 *
 * Pro vs Casual is NOT in here on purpose: that's a self-service display
 * preference in localStorage, not a capability.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ENTITLEMENTS,
  ENTITLEMENT_CLASS,
  REQUIRED_ENTITLEMENTS,
  hasEntitlement,
  getRequiredTierFor,
} from "../services/entitlements";

const BREEDER_CORE = [
  "breeder_register_certificate",
  "breeder_view_lineage",
  "breeder_export_pedigree",
  "breeder_log_spawn",
  "breeder_growout_tracking",
  "breeder_relatedness_check",
  "breeder_genetics_calculator",
  "breeder_submit_morph",
];

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("breeder core capabilities are REQUIRED and can never be gated", () => {
  it("every core capability is registered in the map", () => {
    for (const key of BREEDER_CORE) {
      expect(ENTITLEMENTS[key], key).toBeDefined();
    }
  });

  it("every core capability is class REQUIRED", () => {
    for (const key of BREEDER_CORE) {
      expect(ENTITLEMENTS[key].class, key).toBe(ENTITLEMENT_CLASS.REQUIRED);
    }
  });

  it("none carries a minTier — the thing that would silently gate it", () => {
    for (const key of BREEDER_CORE) {
      expect(ENTITLEMENTS[key].minTier, key).toBeUndefined();
      expect(getRequiredTierFor(key), key).toBeNull();
    }
  });

  it("all are granted to a brand-new 0-XP account with no roles", () => {
    for (const key of BREEDER_CORE) {
      expect(hasEntitlement(key, { xp: 0, tier: "Shallow", roles: [] }), key).toBe(true);
    }
  });

  it("all are picked up by the REQUIRED safety invariant set", () => {
    for (const key of BREEDER_CORE) {
      expect(REQUIRED_ENTITLEMENTS.has(key), key).toBe(true);
    }
  });

  it("registering a certificate is granted at every tier, including the lowest", () => {
    for (const tier of ["Shallow", "Coastal", "Pelagic", "Abyssal", "Hadal"]) {
      expect(hasEntitlement("breeder_register_certificate", { tier })).toBe(true);
    }
  });
});

describe("only the multi-spawn convenience is earned", () => {
  it("bulk_management stays EARNED at a real tier", () => {
    expect(ENTITLEMENTS.bulk_management.class).toBe(ENTITLEMENT_CLASS.EARNED);
    expect(getRequiredTierFor("bulk_management")).toBeTruthy();
  });

  it("single-spawn checkpoint tracking is NOT the gated one", () => {
    expect(hasEntitlement("breeder_growout_tracking", { xp: 0 })).toBe(true);
    expect(hasEntitlement("bulk_management", { xp: 0 })).toBe(false);
  });

  it("morph review remains role-based, never XP", () => {
    expect(ENTITLEMENTS.morph_review.class).toBe(ENTITLEMENT_CLASS.ADMIN);
    expect(hasEntitlement("morph_review", { xp: 999999 })).toBe(false);
    expect(hasEntitlement("morph_review", { roles: ["curator"] })).toBe(true);
  });

  it("submitting a morph is required even though reviewing one is not", () => {
    expect(hasEntitlement("breeder_submit_morph", { xp: 0 })).toBe(true);
  });
});

describe("BatchGrowOutPanel gates the bulk action, not the tracker", () => {
  const SOURCE = source("../components/BatchGrowOutPanel.jsx");

  it("uses the shared entitlement gate rather than a bespoke XP comparison", () => {
    expect(SOURCE).toContain('hasEntitlement("bulk_management"');
    expect(SOURCE).not.toMatch(/xp\s*[><]=?\s*\d{3,}/);
  });

  it("guards the batch submit itself, not just the button", () => {
    const idx = SOURCE.indexOf("const handleBatchSubmit");
    expect(idx).toBeGreaterThan(-1);
    expect(SOURCE.slice(idx, idx + 400)).toContain("if (!canBulkManage) return");
  });

  it("tells the breeder what unlocks it and what still works now", () => {
    expect(SOURCE).toContain("bulkRequiredTier");
    expect(SOURCE).toContain("getRequiredTierFor(\"bulk_management\")");
  });
});

describe("Breeder Tools surfaces do not gate their own core work", () => {
  // These four write paths are the job. None may sit behind an entitlement check.
  const CORE_SURFACES = [
    "../components/MintSpecimen.jsx",
    "../components/SpawningWizard.jsx",
    "../components/SpecimenLineage.jsx",
    "../components/SpawnGrowoutTracker.jsx",
  ];

  it("no core surface calls hasEntitlement at all", () => {
    for (const file of CORE_SURFACES) {
      expect(source(file), file).not.toContain("hasEntitlement(");
    }
  });
});

describe("Pro vs Casual is a preference, not an entitlement", () => {
  it("no entitlement key encodes mode", () => {
    for (const key of Object.keys(ENTITLEMENTS)) {
      expect(key.toLowerCase()).not.toContain("casual");
      expect(key.toLowerCase()).not.toContain("pro_mode");
    }
  });

  it("the Breeder Tools shell explains the mode mismatch instead of blocking", () => {
    const SOURCE = source("../components/BreederTools.jsx");
    expect(SOURCE).toContain("casualModeActive &&");
    expect(SOURCE).toContain("onSwitchToPro");
    // It must not redirect or refuse — deep links to ?section=morphs are documented.
    expect(SOURCE).not.toContain("navigate(");
    expect(SOURCE).not.toContain("hasEntitlement(");
  });

  it("App wires the mode switch and persists it the same way the toggle does", () => {
    const APP = source("../App.jsx");
    expect(APP).toContain("onSwitchToPro");
    expect(APP).toContain('localStorage.setItem("aquadex_casual_mode", "false")');
  });
});
