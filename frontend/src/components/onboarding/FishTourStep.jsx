import React, { useCallback, useEffect, useRef, useState } from "react";

import { useOnboarding } from "../../contexts/OnboardingContext";
import { useTourStep } from "../../hooks/useTourStep";
import { useCatalogHydration } from "../../hooks/useCatalogHydration";
import { SpotlightOverlay } from "./SpotlightOverlay.jsx";
import { TourCoachmark } from "./TourCoachmark.jsx";
import { FISH_TOUR_COPY, resolveFishCopy } from "./fishTourCopy.js";

/**
 * FishTourStep.jsx
 *
 * The add-fish step of the guided spotlight tour (onboarding-revamp spec,
 * task 8.2). It teaches the user to add a REAL specimen by spotlighting the live
 * "Add a Fish" control and detecting the real action — never simulated data
 * (Req 4.1, 4.2). Mirrors the structure/conventions of `TankTourStep.jsx`
 * (task 8.1).
 *
 * Step config (per design.md):
 *   { id:"tour_fish", targetId:"add-fish-tab",
 *     completeOn:"aquadex:specimen_added", verify:() => specimenCount has grown }
 *
 * Completion detection (via `useTourStep`, task 7.2): the step advances when
 * EITHER the `aquadex:specimen_added` window event fires (dispatched by the real
 * `MintSpecimen` success path, task 1.3) OR the `verify()` poll confirms a new
 * specimen exists. Whichever wins, the advance is idempotent (Property 4).
 *
 * SPECIMEN COUNT SOURCE: inspecting the codebase, user specimens are NOT stored
 * in a dedicated Dexie table — they are minted on-chain and mirrored locally as
 * `aquadex_specimen_metadata_<tokenId>` localStorage entries (see
 * `MintSpecimen.jsx`). The Dexie `species` table is the *catalog*, not the
 * user's specimens. So the authoritative "did the user add a fish" signal is the
 * count of those localStorage metadata mirrors. We snapshot a baseline at mount
 * and treat the step complete when the count grows beyond it, so a pre-existing
 * specimen from a prior session never auto-skips the step.
 *
 * CATALOG SUBSET WITHOUT BLOCKING (Req 4.4): we kick off / observe background
 * species-catalog hydration via `useCatalogHydration`. We NEVER block the user
 * on full hydration — the spotlight and the real Add-a-Fish control stay usable
 * immediately; while the catalog is still loading we surface a friendly
 * non-blocking note in the coachmark.
 *
 * SKIP ALLOWED (Req 4.5): adding a fish is optional. The coachmark exposes a
 * Skip control (Esc also skips), and a graceful timeout offers an explicit
 * "continue for now" path. Both route through the tour-step dismiss and advance
 * to the next phase (profileNudge). Advancement is guarded so it happens exactly
 * once (idempotent).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * @param {object} props
 * @param {string} [props.targetId]     `data-tour-id` of the spotlight target (default "add-fish-tab").
 * @param {number} [props.pollInterval] `verify()` poll cadence (ms) — injectable for tests.
 * @param {number} [props.timeout]      Graceful-timeout window (ms) — injectable for tests.
 */

// localStorage prefix under which `MintSpecimen` mirrors each minted specimen's
// metadata. Counting these is the local source of truth for "fish added".
const SPECIMEN_METADATA_PREFIX = "aquadex_specimen_metadata_";

// The completion contract for this step.
export const FISH_TOUR_STEP = Object.freeze({
  id: "tour_fish",
  completeOn: "aquadex:specimen_added",
});

/**
 * countLocalSpecimens — number of specimens the user has registered, derived
 * from the `aquadex_specimen_metadata_*` localStorage mirror written by
 * `MintSpecimen`. Tolerant of non-browser / quota-locked environments.
 *
 * @returns {number}
 */
export function countLocalSpecimens() {
  try {
    if (typeof localStorage === "undefined") return 0;
    let count = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SPECIMEN_METADATA_PREFIX)) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

