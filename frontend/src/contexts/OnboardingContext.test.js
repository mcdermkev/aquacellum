/**
 * Unit tests for the onboarding phase machine (task 3.2).
 *
 * Exercises the pure, exported state-machine helpers in OnboardingContext.jsx:
 *   - nextPhase()            forward transitions + terminal/unknown handling
 *   - onboardingReducer()    ADVANCE / SET_PERSONA / SET_DISPLAY_NAME / RESUME / COMPLETE
 *   - deriveCasualMode()     persona → casual flag
 *   - shouldPersistPhase()   account-gated, pre-account phases never persist
 *
 * Covers the full transition chain
 *   persona → identity → nameConfirm → hatch → tourTank → tourFish → profileNudge → complete,
 * the skip paths (fish / profile steps advance like a normal completion), and the
 * rule that pre-account phases (persona, identity) do not persist.
 *
 * Validates: Requirements 6.3 (resume/persist phase), 6.4 (no false completion /
 * account-gated persistence).
 */

import { describe, it, expect, vi } from "vitest";

// Keep the module import side-effect free: stub the React/Dexie/Supabase chain
// that OnboardingContext.jsx pulls in at module load. The functions under test
// are pure and do not touch any of these.
vi.mock("../db", () => ({ db: { userProfile: {} } }));
vi.mock("../services/reefApi", () => ({ setOnboardingComplete: vi.fn() }));
vi.mock("../hooks/useOnboardingGate", () => ({ ONBOARDING_CACHE_KEY: "aquadex_onboarding_complete" }));
vi.mock("./AuthContext", () => ({ useAuth: vi.fn() }));

import {
  PHASES,
  PHASE_ORDER,
  PRE_ACCOUNT_PHASES,
  initialOnboardingState,
  nextPhase,
  onboardingReducer,
  deriveCasualMode,
  shouldPersistPhase,
} from "./OnboardingContext.jsx";

const ACCOUNT = "0xabc";

// ---------------------------------------------------------------------------
// nextPhase — transitions
// ---------------------------------------------------------------------------

describe("nextPhase — full transition chain", () => {
  it("walks the entire sequence persona → ... → complete in order", () => {
    expect(nextPhase(PHASES.PERSONA)).toBe(PHASES.IDENTITY);
    expect(nextPhase(PHASES.IDENTITY)).toBe(PHASES.NAME_CONFIRM);
    expect(nextPhase(PHASES.NAME_CONFIRM)).toBe(PHASES.HATCH);
    expect(nextPhase(PHASES.HATCH)).toBe(PHASES.TOUR_TANK);
    expect(nextPhase(PHASES.TOUR_TANK)).toBe(PHASES.TOUR_FISH);
    expect(nextPhase(PHASES.TOUR_FISH)).toBe(PHASES.PROFILE_NUDGE);
    expect(nextPhase(PHASES.PROFILE_NUDGE)).toBe(PHASES.COMPLETE);
  });

  it("matches the canonical PHASE_ORDER pairwise", () => {
    for (let i = 0; i < PHASE_ORDER.length - 1; i++) {
      expect(nextPhase(PHASE_ORDER[i])).toBe(PHASE_ORDER[i + 1]);
    }
  });

  it("treats complete as terminal (stays put)", () => {
    expect(nextPhase(PHASES.COMPLETE)).toBe(PHASES.COMPLETE);
  });

  it("resets unknown phases to the first phase", () => {
    expect(nextPhase("not-a-phase")).toBe(PHASE_ORDER[0]);
    expect(nextPhase(undefined)).toBe(PHASE_ORDER[0]);
    expect(nextPhase(null)).toBe(PHASE_ORDER[0]);
  });
});

// ---------------------------------------------------------------------------
// onboardingReducer — ADVANCE drives the same chain (incl. skip paths)
// ---------------------------------------------------------------------------

describe("onboardingReducer — ADVANCE transitions", () => {
  it("advances one phase at a time across the full flow", () => {
    let state = initialOnboardingState;
    const seen = [state.phase];
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      state = onboardingReducer(state, { type: "ADVANCE" });
      seen.push(state.phase);
    }
    // Expect the ordered chain, then terminal stays at complete on the extra step.
    expect(seen).toEqual([...PHASE_ORDER, PHASES.COMPLETE]);
  });

  it("skip path: skipping the fish step advances tourFish → profileNudge (same as completing)", () => {
    // A "skip fish" action is modeled as a normal forward ADVANCE.
    const state = onboardingReducer({ ...initialOnboardingState, phase: PHASES.TOUR_FISH }, { type: "ADVANCE" });
    expect(state.phase).toBe(PHASES.PROFILE_NUDGE);
  });

  it("skip path: skipping the profile-picture step advances profileNudge → complete", () => {
    const state = onboardingReducer({ ...initialOnboardingState, phase: PHASES.PROFILE_NUDGE }, { type: "ADVANCE" });
    expect(state.phase).toBe(PHASES.COMPLETE);
  });

  it("does not advance past complete", () => {
    const state = onboardingReducer({ ...initialOnboardingState, phase: PHASES.COMPLETE }, { type: "ADVANCE" });
    expect(state.phase).toBe(PHASES.COMPLETE);
  });

  it("ADVANCE preserves persona and displayName", () => {
    const start = { phase: PHASES.HATCH, persona: "casual", displayName: "Nemo" };
    const state = onboardingReducer(start, { type: "ADVANCE" });
    expect(state).toEqual({ phase: PHASES.TOUR_TANK, persona: "casual", displayName: "Nemo" });
  });
});

