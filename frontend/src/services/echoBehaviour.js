/**
 * echoBehaviour.js — Echo's behaviour core.
 *
 * Implements docs/ECHO_CHARACTER_SPEC.md §4. This is the module that decides what
 * Echo is doing; `EchoAmbient` only renders the answer and ticks the clock.
 *
 * PURE ON PURPOSE. No React, no DOM, no `Date.now()`, no `setTimeout`, no
 * `Math.random()` unless one is handed in. Three reasons, and the third is the one
 * that actually forced it:
 *
 *   1. Believability is timing, and timing is the one thing you cannot eyeball in
 *      a review. It has to be assertable.
 *   2. `database.html` cannot import ESM from `src/`, so this needs a browser
 *      mirror (`public/js/echo-behaviour.js`) kept honest by a parity test — the
 *      arrangement `species-catalog.js` and `sexing-guide.js` already use. A core
 *      full of timers could not be mirrored faithfully.
 *   3. Echo has been rebuilt five times. Every previous version scattered its
 *      timing across component-local `setInterval` calls, which is why nobody
 *      could say what she was supposed to do — the behaviour only existed as an
 *      emergent property of four components. Now it exists in one file you can
 *      read.
 *
 * SIX OBSERVABLE STATES, THREE INTERNAL DIMENSIONS
 *
 * The spec names six states. Modelling them as six flat, mutually-exclusive slots
 * turned out to be wrong: she can plausibly be *attending to something while
 * Poseidon speaks*, and a reaction is a brief flash that should overlay whatever
 * she was already doing rather than replace it. A flat enum forces you to invent
 * answers to "speaking or attending?" that no observer would ever ask.
 *
 * So internally there are three orthogonal dimensions —
 *
 *   activity   resting | idle | speaking | examining   (mutually exclusive)
 *   attention  a gaze vector, or none                  (orthogonal)
 *   reaction   a delayed, bounded window               (transient overlay)
 *
 * — and `observe()` collapses them into the spec's six names by precedence. The
 * vocabulary the spec promises is preserved; the combinatorial mess is not.
 *
 * THE DELAYED REACTION IS DATA, NOT A TIMER
 *
 * Rule 3 says she reacts a beat late. Rather than a `setTimeout` inside a
 * reaction handler, a reaction stores `reactFrom` and `reactUntil` timestamps.
 * `observe()` compares them against `now`. That makes "reacts 250 ms late" a
 * property you can assert with two integers instead of fake timers, and it means
 * the React layer needs exactly one scheduled wake-up rather than a pile of
 * overlapping ones — see `nextTransitionAt()`.
 */

// ─── Observable states (spec §4) ─────────────────────────────────────────────

export const ECHO_STATE = Object.freeze({
  RESTING: "resting",
  IDLE: "idle",
  ATTENDING: "attending",
  SPEAKING: "speaking",
  EXAMINING: "examining",
  REACTING: "reacting",
});

// ─── Events ──────────────────────────────────────────────────────────────────

export const ECHO_EVENT = Object.freeze({
  ACTIVITY: "activity",
  HIDDEN: "hidden",
  VISIBLE: "visible",
  POSEIDON_SPEAKING: "poseidon-speaking",
  POSEIDON_REACTION: "poseidon-reaction",
  VISION_START: "vision-start",
  VISION_END: "vision-end",
  ATTEND: "attend",
  RELEASE: "release",
  DRIFT: "drift",
  GLANCE: "glance",
});

/**
 * The art. One constant, one character, every surface.
 *
 * ⚠️ PLACEHOLDER — still one of the old stage PNGs so Echo stays visible through
 * the rework. Step 7 replaces it with the real stylised set. It lives in the CORE
 * rather than in a renderer precisely so that swap is one line and cannot be done
 * for the app while leaving `database.html` on the old art.
 */
export const ECHO_ART = "/echo-stages/stage-4-adult.png?v1";

// ─── Timing (spec §4 rules 2–5) ──────────────────────────────────────────────

