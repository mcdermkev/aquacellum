/**
 * useHighContrast.js — app-wide high-contrast mode (Task 21D).
 *
 * Mirrors `useFontSettings.js`'s pattern: a localStorage-persisted
 * preference, applied globally via a root attribute so the choice isn't
 * limited to whenever the Settings panel happens to be mounted (see the
 * root-level `useHighContrast()` call in `App.jsx`, matching the existing
 * `useFontSettings()` call).
 *
 * The load/persist/apply logic is exported as plain functions, each taking
 * an injectable storage/target (defaulting to the real `localStorage`/
 * `document.documentElement`) so it's testable without a DOM (this repo's
 * vitest runs in a `node` environment — see docs/TASK_21D_PWA_HARDENING_SPEC.md
 * §5: "or a pure helper if the hook is thin"). The hook itself is a thin
 * React binding over these functions, same as useFontSettings.
 */

import { useCallback, useEffect, useState } from "react";

const HIGH_CONTRAST_STORAGE_KEY = "aquadex_high_contrast";
const CONTRAST_ATTRIBUTE = "data-contrast";
const CONTRAST_VALUE = "high";

/**
 * Load the persisted high-contrast preference. Defaults to false (off) when
 * unset or on any storage error — never assume a preference the user didn't
 * set.
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function loadHighContrastPreference(storage = safeLocalStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persist the high-contrast preference. Silently degrades if storage is
 * unavailable (private browsing, quota, etc.) — the in-memory/applied state
 * for this session still works.
 * @param {boolean} enabled
 * @param {Storage} [storage]
 */
export function persistHighContrastPreference(enabled, storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    storage.setItem(HIGH_CONTRAST_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // non-fatal — localStorage may be unavailable
  }
}

/**
 * Apply (or remove) the `data-contrast="high"` attribute on the given root
 * element, which the `[data-contrast="high"]` CSS ruleset in index.css keys
 * off of. Composes/extends the existing OS-level `prefers-contrast` rules —
 * this manual toggle and the media query both key off the same underlying
 * high-contrast styles.
 * @param {boolean} enabled
 * @param {{ setAttribute: Function, removeAttribute: Function }} [target]
 */
export function applyHighContrast(enabled, target = safeDocumentElement()) {
  if (!target) return;
  if (enabled) target.setAttribute(CONTRAST_ATTRIBUTE, CONTRAST_VALUE);
  else target.removeAttribute(CONTRAST_ATTRIBUTE);
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function safeDocumentElement() {
  return typeof document !== "undefined" ? document.documentElement : null;
}

/**
 * React binding: persisted boolean + app-wide application on every change
 * (and on mount, so a page refresh keeps the preference applied even before
 * any effect from a re-render).
 * @returns {{ enabled:boolean, toggle:Function, setEnabled:Function }}
 */
export function useHighContrast() {
  const [enabled, setEnabledState] = useState(() => loadHighContrastPreference());

  useEffect(() => {
    applyHighContrast(enabled);
    persistHighContrastPreference(enabled);
  }, [enabled]);

  // Re-apply on mount too, mirroring useFontSettings' own belt-and-suspenders
  // mount effect (guards against any render path that skipped the effect
  // above before the root attribute was ever set this session).
  useEffect(() => {
    applyHighContrast(enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEnabled = useCallback((value) => {
    setEnabledState(!!value);
  }, []);

  const toggle = useCallback(() => {
    setEnabledState((prev) => !prev);
  }, []);

  return { enabled, toggle, setEnabled };
}
