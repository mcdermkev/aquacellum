import React from "react";
import { announce } from "../../utils/a11y";

/**
 * SettingsToggle — the one on/off switch for Settings.
 *
 * Companion to `SettingsRadioGroup`, extracted for the same reason: the switch
 * markup was already duplicated between `HighContrastToggle` and
 * `HapticsToggle`, and the Aquariums section needs a third. `AiCompanionToggle`
 * stays separate because it is a richer row (avatar, two-line description) built
 * for the companions card specifically.
 *
 * Accessibility follows `HighContrastToggle`, the spec's reference implementation
 * (docs/SETTINGS_SPEC.md AC-5): a real `<button>` with `role="switch"` and
 * `aria-checked` so Enter/Space work natively, a 44px minimum target, and
 * `announce()` on change because the effect of a settings toggle is usually not
 * visible on the settings screen itself.
 *
 * @param {object} props
 * @param {string} props.label - accessible name, e.g. "Grow-out reminders".
 * @param {boolean} props.enabled
 * @param {(next: boolean) => void} props.onChange
 * @param {string} [props.hint] - explanatory line rendered above the switch.
 * @param {string} [props.onLabel="On"]
 * @param {string} [props.offLabel="Off"]
 * @param {string} [props.announceOn] - full announcement for the on state.
 * @param {string} [props.announceOff]
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.disabledNote] - shown when disabled, explaining why.
 */
export function SettingsToggle({
  label,
  enabled,
  onChange,
  hint,
  onLabel = "On",
  offLabel = "Off",
  announceOn,
  announceOff,
  disabled = false,
  disabledNote,
}) {
  const handleToggle = () => {
    if (disabled) return;
    const next = !enabled;
    onChange(next);
    announce(
      next
        ? announceOn || `${label} turned on`
        : announceOff || `${label} turned off`
    );
  };

  return (
    <div>
      {hint && <p className="st-hint">{hint}</p>}

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={handleToggle}
        className="st-switch"
      >
        <span>{enabled ? onLabel : offLabel}</span>
        <span className="st-switch-track" aria-hidden="true">
          <span className="st-switch-thumb" />
        </span>
      </button>

      {disabled && disabledNote && (
        <p className="st-status st-status--warning">{disabledNote}</p>
      )}
    </div>
  );
}

export default SettingsToggle;
