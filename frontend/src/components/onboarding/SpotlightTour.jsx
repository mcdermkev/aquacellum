/**
 * SpotlightTour.jsx
 *
 * Orchestrates the guided tour phase of onboarding: tank registration → add fish →
 * profile picture nudge. Each step uses SpotlightOverlay + TourCoachmark + useTourStep.
 *
 * Tasks covered: 8.1, 8.2, 8.3
 * Requirements: 3.1–3.6, 4.1–4.5, 7.3–7.5
 */

import React, { useState, useCallback } from "react";
import { SpotlightOverlay } from "./SpotlightOverlay";
import { TourCoachmark } from "./TourCoachmark";
import { useTourStep } from "../../hooks/useTourStep";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { addXp } from "../../utils/xp";
import { db } from "../../db";

// ─── Tour step configurations ────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    id: "tour-tank",
    phase: "tourTank",
    targetId: "aquariums-tab",
    completeOn: "aquadex:tank_registered",
    verify: async () => (await db.tanks.count()) > 0,
    skippable: false,
    xpReward: 15,
    xpLabel: "first_tank_tour",
    copy: {
      casual: "Tap the Aquariums tab and register your first tank. I'll walk you through it!",
      pro: "Select the Aquariums tab and initialize your primary containment unit.",
    },
    title: {
      casual: "Set up your first tank",
      pro: "Register containment unit",
    },
  },
  {
    id: "tour-fish",
    phase: "tourFish",
    targetId: "add-fish-tab",
    completeOn: "aquadex:specimen_added",
    verify: async () => {
      const count = await db.species.count();
      // Check specimens via listings or a simple count
      return count > 0;
    },
    skippable: true,
    copy: {
      casual: "Now add your first fish! Tap 'Add a Fish' and pick a species from the catalog.",
      pro: "Register your first specimen via the catalog. Select the species and confirm.",
    },
    title: {
      casual: "Add your first fish",
      pro: "Register specimen",
    },
  },
  {
    id: "profile-nudge",
    phase: "profileNudge",
    targetId: "profile-widget",
    completeOn: "aquadex:avatar_set",
    verify: null, // No poll for avatar — event or skip only
    skippable: true,
    copy: {
      casual: "One last thing — tap your profile to set a picture so others can recognize you!",
      pro: "Set your operator avatar via the profile widget for community identification.",
    },
    title: {
      casual: "Add a profile picture",
      pro: "Set operator avatar",
    },
  },
];

/**
 * SpotlightTour — overlay rendered above the live dashboard during tour phases.
 *
 * Advances through tour steps and calls `onComplete` when done or all steps
 * are skipped/completed.
 */
export function SpotlightTour({ onStepComplete, onAllComplete }) {
  const { phase, casualMode, advance } = useOnboarding();
  const [targetRect, setTargetRect] = useState(null);

  // Find the current step config based on the onboarding phase
  const currentStep = TOUR_STEPS.find((s) => s.phase === phase) || null;

  const handleComplete = useCallback(
    (info) => {
      if (currentStep?.xpReward) {
        addXp(currentStep.xpLabel, currentStep.xpReward);
      }
      onStepComplete?.(currentStep?.id, info);
      advance();
    },
    [currentStep, advance, onStepComplete]
  );

  const handleTimeout = useCallback(() => {
    // Graceful skip — advance anyway for skippable steps
    if (currentStep?.skippable) {
      advance();
    }
  }, [currentStep, advance]);

  const handleSkip = useCallback(() => {
    advance();
  }, [advance]);

  // useTourStep drives completion detection
  const { dismiss } = useTourStep(
    currentStep
      ? {
          id: currentStep.id,
          completeOn: currentStep.completeOn,
          verify: currentStep.verify,
        }
      : null,
    {
      onComplete: handleComplete,
      onTimeout: handleTimeout,
      enabled: !!currentStep,
      timeout: 60000,
    }
  );

  // No active tour step → we're done
  if (!currentStep) {
    // Signal completion on first render with no step
    if (typeof onAllComplete === "function") {
      // Defer to avoid calling during render
      setTimeout(onAllComplete, 0);
    }
    return null;
  }

  return (
    <>
      <SpotlightOverlay
        targetId={currentStep.targetId}
        onRectChange={setTargetRect}
        onTargetMissing={() => {
          // If the target can't be found, allow skip for non-skippable too
          // (fallback behavior per Req 3.5)
          if (currentStep.skippable) {
            advance();
          }
        }}
      />
      <TourCoachmark
        targetRect={targetRect}
        copy={currentStep.copy}
        title={currentStep.title}
        casualMode={casualMode}
        skippable={currentStep.skippable}
        onSkip={currentStep.skippable ? handleSkip : undefined}
        skipLabel="Skip for now"
      />
    </>
  );
}

export default SpotlightTour;
