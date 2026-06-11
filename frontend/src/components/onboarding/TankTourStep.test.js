/**
 * Static source guards for TankTourStep (onboarding-revamp task 8.1).
 *
 * This project's vitest runs in a `node` environment (no jsdom), and
 * `TankTourStep.jsx` transitively imports OnboardingContext → AuthContext →
 * @privy-io/react-auth, which cannot be imported under node. So — exactly as the
 * IdentityStep tests do — we assert the component's behavioural contract via a
 * comment-stripped static guard over its source, complementing the pure-module
 * unit tests (`tankTourCopy.test.js`, `firstTankReward.test.js`).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/** Strip block + line comments so assertions inspect real code, not docs. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = readFileSync(
  fileURLToPath(new URL("./TankTourStep.jsx", import.meta.url)),
  "utf8"
);
const CODE = stripComments(SOURCE);

describe("TankTourStep — completion detection wiring (Req 3.3)", () => {
  it("drives completion through useTourStep", () => {
    expect(CODE).toContain("useTourStep");
  });

  it("listens for the tank_registered completion event (event path)", () => {
    expect(CODE).toContain('completeOn: "aquadex:tank_registered"');
  });

  it("verifies via a Dexie tanks count (poll path)", () => {
    expect(CODE).toMatch(/verify:\s*\(\)\s*=>\s*db\.tanks\.count\(\)\s*>\s*0/);
  });
});

describe("TankTourStep — spotlight targeting (Req 3.1, 3.2)", () => {
  it("renders the SpotlightOverlay + TourCoachmark over the real control", () => {
    expect(CODE).toContain("SpotlightOverlay");
    expect(CODE).toContain("TourCoachmark");
  });

  it("defaults to a real data-tour-id target permitted by the design", () => {
    expect(CODE).toMatch(/targetId\s*=\s*"(aquariums-tab|add-fish-tab)"/);
  });
});

describe("TankTourStep — first-tank XP on completion (Req 3.4)", () => {
  it("awards the idempotent first-tank bonus when the step completes", () => {
    expect(CODE).toContain("awardFirstTankXp");
  });

  it("advances the onboarding phase on completion", () => {
    expect(CODE).toMatch(/awardFirstTankXp\(\);\s*advance\(\)/);
  });
});

describe("TankTourStep — in-card guided-form fallback (Req 3.5)", () => {
  it("falls back when the target is missing", () => {
    expect(CODE).toContain("onTargetMissing");
    expect(CODE).toContain("setShowFallback(true)");
  });

  it("falls back when the target is too small to spotlight", () => {
    expect(CODE).toContain("MIN_TARGET_DIMENSION");
    expect(CODE).toContain("onRectChange");
  });

  it("performs the SAME real registration via relayRegisterTank", () => {
    expect(CODE).toContain("relayRegisterTank");
  });

  it("dispatches the completion event from the fallback so detection still runs", () => {
    expect(CODE).toContain('new CustomEvent("aquadex:tank_registered"');
  });
});

describe("TankTourStep — failure retry + allow-continue (Req 3.6)", () => {
  it("surfaces a friendly Poseidon error on registration failure", () => {
    expect(CODE).toContain("TANK_TOUR_COPY.error");
    expect(CODE).toContain("setRegisterError");
  });

  it("offers a continue-anyway affordance that advances onboarding", () => {
    expect(CODE).toContain("TANK_TOUR_COPY.continueAnyway");
    expect(CODE).toMatch(/dismiss\(\);\s*advance\(\)/);
  });
});
