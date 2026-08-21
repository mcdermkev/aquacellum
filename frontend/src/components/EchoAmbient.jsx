import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EchoRenderer } from "./EchoRenderer";
import {
  ECHO_EVENT,
  ECHO_STATE,
  createEchoState,
  reduce,
  describe as describeEcho,
  nextTransitionAt,
  nextDriftDelay,
  nextDriftOffset,
  nextGlanceDelay,
  wrapperVisuals,
} from "../services/echoBehaviour";
import { attachGazeTracking } from "../services/echoGaze";
// Styling lives in /css/echo.css, linked from app.html — one stylesheet shared
// with database.html so the two surfaces cannot style two different characters.

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

  // ─── Vision (spec §6) ─────────────────────────────────────────────────────
  //
  // `services/echoVision.js` brackets an identification request with these two
  // events, so she concentrates for exactly as long as the model is looking. The
  // core has modelled EXAMINING since the rework with nothing to trigger it; this
  // is the trigger.
  //
  // A DOM event rather than a prop or a context because the vanilla mount on
  // `database.html` listens for the same two names — one protocol, both surfaces.
  useEffect(() => {
    if (!visible) return;

    const onStart = () => send(ECHO_EVENT.VISION_START);
    const onEnd = () => send(ECHO_EVENT.VISION_END);

    window.addEventListener("echo:vision-start", onStart);
    window.addEventListener("echo:vision-end", onEnd);
    return () => {
      window.removeEventListener("echo:vision-start", onStart);
      window.removeEventListener("echo:vision-end", onEnd);
      // Unmounting mid-request must not strand `examining: true` in a state that
      // outlives this effect — the next mount reads a fresh state, but a remount
      // while a request is in flight would otherwise miss the end event.
      send(ECHO_EVENT.VISION_END);
    };
  }, [visible, send]);

  // ─── Gaze (rule 1) ────────────────────────────────────────────────────────
  //
  // Components ask via `useEchoAttend(ref, active)`, which dispatches
  // `echo:attend` with an element. The mount is the half that does the geometry,
  // because only it knows where she currently is — and she drifts, so an offset
  // computed by a caller would be stale before it arrived.
  const selfRef = useRef(null);
  useEffect(() => {
    if (!visible) return;
    return attachGazeTracking({
      getSelf: () => selfRef.current,
      onOffset: ({ dx, dy }) => send(ECHO_EVENT.ATTEND, { dx, dy }),
      onRelease: () => send(ECHO_EVENT.RELEASE),
    });
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
  const glanceTimer = useRef(null);
  const observedState = describeEcho(behaviour, Date.now()).state;
  const idling = visible && observedState !== ECHO_STATE.RESTING;
  const shouldDrift = idling && !calm;

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

  // Idle glancing. Separate from drift because looking around is a smaller act
  // than moving, and because it survives `calm` — a Pro Echo holds position but
  // is not a statue.
  useEffect(() => {
    if (!idling) return;

    const schedule = () => {
      glanceTimer.current = setTimeout(() => {
        send(ECHO_EVENT.GLANCE);
        schedule();
      }, nextGlanceDelay());
    };
    schedule();

    return () => {
      if (glanceTimer.current) clearTimeout(glanceTimer.current);
    };
  }, [idling, send]);

  if (!visible) return null;

  const view = describeEcho(behaviour, Date.now());

  return (
    <div
      ref={selfRef}
      className={`echo-ambient echo-ambient--${view.state}`}
      // Every value here comes from the core, including the reaction scale and
      // brightness (rule 4: proportional to the news) and the settle duration
      // (rule 5). The vanilla mount assigns the identical object onto
      // `element.style`, which is what keeps the two renderers one character.
      style={wrapperVisuals(view)}
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
