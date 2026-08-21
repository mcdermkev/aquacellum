import React, { useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "../utils/a11y";
import "./EchoRenderer.css";

/**
 * EchoRenderer — draws Echo.
 *
 * ONE character, identical for every user. See docs/ECHO_CHARACTER_SPEC.md §2.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The previous renderer was 718 lines that took `dna`, `stage`, `needs` and
 * `personality` and composed a per-wallet Echo out of a stage PNG plus CSS
 * filters: `hue-rotate` off a hardcoded 190° teal for colour, a `skewY()` for
 * "body shape" (its own comment admitted "we don't have per-shape art"), and an
 * unmasked SVG doodle for "pattern". Eight body shapes were the same fish
 * squashed eight ways.
 *
 * That machinery bought nothing. Every Echo in production derived its DNA from
 * `generateLocalDna()` — a char-code hash of the wallet address — because the
 * contract it was meant to read was never deployed. So the visual variation was
 * noise, not identity, and it made authored art impossible: nobody can draw for
 * a silhouette defined as `skewY(-2.5deg)`.
 *
 * Echo is a character, not a collectible. Everyone gets the same one, so she can
 * actually be drawn, recognised, and animated.
 *
 * ⚠️ THE ART IS A PLACEHOLDER. `ECHO_ART` still points at one of the old stage
 * PNGs so Echo remains visible through this refactor. Step 7 of the spec replaces
 * it with the real stylised character set (vector, kilobytes, expression states).
 * Swapping it is a one-line change here, which is the point of routing every
 * surface through this component.
 *
 * Motion is deliberately minimal for now. The behaviour model — six states, gaze,
 * proportional reaction, irregular timing — is step 3 and belongs in its own
 * shared module so `database.html` can run the same character. This component
 * only avoids regressing to a dead sprite in the meantime.
 *
 * Props:
 *   size     {number}  render size in px
 *   animated {boolean} idle motion; always off under prefers-reduced-motion
 */

// The single canonical Echo. Replaced wholesale in step 7.
const ECHO_ART = "/echo-stages/stage-4-adult.png?v1";

/**
 * Idle drift, jittered.
 *
 * Spec §4 rule 2: nothing on a fixed interval. A perfectly regular cycle is what
 * made the old ambient Echo read as a screensaver, so each leg of the drift gets
 * its own duration rather than sharing one loop.
 */
const IDLE_MIN_MS = 5200;
const IDLE_JITTER_MS = 4300;

export function EchoRenderer({ size = 64, animated = true }) {
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const shouldAnimate = animated && !reducedMotion;

  // Facing flips on an irregular cadence so she reads as looking around rather
  // than cycling. Never mid-flip on mount, so she doesn't pop.
  const [facingLeft, setFacingLeft] = useState(false);
  const flipTimer = useRef(null);

  useEffect(() => {
    if (!shouldAnimate) return;

    const schedule = () => {
      const delay = IDLE_MIN_MS + Math.random() * IDLE_JITTER_MS;
      flipTimer.current = setTimeout(() => {
        setFacingLeft((prev) => !prev);
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (flipTimer.current) clearTimeout(flipTimer.current);
    };
  }, [shouldAnimate]);

  return (
    <div
      className="echo-renderer"
      style={{ width: size, height: size }}
      // Decorative. Echo carries no information a screen reader needs, and the
      // surfaces that mount her supply their own labels when she becomes
      // interactive.
      aria-hidden="true"
    >
      <img
        className={shouldAnimate ? "echo-art echo-art--animated" : "echo-art"}
        src={ECHO_ART}
        alt=""
        draggable="false"
        style={{
          width: "100%",
          height: "100%",
          transform: facingLeft ? "scaleX(-1)" : "none",
        }}
      />
    </div>
  );
}

export default EchoRenderer;
