import React from "react";
import { announce } from "../../utils/a11y";

/**
 * SettingsRadioGroup — the one "pick exactly one option" control for Settings.
 *
 * Extracted because this pattern was about to exist four times: `FontScaleOption`
 * (font size), `ReducedMotionOverride` (motion), and both Units controls. Three
 * hand-rolled copies is how the styling drift described in
 * docs/SETTINGS_SPEC.md §5 happened the first time, so the fourth one is a
 * primitive instead.
 *
 * Accessibility is the reason this is a component rather than a style object.
 * The original `FontScaleOption` was a `<div onClick>` with no role, no tabIndex
 * and no key handler — an a11y defect inside the accessibility panel (AC-5). Here
 * every option is a real `<button role="radio">` inside a labelled `radiogroup`,
 * so Enter/Space work natively, and the selection is `announce()`d because the
 * visible result of a units change may be off-screen in another tab.
 *
 * @param {object} props
 * @param {string} props.label - accessible name for the group.
 * @param {Array<{value: string, label: string, description?: string}>} props.options
 * @param {string} props.value - currently selected option value.
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.hint] - optional explanatory line above the options.
 * @param {string} [props.announceAs] - noun used in the screen-reader
 *   announcement, e.g. "Distance unit". Falls back to `label`.
 */
export function SettingsRadioGroup({
  label,
  options,
  value,
  onChange,
  hint,
  announceAs,
}) {
  const handleSelect = (next) => {
    if (next === value) return;
    onChange(next);
    const selectedLabel = options.find((o) => o.value === next)?.label || next;
    announce(`${announceAs || label} set to ${selectedLabel}`);
  };

  return (
    <div>
      {hint && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
          {hint}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label={label}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => handleSelect(option.value)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                minHeight: 44,
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                border: `1px solid ${selected ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 8,
                padding: "10px 12px",
                background: selected ? "rgba(56, 189, 248, 0.08)" : "rgba(255,255,255,0.02)",
                cursor: selected ? "default" : "pointer",
              }}
            >
              <span>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: selected ? "#38bdf8" : "var(--text-primary)",
                  }}
                >
                  {option.label}
                  {selected && (
                    <span aria-hidden="true" style={{ marginLeft: 6 }}>
                      ✓
                    </span>
                  )}
                </span>
                {option.description && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {option.description}
                  </span>
                )}
              </span>
              {option.sample && (
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                    marginLeft: 12,
                  }}
                >
                  {option.sample}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SettingsRadioGroup;
