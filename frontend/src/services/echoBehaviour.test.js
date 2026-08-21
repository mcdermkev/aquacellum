/**
 * echoBehaviour.test.js
 *
 * The five timing rules from docs/ECHO_CHARACTER_SPEC.md §4, asserted rather than
 * eyeballed. Timing is the whole feature — "behaves believably" is a motion
 * problem — and it is exactly the kind of thing that cannot be reviewed by
 * reading a diff. Hence a pure core.
 *
 * Also pins the lockstep with /js/echo-behaviour.js, the mirror database.html
 * loads. Echo is a character; one who behaves differently on the public page than
 * in the app is two characters, and this project has already shipped five.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ECHO_STATE,
  ECHO_EVENT,
  TIMING,
  createEchoState,
  reduce,
  observe,
  nextTransitionAt,
  nextDriftDelay,
  nextDriftOffset,
  clampReactionDuration,
  reactionIntensity,
  gazeFromOffset,
  describe as describeEcho,
} from "./echoBehaviour.js";

/** Apply a sequence of events, threading state through. */
const run = (events, t0 = 0) => events.reduce((s, e) => reduce(s, e), createEchoState(t0));

describe("she starts idle and present", () => {
  it("is idle at t0, not resting", () => {
    // A guide who begins asleep is a guide you never notice.
    expect(observe(createEchoState(0), 0)).toBe(ECHO_STATE.IDLE);
  });

  it("needs no per-account state to exist", () => {
    // The whole point of the rework: no DNA, no needs, no XP gate. Anyone can
    // construct her from a timestamp.
    expect(createEchoState(0)).toBeTruthy();
  });
});

describe("rule 3 — she reacts a beat late", () => {
  const at = (now) =>
    observe(
      reduce(createEchoState(0), { type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 900 }),
      now
    );

  it("is NOT reacting on the same frame as the event", () => {
    // THE RULE. Reacting simultaneously reads as scripted; a beat later reads as
    // reacting *to* him.
    expect(at(0)).not.toBe(ECHO_STATE.REACTING);
  });

  it("is still not reacting just before the delay elapses", () => {
    expect(at(TIMING.reactDelayMs - 1)).not.toBe(ECHO_STATE.REACTING);
  });

  it("reacts once the delay has elapsed", () => {
    expect(at(TIMING.reactDelayMs)).toBe(ECHO_STATE.REACTING);
    expect(at(TIMING.reactDelayMs + 400)).toBe(ECHO_STATE.REACTING);
  });

  it("stops reacting when the window closes", () => {
    expect(at(TIMING.reactDelayMs + 900)).not.toBe(ECHO_STATE.REACTING);
  });

  it("implements the delay as data, not a timer", () => {
    // If this ever becomes a setTimeout the parity mirror cannot reproduce it and
    // these tests need fake timers. Two integers instead.
    const s = reduce(createEchoState(0), { type: ECHO_EVENT.POSEIDON_REACTION, now: 1000, durationMs: 800 });
    expect(s.reactFrom).toBe(1000 + TIMING.reactDelayMs);
    expect(s.reactUntil).toBe(1000 + TIMING.reactDelayMs + 800);
  });
});

