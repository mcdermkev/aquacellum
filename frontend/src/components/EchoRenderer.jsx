import React from "react";
import { ECHO_ART, artTransform } from "../services/echoBehaviour";

/**
 * EchoRenderer — draws Echo.
 *
 * ONE character, identical for every user, and now identical on every surface.
 * See docs/ECHO_CHARACTER_SPEC.md §2.
 *
 * THIS COMPONENT DECIDES NOTHING, which is the whole point. The art path and the
 * transform both come from `services/echoBehaviour.js`, the same module the
 * vanilla mount on `database.html` calls through its browser mirror. Spec §8
 * forbids a second renderer; a static page cannot use a React one, so the honest
 * form of that rule is that neither renderer is allowed a decision. Two dumb
 * renderers applying one core's output cannot drift into two characters.
 *
 * It used to own an idle facing timer and its own transform composition. Both
 * moved into the core — the timer became a `GLANCE` event a binding schedules, so
 * "which way is she facing" has exactly one answer regardless of who is drawing
 * her.
 *
 * WHAT IT REPLACED, for the record: 718 lines that composed a per-wallet Echo from
 * a stage PNG plus CSS filters — `hue-rotate` off a hardcoded 190° teal for
 * colour, a `skewY()` for "body shape" (its own comment admitted "we don't have
 * per-shape art"), and an unmasked SVG doodle for "pattern". Eight body shapes
 * were the same fish squashed eight ways, and every Echo's DNA came from a
 * char-code hash of the wallet address because the contract it was meant to read
 * was never deployed. Noise, not identity — and it made authored art impossible.
 *
 * Styling lives in /css/echo.css, linked by app.html and database.html alike.
 *
 * Props:
 *   size       {number}  render size in px
 *   animated   {boolean} idle motion — the caller passes the core's `animate`
 *   facingLeft {boolean} from the core; gaze when attending, glance when idle
 *   tiltDeg    {number}  lean toward an attended target
 */
export function EchoRenderer({ size = 64, animated = true, facingLeft = false, tiltDeg = 0 }) {
  return (
    <div
      className="echo-renderer"
      style={{ width: size, height: size }}
      // Decorative. Echo carries no information a screen reader needs, and the
      // surfaces that mount her supply their own labels if she becomes interactive.
      aria-hidden="true"
    >
      <img
        className={animated ? "echo-art echo-art--animated" : "echo-art"}
        src={ECHO_ART}
        alt=""
        draggable="false"
        style={{ transform: artTransform({ facingLeft, tiltDeg }) }}
      />
    </div>
  );
}

export default EchoRenderer;
