/**
 * echo-behaviour.js — browser mirror of Echo's behaviour core.
 *
 * The Vite app imports the real module at src/services/echoBehaviour.js. The
 * static pages (database.html, species.html) are plain <script> pages that cannot
 * import ESM from src/, so they load this mirror as a global
 * (`window.EchoBehaviour`). Same arrangement as /js/species-catalog.js and
 * /js/sexing-guide.js.
 *
 * Kept in lockstep by the parity test in src/services/echoBehaviour.test.js,
 * which drives BOTH implementations through the same event sequences and asserts
 * they agree at every step. That matters more here than for the other two
 * mirrors: Echo is a character, and a character who behaves differently on the
 * public database page than in the app is two characters. Producing five Echos
 * once was enough.
 *
 * Mirror the whole core — states, timing, reducer, derivations. There is no
 * app-only half.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest parity test
  }
  root.EchoBehaviour = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var ECHO_STATE = {
    RESTING: "resting",
    IDLE: "idle",
    ATTENDING: "attending",
    SPEAKING: "speaking",
    EXAMINING: "examining",
    REACTING: "reacting",
  };

  var ECHO_EVENT = {
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
  };

  // Echo, as vector art. MIRROR of ECHO_SVG in src/services/echoBehaviour.js —
  // see that file for why she is a string rather than an .svg file or a component.
  // These bytes must match character for character; `echoBehaviour.test.js` asserts
  // it, because a silent edit to one copy is how one character becomes two.
  //
  // Every part carries a class and /css/echo.css moves them per state, so the
  // expressions cost no plumbing on this side.
  var ECHO_SVG = `<svg class="echo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false" overflow="visible">
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

  var TIMING = {
    reactDelayMs: 250,
    reactMinMs: 400,
    reactMaxMs: 2200,
    driftMinMs: 9000,
    driftJitterMs: 7000,
    glanceMinMs: 5200,
    glanceJitterMs: 4300,
    speakingGraceMs: 1400,
    restAfterMs: 2 * 60 * 1000,
    settleMs: 420,
  };

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  function createEchoState(now) {
    now = Number(now) || 0;
    return {
      hidden: false,
      lastActivityAt: now,
      speakingUntil: 0,
      examining: false,
      reactFrom: 0,
      reactUntil: 0,
      reactIntensity: 0,
      gaze: null,
      idleFacingLeft: false,
      drift: { x: 0, y: 0 },
    };
  }

  function clampReactionDuration(requested) {
    var ms = Number(requested);
    if (!isFinite(ms) || ms <= 0) return TIMING.reactMinMs * 2;
    return clamp(ms, TIMING.reactMinMs, TIMING.reactMaxMs);
  }

  function reactionIntensity(payload) {
    payload = payload || {};
    var speed = Number(payload.swimSpeedMultiplier);
    var speedSignal = isFinite(speed) ? clamp(Math.abs(speed - 1) / 0.6, 0, 1) : 0;

    var ms = Number(payload.durationMs);
    var lengthSignal = isFinite(ms) && ms > 0 ? clamp(ms / TIMING.reactMaxMs, 0, 1) : 0;

    return clamp(0.35 + speedSignal * 0.45 + lengthSignal * 0.2, 0, 1);
  }

  function assign(state, patch) {
    var out = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) out[k] = state[k];
    for (var p in patch) if (Object.prototype.hasOwnProperty.call(patch, p)) out[p] = patch[p];
    return out;
  }

  function reduce(state, event) {
    if (!state || !event || !event.type) return state;
    var now = Number(event.now) || 0;

    switch (event.type) {
      case ECHO_EVENT.ACTIVITY:
        return assign(state, { lastActivityAt: now, hidden: false });

      case ECHO_EVENT.HIDDEN:
        return assign(state, { hidden: true });

      case ECHO_EVENT.VISIBLE:
        return assign(state, { hidden: false, lastActivityAt: now });

      case ECHO_EVENT.POSEIDON_SPEAKING:
        return assign(state, {
          hidden: false,
          lastActivityAt: now,
          speakingUntil: now + (Number(event.durationMs) || TIMING.speakingGraceMs),
        });

      case ECHO_EVENT.POSEIDON_REACTION: {
        var duration = clampReactionDuration(event.durationMs);
        var from = now + TIMING.reactDelayMs;
        return assign(state, {
          hidden: false,
          lastActivityAt: now,
          reactFrom: from,
          reactUntil: from + duration,
          reactIntensity: reactionIntensity(event),
        });
      }

      case ECHO_EVENT.VISION_START:
        return assign(state, { hidden: false, lastActivityAt: now, examining: true });

      case ECHO_EVENT.VISION_END:
        return assign(state, { examining: false, lastActivityAt: now });

      case ECHO_EVENT.ATTEND:
        return assign(state, {
          lastActivityAt: now,
          gaze: { dx: Number(event.dx) || 0, dy: Number(event.dy) || 0 },
        });

      case ECHO_EVENT.RELEASE:
        return state.gaze === null ? state : assign(state, { gaze: null });

      case ECHO_EVENT.DRIFT:
        return assign(state, {
          drift: { x: Number(event.x) || 0, y: Number(event.y) || 0 },
        });

      case ECHO_EVENT.GLANCE:
        return assign(state, { idleFacingLeft: !state.idleFacingLeft });

      default:
        return state;
    }
  }

  function observe(state, now) {
    now = Number(now) || 0;
    if (!state) return ECHO_STATE.IDLE;
    if (state.hidden) return ECHO_STATE.RESTING;
    if (now >= state.reactFrom && now < state.reactUntil) return ECHO_STATE.REACTING;
    if (state.examining) return ECHO_STATE.EXAMINING;
    if (now < state.speakingUntil) return ECHO_STATE.SPEAKING;
    if (state.gaze) return ECHO_STATE.ATTENDING;
    if (now - state.lastActivityAt >= TIMING.restAfterMs) return ECHO_STATE.RESTING;
    return ECHO_STATE.IDLE;
  }

  function nextTransitionAt(state, now) {
    now = Number(now) || 0;
    if (!state || state.hidden) return null;

    var candidates = [];
    if (state.reactFrom > now) candidates.push(state.reactFrom);
    if (state.reactUntil > now) candidates.push(state.reactUntil);
    if (state.speakingUntil > now) candidates.push(state.speakingUntil);

    var restAt = state.lastActivityAt + TIMING.restAfterMs;
    if (restAt > now) candidates.push(restAt);

    if (candidates.length === 0) return null;
    return Math.min.apply(Math, candidates);
  }

  function nextDriftDelay(random) {
    random = random || Math.random;
    return TIMING.driftMinMs + random() * TIMING.driftJitterMs;
  }

  function nextGlanceDelay(random) {
    random = random || Math.random;
    return TIMING.glanceMinMs + random() * TIMING.glanceJitterMs;
  }

  function nextDriftOffset(random, range) {
    random = random || Math.random;
    range = range === undefined ? 22 : range;
    return {
      x: (random() * 2 - 1) * range,
      y: (random() * 2 - 1) * range * 0.6,
    };
  }

  function gazeFromOffset(dx, dy) {
    var x = Number(dx) || 0;
    var y = Number(dy) || 0;
    var facingLeft = x < 0;
    var slope = y / (Math.abs(x) + 1);
    var tilt = clamp(slope * 14, -14, 14);
    return { facingLeft: facingLeft, tiltDeg: facingLeft ? -tilt : tilt };
  }

  function offsetBetweenRects(target, self) {
    if (!target || !self) return null;

    var tw = Number(target.width) || 0;
    var th = Number(target.height) || 0;
    if (tw === 0 && th === 0) return null;

    var tx = (Number(target.left) || 0) + tw / 2;
    var ty = (Number(target.top) || 0) + th / 2;
    var sx = (Number(self.left) || 0) + (Number(self.width) || 0) / 2;
    var sy = (Number(self.top) || 0) + (Number(self.height) || 0) / 2;

    return { dx: tx - sx, dy: ty - sy };
  }

  function describe(state, now) {
    now = Number(now) || 0;
    var observed = observe(state, now);
    var gaze = state && state.gaze ? gazeFromOffset(state.gaze.dx, state.gaze.dy) : null;

    return {
      state: observed,
      intensity: observed === ECHO_STATE.REACTING ? state.reactIntensity : 0,
      animate: observed !== ECHO_STATE.RESTING,
      drift: (state && state.drift) || { x: 0, y: 0 },
      facingLeft: gaze ? gaze.facingLeft : Boolean(state && state.idleFacingLeft),
      tiltDeg: gaze ? gaze.tiltDeg : 0,
    };
  }

  function artTransform(view) {
    view = view || {};
    var parts = [];
    if (view.facingLeft) parts.push("scaleX(-1)");
    if (view.tiltDeg) parts.push("rotate(" + Number(view.tiltDeg).toFixed(1) + "deg)");
    return parts.length ? parts.join(" ") : "none";
  }

  function wrapperVisuals(view) {
    var v = view || {};
    var reacting = v.state === ECHO_STATE.REACTING;
    var resting = v.state === ECHO_STATE.RESTING;
    var drift = v.drift || { x: 0, y: 0 };
    var intensity = Number(v.intensity) || 0;

    return {
      transform:
        "translate(" + (Number(drift.x) || 0).toFixed(1) + "px, " +
        (Number(drift.y) || 0).toFixed(1) + "px)",
      opacity: resting ? "0.45" : "1",
      scale: reacting ? (1 + intensity * 0.09).toFixed(3) : "1",
      filter: reacting ? "brightness(" + (1 + intensity * 0.18).toFixed(2) + ")" : "none",
      transitionDuration: TIMING.settleMs + "ms",
    };
  }

  return {
    ECHO_STATE: ECHO_STATE,
    ECHO_EVENT: ECHO_EVENT,
    TIMING: TIMING,
    ECHO_SVG: ECHO_SVG,
    artTransform: artTransform,
    wrapperVisuals: wrapperVisuals,
    nextGlanceDelay: nextGlanceDelay,
    createEchoState: createEchoState,
    reduce: reduce,
    observe: observe,
    nextTransitionAt: nextTransitionAt,
    nextDriftDelay: nextDriftDelay,
    nextDriftOffset: nextDriftOffset,
    clampReactionDuration: clampReactionDuration,
    reactionIntensity: reactionIntensity,
    gazeFromOffset: gazeFromOffset,
    offsetBetweenRects: offsetBetweenRects,
    describe: describe,
  };
});
