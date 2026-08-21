/**
 * EchoWhispers.jsx — Echo mentions something she noticed.
 *
 * A small bubble near Echo carrying ONE observation drawn from the keeper's own
 * logs. Tapping a care observation opens Poseidon with that question already asked.
 *
 * ── What this component is not allowed to do ─────────────────────────────────
 * Hold copy, or decide what is worth saying. Both live in
 * `services/echoNotices.js`, which is pure and tested — including a test that no
 * notice is phrased as advice. This file is timing and rendering only.
 *
 * That split is the point. The previous version was 380 lines with a hardcoded
 * string table in it, and it told keepers their "fish would appreciate" a water
 * change: husbandry advice, in Echo's voice, unreviewable because it was tangled up
 * with the render. Now the rules are assertable and this file cannot contribute
 * prose.
 *
 * ── Echo notices; Poseidon explains ──────────────────────────────────────────
 * Care notices carry a `seedPrompt` and the bubble becomes a button that opens the
 * chat with it. He is the brain: he has the species context, he is bound by the
 * anti-diagnosis prompt, and his writes need confirming. Celebratory notices have
 * nothing to ask, so they render as plain text and are not focusable — a button
 * that only dismisses itself is a lie about what it does.
 *
 * ── Both modes ───────────────────────────────────────────────────────────────
 * This used to be casual-only. That is the same mistake as the XP gate that hid
 * Echo below 500 points: it withheld the guide from a whole mode. Pro gets the
 * terse wording from the notices module instead of getting nothing.
 *
 * Position and motion live in /css/echo.css, next to `.echo-ambient`, so the bubble
 * and the fish she speaks from cannot drift apart across breakpoints.
 *
 * Props:
 *   casualModeActive {boolean}
 *   userState {{ totalXp, streakDays }}
 *   tankData {{ lastWaterChange, lastFeeding, lastParams, tankCount }}
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { buildNotices, pickNotice, noticeText } from "../services/echoNotices";

const DISPLAY_MS = 9000; // long enough to read and reach for
const COOLDOWN_MS = 120000; // at most one every two minutes
const INITIAL_DELAY_MS = 3000; // let the page settle before she speaks
const LEAVE_MS = 300; // matches the CSS transition
const AFTER_ACTION_MS = 1800; // let the log land before re-checking

export function EchoWhispers({ casualModeActive = true, userState, tankData }) {
  const pro = !casualModeActive;

  const [notice, setNotice] = useState(null);
  const [leaving, setLeaving] = useState(false);

  const lastShownIdRef = useRef(null);
  const lastShownAtRef = useRef(0);
  const dismissTimerRef = useRef(null);

  // Read through refs inside the timers below so a data refresh does not restart
  // the schedule — App reloads these on every XP event, and re-running the mount
  // effect on each one would make her speak far more often than the cooldown says.
  const dataRef = useRef({ userState, tankData });
  dataRef.current = { userState, tankData };

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setNotice(null);
      setLeaving(false);
    }, LEAVE_MS);
  }, []);

  const maybeShow = useCallback(() => {
    const now = Date.now();
    if (now - lastShownAtRef.current < COOLDOWN_MS) return;

    const { userState: u, tankData: t } = dataRef.current;
    const next = pickNotice(buildNotices({ userState: u, tankData: t, now }), {
      excludeId: lastShownIdRef.current,
    });
    if (!next) return; // nothing true to report; say nothing

    lastShownIdRef.current = next.id;
    lastShownAtRef.current = now;
    setNotice(next);
    setLeaving(false);

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(dismiss, DISPLAY_MS);
  }, [dismiss]);

  // First look, once, after the page has settled.
  useEffect(() => {
    const timer = setTimeout(maybeShow, INITIAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [maybeShow]);

  // A logged care action changes the facts, so re-check shortly after one lands.
  //
  // It also makes Echo MOVE, via the same event the chat console and the easter
  // eggs use. That replaces the old behaviour of picking a congratulatory sentence
  // at random ("Fed and happy. Echo approves.") — she is the body, so she reacts
  // with motion, and any words belong to Poseidon.
  useEffect(() => {
    const onXp = () => {
      window.dispatchEvent(
        new CustomEvent("poseidon:echo-reaction", {
          detail: { durationMs: 900, swimSpeedMultiplier: 1.35 },
        }),
      );
      setTimeout(maybeShow, AFTER_ACTION_MS);
    };

    window.addEventListener("aquadex_xp_added", onXp);
    return () => window.removeEventListener("aquadex_xp_added", onXp);
  }, [maybeShow]);

  useEffect(() => () => clearTimeout(dismissTimerRef.current), []);

  if (!notice) return null;

  const text = noticeText(notice, { pro });
  const actionable = Boolean(notice.seedPrompt);

  const ask = () => {
    // The widget listens for this and opens with the question already asked. A DOM
    // event because the FAB owns its own open state and lives elsewhere in the tree.
    window.dispatchEvent(
      new CustomEvent("poseidon:open", { detail: { seedPrompt: notice.seedPrompt } }),
    );
    dismiss();
  };

  const body = (
    <>
      <span className="echo-whisper__icon" aria-hidden="true">
        {notice.icon}
      </span>
      <span className="echo-whisper__body">
        <span className="echo-whisper__text">{text}</span>
        <span className="echo-whisper__hint">
          {actionable ? (pro ? "Query Poseidon" : "Ask Poseidon about it") : "Echo noticed"}
        </span>
      </span>
    </>
  );

  return (
    // The live region is the wrapper, so the observation is announced when it
    // arrives whether or not it happens to be focusable.
    <div
      className={`echo-whisper${leaving ? " echo-whisper--leaving" : ""}${pro ? " echo-whisper--pro" : ""}`}
      role="status"
      aria-live="polite"
    >
      {actionable ? (
        <button type="button" className="echo-whisper__action" onClick={ask}>
          {body}
        </button>
      ) : (
        // Not a button: nothing to activate, and it disappears on its own.
        <span className="echo-whisper__static">{body}</span>
      )}

      <button
        type="button"
        className="echo-whisper__close"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export default EchoWhispers;