export function FishTourStep({
  targetId,
  pollInterval,
  timeout,
}) {
  const { persona, casualMode, advance } = useOnboarding();
  const personaValue = casualMode ?? persona ?? null;
  const isCasual = personaValue === true || personaValue === "casual";
  const finalTargetId = targetId || (isCasual ? "aquariums-tab" : "add-fish-tab");

  // Kick off / observe background species-catalog hydration. We only READ its
  // readiness to tailor copy — we never gate progress on it (Req 4.4).
  const { catalogReady } = useCatalogHydration();

  // Baseline specimen count at mount: completion means the count grew beyond
  // this, so a specimen from a previous session doesn't auto-complete the step.
  const baselineRef = useRef(countLocalSpecimens());

  // Single terminal latch so we advance EXACTLY ONCE across the
  // {event, poll, skip, timeout} race (idempotent advance — Property 4).
  const settledRef = useRef(false);

  // Whether we've fallen back to the graceful timeout / skip card.
  const [showTimeout, setShowTimeout] = useState(false);

  const advanceOnce = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    advance(); // tourFish → profileNudge
  }, [advance]);

  const { timedOut, dismiss } = useTourStep(
    {
      id: FISH_TOUR_STEP.id,
      completeOn: FISH_TOUR_STEP.completeOn,
      verify: () => countLocalSpecimens() > baselineRef.current,
    },
    {
      onComplete: advanceOnce,
      enabled: true,
      ...(pollInterval != null ? { interval: pollInterval } : {}),
      ...(timeout != null ? { timeout } : {}),
    }
  );

  // When the step times out gracefully, surface the explicit continue/skip card
  // so the user always has a way to move on (Req 4.5).
  useEffect(() => {
    if (timedOut) setShowTimeout(true);
  }, [timedOut]);

  // Skip / continue: stop detection cleanly, then advance once (Req 4.5).
  const handleSkip = useCallback(() => {
    dismiss();
    advanceOnce();
  }, [dismiss, advanceOnce]);

  // If the spotlight target can't be resolved, fall back to the skip card so the
  // (optional) step never traps the user (Req 4.5).
  const handleTargetMissing = useCallback(() => {
    setShowTimeout(true);
  }, []);

  // ── Render: graceful timeout / skip card ────────────────────────────────────
  if (showTimeout) {
    return (
      <div
        className="onboarding-card fish-tour-fallback"
        role="group"
        aria-label={resolveFishCopy(FISH_TOUR_COPY.timeoutTitle, personaValue)}
      >
        <h2 className="fish-tour-fallback__title">
          {resolveFishCopy(FISH_TOUR_COPY.timeoutTitle, personaValue)}
        </h2>
        <p className="fish-tour-fallback__lead">
          {resolveFishCopy(FISH_TOUR_COPY.timeoutHelp, personaValue)}
        </p>
        <div className="fish-tour-fallback__actions">
          <button type="button" className="tour-skip" onClick={handleSkip}>
            {resolveFishCopy(FISH_TOUR_COPY.continueAnyway, personaValue)}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: spotlight over the real "Add a Fish" control ─────────────────────
  // While the catalog is still hydrating we append a friendly, non-blocking note
  // rather than holding the user back (Req 4.4).
  const instruction = resolveFishCopy(FISH_TOUR_COPY.instruction, personaValue);
  const catalogNote = catalogReady
    ? ""
    : resolveFishCopy(FISH_TOUR_COPY.catalogPreparing, personaValue);
  const message = catalogNote ? `${instruction} ${catalogNote}` : instruction;

  return (
    <SpotlightOverlay
      targetId={finalTargetId}
      onTargetMissing={handleTargetMissing}
    >
      {(rect) => (
        <TourCoachmark
          targetRect={rect}
          title={FISH_TOUR_COPY.title}
          message={message}
          persona={personaValue}
          skippable
          onSkip={handleSkip}
          skipLabel={resolveFishCopy(FISH_TOUR_COPY.skip, personaValue)}
        />
      )}
    </SpotlightOverlay>
  );
}

export default FishTourStep;