describe("rule 4 — the response is proportional and bounded", () => {
  it("clamps the 12-second easter-egg payload that actually ships", () => {
    // SpecimenDetailModal dispatches durationMs: 12000 for its golden glow.
    // Twelve seconds is a pose, not a reaction.
    expect(clampReactionDuration(12000)).toBe(TIMING.reactMaxMs);
  });

  it("floors a flicker so a dispatched event is always visible", () => {
    expect(clampReactionDuration(50)).toBe(TIMING.reactMinMs);
  });

  it("survives a missing or nonsense duration", () => {
    for (const bad of [undefined, null, 0, -1, NaN, "soon"]) {
      const ms = clampReactionDuration(bad);
      expect(ms, String(bad)).toBeGreaterThanOrEqual(TIMING.reactMinMs);
      expect(ms).toBeLessThanOrEqual(TIMING.reactMaxMs);
    }
  });

  it("scales intensity with how excited the caller said to be", () => {
    // The old renderer used one fixed burst for everything, so a water-change log
    // and a hidden easter egg produced identical motion.
    const calm = reactionIntensity({ swimSpeedMultiplier: 1.0, durationMs: 600 });
    const lively = reactionIntensity({ swimSpeedMultiplier: 1.5, durationMs: 600 });
    expect(lively).toBeGreaterThan(calm);
  });

  it("treats a deliberate slow-down as strong too", () => {
    // BreedGallery's "vacuum" egg dispatches swimSpeedMultiplier: 0.5. Going
    // conspicuously still is as much a statement as speeding up, so distance from
    // 1.0 is what counts — not direction.
    const slow = reactionIntensity({ swimSpeedMultiplier: 0.5, durationMs: 5000 });
    const neutral = reactionIntensity({ swimSpeedMultiplier: 1.0, durationMs: 5000 });
    expect(slow).toBeGreaterThan(neutral);
  });

  it("never returns an invisible or overdriven intensity", () => {
    const payloads = [
      {},
      { swimSpeedMultiplier: 1 },
      { swimSpeedMultiplier: 99, durationMs: 99999 },
      { swimSpeedMultiplier: -5, durationMs: -5 },
      { swimSpeedMultiplier: "fast", durationMs: "long" },
    ];
    for (const p of payloads) {
      const i = reactionIntensity(p);
      expect(i, JSON.stringify(p)).toBeGreaterThanOrEqual(0.35);
      expect(i).toBeLessThanOrEqual(1);
    }
  });

  it("reports intensity only while actually reacting", () => {
    const s = reduce(createEchoState(0), {
      type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 900, swimSpeedMultiplier: 1.5,
    });
    expect(describeEcho(s, TIMING.reactDelayMs).intensity).toBeGreaterThan(0);
    // Before the beat, and after the window, a renderer must not read a stale value.
    expect(describeEcho(s, 0).intensity).toBe(0);
    expect(describeEcho(s, 99999).intensity).toBe(0);
  });
});

describe("rule 2 — nothing on a fixed interval", () => {
  it("draws a different delay each time", () => {
    // The old ambient Echo repositioned on setInterval(4000–7000), which is the
    // mechanical tell: regularity reads as a screensaver.
    const delays = new Set();
    for (let i = 0; i < 40; i++) delays.add(nextDriftDelay());
    expect(delays.size).toBeGreaterThan(30);
  });

  it("stays inside the configured range", () => {
    for (const r of [() => 0, () => 0.5, () => 0.999]) {
      const d = nextDriftDelay(r);
      expect(d).toBeGreaterThanOrEqual(TIMING.driftMinMs);
      expect(d).toBeLessThanOrEqual(TIMING.driftMinMs + TIMING.driftJitterMs);
    }
  });

  it("squashes vertical drift so she reads as a fish, not debris", () => {
    const o = nextDriftOffset(() => 1, 22);
    expect(Math.abs(o.y)).toBeLessThan(Math.abs(o.x));
  });

  it("keeps drift near the anchor", () => {
    for (let i = 0; i < 25; i++) {
      const o = nextDriftOffset(Math.random, 22);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(22);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(22);
    }
  });
});

describe("rule 1 — gaze is the highest-value cue", () => {
  it("faces the side the target is on", () => {
    expect(gazeFromOffset(-200, 0).facingLeft).toBe(true);
    expect(gazeFromOffset(200, 0).facingLeft).toBe(false);
  });

  it("barely tilts for a target far to the side", () => {
    // A lean, not a compass needle.
    expect(Math.abs(gazeFromOffset(600, 40).tiltDeg)).toBeLessThan(3);
  });

  it("tilts most for a target directly above or below", () => {
    const overhead = Math.abs(gazeFromOffset(0, -300).tiltDeg);
    const sideways = Math.abs(gazeFromOffset(600, -300).tiltDeg);
    expect(overhead).toBeGreaterThan(sideways);
  });

  it("never exceeds a lean", () => {
    for (const [dx, dy] of [[0, 9999], [0, -9999], [1, 5000], [-1, -5000]]) {
      expect(Math.abs(gazeFromOffset(dx, dy).tiltDeg)).toBeLessThanOrEqual(14);
    }
  });

  it("survives being directly on top of the target", () => {
    const g = gazeFromOffset(0, 0);
    expect(Number.isFinite(g.tiltDeg)).toBe(true);
    expect(g.tiltDeg).toBe(0);
  });

  it("reports attending, and stops when released", () => {
    const attending = run([{ type: ECHO_EVENT.ATTEND, now: 0, dx: -100, dy: -50 }]);
    expect(observe(attending, 0)).toBe(ECHO_STATE.ATTENDING);
    expect(describeEcho(attending, 0).facingLeft).toBe(true);

    const released = reduce(attending, { type: ECHO_EVENT.RELEASE, now: 1 });
    expect(observe(released, 1)).toBe(ECHO_STATE.IDLE);
    expect(describeEcho(released, 1).facingLeft).toBeNull();
  });
});

