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

  // Placeholder art until step 7. In the core so the swap cannot be done for the
  // app while leaving database.html on the old picture.
  var ECHO_ART = "/echo-stages/stage-4-adult.png?v1";

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
    ECHO_ART: ECHO_ART,
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
