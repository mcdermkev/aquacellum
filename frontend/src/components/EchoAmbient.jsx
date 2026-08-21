import React, { useEffect, useRef, useState } from "react";
import { EchoRenderer } from "./EchoRenderer";
import "./EchoAmbient.css";

/**
 * EchoAmbient — Echo's persistent presence.
 *
 * See docs/ECHO_CHARACTER_SPEC.md §3. Poseidon is the brain, Echo is the body:
 * she is present, she drifts, and she will react to him. That is all.
 *
 * WHAT THIS REPLACED
 *
 * 437 lines that also owned a tap-to-open handler for a full-screen pet screen,
 * a needs-summary popover with per-need progress bars, a mood header, and a
 * streak readout. All of that belonged to the Tamagotchi role the spec removed —
 * a companion you can neglect cannot also be a guide you trust.
 *
 * Two behavioural fixes carried over from the old version's problems:
 *
 *   0. She never listened to Poseidon. `poseidon:echo-reaction` was dispatched
 *      from five places and received only by `CompanionFishEntity`. She listens
 *      now — see the effect below.
 *   1. She roamed on `setInterval(4000–7000ms)`. A fixed cadence reads as a
 *      screensaver, not a creature. Every reposition now gets its own jittered
 *      delay (spec §4 rule 2).
 *   2. She was a `role="button"` with `tabIndex={0}` sitting at `zIndex: 8000`
 *      in the corner — a focusable, clickable object over the UI. She is now
 *      inert: `pointer-events: none` and `aria-hidden`, so she cannot swallow a
 *      click or a tab stop. This project has already lost time to a floating
 *      element covering a control.
 *
 * ⚠️ SHE IS DELIBERATELY NON-INTERACTIVE. Tapping Echo should open Poseidon (spec
 * §3), but `PoseidonGlobalWidget` keeps `isOpen` in local state with no
 * programmatic entry point, so that direction still needs a bridge. Rather than
 * leave a button that does nothing, she is presence-only: she hears Poseidon, she
 * cannot yet summon him.
 *
 * Props:
 *   visible {boolean} render at all — the caller owns the Settings gate
 *   calm    {boolean} Pro mode: quieter motion, no roaming
 */

const AMBIENT_SIZE = 56;

// Roam cadence. Jittered per move; see the docblock.
const ROAM_MIN_MS = 9000;
const ROAM_JITTER_MS = 7000;

// How far she may drift from her anchor, in px. Small on purpose: she is a
// presence in the corner, not a pet wandering the viewport.
const DRIFT_RANGE = 22;

// Long idle → she settles. Real inactivity, not a timer since mount.
const REST_AFTER_MS = 2 * 60 * 1000;

// Poseidon reaction timing. Spec §4 rule 3: she reacts a BEAT LATE. Reacting on
// the same frame as his output reads as scripted; a short delay reads as reacting
// to it. Rule 4: the response is brief and bounded — the payload can ask for 12
// seconds, which is a pose, not a reaction.
const REACT_DELAY_MS = 250;
const REACT_MAX_MS = 2200;

export function EchoAmbient({ visible = true, calm = false }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [resting, setResting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const roamTimer = useRef(null);
  const restTimer = useRef(null);
  const reactTimers = useRef([]);

  // ─── Irregular drift ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible || calm || resting) return;

    const schedule = () => {
      const delay = ROAM_MIN_MS + Math.random() * ROAM_JITTER_MS;
      roamTimer.current = setTimeout(() => {
        setOffset({
          x: (Math.random() * 2 - 1) * DRIFT_RANGE,
          y: (Math.random() * 2 - 1) * (DRIFT_RANGE * 0.6),
        });
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (roamTimer.current) clearTimeout(roamTimer.current);
    };
  }, [visible, calm, resting]);

  // ─── Rest on genuine inactivity ───────────────────────────────────────────
  //
  // Listens to real input rather than counting from mount, so a user who is
  // reading rather than clicking still lets her settle — and any activity wakes
  // her. `visibilitychange` matters too: a hidden tab should not animate.
  useEffect(() => {
    if (!visible) return;

    const wake = () => {
      setResting(false);
      if (restTimer.current) clearTimeout(restTimer.current);
      restTimer.current = setTimeout(() => setResting(true), REST_AFTER_MS);
    };

    const onVisibility = () => {
      if (document.hidden) setResting(true);
      else wake();
    };

    const events = ["pointerdown", "keydown", "scroll"];
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    wake();

    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      document.removeEventListener("visibilitychange", onVisibility);
      if (restTimer.current) clearTimeout(restTimer.current);
    };
  }, [visible]);

  // ─── React to Poseidon ────────────────────────────────────────────────────
  //
  // THE FIRST TIME POSEIDON AND ECHO ARE ACTUALLY CONNECTED. `poseidon:echo-reaction`
  // has been dispatched from five places for a long time — the chat console, the
  // global widget, and three easter eggs — and its only listener was
  // `CompanionFishEntity`, a CSS-div fish buried in the tank detail panel that most
  // users never opened. Deleting that component is what surfaced the mismatch:
  // Poseidon was talking to a fish nobody could see.
  //
  // This is a deliberately thin reading of the payload. It carries `mood`,
  // `glowColor` and `swimSpeedMultiplier`, and mapping those properly is the
  // behaviour model in step 3. For now: she notices, briefly, and settles.
  useEffect(() => {
    if (!visible) return;

    const onReaction = (e) => {
      const requested = Number(e?.detail?.durationMs) || 900;
      const duration = Math.min(Math.max(requested, 400), REACT_MAX_MS);

      // Poseidon speaking is activity — she should not stay asleep through it.
      setResting(false);

      const start = setTimeout(() => {
        setReacting(true);
        const end = setTimeout(() => setReacting(false), duration);
        reactTimers.current.push(end);
      }, REACT_DELAY_MS);
      reactTimers.current.push(start);
    };

    window.addEventListener("poseidon:echo-reaction", onReaction);
    return () => {
      window.removeEventListener("poseidon:echo-reaction", onReaction);
      for (const t of reactTimers.current) clearTimeout(t);
      reactTimers.current = [];
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`echo-ambient${reacting ? " echo-ambient--reacting" : ""}`}
      style={{
        transform: `translate(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px)`,
        opacity: resting ? 0.45 : 1,
      }}
      aria-hidden="true"
    >
      <EchoRenderer size={AMBIENT_SIZE} animated={!resting} />
    </div>
  );
}

export default EchoAmbient;
