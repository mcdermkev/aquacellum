/**
 * SpotlightTour.jsx
 *
 * Thin orchestrator for the guided-tour phases of onboarding. It selects the
 * dedicated step component for the current onboarding phase and renders it over
 * the live dashboard:
 *
 *   tourTank      → <TankTourStep />     (task 8.1)
 *   tourFish      → <FishTourStep />     (task 8.2)
 *   profileNudge  → <ProfileTourStep />  (task 8.3)
 *
 * Each dedicated step owns its own SpotlightOverlay + TourCoachmark + completion
 * detection (`useTourStep`) and advances the onboarding phase itself, so this
 * orchestrator holds NO step config of its own — the dedicated components are the
 * single source of truth (task 9.1 reconciliation; this replaces the earlier
 * inline `TOUR_STEPS` config whose fish-step `verify` incorrectly polled the
 * `db.species` *catalog* count instead of the user's specimens).
 *
 * When the phase machine advances past the last tour step to `complete`, no step
 * matches and `onAllComplete` fires once. In the assembled wizard the parent also
 * watches for the `complete` phase directly, so completion is handled even though
 * this component unmounts on that transition; `onAllComplete` is kept as a
 * best-effort signal for standalone use.
 *
 * Tasks covered: 9.1 (compose the tour hand-off from the dedicated steps)
 * Requirements: 1.1, 3.1–3.6, 4.1–4.5, 7.3–7.5
 */

import React, { useEffect, useRef } from "react";
import { useOnboarding, PHASES } from "../../contexts/OnboardingContext";
import { TankTourStep } from "./TankTourStep.jsx";
import { FishTourStep } from "./FishTourStep.jsx";
import { ProfileTourStep } from "./ProfileTourStep.jsx";

// Map each tour phase to its dedicated step component (single source of truth).
const PHASE_TO_STEP = Object.freeze({
  [PHASES.TOUR_TANK]: TankTourStep,
  [PHASES.TOUR_FISH]: FishTourStep,
  [PHASES.PROFILE_NUDGE]: ProfileTourStep,
});

/**
 * SpotlightTour — renders the dedicated tour step for the current phase over the
 * live dashboard. The dashboard itself must be mounted beneath this overlay by
 * the App (see the App-contract note in `OnboardingWizard.jsx`).
 *
 * @param {object} props
 * @param {() => void} [props.onAllComplete] Fired once when no tour step matches
 *        the current phase (i.e. the tour has finished and the phase is `complete`).
 */
export function SpotlightTour({ onAllComplete }) {
  const { phase } = useOnboarding();
  const StepComponent = PHASE_TO_STEP[phase] || null;
  const firedRef = useRef(false);

  // Best-effort completion signal for standalone use: once we've run out of tour
  // steps, notify the parent exactly once.
  useEffect(() => {
    if (!StepComponent && !firedRef.current) {
      firedRef.current = true;
      if (typeof onAllComplete === "function") onAllComplete();
    }
  }, [StepComponent, onAllComplete]);

  if (!StepComponent) return null;

  return <StepComponent />;
}

export default SpotlightTour;
