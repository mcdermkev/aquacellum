import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EchoRenderer } from "./EchoRenderer";
import {
  ECHO_EVENT,
  ECHO_STATE,
  TIMING,
  createEchoState,
  reduce,
  describe as describeEcho,
  nextTransitionAt,
  nextDriftDelay,
  nextDriftOffset,
} from "../services/echoBehaviour";
import "./EchoAmbient.css";

/**
 * EchoAmbient — Echo's persistent presence.
 *
 * See docs/ECHO_CHARACTER_SPEC.md §3–4. Poseidon is the brain, Echo is the body.
 *
 * THIS COMPONENT DECIDES NOTHING. All of it — what state she is in, how long a
 * reaction lasts, when she rests, how far she drifts — lives in
 * `services/echoBehaviour.js`, which is pure and mirrored for `database.html`.
 * This file is a binding: translate DOM events into behaviour events, translate
 * behaviour state into pixels.
 *
 * That split is the whole reason step 3 exists. Every previous Echo scattered its
 * timing across component-local intervals, so the behaviour only existed as an
 * emergent property of four components and nobody could say what she was supposed
 * to do. Do not add a `setTimeout` here that encodes a *decision*; the two timers
 * below exist only to advance the clock.
 *
 * ONE SCHEDULED WAKE-UP, not one per concern. `nextTransitionAt()` returns the
 * single soonest instant at which `observe()` could change its answer, so a
 * reaction, a speaking window and a rest deadline share one timeout. When nothing
 * is pending it returns null and we schedule nothing — an idle Echo in a
 * background tab costs zero timers.
 */

const AMBIENT_SIZE = 56;

export function EchoAmbient({ visible = true, calm = false }) {
  // `useReducer` with the pure core as the reducer. React's contract (same state
  // + same action ⇒ same result, no side effects) is exactly what the core
  // already guarantees, so they compose without a wrapper.
  const [behaviour, dispatch] = useReducer(reduce, undefined, () => createEchoState(Date.now()));

  // Re-render tick. The core is a function of `now`, so advancing this is how a
  // pending transition becomes visible.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const send = useCallback((type, extra) => {
    dispatch({ type, now: Date.now(), ...extra });
  }, []);

  // ─── Advance the clock exactly when something can change ───────────────────
  const wakeTimer = useRef(null);
  useEffect(() => {
    if (!visible) return;

    const at = nextTransitionAt(behaviour, Date.now());
    if (at === null) return;

    const delay = Math.max(0, at - Date.now());
    wakeTimer.current = setTimeout(bump, delay);
    return () => {
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
    };
    // `tick` IS a dependency, deliberately. A reaction has two transitions — it
    // begins 250 ms late and ends when its window closes — and `behaviour` does
    // not change between them. Without `tick` here the effect would run once,
    // schedule the first wake-up, and never schedule the second, leaving her stuck
    // mid-reaction until some unrelated event happened to re-render her.
  }, [behaviour, tick, visible, bump]);

  // ─── Poseidon ─────────────────────────────────────────────────────────────
  //
  // `poseidon:echo-reaction` is dispatched from five places — the chat console,
  // the global widget, and three easter eggs. Its only listener used to be
  // `CompanionFishEntity`, a CSS fish in the tank detail panel most users never
  // opened, so Poseidon was talking to something nobody could see.
  useEffect(() => {
    if (!visible) return;

    const onReaction = (e) => {
      const d = e?.detail || {};
      send(ECHO_EVENT.POSEIDON_REACTION, {
        durationMs: d.durationMs,
        swimSpeedMultiplier: d.swimSpeedMultiplier,
      });
    };

    window.addEventListener("poseidon:echo-reaction", onReaction);
    return () => window.removeEventListener("poseidon:echo-reaction", onReaction);
  }, [visible, send]);

  // ─── Wake on genuine input, rest on real inactivity ───────────────────────
  //
  // Real input rather than a countdown from mount, so a keeper who is reading
  // rather than clicking still lets her settle, and any activity wakes her.
  useEffect(() => {
    if (!visible) return;

    const onActivity = () => send(ECHO_EVENT.ACTIVITY);
    const onVisibility = () =>
      send(document.hidden ? ECHO_EVENT.HIDDEN : ECHO_EVENT.VISIBLE);

    const events = ["pointerdown", "keydown", "scroll"];
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [visible, send]);

  // ─── Irregular drift ──────────────────────────────────────────────────────
  //
  // Each leg schedules the next with its own jittered delay from the core. A
  // shared interval is the mechanical tell rule 2 is about.
  const driftTimer = useRef(null);
  const observedState = describeEcho(behaviour, Date.now()).state;
  const shouldDrift = visible && !calm && observedState !== ECHO_STATE.RESTING;

  useEffect(() => {
    if (!shouldDrift) return;

    const schedule = () => {
      driftTimer.current = setTimeout(() => {
        const { x, y } = nextDriftOffset();
        send(ECHO_EVENT.DRIFT, { x, y });
        schedule();
      }, nextDriftDelay());
    };
    schedule();

    return () => {
      if (driftTimer.current) clearTimeout(driftTimer.current);
    };
  }, [shouldDrift, send]);

  if (!visible) return null;

  const view = describeEcho(behaviour, Date.now());
  const reacting = view.state === ECHO_STATE.REACTING;
  const resting = view.state === ECHO_STATE.RESTING;

  return (
    <div
      className={`echo-ambient echo-ambient--${view.state}`}
      style={{
        transform: `translate(${view.drift.x.toFixed(1)}px, ${view.drift.y.toFixed(1)}px)`,
        opacity: resting ? 0.45 : 1,
        // Rule 4: the reaction is scaled by the core's intensity rather than a
        // fixed burst, so a water-change log and an easter egg no longer produce
        // identical motion.
        scale: reacting ? 1 + view.intensity * 0.09 : 1,
        filter: reacting ? `brightness(${(1 + view.intensity * 0.18).toFixed(2)})` : "none",
        // Rule 5: one settle duration, owned by the core.
        transitionDuration: `${TIMING.settleMs}ms`,
      }}
      // Decorative and inert. Spec §3: she must never intercept a click she does
      // not own or take a tab stop.
      aria-hidden="true"
    >
      <EchoRenderer
        size={AMBIENT_SIZE}
        animated={view.animate}
        facingLeft={view.facingLeft}
        tiltDeg={view.tiltDeg}
      />
    </div>
  );
}

export default EchoAmbient;
