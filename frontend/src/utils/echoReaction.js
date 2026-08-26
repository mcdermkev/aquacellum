/**
 * echoReaction.js — mood → sprite overlay for Poseidon's echoReaction payload.
 *
 * Sprite states (resting | idle | attending | speaking | examining | reacting)
 * live in echoBehaviour.js, not here. This file only maps a mood string to the
 * glow/speed overlay the client already plays via `poseidon:echo-reaction`.
 *
 * Closed set: happy | excited | calm | confused | alert.
 * `paired_swimming` is a client easter-egg dispatch, not a Poseidon mood — do
 * not steal it. Do not add reflective / restless / joyful. happy is first-class;
 * do not remap it to joyful. Unknown moods fall back to calm.
 */

const ECHO_MOOD_TABLE = Object.freeze({
  calm: Object.freeze({
    glowActive: true,
    glowColor: "#2dd4bf",
    swimSpeedMultiplier: 1.0,
    durationMs: 1600,
  }),
  happy: Object.freeze({
    glowActive: true,
    glowColor: "#5eead4",
    swimSpeedMultiplier: 1.2,
    durationMs: 1800,
  }),
  excited: Object.freeze({
    glowActive: true,
    glowColor: "#ffd700",
    swimSpeedMultiplier: 1.35,
    durationMs: 2000,
  }),
  alert: Object.freeze({
    glowActive: true,
    glowColor: "#f97316",
    swimSpeedMultiplier: 1.4,
    durationMs: 2200,
  }),
  confused: Object.freeze({
    glowActive: false,
    glowColor: "",
    swimSpeedMultiplier: 0.8,
    durationMs: 2000,
  }),
});

/**
 * @param {string} mood
 * @returns {{ mood: string, glowActive: boolean, glowColor: string, swimSpeedMultiplier: number, durationMs: number }}
 */
export function echoReactionForMood(mood) {
  const row = ECHO_MOOD_TABLE[mood] || ECHO_MOOD_TABLE.calm;
  const resolved = ECHO_MOOD_TABLE[mood] ? mood : "calm";
  return {
    mood: resolved,
    glowActive: row.glowActive,
    glowColor: row.glowColor,
    swimSpeedMultiplier: row.swimSpeedMultiplier,
    durationMs: row.durationMs,
  };
}
