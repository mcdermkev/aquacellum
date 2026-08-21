/**
 * echoGaze.test.js — the gaze protocol.
 *
 * Step 4 of docs/ECHO_CHARACTER_SPEC.md. Two properties matter enough to pin:
 *
 *   1. Asking for Echo's attention can NEVER break the asker. She is optional —
 *      switched off in Settings, absent from a page — and a component that
 *      requests her gaze must not care whether she is listening.
 *   2. She must let go of dead targets. A one-shot measurement leaves her staring
 *      at where a closed panel used to be, which is worse than not looking at all.
 *
 * The project's vitest runs in a `node` environment with no jsdom, so the DOM is
 * stubbed. That is enough: this module's job is event plumbing and staleness, and
 * the arithmetic it delegates to lives in echoBehaviour with its own tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ECHO_ATTEND_EVENT,
  ECHO_RELEASE_EVENT,
  echoAttend,
  echoRelease,
  attachGazeTracking,
} from "./echoGaze.js";

/** Minimal window/DOM stub with synchronous requestAnimationFrame. */
function stubDom() {
  const listeners = new Map();
  const win = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    // Synchronous so a scroll can be asserted without awaiting a frame.
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };
  return { win, listeners, count: (t) => listeners.get(t)?.size || 0 };
}

function makeTarget(rect, connected = true) {
  return {
    isConnected: connected,
    getBoundingClientRect: () => rect,
  };
}

const SELF = { left: 20, top: 700, width: 56, height: 56 };
const selfEl = { getBoundingClientRect: () => SELF };

let dom;
beforeEach(() => {
  dom = stubDom();
  vi.stubGlobal("window", dom.win);
  vi.stubGlobal("requestAnimationFrame", dom.win.requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", dom.win.cancelAnimationFrame);
  vi.stubGlobal("CustomEvent", dom.win.CustomEvent);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for attention cannot break the asker", () => {
  it("does nothing when nobody is listening", () => {
    // Echo switched off, or a page that never mounted her.
    expect(() => echoAttend(makeTarget({ left: 0, top: 0, width: 10, height: 10 }))).not.toThrow();
    expect(() => echoRelease()).not.toThrow();
  });

  it("ignores a null or non-element target", () => {
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(null);
    echoAttend(undefined);
    // A dispatcher that sends something that is not an element at all.
    dom.win.dispatchEvent({ type: ECHO_ATTEND_EVENT, detail: { target: { nope: true } } });

    expect(onOffset).not.toHaveBeenCalled();
  });
});

describe("attending measures through the shared arithmetic", () => {
  it("reports a centre-to-centre offset", () => {
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(makeTarget({ left: 100, top: 100, width: 200, height: 100 }));

    expect(onOffset).toHaveBeenCalledWith({ dx: 152, dy: -578 });
  });

  it("does not move her gaze for a zero-sized target", () => {
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(makeTarget({ left: 0, top: 0, width: 0, height: 0 }));

    expect(onOffset).not.toHaveBeenCalled();
  });

  it("waits for a mount that has not rendered yet", () => {
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => null, onOffset, onRelease: vi.fn() });

    echoAttend(makeTarget({ left: 100, top: 100, width: 100, height: 100 }));

    expect(onOffset).not.toHaveBeenCalled();
  });
});

describe("she lets go of dead targets", () => {
  it("releases when the element leaves the document", () => {
    // THE STALENESS RULE. A closed panel is detached, and a gaze based on one
    // measurement would keep pointing at where it used to be.
    const onRelease = vi.fn();
    const target = makeTarget({ left: 400, top: 100, width: 200, height: 200 });
    attachGazeTracking({ getSelf: () => selfEl, onOffset: vi.fn(), onRelease });

    echoAttend(target);
    expect(onRelease).not.toHaveBeenCalled();

    target.isConnected = false;
    dom.win.dispatchEvent({ type: "scroll" });

    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("releases on request, and only once", () => {
    const onRelease = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset: vi.fn(), onRelease });

    echoAttend(makeTarget({ left: 400, top: 100, width: 200, height: 200 }));
    echoRelease();
    echoRelease(); // redundant — must not re-fire

    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores a release when nothing is attended", () => {
    const onRelease = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset: vi.fn(), onRelease });

    echoRelease();

    expect(onRelease).not.toHaveBeenCalled();
  });
});