export const TIMING = Object.freeze({
  /**
   * Rule 3. Reacting on the same frame as Poseidon's output reads as scripted;
   * a short delay reads as reacting TO it. Long enough to be a beat, short
   * enough not to feel like lag.
   */
  reactDelayMs: 250,

  /**
   * Rule 4 bounds. The dispatched payloads in this codebase ask for up to
   * 12000 ms (`SpecimenDetailModal`'s golden-glow easter egg). Twelve seconds is
   * a pose, not a reaction, so requests are clamped. The floor stops a 50 ms
   * request becoming an invisible flicker.
   */
  reactMinMs: 400,
  reactMaxMs: 2200,

  /**
   * Rule 2. The old ambient Echo repositioned on `setInterval(4000–7000)`. A
   * fixed cadence is the mechanical tell — regularity is what makes something
   * read as a screensaver rather than a creature. Every drift gets its own delay
   * drawn from this range.
   */
  driftMinMs: 9000,
  driftJitterMs: 7000,

  /** Idle glancing — smaller act than drifting, so more often and jitterier. */
  glanceMinMs: 5200,
  glanceJitterMs: 4300,

  /** How long she keeps "speaking" after the last output arrives. */
  speakingGraceMs: 1400,

  /** Genuine inactivity before she settles. */
  restAfterMs: 2 * 60 * 1000,

  /** Rule 5. Transition duration — she eases, never snaps. */
  settleMs: 420,
});

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * @param {number} now
 * @returns {object} opaque behaviour state — always go through `observe()`
 */
