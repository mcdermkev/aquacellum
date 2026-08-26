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
 * Echo, as vector art. One constant, one character, every surface.
 *
 * Step 7 of docs/ECHO_CHARACTER_SPEC.md, and what `docs/BRAND_KIT.md` asked for
 * all along: *"Animated SVG with brand teal/violet palette… playful, organic
 * shapes — intentionally 'gamey'"*. The old implementation was a 2 MB photographic
 * PNG, which is neither of those things.
 *
 * WHY A STRING IN THE CORE, and not an .svg file or a JSX component:
 *
 *   - An `<img src="echo.svg">` is opaque to CSS, so expressions would need one
 *     file per state and we would be back to seven images.
 *   - A JSX component cannot be used by `database.html`, and duplicating it in the
 *     vanilla mount is the second-renderer trap (spec §8) in its purest form.
 *   - As one string in the core, both mounts inject the SAME bytes. The parity
 *     test asserts the app and the static page hold an identical string, so they
 *     cannot drift into two characters.
 *
 * Safe to inject: this is a static literal with no interpolation and no user
 * input, which is the one case where setting innerHTML is not a smell.
 *
 * EXPRESSIONS ARE CSS, NOT MARKUP. Every part carries a class, and
 * `/css/echo.css` moves them per state using the `.echo-ambient--{state}` wrapper
 * both mounts already set. So the six states in this module get six faces for
 * free, with no extra plumbing and nothing to keep in sync — and a state added to
 * the machine later needs only a CSS rule, not new art.
 *
 * Drawn facing RIGHT at 100×100; `artTransform()` mirrors her when she looks left.
 */
