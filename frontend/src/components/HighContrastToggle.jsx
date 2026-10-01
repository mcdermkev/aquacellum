import React from "react";
import { announce } from "../utils/a11y";

/**
 * HighContrastToggle — Settings → Accessibility control for app-wide
 * high-contrast mode (Task 21D). Sits in the same accessibility cluster as
 * FontSizeSettings.
 *
 * A real `<button>` with `role="switch"`/`aria-checked` (keyboard-operable
 * by default — Enter/Space activate a button natively), labeled, and
 * `announce()`s the new state so the change is perceivable to screen-reader
 * users even though the visual change (contrast) is not.
 *
 * Renders as plain content inside a `SettingsSection` card (docs/
 * SETTINGS_SPEC.md §5, AC-2) — no own panel or heading; the accessibility
 * section already provides both. Uses the shared `.st-switch` look from
 * settings/SettingsDaylight.css, the same as SettingsToggle.
 *
 * Props:
 *   - enabled (boolean) — current state, from useHighContrast()
 *   - onToggle (function) — flips the state, from useHighContrast()
 */
export function HighContrastToggle({ enabled, onToggle }) {
  const handleToggle = () => {
    onToggle();
    announce(enabled ? "High contrast mode turned off" : "High contrast mode turned on");
  };

  return (
    <div>
      <p className="st-hint">Darker text and stronger borders across the app.</p>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="High contrast mode"
        onClick={handleToggle}
        className="st-switch"
      >
        <span>{enabled ? "On" : "Off"}</span>
        <span className="st-switch-track" aria-hidden="true">
          <span className="st-switch-thumb" />
        </span>
      </button>
    </div>
  );
}

