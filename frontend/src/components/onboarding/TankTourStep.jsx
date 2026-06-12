import React, { useCallback, useEffect, useRef, useState } from "react";

import { useOnboarding } from "../../contexts/OnboardingContext";
import { useTourStep } from "../../hooks/useTourStep";
import { db } from "../../db";
import { relayRegisterTank } from "../../services/relayer";
import { addXp, XP_ACTIONS } from "../../utils/xp";
import { SpotlightOverlay } from "./SpotlightOverlay.jsx";
import { TourCoachmark } from "./TourCoachmark.jsx";
import { awardFirstTankXp } from "./firstTankReward.js";
import { TANK_TOUR_COPY, DEFAULT_TANK_NAME, resolveTankCopy } from "./tankTourCopy.js";

/**
 * TankTourStep.jsx
 *
 * The tank-registration step of the guided spotlight tour (onboarding-revamp
 * spec, task 8.1). It teaches the user to register a REAL tank by spotlighting
 * the live Aquariums / "Add a Fish" control and detecting the real action —
 * never simulated data (Req 3.1–3.4).
 *
 * Step config (per design.md):
 *   { id:"tour_tank", targetId:"aquariums-tab"|"add-fish-tab",
 *     completeOn:"aquadex:tank_registered", verify:()=>db.tanks.count()>0 }
 *
 * Completion detection (via `useTourStep`, task 7.2): the step advances when
 * EITHER the `aquadex:tank_registered` window event fires (dispatched by the
 * real `FacilityTreeView`/`TankList` registration paths, task 1.3) OR the Dexie
 * poll `verify()` confirms a tank row exists. Whichever wins, the advance is
 * idempotent (Property 4).
 *
 * On completion the step awards the one-time first-tank onboarding bonus
 * (+15 XP, idempotent — see `firstTankReward.js`) and advances the onboarding
 * phase to `tourFish` (Req 3.4).
 *
 * Fallbacks (resilience):
 *   - IN-CARD GUIDED FORM (Req 3.5): when the spotlight target can't be resolved
 *     (`onTargetMissing`) or is too small to usefully highlight, the step falls
 *     back to an inline guided form that performs the SAME real registration via
 *     `relayRegisterTank` (Dexie-local beta path), then dispatches
 *     `aquadex:tank_registered` so the same completion flow runs.
 *   - FRIENDLY RETRY + ALLOW-CONTINUE (Req 3.6): if registration fails, a
 *     friendly Poseidon line is shown with a Retry control and a
 *     "Continue for now" affordance so onboarding is never blocked.
 *   - TIMEOUT: if no completion is detected within the tour-step window, the
 *     user is offered the inline form and an explicit continue path.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 *
 * @param {object} props
 * @param {string} [props.targetId]   `data-tour-id` of the spotlight target.
 *        Defaults to "aquariums-tab" (where tank registration lives); the design
 *        also permits "add-fish-tab".
 * @param {number} [props.pollInterval]  `verify()` poll cadence (ms) — injectable for tests.
 * @param {number} [props.timeout]       Graceful-timeout window (ms) — injectable for tests.
 */

// Below this dimension (px) a spotlight cutout is too small to be useful, so we
// fall back to the in-card guided form (Req 3.5).
const MIN_TARGET_DIMENSION = 24;

// The completion contract for this step (kept here so the same shape is reused
// by both the spotlight and the in-card fallback paths).
export const TANK_TOUR_STEP = Object.freeze({
  id: "tour_tank",
  completeOn: "aquadex:tank_registered",
});