describe("onboardingReducer — SET_PERSONA / SET_DISPLAY_NAME", () => {
  it("sets the persona without changing the phase", () => {
    const state = onboardingReducer(initialOnboardingState, { type: "SET_PERSONA", persona: "pro" });
    expect(state.persona).toBe("pro");
    expect(state.phase).toBe(PHASES.PERSONA);
  });

  it("sets the display name", () => {
    const state = onboardingReducer(initialOnboardingState, { type: "SET_DISPLAY_NAME", displayName: "Coral" });
    expect(state.displayName).toBe("Coral");
  });

  it("coerces a nullish display name to an empty string", () => {
    const state = onboardingReducer(initialOnboardingState, { type: "SET_DISPLAY_NAME", displayName: undefined });
    expect(state.displayName).toBe("");
  });
});

describe("onboardingReducer — RESUME", () => {
  it("jumps forward to a later persisted phase", () => {
    const state = onboardingReducer(
      { ...initialOnboardingState, phase: PHASES.IDENTITY },
      { type: "RESUME", phase: PHASES.TOUR_TANK }
    );
    expect(state.phase).toBe(PHASES.TOUR_TANK);
  });

  it("never rewinds to an earlier phase", () => {
    const state = onboardingReducer(
      { ...initialOnboardingState, phase: PHASES.TOUR_FISH },
      { type: "RESUME", phase: PHASES.HATCH }
    );
    expect(state.phase).toBe(PHASES.TOUR_FISH);
  });

  it("ignores a RESUME to the same phase", () => {
    const state = onboardingReducer(
      { ...initialOnboardingState, phase: PHASES.HATCH },
      { type: "RESUME", phase: PHASES.HATCH }
    );
    expect(state.phase).toBe(PHASES.HATCH);
  });

  it("ignores a RESUME to an unknown phase", () => {
    const state = onboardingReducer(
      { ...initialOnboardingState, phase: PHASES.HATCH },
      { type: "RESUME", phase: "bogus" }
    );
    expect(state.phase).toBe(PHASES.HATCH);
  });
});

describe("onboardingReducer — COMPLETE and unknown actions", () => {
  it("COMPLETE jumps straight to the terminal phase", () => {
    const state = onboardingReducer({ ...initialOnboardingState, phase: PHASES.PERSONA }, { type: "COMPLETE" });
    expect(state.phase).toBe(PHASES.COMPLETE);
  });

  it("returns the same state for an unknown action", () => {
    const start = { ...initialOnboardingState, phase: PHASES.HATCH };
    expect(onboardingReducer(start, { type: "NOPE" })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// deriveCasualMode
// ---------------------------------------------------------------------------

describe("deriveCasualMode", () => {
  it("maps casual → true", () => {
    expect(deriveCasualMode("casual")).toBe(true);
  });

  it("maps pro → false", () => {
    expect(deriveCasualMode("pro")).toBe(false);
  });

  it("maps an unchosen/unknown persona → null", () => {
    expect(deriveCasualMode(null)).toBe(null);
    expect(deriveCasualMode(undefined)).toBe(null);
    expect(deriveCasualMode("banana")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// shouldPersistPhase — pre-account phases never persist
// ---------------------------------------------------------------------------

describe("shouldPersistPhase — account-gated persistence", () => {
  it("never persists when there is no account, regardless of phase", () => {
    for (const phase of PHASE_ORDER) {
      expect(shouldPersistPhase(phase, null)).toBe(false);
    }
  });

  it("never persists pre-account phases (persona, identity), even with an account", () => {
    for (const phase of PRE_ACCOUNT_PHASES) {
      expect(shouldPersistPhase(phase, ACCOUNT)).toBe(false);
    }
    // Sanity: the documented pre-account phases are exactly persona + identity.
    expect([...PRE_ACCOUNT_PHASES].sort()).toEqual([PHASES.IDENTITY, PHASES.PERSONA].sort());
  });

  it("persists post-account phases once an account exists", () => {
    const postAccount = PHASE_ORDER.filter((p) => !PRE_ACCOUNT_PHASES.includes(p));
    for (const phase of postAccount) {
      expect(shouldPersistPhase(phase, ACCOUNT)).toBe(true);
    }
  });
});