export const ECHO_SVG = `<svg class="echo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false" overflow="visible">
<defs>
<radialGradient id="echoBody" cx="64%" cy="36%" r="70%">
<stop offset="0%" stop-color="#7ff3e4"/><stop offset="40%" stop-color="#2dd4bf"/><stop offset="100%" stop-color="#0e9488"/>
</radialGradient>
<linearGradient id="echoFin" x1="100%" y1="42%" x2="0%" y2="58%">
<stop offset="0%" stop-color="#22d3ee" stop-opacity="0.94"/><stop offset="48%" stop-color="#67e8f9" stop-opacity="0.7"/><stop offset="100%" stop-color="#a78bfa" stop-opacity="0.9"/>
</linearGradient>
<linearGradient id="echoFinDorsal" x1="52%" y1="100%" x2="40%" y2="0%">
<stop offset="0%" stop-color="#22d3ee" stop-opacity="0.92"/><stop offset="100%" stop-color="#a78bfa" stop-opacity="0.88"/>
</linearGradient>
<linearGradient id="echoFinPectoral" x1="72%" y1="0%" x2="22%" y2="100%">
<stop offset="0%" stop-color="#22d3ee" stop-opacity="0.92"/><stop offset="100%" stop-color="#a78bfa" stop-opacity="0.86"/>
</linearGradient>
<radialGradient id="echoAura" cx="50%" cy="50%" r="50%">
<stop offset="55%" stop-color="#2dd4bf" stop-opacity="0"/><stop offset="100%" stop-color="#5eead4" stop-opacity="0.22"/>
</radialGradient>
<radialGradient id="echoIris" cx="38%" cy="32%" r="64%">
<stop offset="0%" stop-color="#ccfbf1"/><stop offset="26%" stop-color="#2dd4bf"/><stop offset="70%" stop-color="#0f766e"/><stop offset="100%" stop-color="#134e4a"/>
</radialGradient>
<filter id="echoGlow" x="-55%" y="-55%" width="210%" height="210%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="2.35" result="blur"/>
<feFlood flood-color="#22d3ee" flood-opacity="0.84" result="color"/>
<feComposite in="color" in2="blur" operator="in" result="glow"/>
<feGaussianBlur in="glow" stdDeviation="1.1" result="soft"/>
<feMerge>
<feMergeNode in="soft"/>
<feMergeNode in="glow"/>
</feMerge>
</filter>
</defs>
<circle class="echo-aura" cx="50" cy="50" r="46" fill="url(#echoAura)"/>
<g filter="url(#echoGlow)" aria-hidden="true">
<path d="M32 45 C22 34 12 23 6 19 C3 18 2 23 4 29 C7 38 12 44 17 47 C13 49 13 52 17 54 C12 57 6 64 4 74 C3 82 6 90 11 92 C14 90 16 82 20 72 C24 64 28 58 32 55 C32.3 51.5 32.3 48 32 45 Z" fill="#22d3ee"/>
<path d="M42 34.8 C37 22 41 10 52 7 C61 4.5 69 8 73 15.5 C71 22 68 28.5 65 33.8 C57 35.6 49 36 42 34.8 Z" fill="#22d3ee"/>
<path d="M58 60 C52 66 48 76 50 84 C58 80 66 70 68 62 C65 59.5 61 58.5 58 60 Z" fill="#22d3ee"/>
<path d="M88 51 C87 42 80 34 68 31 C55 28 42 31 34 39 C29 44 27 49 28 54 C29 61 36 69 50 72 C64 75 78 70 85 62 C90 56 89 53 88 51 Z" fill="#22d3ee"/>
</g>
<g class="echo-tail">
<path d="M32 45 C22 34 12 23 6 19 C3 18 2 23 4 29 C7 38 12 44 17 47 C13 49 13 52 17 54 C12 57 6 64 4 74 C3 82 6 90 11 92 C14 90 16 82 20 72 C24 64 28 58 32 55 C32.3 51.5 32.3 48 32 45 Z" fill="url(#echoFin)"/>
<path d="M31.4 47.5 C22 38 13 28 7.5 22" fill="none" stroke="#22d3ee" stroke-width="0.7" stroke-linecap="round" opacity="0.55"/>
<path d="M31.4 50 C21 50 13 54 8 64" fill="none" stroke="#67e8f9" stroke-width="0.65" stroke-linecap="round" opacity="0.45"/>
<path d="M31.4 52.5 C23 62 16 76 12 88" fill="none" stroke="#a78bfa" stroke-width="0.65" stroke-linecap="round" opacity="0.48"/>
</g>
<g class="echo-fin-dorsal">
<path d="M42 34.8 C37 22 41 10 52 7 C61 4.5 69 8 73 15.5 C71 22 68 28.5 65 33.8 C57 35.6 49 36 42 34.8 Z" fill="url(#echoFinDorsal)"/>
<path d="M48 34.2 C46 24 47 14 51 9" fill="none" stroke="#22d3ee" stroke-width="0.55" stroke-linecap="round" opacity="0.5"/>
<path d="M55.5 34.4 C56.5 24 59 14 63 10.5" fill="none" stroke="#67e8f9" stroke-width="0.55" stroke-linecap="round" opacity="0.45"/>
<path d="M62 34 C64.5 26 68 18 72 15" fill="none" stroke="#a78bfa" stroke-width="0.5" stroke-linecap="round" opacity="0.42"/>
</g>
<g class="echo-fin-pectoral">
<path d="M58 60 C52 66 48 76 50 84 C58 80 66 70 68 62 C65 59.5 61 58.5 58 60 Z" fill="url(#echoFinPectoral)"/>
<path d="M58.6 62.2 C54 70 51 78 51.5 83.5" fill="none" stroke="#22d3ee" stroke-width="0.55" stroke-linecap="round" opacity="0.48"/>
<path d="M61 62 C61.2 71 63.5 78 66 82" fill="none" stroke="#a78bfa" stroke-width="0.5" stroke-linecap="round" opacity="0.38"/>
</g>
<path class="echo-body" d="M88 51 C87 42 80 34 68 31 C55 28 42 31 34 39 C29 44 27 49 28 54 C29 61 36 69 50 72 C64 75 78 70 85 62 C90 56 89 53 88 51 Z" fill="url(#echoBody)"/>
<path d="M40 38 C54 30.5 70 31 84 41.5" fill="none" stroke="#a5f3fc" stroke-width="1.25" stroke-linecap="round" opacity="0.38"/>
<path class="echo-sheen" d="M42 40 C54 32.5 69 32.5 81 41 C69 36.5 54 36.5 42 41 Z" fill="#e8fffb" opacity="0.42"/>
<g class="echo-spots" fill="#fbbf24" stroke="#fbbf24">
<path d="M83.8 41.2 C87.2 45.4 86.8 52.2 82.6 56.8 C78.4 61.2 71.6 62.8 66.2 60.4" fill="none" stroke-width="1.55" stroke-linecap="round"/>
<path d="M39 45.2 L49.5 45.2 L53.2 48.8 L61.8 48.8" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M41.5 52.4 L52.2 52.4 L56.4 48.6" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M43.5 59 L53.8 59 L57.4 55.6" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="83.8" cy="41.2" r="1.4" stroke="none"/>
<circle cx="66.2" cy="60.4" r="1.4" stroke="none"/>
<circle cx="39" cy="45.2" r="1.45" stroke="none"/>
<circle cx="61.8" cy="48.8" r="1.35" stroke="none"/>
<circle cx="41.5" cy="52.4" r="1.4" stroke="none"/>
<circle cx="56.4" cy="48.6" r="1.3" stroke="none"/>
<circle cx="43.5" cy="59" r="1.4" stroke="none"/>
<circle cx="57.4" cy="55.6" r="1.3" stroke="none"/>
</g>
<g class="echo-eye">
<circle class="echo-eye-white" cx="75.4" cy="47" r="9.3" fill="#071c22"/>
<circle class="echo-eye-iris" cx="76.6" cy="47" r="5.75" fill="url(#echoIris)"/>
<circle class="echo-eye-pupil" cx="77.8" cy="47" r="3.2" fill="#02090b"/>
<circle class="echo-eye-glint" cx="79" cy="44.2" r="2.25" fill="#ffffff" opacity="0.96"/>
<circle cx="73.1" cy="50.2" r="0.85" fill="#ffffff" opacity="0.55"/>
<circle class="echo-eye-lid" cx="75.4" cy="47" r="9.8" fill="#35d8c4" transform="translate(75.4 47) scale(1 0) translate(-75.4 -47)"/>
</g>
<path class="echo-mouth" d="M87.2 55.6 C84.2 58 80.4 57.8 78 55.8" stroke="#0b2b2f" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.55"/>
</svg>`;

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