export function TankTourStep({
  targetId = "aquariums-tab",
  pollInterval,
  timeout,
}) {
  const { persona, casualMode, account, advance } = useOnboarding();
  const personaValue = casualMode ?? persona ?? null;

  // ── Local UI state ─────────────────────────────────────────────────────────
  // Whether we've dropped out of the spotlight into the in-card guided form.
  const [showFallback, setShowFallback] = useState(false);
  // Form fields for the fallback registration.
  const [tankName, setTankName] = useState(
    resolveTankCopy(DEFAULT_TANK_NAME, personaValue)
  );
  const [tankVolume, setTankVolume] = useState("75");
  // Registration in-flight + friendly error (Req 3.6).
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");

  // Guards so completion side effects run exactly once even if event + poll race.
  const completedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the default tank name in sync with persona until the user edits it.
  const nameEditedRef = useRef(false);
  useEffect(() => {
    if (!nameEditedRef.current) {
      setTankName(resolveTankCopy(DEFAULT_TANK_NAME, personaValue));
    }
  }, [personaValue]);

  // ── Completion handler (shared by event + poll) ─────────────────────────────
  const handleComplete = useCallback(() => {
    if (completedRef.current) return; // idempotent advance (Property 4)
    completedRef.current = true;
    // One-time first-tank onboarding bonus (+15), guarded against double-count
    // with the generic REGISTER_TANK reward (Req 3.4).
    awardFirstTankXp();
    advance(); // tourTank → tourFish
  }, [advance]);

  const { timedOut, dismiss } = useTourStep(
    { id: TANK_TOUR_STEP.id, completeOn: TANK_TOUR_STEP.completeOn, verify: () => db.tanks.count() > 0 },
    {
      onComplete: handleComplete,
      enabled: true,
      ...(pollInterval != null ? { interval: pollInterval } : {}),
      ...(timeout != null ? { timeout } : {}),
    }
  );

  // When the step times out gracefully, surface the in-card form so the user
  // always has a way to finish (and an explicit continue affordance, Req 3.6).
  useEffect(() => {
    if (timedOut) setShowFallback(true);
  }, [timedOut]);

  // ── Spotlight target resolution callbacks ───────────────────────────────────
  const handleTargetMissing = useCallback(() => {
    // Target not present in the DOM → guided-form fallback (Req 3.5).
    setShowFallback(true);
  }, []);

  const handleRectChange = useCallback((rect) => {
    if (!rect) return;
    // Target present but too small to spotlight meaningfully → fallback (Req 3.5).
    if (rect.width < MIN_TARGET_DIMENSION || rect.height < MIN_TARGET_DIMENSION) {
      setShowFallback(true);
    }
  }, []);

  // ── In-card guided form submit: performs the SAME real registration ─────────
  const handleFallbackSubmit = useCallback(
    async (e) => {
      e?.preventDefault?.();
      const name = tankName.trim();
      if (!name || registering) return;

      setRegistering(true);
      setRegisterError("");

      try {
        const litres = Math.max(1, Math.round(Number(tankVolume) || 75));
        const result = await relayRegisterTank({
          name,
          tankType: 0,
          volumeLiters: litres,
          ownerAddress: account || "",
        });

        if (!result?.success) {
          throw new Error(result?.error || "Registration failed");
        }

        // Log the initial parameters so the Reef Composer can pick them up automatically
        await db.actionLogs.add({
          tankId: result.tankId,
          actionType: "ParameterLog",
          timestamp: Math.round(Date.now() / 1000),
          details: {
            temp: 24.5,
            ph: 7.2,
            salinity: 1.0,
            ammonia: 0,
            nitrite: 0,
            nitrate: 5,
            notes: "System initialized via tutorial fallback"
          }
        });

        // Mirror the real registration components: award the generic tank XP and
        // notify the tour. The dispatched event is caught by `useTourStep`, which
        // runs `handleComplete` (first-tank bonus + advance) — keeping a single
        // completion path for both the spotlight and the fallback (Property 4).
        addXp(XP_ACTIONS.REGISTER_TANK.points, XP_ACTIONS.REGISTER_TANK.label);
        window.dispatchEvent(
          new CustomEvent("aquadex:tank_registered", {
            detail: { tankId: result.tankId },
          })
        );
      } catch (err) {
        // Friendly retry + allow-continue (Req 3.6).
        console.warn("[onboarding] tank fallback registration failed:", err?.message);
        if (mountedRef.current) {
          setRegisterError(resolveTankCopy(TANK_TOUR_COPY.error, personaValue));
        }
      } finally {
        if (mountedRef.current) setRegistering(false);
      }
    },
    [tankName, tankVolume, registering, account, personaValue]
  );

  // ── Render: in-card guided form ─────────────────────────────────────────────
  if (showFallback) {
    return (
      <div className="onboarding-card tank-tour-fallback" role="group" aria-label={resolveTankCopy(TANK_TOUR_COPY.fallbackTitle, personaValue)}>
        <h2 className="tank-tour-fallback__title">
          {resolveTankCopy(TANK_TOUR_COPY.fallbackTitle, personaValue)}
        </h2>
        <p className="tank-tour-fallback__lead">
          {resolveTankCopy(timedOut ? TANK_TOUR_COPY.timeoutHelp : TANK_TOUR_COPY.fallbackLead, personaValue)}
        </p>

        <form className="onboarding-action-area" onSubmit={handleFallbackSubmit}>
          <label className="tank-tour-field">
            <span>{resolveTankCopy(TANK_TOUR_COPY.nameLabel, personaValue)}</span>
            <input
              type="text"
              value={tankName}
              maxLength={40}
              onChange={(e) => {
                nameEditedRef.current = true;
                setTankName(e.target.value);
              }}
              disabled={registering}
            />
          </label>

          <label className="tank-tour-field">
            <span>{resolveTankCopy(TANK_TOUR_COPY.volumeLabel, personaValue)}</span>
            <input
              type="number"
              min="1"
              value={tankVolume}
              onChange={(e) => setTankVolume(e.target.value)}
              disabled={registering}
            />
          </label>

          {/* Friendly Poseidon error, announced politely (Req 3.6). */}
          {registerError && (
            <p className="onboarding-action-error" role="status" aria-live="polite">
              {registerError}
            </p>
          )}

          <div className="tank-tour-fallback__actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={registering || !tankName.trim()}
              aria-busy={registering}
            >
              {resolveTankCopy(
                registering
                  ? TANK_TOUR_COPY.submitBusy
                  : registerError
                    ? TANK_TOUR_COPY.retry
                    : TANK_TOUR_COPY.submit,
                personaValue
              )}
            </button>

            {/* Allow-continue so a failure (or "later") never blocks onboarding. */}
            <button
              type="button"
              className="tour-skip"
              onClick={() => {
                // Route through the tour-step dismiss so detection stops cleanly,
                // then advance to the next phase.
                dismiss();
                advance();
              }}
            >
              {resolveTankCopy(TANK_TOUR_COPY.continueAnyway, personaValue)}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Render: spotlight over the real control ─────────────────────────────────
  return (
    <SpotlightOverlay
      targetId={targetId}
      onTargetMissing={handleTargetMissing}
      onRectChange={handleRectChange}
    >
      {(rect) => (
        <TourCoachmark
          targetRect={rect}
          title={TANK_TOUR_COPY.title}
          message={TANK_TOUR_COPY.instruction}
          persona={personaValue}
        />
      )}
    </SpotlightOverlay>
  );
}

export default TankTourStep;
