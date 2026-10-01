import React from "react";
import { ECHO_ART, ECHO_ASPECT, artTransform } from "../services/echoBehaviour";

/**
 * EchoRenderer — draws Echo.
 *
 * ONE character, identical for every user and every surface: Echo, powered by
 * Poseidon (docs/ECHO_CHARACTER_SPEC.md). Her seven faces are painted poses in
 * public/echo/, all cropped to one box, listed in the behaviour core as
 * ECHO_ART. The vanilla mount on the static pages reads the same list.
 *
 * THIS COMPONENT DECIDES NOTHING. Which face, which way she looks and how far
 * she leans all come from the core (`describe()` / `artTransform()`); this only
 * draws the answer.
 *
 * All seven faces are stacked and only the current one is opaque, so a change
 * of expression is a short crossfade rather than a flash of an unloaded image.
 * They are small WebPs (about 33 KB each) and load once.
 *
 * Styling lives in /css/echo.css, shared with the static pages.
 *
 * Props:
 *   size       {number}  height in px; width follows the art's aspect
 *   expression {string}  one of ECHO_EXPRESSION, from the core
 *   animated   {boolean} idle bob and sway
 *   facingLeft {boolean} from the core
 *   tiltDeg    {number}  lean toward an attended target
 */
export function EchoRenderer({ size = 64, expression = "idle", animated = true, facingLeft = false, tiltDeg = 0 }) {
  const face = Object.prototype.hasOwnProperty.call(ECHO_ART, expression) ? expression : "idle";
  return (
    <div
      className="echo-renderer"
      style={{ width: Math.round(size * ECHO_ASPECT), height: size }}
      // Decorative here. Surfaces that make her interactive supply the label.
      aria-hidden="true"
    >
      <div
        className={animated ? "echo-art echo-art--animated" : "echo-art"}
        style={{ transform: artTransform({ facingLeft, tiltDeg }) }}
      >
        {Object.entries(ECHO_ART).map(([name, src]) => (
          <img
            key={name}
            src={src}
            alt=""
            draggable="false"
            decoding="async"
            className={`echo-face${name === face ? " echo-face--on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

export default EchoRenderer;
