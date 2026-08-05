/**
 * The Settings → Aquariums "Active tank" control must store the `displayTank`
 * CONTRACT, not the tank record it was picked from.
 *
 * WHY THIS TEST EXISTS. The Settings rework moved active-tank selection into
 * Settings, and the first cut did the obvious thing: `setDisplayTank(tank)`,
 * passing the record straight through. That is wrong in a way nothing reports.
 *
 *   displayTank contract : { id, name, volume /gallons/, temp /°C/, ph }
 *   tank record          : { id, name, volumeLiters, latestLog: { tempCelsiusX10, phX10 } }
 *
 * The names don't overlap, so `displayTank.volume`, `.temp` and `.ph` are all
 * `undefined`. `evaluateTankFit` coerces each with `Number()`, producing `NaN` —
 * and EVERY comparison against `NaN` is false. So each penalty branch is skipped
 * (penalty stays 0 → sub-score stays 100) and each block branch is skipped too.
 * The scorer therefore returns a perfect score and an "ok" verdict for any species
 * in any tank.
 *
 * That is the worst available failure mode: not a crash, not a blank field, but a
 * confident "this fish suits your tank" for a fish that would die in it. The two
 * halves below pin it from both ends — the behaviour that makes normalization
 * mandatory, and the call sites that must perform it.
 *
 * Node-environment friendly (this repo's vitest has no DOM): the call-site checks
 * read source text, the same technique as settingsPrivacyOwnership.test.js.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { evaluateTankFit } from "../services/addOnRecommender.js";
import { tankFitInputs } from "../services/compatibleTanks.js";

const SRC = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, SRC)), "utf8");
}

// A 20-litre (~5 gallon) tank — nowhere near a discus's 55-gallon minimum, and
// well outside its temperature band. Shaped exactly like a real record.
const TINY_TANK_RECORD = {
  id: 7,
  name: "Nano cube",
  volumeLiters: 20,
  latestLog: { tempCelsiusX10: 180, phX10: 82 }, // 18.0 °C, pH 8.2
};

const DISCUS_PROFILE = {
  minVolumeGallons: 55,
  tempRange: [28, 31],
  phRange: [6.0, 6.8],
};

describe("why the active-tank control must normalize (the silent failure)", () => {
  it("returns a fabricated perfect fit when handed a raw tank record", () => {
    // This is the bug, asserted so it can never be mistaken for acceptable.
    const wrong = evaluateTankFit(DISCUS_PROFILE, TINY_TANK_RECORD);

    expect(wrong.score).toBe(100);
    expect(wrong.verdict).toBe("ok");
    // Not merely a missing warning — it affirmatively recommends the tank.
    expect(wrong.reasons.join(" ")).toMatch(/Good fit for the buyer's tank/);
  });

  it("correctly blocks the same tank once normalized", () => {
    const right = evaluateTankFit(DISCUS_PROFILE, tankFitInputs(TINY_TANK_RECORD));

    expect(right.verdict).toBe("blocked");
    expect(right.score).toBeLessThan(100);
    expect(right.reasons.join(" ")).toMatch(/less than half the species' minimum/);
  });

  it("converts litres to gallons and lifts water params out of latestLog", () => {
    // 20 L ≈ 5.28 gal → 5; the x10 fixed-point log fields become real units.
    expect(tankFitInputs(TINY_TANK_RECORD)).toEqual({ volume: 5, temp: 18, ph: 8.2 });
  });

  it("never reports a volume the record does not have", () => {
    // `volumeGallons` is not a field on a tank record. Reading it was why the
    // Settings volume label silently rendered nothing.
    expect(TINY_TANK_RECORD.volumeGallons).toBeUndefined();
    expect(tankFitInputs(TINY_TANK_RECORD).volume).toBeGreaterThan(0);
  });
});

describe("every displayTank writer normalizes", () => {
  // Each of these calls setDisplayTank with a tank the user picked. A bare
  // `setDisplayTank(tank)` in any of them reintroduces the defect above.
  const WRITERS = [
    "components/settings/sections/AquariumsSection.jsx",
    "components/finder/FishFinder.jsx",
    "components/finder/CasualSpeciesDetail.jsx",
  ];

  it.each(WRITERS)("%s spreads tankFitInputs into the stored value", (path) => {
    const source = read(path);
    expect(source).toMatch(/tankFitInputs/);
    expect(source).toMatch(/setDisplayTank\(\s*(?:tank\s*\?)?\s*\{/);
  });

  it.each(WRITERS)("%s never stores a bare tank record", (path) => {
    // Strip comments first: the docblocks quote the wrong form to explain it.
    const code = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/setDisplayTank\(\s*tank\s*\)/);
    expect(code).not.toMatch(/setDisplayTank\(\s*first\s*\)/);
  });
});

describe("the Settings tank list is owner-scoped", () => {
  const section = read("components/settings/sections/AquariumsSection.jsx");
  // Comments stripped: the docblock names `db.tanks` to explain why it is not used.
  const sectionCode = section.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("loads tanks through useUserTanks rather than scanning Dexie directly", () => {
    // A bare `db.tanks` scan returns every account ever cached in this browser,
    // so on a shared device you could bind compatibility checks — and the cart's
    // buyer context — to a stranger's tank. useUserTanks filters by lowercased
    // ownerAddress, and reusing it keeps one definition of "my tanks".
    expect(sectionCode).toMatch(/useUserTanks\(/);
    expect(sectionCode).not.toMatch(/db\.tanks/);
  });

  it("does not claim the user has no tanks when they are simply signed out", () => {
    // useUserTanks is disabled without an account, so an empty list is ambiguous.
    expect(section).toMatch(/!walletAccount/);
    expect(section).toMatch(/Sign in to choose which tank/);
  });
});
