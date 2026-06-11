import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { prefersReducedMotion } from "../../utils/a11y.js";

// Echo's hatchling art lives in /public so it is served from the site root.
const ECHO_FRY = "/echo-fry.png";

// The visual/lifecycle states of the stage.
export const ECHO_STATES = ["idle", "cracking", "hatched"];

// How long the egg may sit untouched before Poseidon nudges the user (Req 2.3).
export const DEFAULT_NUDGE_DELAY = 6000;

// Fallback timeout (ms) that advances cracking → hatched if the CSS
// `animationend` event never fires (e.g. animation disabled, reduced motion,
// or the element is off-screen). Slightly longer than the `eggCrack` 1.2s anim.
const CRACK_FALLBACK_MS = 1400;

/**
 * nextEchoState — pure transition function for the Echo hatch lifecycle.
 *
 * Extracted as a side-effect-free helper so the state machine can be unit
 * tested without a DOM (the project's vitest runs in a `node` environment).
 *
 *   idle      --activate-->  cracking   (or "hatched" directly when reduced motion)
 *   cracking  --animEnd--->  hatched
 *   hatched   ------------>  hatched     (terminal)
 *
 * @param {"idle"|"cracking"|"hatched"} current
 * @param {boolean} reducedMotion  When true, idle activation skips the crack
 *        animation and cross-fades straight to hatched (Req 2.3 / 9.3).
 * @returns {"idle"|"cracking"|"hatched"}
 */
export function nextEchoState(current, reducedMotion = false) {
  switch (current) {
    case "idle":
      return reducedMotion ? "hatched" : "cracking";
    case "cracking":
      return "hatched";
    case "hatched":
    default:
      return "hatched";
  }
}

/**
 * EchoStage — the egg → crack → fry-in-tank visual stage.
 *
 * Renders the interactive Echo egg inside a tank-framed backdrop ("Echo's
 * home"). Activating the egg (click, or keyboard Enter/Space) plays a
 * crack/hatch animation that resolves to the Echo fry (`/echo-fry.png`)
 * swimming inside the tank. The same tank frame is reused as the visual anchor
 * during the later spotlight tour so the "this is Echo's home" metaphor carries
 * over.
 *
 * The component is primarily self-managed: it owns its lifecycle state and
 * fires `onHatch` once when the hatch completes. A `state` prop is also
 * accepted so a parent can seed/override the visual state if desired.
 *
 * Accessibility & motion:
 *   - The egg is a real <button> with `role="button"`, an aria-label, a visible
 *     focus ring, and a ≥48×48px interactive target (Req 2.6, 9.2).
 *   - Honors `prefers-reduced-motion`: instead of the crack/shake animation it
 *     cross-fades idle → hatched, reaching the same end state (Req 2.3, 9.3).
 *   - A ~6s nudge hook (`onNudge`) fires if the egg is never touched, so the
 *     parent can surface Poseidon's "Go on, give it a tap." line (Req 2.3).
 *
 * @param {object}   props
 * @param {"idle"|"cracking"|"hatched"} [props.state]  Optional controlled/seed state.
 * @param {() => void} [props.onHatch]       Fired once when the hatch completes.
 * @param {() => void} [props.onNudge]       Fired ~`nudgeDelay`ms after mount if untouched.
 * @param {boolean}  [props.reducedMotion]   Override motion detection; auto-detected when omitted.
 * @param {number}   [props.nudgeDelay]      Nudge delay in ms (default 6000).
 * @param {string}   [props.className]       Extra class names for the stage wrapper.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 9.2, 9.3
 */
export function EchoStage({
  state,
  onHatch,
  onNudge,
  reducedMotion,
  nudgeDelay = DEFAULT_NUDGE_DELAY,
  className = "",
}) {
  // Resolve the reduced-motion preference once: explicit prop wins, otherwise
  // detect via matchMedia (guarded for non-browser environments).
  const [reduced] = useState(() => {
    if (typeof reducedMotion === "boolean") return reducedMotion;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return prefersReducedMotion();
    }
    return false;
  });

  // Self-managed lifecycle state, optionally seeded from the `state` prop.
  const [phase, setPhase] = useState(() => (
    ECHO_STATES.includes(state) ? state : "idle"
  ));

  const interactedRef = useRef(false);
  const hatchedFiredRef = useRef(false);
  const crackTimerRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (crackTimerRef.current) clearTimeout(crackTimerRef.current);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, []);

  // Keep internal phase in sync if a parent drives the `state` prop.
  useEffect(() => {
    if (ECHO_STATES.includes(state)) {
      setPhase(state);
    }
  }, [state]);

  // Fire onHatch exactly once when we reach the hatched state.
  useEffect(() => {
    if (phase === "hatched" && !hatchedFiredRef.current) {
      hatchedFiredRef.current = true;
      if (typeof onHatch === "function") onHatch();
    }
  }, [phase, onHatch]);

  // ~6s nudge: if the egg is still untouched after `nudgeDelay`, notify parent
  // so Poseidon can prompt the user. Cleared on interaction / unmount.
  useEffect(() => {
    if (phase !== "idle" || interactedRef.current) return undefined;
    nudgeTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !interactedRef.current) {
        if (typeof onNudge === "function") onNudge();
      }
    }, nudgeDelay);
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [phase, nudgeDelay, onNudge]);

  // Advance cracking → hatched once the crack animation finishes. A fallback
  // timer guarantees progression even if `animationend` never arrives.
  const finishCrack = useCallback(() => {
    if (crackTimerRef.current) {
      clearTimeout(crackTimerRef.current);
      crackTimerRef.current = null;
    }
    setPhase((prev) => (prev === "cracking" ? "hatched" : prev));
  }, []);

  const handleActivate = useCallback(() => {
    // Only the idle egg is interactive; ignore once cracking/hatched.
    if (phase !== "idle" || interactedRef.current) return;
    interactedRef.current = true;
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);

    const target = nextEchoState("idle", reduced);
    setPhase(target);

    // When animating, arm a fallback in case `animationend` doesn't fire.
    if (target === "cracking") {
      crackTimerRef.current = setTimeout(finishCrack, CRACK_FALLBACK_MS);
    }
  }, [phase, reduced, finishCrack]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate]
  );

  const showEgg = phase === "idle" || phase === "cracking";
  const eggClassName = `echo-egg${phase === "cracking" ? " echo-egg--cracking" : ""}`;

  return (
    <div className={`echo-stage${className ? ` ${className}` : ""}`}>
      <div className="echo-tank-frame">
        {showEgg && (
          <button
            type="button"
            className={eggClassName}
            role="button"
            aria-label="Hatch Echo's egg"
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
            onAnimationEnd={phase === "cracking" ? finishCrack : undefined}
            // Egg-shaped gradient: no dedicated egg asset exists, so the shell is
            // drawn in CSS and revealed art (the fry) takes over after hatching.
            style={{
              borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
              background:
                "radial-gradient(ellipse at 30% 28%, rgba(186, 230, 253, 0.95), rgba(56, 189, 248, 0.45) 45%, rgba(14, 20, 36, 0.92))",
            }}
          />
        )}

        {phase === "hatched" && (
          <img
            className="echo-fry"
            src={ECHO_FRY}
            alt="Echo, your newly hatched companion, swimming in the tank"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}

export default EchoStage;
