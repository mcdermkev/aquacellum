/**
 * Static source guards for ProfileTourStep (onboarding-revamp task 8.3).
 *
 * This project's vitest runs in a `node` environment (no jsdom), and
 * `ProfileTourStep.jsx` transitively imports OnboardingContext → AuthContext →
 * @privy-io/react-auth, which cannot be imported under node. So — exactly as the
 * TankTourStep/IdentityStep tests do — we assert the component's behavioural
 * contract via a comment-stripped static guard over its source, complementing
 * the pure-module unit tests (`profileTourCopy.test.js`).
 *
 * Validates: Requirements 7.3, 7.4, 7.5
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
  fileURLToPath(new URL("./ProfileTourStep.jsx", import.meta.url)),
  "utf8"
);
const CODE = stripComments(SOURCE);

describe("ProfileTourStep — completion detection wiring (Req 7.4)", () => {
  it("drives completion through useTourStep", () => {
    expect(CODE).toContain("useTourStep");
  });

  it("listens for the avatar_set completion event (event path)", () => {
    expect(CODE).toContain('completeOn: "aquadex:avatar_set"');
  });

  it("does NOT poll a verify() (avatar lives only in Supabase)", () => {
    expect(CODE).not.toContain("verify:");
  });
});

describe("ProfileTourStep — spotlight targeting (Req 7.3)", () => {
  it("renders the SpotlightOverlay + TourCoachmark over the real profile widget", () => {
    expect(CODE).toContain("SpotlightOverlay");
    expect(CODE).toContain("TourCoachmark");
  });

  it("defaults to the real profile-widget data-tour-id target", () => {
    expect(CODE).toMatch(/targetId\s*=\s*"profile-widget"/);
  });
});

describe("ProfileTourStep — skip allowed, default avatar remains (Req 7.5)", () => {
  it("renders a skippable coachmark", () => {
    expect(CODE).toContain("skippable");
    expect(CODE).toContain("onSkip={handleSkip}");
  });

  it("skip/timeout routes through dismiss then advances exactly once", () => {
    expect(CODE).toMatch(/dismiss\(\);\s*advanceOnce\(\)/);
    expect(CODE).toContain("settledRef");
  });

  it("falls back to a continue/skip card when the target is missing", () => {
    expect(CODE).toContain("onTargetMissing");
    expect(CODE).toContain("setShowTimeout(true)");
    expect(CODE).toContain("PROFILE_TOUR_COPY.continueAnyway");
  });
});

describe("ProfileTourStep — advance only, no duplicate completion writes", () => {
  it("advances to the next phase rather than persisting completion itself", () => {
    expect(CODE).toContain("advance()");
    expect(CODE).not.toContain("completeOnboarding");
    expect(CODE).not.toContain("setOnboardingComplete");
  });
});
