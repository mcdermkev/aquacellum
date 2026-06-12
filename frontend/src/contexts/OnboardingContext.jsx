/**
 * OnboardingContext.jsx
 *
 * Shared state + phase machine for the revamped onboarding experience
 * (onboarding-revamp spec). Mounted by `App.jsx` only while onboarding is active.
 *
 * Responsibilities:
 *   - Hold the current onboarding `phase`, the chosen `persona`, and the confirmed
 *     `displayName`, and expose the connected `account` (sourced from AuthContext).
 *   - Drive the phase state machine:
 *       persona → identity → nameConfirm → hatch → tourTank → tourFish → profileNudge → complete
 *   - Persist `onboardingPhase` to the Dexie `userProfile` record ONCE an account exists,
 *     so an interrupted session can resume. Phases *before* account creation
 *     (persona, identity) always restart clean and are never persisted (Property 3, 8).
 *   - On `completeOnboarding()`, persist completion to the Supabase flag
 *     (`setOnboardingComplete`), mirror it to Dexie (`userProfile.onboardingComplete`),
 *     and refresh the `aquadex_onboarding_complete` localStorage fast-path cache.
 *
 * DESIGN NOTE — testability: the phase-transition logic is implemented as pure,
 * exported functions (`nextPhase`, `onboardingReducer`, `deriveCasualMode`,
 * `shouldPersistPhase`) with no React/Dexie dependencies, so the state machine can be
 * unit-tested in isolation (see task 3.2).
 *
 * Validates: Requirements 6.3 (resume/persist phase), 6.4 (no false completion /
 * account-gated persistence), 8.1 (persona selection persisted).
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useAuth } from "./AuthContext";
import { db } from "../db";
import { setOnboardingComplete } from "../services/reefApi";
import { persistEchoCompanion } from "../services/echoCompanion";
import { ONBOARDING_CACHE_KEY } from "../hooks/useOnboardingGate";

// ─────────────────────────────────────────────────────────────────────────────
// Phase machine (pure — no React/Dexie). Exported for unit testing (task 3.2).
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical phase identifiers. */
export const PHASES = Object.freeze({
  PERSONA: "persona",
  IDENTITY: "identity",
  NAME_CONFIRM: "nameConfirm",
  HATCH: "hatch",
  TOUR_TANK: "tourTank",
  TOUR_FISH: "tourFish",
  PROFILE_NUDGE: "profileNudge",
  COMPLETE: "complete",
});

/**
 * Ordered phase sequence. `advance()` walks this array; the final phase
 * (`complete`) is terminal.
 */
export const PHASE_ORDER = Object.freeze([
  PHASES.PERSONA,
  PHASES.IDENTITY,
  PHASES.NAME_CONFIRM,
  PHASES.HATCH,
  PHASES.TOUR_TANK,
  PHASES.TOUR_FISH,
  PHASES.PROFILE_NUDGE,
  PHASES.COMPLETE,
]);

/**
 * Phases that occur BEFORE an account has been provisioned (Privy login happens
 * during `identity`). These are never persisted and always restart clean so no
 * account-keyed data is written before an account exists (Property 3).
 */
export const PRE_ACCOUNT_PHASES = Object.freeze([PHASES.PERSONA, PHASES.IDENTITY]);

/**
 * Pure transition: given the current phase, return the next phase per the state
 * machine. Unknown phases reset to the start; `complete` is terminal (stays put).
 *
 * Skip paths (skipping the fish step or the profile-picture step) advance to the
 * same successor as a normal completion, so a single forward transition covers both.
 *
 * @param {string} phase
 * @returns {string}
 */
export function nextPhase(phase) {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1) return PHASE_ORDER[0];
  if (idx >= PHASE_ORDER.length - 1) return PHASE_ORDER[PHASE_ORDER.length - 1];
  return PHASE_ORDER[idx + 1];
}

