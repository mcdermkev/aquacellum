/**
 * haptics.js
 *
 * Centralized, accessibility-aware haptic feedback for primary actions.
 *
 * Previously `navigator.vibrate(...)` was called ad-hoc with magic-number
 * patterns scattered through the app. This module unifies those into named
 * intents so feedback stays consistent across XP toasts, care logging,
 * purchases, posting, and level-ups.
 *
 * Respects two opt-outs:
 *   1. `prefers-reduced-motion: reduce` (treated as "minimize non-essential
 *      sensory feedback").
 *   2. An explicit user setting persisted at `localStorage.aquadex_haptics`
 *      ("off" disables, anything else / unset enables).
 *
 * All calls are no-ops on devices without the Vibration API (most desktops,
 * iOS Safari), so callers never need to feature-detect.
 */

import { prefersReducedMotion } from "./a11y.js";

const SETTING_KEY = "aquadex_haptics";

// Named vibration patterns (ms). Keep these short (<200ms total where possible)
// so feedback feels like a tactile "tick", never a buzz.
const PATTERNS = {
  // A light tap for routine primary actions (log, post, toggle, buy tap).
  tap: 40,
  // A slightly firmer confirmation for a completed/successful action.
  success: 55,
  // A short double-buzz to signal something needs attention.
  error: [40, 40, 40],
  // A celebratory triple pulse reserved for level-ups / milestone unlocks.
  levelUp: [50, 30, 80],
};

/**
 * Whether haptics are currently allowed to fire.
 */
export function hapticsEnabled() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    if (localStorage.getItem(SETTING_KEY) === "off") return false;
  } catch {
    // localStorage may be unavailable (private mode / SSR) — fall through.
  }
  if (prefersReducedMotion()) return false;
  return true;
}

/**
 * Persist the user's haptics preference. Pass `false` to disable.
 */
export function setHapticsEnabled(enabled) {
  try {
    localStorage.setItem(SETTING_KEY, enabled ? "on" : "off");
  } catch {
    // Ignore persistence failures — feedback simply won't be remembered.
  }
}

/**
 * Fire a haptic pattern by name, or pass a custom number / array pattern.
 * Safe to call anywhere: silently no-ops when unsupported or opted out.
 *
 * @param {keyof typeof PATTERNS | number | number[]} intent
 */
export function haptic(intent = "tap") {
  if (!hapticsEnabled()) return;
  const pattern = typeof intent === "string" ? PATTERNS[intent] : intent;
  if (pattern == null) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw on certain patterns — never let feedback break a flow.
  }
}

// Convenience named exports for readability at call sites.
export const tap = () => haptic("tap");
export const success = () => haptic("success");
export const error = () => haptic("error");
export const levelUp = () => haptic("levelUp");