describe("rule 5 — she eases, never snaps", () => {
  it("publishes a settle duration for the renderer to transition over", () => {
    expect(TIMING.settleMs).toBeGreaterThan(200);
  });

  it("stops animating only when resting", () => {
    const idle = createEchoState(0);
    expect(describeEcho(idle, 0).animate).toBe(true);
    expect(describeEcho(reduce(idle, { type: ECHO_EVENT.HIDDEN, now: 0 }), 0).animate).toBe(false);
  });
});

describe("state precedence", () => {
  it("a hidden tab rests regardless of everything else", () => {
    const s = run([
      { type: ECHO_EVENT.VISION_START, now: 0 },
      { type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 2000 },
      { type: ECHO_EVENT.HIDDEN, now: 0 },
    ]);
    expect(observe(s, TIMING.reactDelayMs)).toBe(ECHO_STATE.RESTING);
    // And nothing is scheduled — an idle Echo in a background tab costs no timers.
    expect(nextTransitionAt(s, 0)).toBeNull();
  });

  it("a reaction overlays examining rather than replacing it", () => {
    const s = run([
      { type: ECHO_EVENT.VISION_START, now: 0 },
      { type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 800 },
    ]);
    expect(observe(s, TIMING.reactDelayMs)).toBe(ECHO_STATE.REACTING);
    // Still examining underneath — it resumes when the flash ends.
    expect(observe(s, TIMING.reactDelayMs + 800)).toBe(ECHO_STATE.EXAMINING);
  });

  it("examining outranks speaking", () => {
    const s = run([
      { type: ECHO_EVENT.POSEIDON_SPEAKING, now: 0, durationMs: 5000 },
      { type: ECHO_EVENT.VISION_START, now: 0 },
    ]);
    expect(observe(s, 100)).toBe(ECHO_STATE.EXAMINING);
  });

  it("she can attend while Poseidon speaks — the flat-enum problem", () => {
    // Modelling six mutually exclusive states forced an answer to "speaking or
    // attending?" that no observer would ask. Attention is orthogonal: SPEAKING
    // wins the label, and the gaze still drives her facing.
    const s = run([
      { type: ECHO_EVENT.ATTEND, now: 0, dx: -300, dy: 0 },
      { type: ECHO_EVENT.POSEIDON_SPEAKING, now: 0, durationMs: 3000 },
    ]);
    const d = describeEcho(s, 100);
    expect(d.state).toBe(ECHO_STATE.SPEAKING);
    expect(d.facingLeft).toBe(true);
  });

  it("rests after real inactivity, and any input wakes her", () => {
    const idle = createEchoState(0);
    expect(observe(idle, TIMING.restAfterMs)).toBe(ECHO_STATE.RESTING);

    const woken = reduce(idle, { type: ECHO_EVENT.ACTIVITY, now: TIMING.restAfterMs });
    expect(observe(woken, TIMING.restAfterMs)).toBe(ECHO_STATE.IDLE);
  });

  it("Poseidon speaking counts as activity so she cannot sleep through him", () => {
    const s = reduce(createEchoState(0), {
      type: ECHO_EVENT.POSEIDON_SPEAKING, now: TIMING.restAfterMs + 5000, durationMs: 1000,
    });
    expect(observe(s, TIMING.restAfterMs + 5100)).toBe(ECHO_STATE.SPEAKING);
  });
});