/**
 * Derive `casualMode` from the persona: "casual" ⇒ true, "pro" ⇒ false,
 * anything else (unchosen) ⇒ null.
 *
 * @param {string|null} persona
 * @returns {boolean|null}
 */
export function deriveCasualMode(persona) {
  if (persona === "casual") return true;
  if (persona === "pro") return false;
  return null;
}

/**
 * Whether the given phase should be persisted to Dexie `userProfile.onboardingPhase`.
 * Persistence only happens once an account exists AND the phase is past the
 * pre-account phases — pre-account phases always restart clean (Property 3, 8).
 *
 * @param {string} phase
 * @param {string|null} account
 * @returns {boolean}
 */
export function shouldPersistPhase(phase, account) {
  return !!account && !PRE_ACCOUNT_PHASES.includes(phase);
}

/** Initial reducer state. */
export const initialOnboardingState = Object.freeze({
  phase: PHASES.PERSONA,
  persona: null, // "casual" | "pro" | null
  displayName: "",
});

/**
 * Pure reducer for onboarding state. Exported for unit testing (task 3.2).
 *
 * Actions:
 *   - { type: "SET_PERSONA", persona }     set persona ("casual"|"pro")
 *   - { type: "SET_DISPLAY_NAME", displayName }
 *   - { type: "ADVANCE" }                  move to the next phase
 *   - { type: "RESUME", phase }            jump forward to a persisted phase (never backward)
 *   - { type: "COMPLETE" }                 jump straight to the terminal phase
 *
 * @param {{phase:string, persona:string|null, displayName:string}} state
 * @param {{type:string, [k:string]: any}} action
 */
