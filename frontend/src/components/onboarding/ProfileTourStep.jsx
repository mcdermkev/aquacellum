import React, { useCallback, useEffect, useRef, useState } from "react";

import { useOnboarding } from "../../contexts/OnboardingContext";
import { useTourStep } from "../../hooks/useTourStep";
import { SpotlightOverlay } from "./SpotlightOverlay.jsx";
import { TourCoachmark } from "./TourCoachmark.jsx";
import { PROFILE_TOUR_COPY, resolveProfileCopy } from "./profileTourCopy.js";

/**
 * ProfileTourStep.jsx
 *
 * The profile-picture nudge step of the guided spotlight tour (onboarding-revamp
 * spec, task 8.3) — the final tour beat before onboarding completes. It nudges
 * the user to personalise their identity by spotlighting the real
 * `profile-widget` (the `ConnectWallet` profile chip, tagged in task 1.4).
 * Opening that widget routes to the existing profile / `ProfileEdit` avatar
 * upload flow — we reuse that surface rather than building a new one (Req 7.3,
 * 7.4). The spotlight keeps the real widget operable, so the user clicks the
 * actual chip and follows "View Profile" to upload.
 *
 * Mirrors the structure/conventions of `FishTourStep.jsx` (task 8.2).
 *
 * Step config (per design.md):
 *   { id:"profile_nudge", targetId:"profile-widget",
 *     completeOn:"aquadex:avatar_set", skippable:true }
 *
 * Completion detection (via `useTourStep`, task 7.2): the step advances when the
 * `aquadex:avatar_set` window event fires — dispatched by the real `ProfileEdit`
 * success path on a completed avatar upload (task 1.3).
 *
 * VERIFY IS BEST-EFFORT / OMITTED: unlike the tank (Dexie `db.tanks`) and fish
 * (localStorage specimen mirror) steps, the avatar lives ONLY in the Supabase
 * profile (`profiles.avatar_url`) — there is no reliable local Dexie/localStorage
 * mirror to poll. So this step relies on the completion EVENT plus its
 * skippability rather than a `verify()` poll. `useTourStep` handles a missing
 * `verify` gracefully (event path + graceful timeout only).
 *
 * SKIP ALLOWED (Req 7.5): a profile picture is optional — the default avatar
 * already renders in `ConnectWallet` and remains if the user skips. The coachmark
 * exposes a Skip control (Esc also skips), and a graceful timeout offers an
 * explicit "finish up" path. Both route through the tour-step dismiss and advance
 * to the next phase (`complete`).
 *
 * ADVANCE ONLY (no duplicate completion writes): after this nudge the next phase
 * is `complete`. We simply `advance()` — the wizard composition / `completeOnboarding`
 * owns the final Supabase/Dexie/localStorage completion persistence (task 9.x), so
 * we must NOT duplicate those writes here. The advance is guarded so it happens
 * exactly once across the {event, skip, timeout} race (idempotent — Property 4).
 *
 * Validates: Requirements 7.3, 7.4, 7.5
 *
 * @param {object} props
 * @param {string} [props.targetId]     `data-tour-id` of the spotlight target (default "profile-widget").
 * @param {number} [props.pollInterval] `verify()` poll cadence (ms) — injectable for tests.
 * @param {number} [props.timeout]      Graceful-timeout window (ms) — injectable for tests.
 */

// The completion contract for this step.
export const PROFILE_TOUR_STEP = Object.freeze({
  id: "profile_nudge",
  completeOn: "aquadex:avatar_set",
});

export function ProfileTourStep({
  targetId = "profile-widget",
  pollInterval,
  timeout,
}) {
  const { persona, casualMode, advance } = useOnboarding();
  const personaValue = casualMode ?? persona ?? null;

  // Single terminal latch so we advance EXACTLY ONCE across the
  // {event, skip, timeout} race (idempotent advance — Property 4).
  const settledRef = useRef(false);

  // Whether we've fallen back to the graceful timeout / skip card.
  const [showTimeout, setShowTimeout] = useState(false);

  const advanceOnce = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    advance(); // profileNudge → complete
  }, [advance]);

  // No `verify()`: the avatar lives only in Supabase, so we rely on the event
  // plus skippability. `useTourStep` keeps just the event path + timeout active.
  const { timedOut, dismiss } = useTourStep(
    {
      id: PROFILE_TOUR_STEP.id,
      completeOn: PROFILE_TOUR_STEP.completeOn,
    },
    {
      onComplete: advanceOnce,
      enabled: true,
      ...(pollInterval != null ? { interval: pollInterval } : {}),
      ...(timeout != null ? { timeout } : {}),
    }
  );

  // When the step times out gracefully, surface the explicit continue/skip card
  // so the user always has a way to move on with the default avatar (Req 7.5).
  useEffect(() => {
    if (timedOut) setShowTimeout(true);
  }, [timedOut]);

  // Skip / finish: stop detection cleanly, then advance once (Req 7.5).
  const handleSkip = useCallback(() => {
    dismiss();
    advanceOnce();
  }, [dismiss, advanceOnce]);

  // If the spotlight target can't be resolved, fall back to the skip card so the
  // (optional) step never traps the user (Req 7.5).
  const handleTargetMissing = useCallback(() => {
    setShowTimeout(true);
  }, []);

  // ── Render: graceful timeout / skip card ────────────────────────────────────
  if (showTimeout) {
    return (
      <div
        className="onboarding-card profile-tour-fallback"
        role="group"
        aria-label={resolveProfileCopy(PROFILE_TOUR_COPY.timeoutTitle, personaValue)}
      >
        <h2 className="profile-tour-fallback__title">
          {resolveProfileCopy(PROFILE_TOUR_COPY.timeoutTitle, personaValue)}
        </h2>
        <p className="profile-tour-fallback__lead">
          {resolveProfileCopy(PROFILE_TOUR_COPY.timeoutHelp, personaValue)}
        </p>
        <div className="profile-tour-fallback__actions">
          <button type="button" className="tour-skip" onClick={handleSkip}>
            {resolveProfileCopy(PROFILE_TOUR_COPY.continueAnyway, personaValue)}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: spotlight over the real profile widget ───────────────────────────
  return (
    <SpotlightOverlay
      targetId={targetId}
      onTargetMissing={handleTargetMissing}
    >
      {(rect) => (
        <TourCoachmark
          targetRect={rect}
          title={PROFILE_TOUR_COPY.title}
          message={PROFILE_TOUR_COPY.instruction}
          persona={personaValue}
          skippable
          onSkip={handleSkip}
          skipLabel={resolveProfileCopy(PROFILE_TOUR_COPY.skip, personaValue)}
        />
      )}
    </SpotlightOverlay>
  );
}

export default ProfileTourStep;