describe("nextTransitionAt keeps the React binding to one timer", () => {
  it("returns null when nothing is pending but rest", () => {
    // Already resting: nothing left to wake for.
    const s = createEchoState(0);
    expect(nextTransitionAt(s, TIMING.restAfterMs + 1)).toBeNull();
  });

  it("returns the soonest of several pending transitions", () => {
    const s = run([
      { type: ECHO_EVENT.POSEIDON_SPEAKING, now: 0, durationMs: 5000 },
      { type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 800 },
    ]);
    // reactFrom (250) is sooner than reactUntil (1050) or speakingUntil (5000).
    expect(nextTransitionAt(s, 0)).toBe(TIMING.reactDelayMs);
  });

  it("advances as each transition passes", () => {
    const s = reduce(createEchoState(0), { type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 800 });
    expect(nextTransitionAt(s, TIMING.reactDelayMs)).toBe(TIMING.reactDelayMs + 800);
  });
});

describe("the reducer is pure and cheap", () => {
  it("returns the SAME reference for an unknown event", () => {
    // So a React binding can skip a render rather than re-rendering on stray
    // dispatches.
    const s = createEchoState(0);
    expect(reduce(s, { type: "nonsense", now: 1 })).toBe(s);
    expect(reduce(s, null)).toBe(s);
  });

  it("returns the same reference for a redundant release", () => {
    const s = createEchoState(0);
    expect(reduce(s, { type: ECHO_EVENT.RELEASE, now: 1 })).toBe(s);
  });

  it("never mutates the state it is given", () => {
    const s = createEchoState(0);
    const snapshot = JSON.stringify(s);
    reduce(s, { type: ECHO_EVENT.POSEIDON_REACTION, now: 5, durationMs: 900 });
    reduce(s, { type: ECHO_EVENT.ATTEND, now: 5, dx: 10, dy: 10 });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("reads no clock of its own", () => {
    // Every event carries `now`, so the same sequence always produces the same
    // result. This is what makes the parity test below possible at all.
    const src = readFileSync(fileURLToPath(new URL("./echoBehaviour.js", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/Date\.now\(/);
    expect(code).not.toMatch(/setTimeout|setInterval/);
  });
});

describe("public browser mirror stays in lockstep", () => {
  let mirror;
  try {
    const src = readFileSync(
      fileURLToPath(new URL("../../public/js/echo-behaviour.js", import.meta.url)),
      "utf8"
    );
    const fakeRoot = {};
    const mod = { exports: {} };
    new Function("module", "window", "globalThis", src)(mod, fakeRoot, fakeRoot);
    mirror = mod.exports?.reduce ? mod.exports : fakeRoot.EchoBehaviour;
  } catch {
    mirror = null;
  }

  /** Event sequences covering every branch, replayed through both. */
  const SEQUENCES = [
    [],
    [{ type: ECHO_EVENT.ACTIVITY, now: 100 }],
    [{ type: ECHO_EVENT.HIDDEN, now: 10 }, { type: ECHO_EVENT.VISIBLE, now: 20 }],
    [{ type: ECHO_EVENT.POSEIDON_SPEAKING, now: 0, durationMs: 3000 }],
    [{ type: ECHO_EVENT.POSEIDON_SPEAKING, now: 0 }],
    [{ type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 12000, swimSpeedMultiplier: 1.0 }],
    [{ type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 5000, swimSpeedMultiplier: 0.5 }],
    [{ type: ECHO_EVENT.POSEIDON_REACTION, now: 0, durationMs: 50, swimSpeedMultiplier: 1.5 }],
    [{ type: ECHO_EVENT.POSEIDON_REACTION, now: 0 }],
    [{ type: ECHO_EVENT.VISION_START, now: 0 }],
    [{ type: ECHO_EVENT.VISION_START, now: 0 }, { type: ECHO_EVENT.VISION_END, now: 500 }],
    [{ type: ECHO_EVENT.ATTEND, now: 0, dx: -250, dy: -80 }],
    [{ type: ECHO_EVENT.ATTEND, now: 0, dx: 250, dy: 300 }],
    [{ type: ECHO_EVENT.ATTEND, now: 0, dx: 0, dy: 0 }],
    [{ type: ECHO_EVENT.ATTEND, now: 0, dx: 5, dy: 5 }, { type: ECHO_EVENT.RELEASE, now: 10 }],
    [{ type: ECHO_EVENT.DRIFT, now: 0, x: 12.5, y: -6.25 }],
    [{ type: "nonsense", now: 0 }],
    [
      { type: ECHO_EVENT.VISION_START, now: 0 },
      { type: ECHO_EVENT.POSEIDON_SPEAKING, now: 10, durationMs: 4000 },
      { type: ECHO_EVENT.POSEIDON_REACTION, now: 20, durationMs: 900, swimSpeedMultiplier: 1.4 },
      { type: ECHO_EVENT.ATTEND, now: 30, dx: -90, dy: 40 },
      { type: ECHO_EVENT.VISION_END, now: 40 },
    ],
  ];

  const PROBES = [0, 1, 249, 250, 251, 900, 1050, 1400, 2500, 5000, TIMING.restAfterMs, TIMING.restAfterMs + 1];

  it("exposes the mirror module", () => {
    expect(mirror, "frontend/public/js/echo-behaviour.js should be require-able").toBeTruthy();
  });

  it("agrees on the constants", () => {
    if (!mirror) return;
    expect(mirror.ECHO_STATE).toEqual({ ...ECHO_STATE });
    expect(mirror.ECHO_EVENT).toEqual({ ...ECHO_EVENT });
    expect(mirror.TIMING).toEqual({ ...TIMING });
  });

  it("agrees on observe() at every probe for every sequence", () => {
    if (!mirror) return;
    for (const seq of SEQUENCES) {
      const mine = seq.reduce((s, e) => reduce(s, e), createEchoState(0));
      const theirs = seq.reduce((s, e) => mirror.reduce(s, e), mirror.createEchoState(0));
      for (const now of PROBES) {
        const where = `${JSON.stringify(seq)} @ ${now}`;
        expect(mirror.observe(theirs, now), where).toBe(observe(mine, now));
      }
    }
  });

  it("agrees on describe() at every probe for every sequence", () => {
    if (!mirror) return;
    for (const seq of SEQUENCES) {
      const mine = seq.reduce((s, e) => reduce(s, e), createEchoState(0));
      const theirs = seq.reduce((s, e) => mirror.reduce(s, e), mirror.createEchoState(0));
      for (const now of PROBES) {
        const where = `${JSON.stringify(seq)} @ ${now}`;
        expect(mirror.describe(theirs, now), where).toEqual(describeEcho(mine, now));
      }
    }
  });

  it("agrees on nextTransitionAt()", () => {
    if (!mirror) return;
    for (const seq of SEQUENCES) {
      const mine = seq.reduce((s, e) => reduce(s, e), createEchoState(0));
      const theirs = seq.reduce((s, e) => mirror.reduce(s, e), mirror.createEchoState(0));
      for (const now of PROBES) {
        expect(mirror.nextTransitionAt(theirs, now)).toBe(nextTransitionAt(mine, now));
      }
    }
  });

  it("agrees on the pure derivations", () => {
    if (!mirror) return;
    for (const ms of [undefined, 0, -1, 50, 900, 12000, NaN]) {
      expect(mirror.clampReactionDuration(ms)).toBe(clampReactionDuration(ms));
    }
    for (const p of [{}, { swimSpeedMultiplier: 0.5, durationMs: 5000 }, { swimSpeedMultiplier: 1.5 }, { durationMs: 12000 }]) {
      expect(mirror.reactionIntensity(p)).toBe(reactionIntensity(p));
    }
    for (const [dx, dy] of [[0, 0], [-200, 0], [200, 0], [600, -300], [0, -300], [1, 5000]]) {
      expect(mirror.gazeFromOffset(dx, dy)).toEqual(gazeFromOffset(dx, dy));
    }
    // Injected randomness, so the jittered helpers are comparable at all.
    for (const v of [0, 0.25, 0.5, 0.99]) {
      expect(mirror.nextDriftDelay(() => v)).toBe(nextDriftDelay(() => v));
      expect(mirror.nextDriftOffset(() => v, 22)).toEqual(nextDriftOffset(() => v, 22));
    }
  });
});
