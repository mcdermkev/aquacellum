/**
 * echoGaze.js — the gaze protocol.
 *
 * Step 4 of docs/ECHO_CHARACTER_SPEC.md. Rule 1: orientation is the highest-value
 * believability cue, so "look at this" needs to be trivial to ask for from
 * anywhere in the app.
 *
 * THE PROTOCOL IS TWO DOM EVENTS.
 *
 *   window.dispatchEvent(new CustomEvent("echo:attend", { detail: { target } }))
 *   window.dispatchEvent(new CustomEvent("echo:release"))
 *
 * Custom events rather than a context, a store, or a global object, for three
 * reasons:
 *
 *   1. `database.html` is a plain <script> page. An event is the only channel
 *      both runtimes can use unchanged, and one protocol beats two.
 *   2. Nothing breaks when Echo is absent. If she is switched off in Settings, or
 *      not mounted on a given page, the event goes nowhere and the dispatcher
 *      neither knows nor cares. A component asking for her attention must never
 *      be able to break by asking.
 *   3. It matches how this codebase already talks to itself —
 *      `poseidon:echo-reaction`, `aquadex_xp_added`, `aquadex:navigate-tab`.
 *
 * THE DISPATCHER NAMES AN ELEMENT; THE MOUNT DOES THE GEOMETRY. Only the mount
 * knows where Echo currently is, and she drifts, so an offset computed by the
 * caller would be stale before it arrived. Callers say *what*, never *where*.
 *
 * `attachGazeTracking()` is the mount half, shared by whoever draws her. It holds
 * the current target, re-measures on scroll and resize, and lets go when the
 * element leaves the document — the staleness problem a one-shot measurement
 * would otherwise have, where she keeps staring at where a closed panel used to
 * be.
 */
import { ECHO_EVENT, offsetBetweenRects } from "./echoBehaviour";

export const ECHO_ATTEND_EVENT = "echo:attend";
export const ECHO_RELEASE_EVENT = "echo:release";

/**
 * Ask Echo to look at an element. Safe to call when she is not mounted.
 * @param {Element|null} target
 */
export function echoAttend(target) {
  if (typeof window === "undefined" || !target) return;
  window.dispatchEvent(new CustomEvent(ECHO_ATTEND_EVENT, { detail: { target } }));
}

/** Ask Echo to stop looking at whatever she was looking at. */
export function echoRelease() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ECHO_RELEASE_EVENT));
}

/**
 * Wire gaze tracking for a mounted Echo.
 *
 * @param {object} options
 * @param {() => Element|null} options.getSelf  the element Echo is drawn in
 * @param {(offset: {dx: number, dy: number}) => void} options.onOffset
 * @param {() => void} options.onRelease
 * @returns {() => void} teardown
 */
export function attachGazeTracking({ getSelf, onOffset, onRelease }) {
  if (typeof window === "undefined") return () => {};

  let target = null;
  let frame = null;
  // Tracked separately from the rAF handle, and set BEFORE scheduling. Relying on
  // `frame` alone is order-dependent: `frame = requestAnimationFrame(measure)`
  // assigns the handle only after the callback returns, so any synchronous
  // scheduler leaves `frame` non-null forever and every later re-measure is
  // silently skipped. Browsers happen to be async, which makes that a latent bug
  // rather than a visible one — she would stop following a scrolling target the
  // moment anything invoked the callback inline.
  let pending = false;

  const measure = () => {
    pending = false;
    frame = null;

    // The element went away — a closed panel, an unmounted modal. Let go rather
    // than keep staring at a position that no longer means anything.
    if (!target || !target.isConnected) {
      if (target) {
        target = null;
        onRelease();
      }
      return;
    }

    const self = getSelf();
    if (!self) return;

    const offset = offsetBetweenRects(target.getBoundingClientRect(), self.getBoundingClientRect());
    // Null means "not worth looking at" (zero-sized, collapsed). Leave her gaze
    // where it was instead of snapping to the viewport corner.
    if (offset) onOffset(offset);
  };

  // rAF-coalesced: scroll fires far more often than a layout actually settles,
  // and re-measuring per event would mean a `getBoundingClientRect()` per scroll
  // tick — a forced reflow, for a decorative fish.
  const schedule = () => {
    if (pending) return;
    pending = true;
    frame = requestAnimationFrame(measure);
  };

  const onAttend = (e) => {
    const next = e?.detail?.target;
    if (!next || typeof next.getBoundingClientRect !== "function") return;
    target = next;
    measure();
  };

  const onReleaseEvent = () => {
    if (!target) return;
    target = null;
    onRelease();
  };

  window.addEventListener(ECHO_ATTEND_EVENT, onAttend);
  window.addEventListener(ECHO_RELEASE_EVENT, onReleaseEvent);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });

  return () => {
    window.removeEventListener(ECHO_ATTEND_EVENT, onAttend);
    window.removeEventListener(ECHO_RELEASE_EVENT, onReleaseEvent);
    window.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

/** Re-export so a mount does not need to import the core just for this. */
export const GAZE_ATTEND_ACTION = ECHO_EVENT.ATTEND;
export const GAZE_RELEASE_ACTION = ECHO_EVENT.RELEASE;