describe("re-measuring keeps her honest as the page moves", () => {
  it("follows a target that scrolls", () => {
    const onOffset = vi.fn();
    let top = 100;
    const target = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 400, top, width: 200, height: 200 }),
    };
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(target);
    const first = onOffset.mock.calls.at(-1)[0];

    top = 600; // user scrolls; the panel is now lower on screen
    dom.win.dispatchEvent({ type: "scroll" });
    const second = onOffset.mock.calls.at(-1)[0];

    expect(second.dy).toBeGreaterThan(first.dy);
  });

  it("keeps re-measuring on EVERY scroll, not just the first", () => {
    // REGRESSION. The guard was `if (frame !== null) return`, and
    // `frame = requestAnimationFrame(measure)` assigns the handle only after the
    // callback returns — so a synchronous scheduler left `frame` non-null forever
    // and silently skipped every later re-measure. She would follow a target once
    // and then freeze, and stop noticing detached targets entirely.
    const onOffset = vi.fn();
    let top = 100;
    const target = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 400, top, width: 200, height: 200 }),
    };
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(target);
    const seen = [];
    for (const next of [200, 300, 400]) {
      top = next;
      dom.win.dispatchEvent({ type: "scroll" });
      seen.push(onOffset.mock.calls.at(-1)[0].dy);
    }

    // Three distinct positions, all observed — not one then silence.
    expect(new Set(seen).size).toBe(3);
  });

  it("still releases a detached target on a LATER scroll", () => {
    // The same regression's worst symptom: she keeps staring at a closed panel
    // because the release check never runs again.
    const onRelease = vi.fn();
    const target = makeTarget({ left: 400, top: 100, width: 200, height: 200 });
    attachGazeTracking({ getSelf: () => selfEl, onOffset: vi.fn(), onRelease });

    echoAttend(target);
    dom.win.dispatchEvent({ type: "scroll" }); // an ordinary scroll first
    target.isConnected = false;
    dom.win.dispatchEvent({ type: "scroll" }); // now it is gone

    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("re-measures on resize too", () => {
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    echoAttend(makeTarget({ left: 400, top: 100, width: 200, height: 200 }));
    const before = onOffset.mock.calls.length;

    dom.win.dispatchEvent({ type: "resize" });

    expect(onOffset.mock.calls.length).toBeGreaterThan(before);
  });

  it("does not measure while nothing is attended", () => {
    // Scroll fires constantly; a decorative fish must not force a reflow per tick.
    const onOffset = vi.fn();
    attachGazeTracking({ getSelf: () => selfEl, onOffset, onRelease: vi.fn() });

    dom.win.dispatchEvent({ type: "scroll" });
    dom.win.dispatchEvent({ type: "resize" });

    expect(onOffset).not.toHaveBeenCalled();
  });
});

describe("teardown leaves nothing behind", () => {
  it("removes every listener it added", () => {
    const detach = attachGazeTracking({
      getSelf: () => selfEl,
      onOffset: vi.fn(),
      onRelease: vi.fn(),
    });

    for (const type of [ECHO_ATTEND_EVENT, ECHO_RELEASE_EVENT, "scroll", "resize"]) {
      expect(dom.count(type), type).toBe(1);
    }

    detach();

    for (const type of [ECHO_ATTEND_EVENT, ECHO_RELEASE_EVENT, "scroll", "resize"]) {
      expect(dom.count(type), type).toBe(0);
    }
  });

  it("survives being torn down when window is absent", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(() => attachGazeTracking({ getSelf: () => null, onOffset: () => {}, onRelease: () => {} })()).not.toThrow();
  });
});
