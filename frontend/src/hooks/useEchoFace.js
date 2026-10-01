import { useCallback, useEffect, useReducer, useState } from "react";
import {
  ECHO_EVENT,
  createEchoState,
  reduce,
  describe as describeEcho,
  nextTransitionAt,
} from "../services/echoBehaviour";

/**
 * useEchoFace — the face Echo shows in the chat header.
 *
 * Same core, same events as the corner Echo (EchoAmbient), so the two always
 * agree: she thinks while Poseidon works, talks while the answer lands, and
 * reacts with the reply's mood. This only drives a second, smaller drawing of
 * her. It decides nothing itself.
 *
 * @param {boolean} active listen only while the chat is open
 * @returns {string} one of ECHO_EXPRESSION
 */
export function useEchoFace(active) {
  const [state, dispatch] = useReducer(reduce, undefined, () => createEchoState(Date.now()));
  const [tick, setTick] = useState(0);
  const send = useCallback((type, extra) => dispatch({ type, now: Date.now(), ...extra }), []);

  useEffect(() => {
    if (!active) return;
    const onReaction = (e) => send(ECHO_EVENT.POSEIDON_REACTION, {
      mood: e?.detail?.mood,
      durationMs: e?.detail?.durationMs,
      swimSpeedMultiplier: e?.detail?.swimSpeedMultiplier,
    });
    const onThinkStart = () => send(ECHO_EVENT.THINKING_START);
    const onThinkEnd = () => send(ECHO_EVENT.THINKING_END);
    const onSpeaking = (e) => send(ECHO_EVENT.POSEIDON_SPEAKING, { durationMs: e?.detail?.durationMs });
    const onVisionStart = () => send(ECHO_EVENT.VISION_START);
    const onVisionEnd = () => send(ECHO_EVENT.VISION_END);
    const onActivity = () => send(ECHO_EVENT.ACTIVITY);

    window.addEventListener("poseidon:echo-reaction", onReaction);
    window.addEventListener("echo:thinking-start", onThinkStart);
    window.addEventListener("echo:thinking-end", onThinkEnd);
    window.addEventListener("echo:speaking", onSpeaking);
    window.addEventListener("echo:vision-start", onVisionStart);
    window.addEventListener("echo:vision-end", onVisionEnd);
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    send(ECHO_EVENT.ACTIVITY);
    return () => {
      window.removeEventListener("poseidon:echo-reaction", onReaction);
      window.removeEventListener("echo:thinking-start", onThinkStart);
      window.removeEventListener("echo:thinking-end", onThinkEnd);
      window.removeEventListener("echo:speaking", onSpeaking);
      window.removeEventListener("echo:vision-start", onVisionStart);
      window.removeEventListener("echo:vision-end", onVisionEnd);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointerdown", onActivity);
    };
  }, [active, send]);

  // One wake-up at the next instant the face could change (see EchoAmbient).
  useEffect(() => {
    if (!active) return;
    const at = nextTransitionAt(state, Date.now());
    if (at === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [active, state, tick]);

  return describeEcho(state, Date.now()).expression;
}

export default useEchoFace;