export function createEchoState(now = 0) {
  return Object.freeze({
    hidden: false,
    lastActivityAt: now,
    speakingUntil: 0,
    examining: false,
    reactFrom: 0,
    reactUntil: 0,
    reactIntensity: 0,
    gaze: null,
    // Which way she looks when nothing is being attended to. Owned here rather
    // than by a renderer so both renderers stay dumb — see `describe()`.
    idleFacingLeft: false,
    drift: { x: 0, y: 0 },
  });
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Reduce an event into new state. Pure: every event carries its own `now`, so
 * the same event sequence always produces the same result.
 *
 * Unknown events return the SAME object reference, so a React binding can skip
 * a render rather than re-rendering on every stray dispatch.
 *
 * @param {object} state
 * @param {{type: string, now: number, [k: string]: any}} event
 */
export function reduce(state, event) {
  if (!state || !event || !event.type) return state;
  const now = Number(event.now) || 0;

  switch (event.type) {
    case ECHO_EVENT.ACTIVITY:
      // Any input wakes her. Cheap to fire often, so this must stay a plain
      // timestamp write rather than anything that allocates.
      return { ...state, lastActivityAt: now, hidden: false };

    case ECHO_EVENT.HIDDEN:
      return { ...state, hidden: true };

    case ECHO_EVENT.VISIBLE:
      return { ...state, hidden: false, lastActivityAt: now };

    case ECHO_EVENT.POSEIDON_SPEAKING:
      // Poseidon talking counts as activity: she should not sleep through him.
      return {
        ...state,
        hidden: false,
        lastActivityAt: now,
        speakingUntil: now + (Number(event.durationMs) || TIMING.speakingGraceMs),
      };

    case ECHO_EVENT.POSEIDON_REACTION: {
      const duration = clampReactionDuration(event.durationMs);
      const from = now + TIMING.reactDelayMs;
      return {
        ...state,
        hidden: false,
        lastActivityAt: now,
        reactFrom: from,
        reactUntil: from + duration,
        reactIntensity: reactionIntensity(event),
      };
    }

    case ECHO_EVENT.VISION_START:
      return { ...state, hidden: false, lastActivityAt: now, examining: true };

    case ECHO_EVENT.VISION_END:
      return { ...state, examining: false, lastActivityAt: now };

    case ECHO_EVENT.ATTEND: {
      const dx = Number(event.dx) || 0;
      const dy = Number(event.dy) || 0;
      return { ...state, lastActivityAt: now, gaze: { dx, dy } };
    }

    case ECHO_EVENT.RELEASE:
      return state.gaze === null ? state : { ...state, gaze: null };

    case ECHO_EVENT.DRIFT:
      return {
        ...state,
        drift: { x: Number(event.x) || 0, y: Number(event.y) || 0 },
      };

    case ECHO_EVENT.GLANCE:
      // Idle glancing. A binding schedules these on a jittered delay
      // (`nextGlanceDelay`); the core decides what a glance means.
      return { ...state, idleFacingLeft: !state.idleFacingLeft };

    default:
      return state;
  }
}

/**
 * Collapse the three internal dimensions into one observable state.
 *
 * PRECEDENCE, and why this order:
 *   1. hidden        — a background tab animates nothing, whatever else is true.
 *   2. reacting      — the transient overlay; brief and the most legible thing
 *                      happening, so it wins while its window is open.
 *   3. examining     — vision is a strong, deliberate focus.
 *   4. speaking      — Poseidon delivering.
 *   5. attending     — oriented at something but otherwise quiet.
 *   6. resting/idle  — nothing going on; rest only after real inactivity.
 *
 * @param {object} state
 * @param {number} now
 * @returns {string} one of ECHO_STATE
 */
export function observe(state, now = 0) {
  if (!state) return ECHO_STATE.IDLE;
  if (state.hidden) return ECHO_STATE.RESTING;
  if (now >= state.reactFrom && now < state.reactUntil) return ECHO_STATE.REACTING;
  if (state.examining) return ECHO_STATE.EXAMINING;
  if (now < state.speakingUntil) return ECHO_STATE.SPEAKING;
  if (state.gaze) return ECHO_STATE.ATTENDING;
  if (now - state.lastActivityAt >= TIMING.restAfterMs) return ECHO_STATE.RESTING;
  return ECHO_STATE.IDLE;
}

/**
 * The next instant at which `observe()` could return something different.
 *
 * This is what keeps the React binding to a single scheduled wake-up instead of
 * one timer per concern. Returns `null` when nothing is pending, so the caller
 * can schedule nothing at all — an idle Echo in a quiet tab costs no timers.
 *
 * @returns {number|null} timestamp, or null
 */
export function nextTransitionAt(state, now = 0) {
  if (!state || state.hidden) return null;

  const candidates = [];
  if (state.reactFrom > now) candidates.push(state.reactFrom);
  if (state.reactUntil > now) candidates.push(state.reactUntil);
  if (state.speakingUntil > now) candidates.push(state.speakingUntil);

  // Only worth waking for rest if she is not already resting.
  const restAt = state.lastActivityAt + TIMING.restAfterMs;
  if (restAt > now) candidates.push(restAt);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

// ─── Rule 2: irregular timing ────────────────────────────────────────────────

/**
 * A drift delay, jittered. `random` is injectable so the parity test and the
 * unit tests can pin the distribution rather than hoping.
 *
 * @param {() => number} [random]
 */
export function nextDriftDelay(random = Math.random) {
  return TIMING.driftMinMs + random() * TIMING.driftJitterMs;
}

/**
 * Delay before the next idle glance. Shorter and jitterier than drift — looking
 * around is a smaller act than moving.
 */
export function nextGlanceDelay(random = Math.random) {
  return TIMING.glanceMinMs + random() * TIMING.glanceJitterMs;
}

/**
 * A drift offset inside a small box around her anchor.
 *
 * Deliberately small: she is a presence in the corner, not a pet roaming the
 * viewport. `range` is the half-width in px; vertical travel is squashed because
 * a fish that bobs as far as it slides reads as floating debris.
 */
export function nextDriftOffset(random = Math.random, range = 22) {
  return {
    x: (random() * 2 - 1) * range,
    y: (random() * 2 - 1) * range * 0.6,
  };
}

// ─── Rule 4: proportional response ───────────────────────────────────────────

/** Bound a requested reaction length. See TIMING.reactMaxMs for why. */
export function clampReactionDuration(requested) {
  const ms = Number(requested);
  if (!Number.isFinite(ms) || ms <= 0) return TIMING.reactMinMs * 2;
  return clamp(ms, TIMING.reactMinMs, TIMING.reactMaxMs);
}

/**
 * How big a reaction the news deserves, 0..1.
 *
 * The old renderer fired one fixed `scale(1.12) rotate(8deg)` burst for
 * everything — a water-change log and a hidden easter egg produced identical
 * motion, which is precisely what makes a character feel like a puppet.
 *
 * Derived from the payload that already ships on `poseidon:echo-reaction`:
 *
 *   swimSpeedMultiplier  distance from 1.0 is the caller's own signal of how
 *                        excited it meant to be (0.5 = subdued, 1.5 = lively).
 *                        Both directions count: a deliberate slow-down is as
 *                        strong a statement as a speed-up.
 *   durationMs           a longer request means a bigger moment, contributing
 *                        weakly so a 12-second easter egg does not swamp it.
 *
 * Floors at 0.35: an event worth dispatching is worth seeing.
 */
export function reactionIntensity({ swimSpeedMultiplier, durationMs } = {}) {
  const speed = Number(swimSpeedMultiplier);
  const speedSignal = Number.isFinite(speed) ? clamp(Math.abs(speed - 1) / 0.6, 0, 1) : 0;

  const ms = Number(durationMs);
  const lengthSignal = Number.isFinite(ms) && ms > 0 ? clamp(ms / TIMING.reactMaxMs, 0, 1) : 0;

  return clamp(0.35 + speedSignal * 0.45 + lengthSignal * 0.2, 0, 1);
}

// ─── Rule 1: gaze ────────────────────────────────────────────────────────────

/**
 * Turn an offset to a target into a facing and a lean.
 *
 * Pure geometry only. Measuring where a target actually is on screen is DOM work
 * and belongs to step 4 of the spec; this is the part that has to agree between
 * the app and `database.html`, so it lives here.
 *
 * Rule 1: orientation is the highest-value believability cue. If she turns
 * toward the thing being discussed she reads as aware, and that does more than
 * any amount of animation polish. The tilt is small — a lean, not a pivot — so
 * she still reads as a fish holding position rather than a compass needle.
 *
 * @param {number} dx  target x minus her x (px). Positive = target is right.
 * @param {number} dy  target y minus her y (px). Positive = target is below.
 * @returns {{facingLeft: boolean, tiltDeg: number}}
 */
export function gazeFromOffset(dx = 0, dy = 0) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;

  const facingLeft = x < 0;

  // Tilt tracks the vertical component relative to the horizontal one, so a
  // target far to the side produces almost no tilt while one directly above
  // produces the most. `|x| + 1` avoids a divide-by-zero and keeps it stable
  // when she is directly beneath something.
  const slope = y / (Math.abs(x) + 1);
  const tilt = clamp(slope * 14, -14, 14);

  // Mirrored so a lean reads as "toward" the target regardless of facing.
  return { facingLeft, tiltDeg: facingLeft ? -tilt : tilt };
}

/**
 * Centre-to-centre offset between a target and Echo herself.
 *
 * Takes two DOMRect-shaped objects rather than elements, so the arithmetic — the
 * part that has to agree between the app and `database.html` — is pure and
 * testable while each mount does its own `getBoundingClientRect()`.
 *
 * ONLY THE MOUNT KNOWS WHERE ECHO IS, which is why gaze works this way: a
 * component that wants her attention names an element, and the mount converts
 * that into an offset. A dispatcher computing its own offset would need to know
 * her position, and would go stale the moment she drifted.
 *
 * Returns `null` for a target worth ignoring — nothing there, or zero-sized (an
 * unmounted node, a collapsed container, a `display: none` panel). Null means
 * "don't change where she is looking" rather than "look at the origin", because
 * a zero rect sits at the top-left of the viewport and would yank her gaze to a
 * corner for no reason.
 *
 * @param {{left: number, top: number, width: number, height: number}|null} target
 * @param {{left: number, top: number, width: number, height: number}|null} self
 * @returns {{dx: number, dy: number}|null}
 */
export function offsetBetweenRects(target, self) {
  if (!target || !self) return null;

  const tw = Number(target.width) || 0;
  const th = Number(target.height) || 0;
  if (tw === 0 && th === 0) return null;

  const tx = (Number(target.left) || 0) + tw / 2;
  const ty = (Number(target.top) || 0) + th / 2;
  const sx = (Number(self.left) || 0) + (Number(self.width) || 0) / 2;
  const sy = (Number(self.top) || 0) + (Number(self.height) || 0) / 2;

  return { dx: tx - sx, dy: ty - sy };
}

/**
 * Everything the renderer needs, derived in one call.
 *
 * A single entry point so a surface cannot accidentally read three fields and
 * compose them differently from the next surface — the drift that produced five
 * Echos in the first place.
 */
export function describe(state, now = 0) {
  const observed = observe(state, now);
  const gaze = state?.gaze ? gazeFromOffset(state.gaze.dx, state.gaze.dy) : null;

  return {
    state: observed,
    // Only meaningful while REACTING; zero otherwise so a renderer cannot leak
    // a stale intensity into an idle pose.
    intensity: observed === ECHO_STATE.REACTING ? state.reactIntensity : 0,
    // Rule 5: resting eases everything off rather than freezing mid-motion.
    animate: observed !== ECHO_STATE.RESTING,
    drift: state?.drift || { x: 0, y: 0 },
    // GAZE WINS over idle glancing (rule 1). When she has a target she must not
    // turn away from it on a timer. Always a boolean, never null: a renderer
    // should never have to decide which way she faces.
    facingLeft: gaze ? gaze.facingLeft : Boolean(state?.idleFacingLeft),
    tiltDeg: gaze ? gaze.tiltDeg : 0,
  };
}

// ─── Appearance ──────────────────────────────────────────────────────────────
//
// Spec §8: "Do not build a second renderer." Mounting Echo on `database.html`
// means a vanilla renderer alongside the React one, and the honest way to keep
// that from becoming a second CHARACTER is to leave neither of them any decisions
// to make. Both call these two functions and apply the result verbatim, so they
// cannot drift on art, facing, tilt, or reaction size — the drift that produced
// five Echos in the first place.

/**
 * Transform for the art itself.
 *
 * Mirror THEN tilt, in that order, so a lean reads as "toward the target" on both
 * sides instead of inverting when she turns.
 */
export function artTransform({ facingLeft = false, tiltDeg = 0 } = {}) {
  const parts = [];
  if (facingLeft) parts.push("scaleX(-1)");
  if (tiltDeg) parts.push(`rotate(${Number(tiltDeg).toFixed(1)}deg)`);
  return parts.length ? parts.join(" ") : "none";
}

/**
 * Styles for the wrapper, given a `describe()` result.
 *
 * Returned as plain CSS strings rather than a framework object so the vanilla
 * mount can assign them straight onto `element.style` and React can spread them.
 *
 * The reaction scale and brightness are derived from `intensity` (rule 4), which
 * is why they cannot live in a CSS class: a class can only express one size, and
 * the whole point is that a water-change log and an easter egg look different.
 */
export function wrapperVisuals(view) {
  const v = view || {};
  const reacting = v.state === ECHO_STATE.REACTING;
  const resting = v.state === ECHO_STATE.RESTING;
  const drift = v.drift || { x: 0, y: 0 };
  const intensity = Number(v.intensity) || 0;

  return {
    transform: `translate(${(Number(drift.x) || 0).toFixed(1)}px, ${(Number(drift.y) || 0).toFixed(1)}px)`,
    opacity: resting ? "0.45" : "1",
    scale: reacting ? (1 + intensity * 0.09).toFixed(3) : "1",
    filter: reacting ? `brightness(${(1 + intensity * 0.18).toFixed(2)})` : "none",
    transitionDuration: `${TIMING.settleMs}ms`,
  };
}
