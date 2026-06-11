/**
 * Unit tests for the tour-step completion race + timeout (onboarding-revamp
 * task 7.3).
 *
 * The project runs vitest in a `node` environment with no DOM renderer, so we
 * exercise the pure, React-free `createTourStepWatcher` core that holds all of
 * the race/latch logic. The thin `useTourStep` hook simply binds this watcher
 * to React state, so testing the watcher validates the behaviour that matters:
 *
 *   - EVENT-first  : the completion event fires before anything else.
 *   - POLL-first   : `verify()` confirms a Dexie record before the event/timeout.
 *   - TIMEOUT      : neither fires within the window → graceful "do it later".
 *
 * Each path MUST advance EXACTLY ONCE (idempotent advance — Property 4): the
 * winning callback is invoked a single time and every subsequent trigger is a
 * no-op.
 *
 * Validates: Requirements 3.3, 4.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createTourStepWatcher,
  TOUR_STEP_STATUS,
} from "./useTourStep";

/**
 * Minimal in-memory EventTarget stub. Node's global EventTarget requires real
 * Event instances for dispatch (and CustomEvent isn't available on all Node
 * versions), so this stub keeps the test deterministic and lets us assert on
 * listener bookkeeping (teardown removes the listener).
 */
function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** Test helper: dispatch an event with an optional `detail` payload. */
    dispatch(type, detail) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn({ type, detail });
    },
    /** Test helper: how many listeners are currently registered for `type`. */
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const STEP_ID = "tour_tank";
const EVENT_NAME = "aquadex:tank_registered";

let onComplete;
let onTimeout;
let onStatusChange;

beforeEach(() => {
  vi.useFakeTimers();
  onComplete = vi.fn();
  onTimeout = vi.fn();
  onStatusChange = vi.fn();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("createTourStepWatcher — event-first path", () => {
  it("advances exactly once on the completion event, ignoring later triggers", async () => {
    const target = makeEventTarget();
    const verify = vi.fn().mockResolvedValue(false); // poll never completes

    const watcher = createTourStepWatcher({
      stepId: STEP_ID,
      completeOn: EVENT_NAME,
      verify,
      onStatusChange,
      onComplete,
      onTimeout,
      interval: 1000,
      timeout: 45000,
      eventTarget: target,
    });

    expect(target.listenerCount(EVENT_NAME)).toBe(1);

    // Event fires first → completes via the event source.
    target.dispatch(EVENT_NAME, { tankId: 7 });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      stepId: STEP_ID,
      source: "event",
      detail: { tankId: 7 },
    });
    expect(watcher.isFinished()).toBe(TOUR_STEP_STATUS.COMPLETED);
    // Listener and timers are torn down the instant we settle.
    expect(target.listenerCount(EVENT_NAME)).toBe(0);

    // Every subsequent trigger is a no-op (idempotent advance — Property 4).
    target.dispatch(EVENT_NAME, { tankId: 99 }); // duplicate event
    await vi.advanceTimersByTimeAsync(60000); // past poll + timeout
    watcher.dismiss(); // manual skip

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createTourStepWatcher — poll-first path", () => {
  it("advances exactly once when verify() confirms, ignoring later triggers", async () => {
    const target = makeEventTarget();
    // Immediate check (on construction) is false; the first interval poll is true.
    const verify = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const watcher = createTourStepWatcher({
      stepId: STEP_ID,
      completeOn: EVENT_NAME,
      verify,
      onStatusChange,
      onComplete,
      onTimeout,
      interval: 1000,
      timeout: 45000,
      eventTarget: target,
    });

    // Let the immediate (false) verify settle — no completion yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(onComplete).not.toHaveBeenCalled();

    // First interval poll returns true → completes via the verify source.
    await vi.advanceTimersByTimeAsync(1000);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      stepId: STEP_ID,
      source: "verify",
      detail: undefined,
    });
    expect(watcher.isFinished()).toBe(TOUR_STEP_STATUS.COMPLETED);
    // Poll stopped + listener removed once settled.
    expect(target.listenerCount(EVENT_NAME)).toBe(0);
    const callsAtCompletion = verify.mock.calls.length;

    // Subsequent triggers are no-ops, and the poll no longer fires.
    await vi.advanceTimersByTimeAsync(60000);
    target.dispatch(EVENT_NAME);
    watcher.dismiss();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(verify.mock.calls.length).toBe(callsAtCompletion); // interval cleared
  });
});

describe("createTourStepWatcher — timeout path", () => {
  it("times out exactly once when nothing else fires, ignoring later triggers", async () => {
    const target = makeEventTarget();
    const verify = vi.fn().mockResolvedValue(false); // never completes

    const watcher = createTourStepWatcher({
      stepId: STEP_ID,
      completeOn: EVENT_NAME,
      verify,
      onStatusChange,
      onComplete,
      onTimeout,
      interval: 1000,
      timeout: 45000,
      eventTarget: target,
    });

    // Before the timeout window nothing has settled.
    await vi.advanceTimersByTimeAsync(44000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    // Crossing the timeout boundary settles into the graceful "do it later" path.
    await vi.advanceTimersByTimeAsync(1000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({ stepId: STEP_ID });
    expect(watcher.isFinished()).toBe(TOUR_STEP_STATUS.TIMED_OUT);
    expect(target.listenerCount(EVENT_NAME)).toBe(0);

    // Late event / poll / manual dismiss after timeout are all no-ops.
    target.dispatch(EVENT_NAME);
    await vi.advanceTimersByTimeAsync(60000);
    watcher.dismiss();

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("createTourStepWatcher — status transitions", () => {
  it("reports WATCHING on start then a single terminal status", () => {
    const target = makeEventTarget();

    createTourStepWatcher({
      stepId: STEP_ID,
      completeOn: EVENT_NAME,
      onStatusChange,
      onComplete,
      onTimeout,
      timeout: 0, // disabled
      eventTarget: target,
    });

    expect(onStatusChange).toHaveBeenNthCalledWith(1, TOUR_STEP_STATUS.WATCHING);

    target.dispatch(EVENT_NAME);
    expect(onStatusChange).toHaveBeenNthCalledWith(2, TOUR_STEP_STATUS.COMPLETED);
    expect(onStatusChange).toHaveBeenCalledTimes(2);
  });
});
