/**
 * useAiPrefs.js — the two AI companion preferences, in one place.
 *
 * Owns `aquadex_poseidon_enabled` and `aquadex_echo_enabled`.
 *
 * Why this exists (docs/SETTINGS_SPEC.md §4, D-S-4 and D-S-5). Before this hook:
 *
 *   1. `aquadex_echo_enabled` was written by the Settings toggle and read
 *      *nowhere*. Echo kept rendering regardless, while the pro copy claimed the
 *      toggle "hides the companion entity and suppresses gamification reactions".
 *   2. `aquadex:ai-prefs-changed` was dispatched and had **zero listeners**, while
 *      the footer copy claimed "Changes take effect immediately — no reload needed".
 *   3. Both Settings toggles read `localStorage` inline during render, so a write
 *      didn't re-render and the switch thumb could look stuck.
 *
 * All three are the same root cause: a preference with no owner. So: one hook owns
 * the keys in React state, broadcasts changes on the existing event, and listens
 * for both that event and cross-tab `storage` events. Every consumer converges
 * without a reload, which is what the copy already promised.
 *
 * Follows `useHighContrast.js`: load/persist/read logic is exported as plain
 * functions taking an injectable storage (this repo's vitest runs in a `node`
 * environment), and the hook is a thin React binding over them.
 *
 * ⚠️ Default is ENABLED. Storage holds `"true"`/`"false"` strings and anything
 * other than the exact string `"false"` reads as on — preserving the original
 * `localStorage.getItem(key) !== "false"` semantics at the 6 existing Poseidon
 * call sites (usePoseidon, useNaturalSearch, altTextGenerator, spawnNarration,
 * useEchoObservations). Do not switch to a truthy/`"1"` scheme without migrating
 * those, or every user who opted out silently gets opted back in.
 */
import { useCallback, useEffect, useState } from "react";

export const AI_PREFS_CHANGED_EVENT = "aquadex:ai-prefs-changed";

export const AI_PREF_KEYS = Object.freeze({
  poseidon: "aquadex_poseidon_enabled",
  echo: "aquadex_echo_enabled",
});

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Whether an AI feature is enabled. Defaults to true when unset or on any
 * storage error — an unreadable preference must never silently disable a
 * companion the user never turned off.
 *
 * @param {"poseidon"|"echo"} feature
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function isAiFeatureEnabled(feature, storage = safeLocalStorage()) {
  const key = AI_PREF_KEYS[feature];
  if (!key || !storage) return true;
  try {
    return storage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

/**
 * Read both preferences at once.
 * @param {Storage} [storage]
 * @returns {{ poseidonEnabled: boolean, echoEnabled: boolean }}
 */
export function loadAiPrefs(storage = safeLocalStorage()) {
  return {
    poseidonEnabled: isAiFeatureEnabled("poseidon", storage),
    echoEnabled: isAiFeatureEnabled("echo", storage),
  };
}

/**
 * Persist one preference. Silently degrades if storage is unavailable
 * (private browsing, quota) — the in-memory state for this session still works.
 *
 * @param {"poseidon"|"echo"} feature
 * @param {boolean} enabled
 * @param {Storage} [storage]
 */
export function persistAiPref(feature, enabled, storage = safeLocalStorage()) {
  const key = AI_PREF_KEYS[feature];
  if (!key || !storage) return;
  try {
    storage.setItem(key, enabled ? "true" : "false");
  } catch {
    // non-fatal
  }
}

/**
 * Tell every mounted consumer to re-read. Separate from `persistAiPref` so a
 * caller that writes several keys can broadcast once.
 */
export function broadcastAiPrefsChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT));
  } catch {
    // non-fatal
  }
}

/**
 * React binding. Returns the current values plus setters that persist and
 * broadcast, so a toggle rendered in Settings updates the companions rendered
 * in `App.jsx` with no reload.
 *
 * @returns {{
 *   poseidonEnabled: boolean,
 *   echoEnabled: boolean,
 *   setPoseidonEnabled: (v:boolean) => void,
 *   setEchoEnabled: (v:boolean) => void,
 *   setAiFeatureEnabled: (feature:"poseidon"|"echo", v:boolean) => void,
 * }}
 */
export function useAiPrefs() {
  const [prefs, setPrefs] = useState(() => loadAiPrefs());

  // Re-read on our own broadcast and on cross-tab `storage` events. Reading from
  // storage rather than trusting the event payload keeps storage the single
  // source of truth, so a direct writer that only calls `persistAiPref` +
  // `broadcastAiPrefsChanged` still converges every consumer.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const resync = () => setPrefs(loadAiPrefs());

    const onStorage = (event) => {
      // `key === null` is a `localStorage.clear()`; re-read for that too.
      if (event.key === null || Object.values(AI_PREF_KEYS).includes(event.key)) {
        resync();
      }
    };

    window.addEventListener(AI_PREFS_CHANGED_EVENT, resync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AI_PREFS_CHANGED_EVENT, resync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setAiFeatureEnabled = useCallback((feature, enabled) => {
    const next = !!enabled;
    persistAiPref(feature, next, safeLocalStorage());
    // Update locally first so the control responds even if the event is lost.
    setPrefs((prev) => ({
      ...prev,
      [feature === "poseidon" ? "poseidonEnabled" : "echoEnabled"]: next,
    }));
    broadcastAiPrefsChanged();
  }, []);

  const setPoseidonEnabled = useCallback(
    (value) => setAiFeatureEnabled("poseidon", value),
    [setAiFeatureEnabled]
  );

  const setEchoEnabled = useCallback(
    (value) => setAiFeatureEnabled("echo", value),
    [setAiFeatureEnabled]
  );

  return {
    poseidonEnabled: prefs.poseidonEnabled,
    echoEnabled: prefs.echoEnabled,
    setPoseidonEnabled,
    setEchoEnabled,
    setAiFeatureEnabled,
  };
}

export default useAiPrefs;
