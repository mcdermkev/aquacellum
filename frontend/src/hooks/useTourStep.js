/**
 * useTourStep.js
 *
 * Completion detection for a single guided-tour step (onboarding-revamp spec,
 * task 7.2). A tour step is considered "done" when the user performs the real
 * action it teaches — registering a tank, adding a fish, setting an avatar.
 *
 * Detection runs TWO mechanisms concurrently and whichever fires first wins:
 *   1. EVENT  — subscribe to the step's `completeOn` window CustomEvent
 *               (e.g. "aquadex:tank_registered", "aquadex:specimen_added",
 *               "aquadex:avatar_set"), dispatched by the real components
 *               (task 1.3) on their success paths.
 *   2. POLL   — call the step's `verify()` (reads Dexie counts, e.g.
 *               `() => db.tanks.count() > 0`) on an interval, as a fallback so
 *               a missed event never leaves the tour stuck.
 *
 * If neither fires within `timeout` ms the step resolves gracefully into a
 * timed-out / "do it later" state (the caller can offer to skip or continue).
 *
 * IDEMPOTENT ADVANCE (Property 4): the watcher holds a single terminal latch.
 * The first of {event, verify-success, timeout, manual dismiss} to occur sets
 * the outcome and invokes its callback EXACTLY ONCE; every subsequent trigger
 * is a no-op. Advancing twice can therefore never happen.
 *
 * The race/latch core lives in the pure, React-free `createTourStepWatcher`
 * factory below so it can be unit-tested deterministically (task 7.3) with fake
 * timers and a stub event target. The `useTourStep` hook is a thin wrapper that
 * binds the watcher to React state and the component lifecycle. `interval`,
 * `timeout`, and `eventTarget` are all injectable so the race can be driven
 * deterministically in tests.
 *
 * Validates: Requirements 3.3, 4.2
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Default polling cadence for `verify()` (ms). */
export const DEFAULT_POLL_INTERVAL_MS = 1000;

/** Default graceful-timeout window before falling back to "do it later" (ms). */
export const DEFAULT_TIMEOUT_MS = 45000;

/** Terminal status values the hook can settle into. */
export const TOUR_STEP_STATUS = Object.freeze({
  WATCHING: "watching",
  COMPLETED: "completed",
  TIMED_OUT: "timedOut",
});

/** Resolve the default event target, tolerating non-browser environments. */
function defaultEventTarget() {
  return typeof window !== "undefined" ? window : null;
}

/**
 * Pure, React-free completion watcher for a single tour step.
 *
 * Wires up the event listener, the `verify()` poll, and the graceful timeout,
 * all guarded by a single terminal latch so the step advances EXACTLY ONCE
 * (idempotent advance — Property 4). Whichever mechanism fires first wins; every
 * later trigger (including a second event, a late poll, the timeout, or a manual
 * `dismiss()`) is a no-op. Starts watching immediately on construction.
 *
 * @param {object}  config
 * @param {string}  [config.stepId]            Step identifier (echoed back to callbacks).
 * @param {string}  [config.completeOn]        Name of the event that signals completion.
 * @param {() => (boolean|Promise<boolean>)} [config.verify]  Reads truth from Dexie; truthy ⇒ complete.
 * @param {(status:string) => void} [config.onStatusChange]   Called with each status transition.
 * @param {(info:{ stepId?:string, source:string, detail?:any }) => void} [config.onComplete]
 * @param {(info:{ stepId?:string }) => void} [config.onTimeout]
 * @param {number}  [config.interval]          Poll cadence in ms (default 1000).
 * @param {number}  [config.timeout]           Timeout in ms; <=0 or non-finite disables it.
 * @param {EventTarget} [config.eventTarget]   Target to listen on (default `window`).
 * @returns {{ dismiss: () => void, stop: () => void, isFinished: () => (string|null) }}
 */
