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
  var ECHO_SVG = `<svg class="echo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false">
<defs>
<radialGradient id="echoBody" cx="62%" cy="40%" r="70%">
<stop offset="0%" stop-color="#7ff3e4"/><stop offset="52%" stop-color="#2dd4bf"/><stop offset="100%" stop-color="#0e9488"/>
</radialGradient>
<linearGradient id="echoFin" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.78"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.5"/>
</linearGradient>
<radialGradient id="echoAura" cx="50%" cy="50%" r="50%">
<stop offset="55%" stop-color="#2dd4bf" stop-opacity="0"/><stop offset="100%" stop-color="#5eead4" stop-opacity="0.22"/>
</radialGradient>
</defs>
<circle class="echo-aura" cx="50" cy="50" r="46" fill="url(#echoAura)"/>
<g class="echo-tail">
<path d="M6 25 C11 40 11 60 6 75 C14 66 21 57 28 50 C21 43 14 34 6 25 Z" fill="url(#echoFin)"/>
</g>
<g class="echo-fin-dorsal">
<path d="M59 36 C55 22 46 14 37 17 C45 23 51 29 54 38 Z" fill="url(#echoFin)"/>
</g>
<g class="echo-fin-pectoral">
<path d="M60 62 C56 74 48 83 39 80 C46 73 53 67 56 61 Z" fill="url(#echoFin)"/>
</g>
<path class="echo-body" d="M87 50 C86 43 80 36 68 32 C56 28 42 30 32 37 C26 41 22 46 22 50 C22 54 26 59 32 63 C42 70 56 72 68 68 C80 64 86 57 87 50 Z" fill="url(#echoBody)"/>
<path class="echo-sheen" d="M40 38 C50 33 63 34 72 40 C62 37 50 37 41 40 Z" fill="#e8fffb" opacity="0.5"/>
<g class="echo-spots" fill="#5eead4">
<circle cx="44" cy="45" r="2.1" opacity="0.75"/>
<circle cx="37" cy="52" r="1.7" opacity="0.6"/>
<circle cx="47" cy="57" r="1.5" opacity="0.55"/>
</g>
<g class="echo-eye">
<circle class="echo-eye-white" cx="70" cy="45" r="6.4" fill="#0b2b2f"/>
<circle class="echo-eye-iris" cx="71" cy="45" r="4.2" fill="#5eead4"/>
<circle class="echo-eye-pupil" cx="72" cy="45" r="2.2" fill="#04181b"/>
<circle class="echo-eye-glint" cx="73.4" cy="43" r="1.2" fill="#ffffff" opacity="0.9"/>
<circle class="echo-eye-lid" cx="70" cy="45" r="6.9" fill="#35d8c4"/>
</g>
<path class="echo-mouth" d="M83 54 C80 56 77 56 75 55" stroke="#0b2b2f" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.55"/>
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