export function onboardingReducer(state, action) {
  switch (action.type) {
    case "SET_PERSONA":
      return { ...state, persona: action.persona };

    case "SET_DISPLAY_NAME":
      return { ...state, displayName: action.displayName ?? "" };

    case "ADVANCE":
      return { ...state, phase: nextPhase(state.phase) };

    case "RESUME": {
      // Resume only moves forward to a valid, known phase — never rewinds progress.
      const targetIdx = PHASE_ORDER.indexOf(action.phase);
      const currentIdx = PHASE_ORDER.indexOf(state.phase);
      if (targetIdx > currentIdx) {
        return { ...state, phase: action.phase };
      }
      return state;
    }

    case "COMPLETE":
      return { ...state, phase: PHASES.COMPLETE };

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence helpers (Dexie). Kept out of the reducer so the machine stays pure.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a partial patch onto the account's `userProfile` row without clobbering
 * existing fields. Uses `update` (merge) and falls back to `put` when no row exists.
 *
 * @param {string} account
 * @param {object} patch
 */
async function patchUserProfile(account, patch) {
  const updated = await db.userProfile.update(account, patch);
  if (!updated) {
    await db.userProfile.put({ walletAddress: account, ...patch });
  }
}

/** Refresh the localStorage fast-path cache (non-authoritative). */
function refreshOnboardingCache() {
  try {
    localStorage.setItem(ONBOARDING_CACHE_KEY, "true");
  } catch {
    // Ignore quota/availability errors — the cache is just an optimization.
  }
}

/** Persist the chosen persona to the existing casual-mode localStorage cache. */
function persistPersonaCache(persona) {
  const casual = deriveCasualMode(persona);
  if (casual === null) return;
  try {
    localStorage.setItem("aquadex_casual_mode", casual.toString());
  } catch {
    // Non-fatal — persona is also written to the profile by the identity step.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React context
// ─────────────────────────────────────────────────────────────────────────────

const OnboardingContext = createContext(null);

/**
 * OnboardingProvider — coordinates the onboarding phase machine and shared state.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.account] - optional explicit account; defaults to the
 *   connected account from AuthContext.
 */
export function OnboardingProvider({ children, account: accountProp }) {
  const auth = useAuth();
  const account = accountProp ?? auth?.account ?? null;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const { phase, persona, displayName } = state;
  const casualMode = deriveCasualMode(persona);

  // Tracks which account we've already attempted to resume, so resume runs once.
  const resumedAccountRef = useRef(null);

  const setPersona = useCallback((value) => {
    // Accept either the string persona or a boolean casual flag for convenience.
    const next =
      typeof value === "boolean" ? (value ? "casual" : "pro") : value;
    dispatch({ type: "SET_PERSONA", persona: next });
    persistPersonaCache(next);
  }, []);

  const setDisplayName = useCallback((value) => {
    dispatch({ type: "SET_DISPLAY_NAME", displayName: value });
  }, []);

  const advance = useCallback(() => {
    dispatch({ type: "ADVANCE" });
  }, []);

  /**
   * hatchEcho — persist Echo's initial companion state when the egg hatches
   * (Req 2.4). Wired to `EchoStage`'s `onHatch` callback by the wizard
   * composition (task 9.1). Idempotent: guarded by an existence check so a
   * resumed/interrupted hatch never overwrites or duplicates the row
   * (Property 8). No-ops before an account exists (Property 3).
   *
   * @returns {Promise<{created: boolean, reason?: string}>}
   */
  const hatchEcho = useCallback(() => persistEchoCompanion(account), [account]);

  // ── Resume: when an account first resolves, jump forward to its persisted phase.
  useEffect(() => {
    if (!account || resumedAccountRef.current === account) return;
    resumedAccountRef.current = account;

    let cancelled = false;
    (async () => {
      try {
        const profile = await db.userProfile.get(account);
        const saved = profile?.onboardingPhase;
        if (cancelled || !saved) return;
        // Only resume to a valid post-account phase that isn't terminal; RESUME
        // itself guards against moving backward.
        if (
          PHASE_ORDER.includes(saved) &&
          !PRE_ACCOUNT_PHASES.includes(saved) &&
          saved !== PHASES.COMPLETE
        ) {
          dispatch({ type: "RESUME", phase: saved });
        }
      } catch (err) {
        console.warn("[onboarding] resume read failed:", err?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account]);

  // ── Persist the current phase once an account exists (Identity onward).
  //    Pre-account phases are intentionally never written (Property 3, 8).
  useEffect(() => {
    if (!shouldPersistPhase(phase, account)) return;
    if (phase === PHASES.COMPLETE) return; // completion is persisted by completeOnboarding

    let cancelled = false;
    (async () => {
      try {
        await patchUserProfile(account, { onboardingPhase: phase });
      } catch (err) {
        if (!cancelled) console.warn("[onboarding] phase persist failed:", err?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, account]);

  /**
   * Mark onboarding complete: advance to the terminal phase, then persist
   * completion to the Supabase flag, mirror it to Dexie, and refresh the
   * localStorage fast-path cache. Safe to call when Supabase is unconfigured
   * (the server write is a no-op and the Dexie mirror + cache still apply).
   */
  const completeOnboarding = useCallback(async () => {
    dispatch({ type: "COMPLETE" });

    if (account) {
      // Server source of truth (no-op when Supabase is not configured).
      try {
        await setOnboardingComplete(account, true);
      } catch (err) {
        console.warn("[onboarding] Supabase completion write failed:", err?.message);
      }
      // Offline-first Dexie mirror.
      try {
        await patchUserProfile(account, {
          onboardingComplete: true,
          onboardingPhase: PHASES.COMPLETE,
        });
      } catch (err) {
        console.warn("[onboarding] Dexie completion mirror failed:", err?.message);
      }
    }

    // Fast-path cache so the gate doesn't flash onboarding on the next load.
    refreshOnboardingCache();

    // Set flag for main dashboard welcome modal guidance
    localStorage.setItem("aquadex_show_welcome_guidance", "true");
  }, [account]);

  const value = {
    phase,
    persona,
    casualMode,
    account,
    displayName,
    setDisplayName,
    setPersona,
    advance,
    hatchEcho,
    completeOnboarding,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

/** Hook to consume onboarding context. Throws if used outside the provider. */
export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}

export default OnboardingContext;