export function createTourStepWatcher(config = {}) {
  const {
    stepId,
    completeOn,
    verify,
    onStatusChange,
    onComplete,
    onTimeout,
    interval = DEFAULT_POLL_INTERVAL_MS,
    timeout = DEFAULT_TIMEOUT_MS,
    eventTarget,
  } = config;

  const resolvedTarget =
    eventTarget !== undefined ? eventTarget : defaultEventTarget();
  const hasVerify = typeof verify === "function";

  let finished = null; // null | "completed" | "timedOut"
  let pollTimer = null;
  let timeoutTimer = null;

  /** Stop all detection: clear timers and drop the event listener. */
  const stop = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (resolvedTarget && completeOn) {
      resolvedTarget.removeEventListener(completeOn, handleEvent);
    }
  };

  /**
   * Settle the step exactly once. The first caller wins; all later calls are
   * no-ops (idempotent advance — Property 4).
   */
  const finish = (outcome, info) => {
    if (finished) return;
    finished = outcome;

    // Stop everything immediately so nothing can fire after we've settled.
    stop();

    if (outcome === TOUR_STEP_STATUS.COMPLETED) {
      onStatusChange?.(TOUR_STEP_STATUS.COMPLETED);
      onComplete?.({ stepId, source: info?.source, detail: info?.detail });
    } else {
      onStatusChange?.(TOUR_STEP_STATUS.TIMED_OUT);
      onTimeout?.({ stepId });
    }
  };

  function handleEvent(event) {
    finish(TOUR_STEP_STATUS.COMPLETED, { source: "event", detail: event?.detail });
  }

  const runVerify = async () => {
    if (!hasVerify) return;
    try {
      const result = await verify();
      // `finish` is idempotent, so a race with the event path is harmless.
      if (result && !finished) {
        finish(TOUR_STEP_STATUS.COMPLETED, { source: "verify" });
      }
    } catch (err) {
      // A failing verify() must not break detection — the event path and the
      // timeout remain active. Surface it for debugging only.
      // eslint-disable-next-line no-console
      console.warn(`[useTourStep:${stepId ?? "?"}] verify() threw:`, err?.message);
    }
  };

  // Begin watching.
  onStatusChange?.(TOUR_STEP_STATUS.WATCHING);

  // 1. EVENT path.
  if (resolvedTarget && completeOn) {
    resolvedTarget.addEventListener(completeOn, handleEvent);
  }

  // 2. POLL path: an immediate check (the action may already be done) plus an
  // interval. Skipped entirely when no verify() is supplied.
  if (hasVerify) {
    runVerify();
    pollTimer = setInterval(runVerify, interval);
  }

  // 3. TIMEOUT fallback → graceful "do it later".
  if (Number.isFinite(timeout) && timeout > 0) {
    timeoutTimer = setTimeout(() => {
      finish(TOUR_STEP_STATUS.TIMED_OUT);
    }, timeout);
  }

  return {
    /** Manual "do it later" / skip — routes into the graceful timeout path. */
    dismiss: () => finish(TOUR_STEP_STATUS.TIMED_OUT),
    stop,
    isFinished: () => finished,
  };
}

/**
 * Detect completion of a single tour step via event + poll, with graceful timeout.
 *
 * @param {object|null} step                 Step config: `{ id, completeOn, verify, ... }`.
 * @param {string}      [step.id]            Step identifier (echoed back to callbacks).
 * @param {string}      [step.completeOn]    Name of the window CustomEvent that signals completion.
 * @param {() => (boolean|Promise<boolean>)} [step.verify]  Reads truth from Dexie; truthy ⇒ complete.
 * @param {object}  [options]
 * @param {(info:{ stepId?:string, source:string, detail?:any }) => void} [options.onComplete]
 *                                            Called once when the step completes (event or poll).
 * @param {(info:{ stepId?:string }) => void} [options.onTimeout]
 *                                            Called once when the step times out / is dismissed.
 * @param {boolean} [options.enabled=true]    When false the hook is dormant (no listeners/timers).
 * @param {number}  [options.interval]        Poll cadence in ms (default 1000).
 * @param {number}  [options.timeout]         Timeout in ms; <=0 or non-finite disables the timeout.
 * @param {EventTarget} [options.eventTarget] Target to listen on (default `window`); injectable for tests.
 * @returns {{
 *   status: string,
 *   completed: boolean,
 *   timedOut: boolean,
 *   isWatching: boolean,
 *   dismiss: () => void,
 * }}
 */
export function useTourStep(step, options = {}) {
  const {
    onComplete,
    onTimeout,
    enabled = true,
    interval = DEFAULT_POLL_INTERVAL_MS,
    timeout = DEFAULT_TIMEOUT_MS,
    eventTarget,
  } = options;

  const [status, setStatus] = useState(TOUR_STEP_STATUS.WATCHING);

  // Keep the latest callbacks / verify fn in refs so the detection effect does
  // not re-subscribe when the caller passes new inline functions each render.
  const onCompleteRef = useRef(onComplete);
  const onTimeoutRef = useRef(onTimeout);
  const verifyRef = useRef(step?.verify);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onTimeoutRef.current = onTimeout;
    verifyRef.current = step?.verify;
  });

  // Live watcher handle, shared between the effect and `dismiss()`.
  const watcherRef = useRef(null);

  /**
   * Manual "do it later" / skip affordance. Routes into the same graceful
   * fallback as a timeout and is idempotent via the watcher's shared latch.
   */
  const dismiss = useCallback(() => {
    watcherRef.current?.dismiss();
  }, []);

  const stepId = step?.id;
  const completeOn = step?.completeOn;
  const hasVerify = typeof step?.verify === "function";

  useEffect(() => {
    if (!enabled || !step) return undefined;

    const watcher = createTourStepWatcher({
      stepId,
      completeOn,
      // Read verify through the ref so a new inline fn each render is picked up
      // without re-subscribing the whole watcher.
      verify: hasVerify ? () => verifyRef.current?.() : undefined,
      onStatusChange: setStatus,
      onComplete: (info) => onCompleteRef.current?.(info),
      onTimeout: (info) => onTimeoutRef.current?.(info),
      interval,
      timeout,
      eventTarget,
    });
    watcherRef.current = watcher;

    return () => {
      watcher.stop();
      watcherRef.current = null;
    };
    // Re-run only when the identity of the step or detection knobs change.
  }, [enabled, stepId, completeOn, hasVerify, interval, timeout, eventTarget]);

  return {
    status,
    completed: status === TOUR_STEP_STATUS.COMPLETED,
    timedOut: status === TOUR_STEP_STATUS.TIMED_OUT,
    isWatching: status === TOUR_STEP_STATUS.WATCHING,
    dismiss,
  };
}

export default useTourStep;
