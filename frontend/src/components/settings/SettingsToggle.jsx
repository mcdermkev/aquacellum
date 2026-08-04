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
      {hint && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
          {hint}
        </p>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          minHeight: 44,
          padding: "10px 14px",
          borderRadius: 10,
          border: `1px solid ${enabled && !disabled ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
          background: enabled && !disabled ? "rgba(56, 189, 248, 0.08)" : "rgba(255,255,255,0.02)",
          color: "var(--text-primary)",
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <span>{enabled ? onLabel : offLabel}</span>
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            width: 40,
            height: 22,
            borderRadius: 11,
            background: enabled && !disabled ? "#38bdf8" : "rgba(255,255,255,0.15)",
            transition: "background 0.2s ease",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? 20 : 2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s ease",
            }}
          />
        </span>
      </button>

      {disabled && disabledNote && (
        <p
          style={{
            margin: "0.4rem 0 0",
            fontSize: 11,
            color: "var(--accent-amber)",
            lineHeight: 1.4,
          }}
        >
          {disabledNote}
        </p>
      )}
    </div>
  );
}

export default SettingsToggle;
