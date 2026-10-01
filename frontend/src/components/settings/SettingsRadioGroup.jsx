import React, { useRef } from "react";
import { Check } from "@phosphor-icons/react";
import { announce } from "../../utils/a11y";
import { nextRadioIndex } from "./radioKeys";

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
 * visible result of a units change may be off-screen in another tab. The group
 * is a single Tab stop with arrow/Home/End movement (`radioKeys.js`).
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
  const optionRefs = useRef([]);

  const handleSelect = (next) => {
    if (next === value) return;
    onChange(next);
    const selectedLabel = options.find((o) => o.value === next)?.label || next;
    announce(`${announceAs || label} set to ${selectedLabel}`);
  };

  // Roving tabindex: the group is one Tab stop (the selected option, or the
  // first when nothing is selected) and the arrow keys move between options,
  // selecting as they go, per the WAI-ARIA radio group pattern.
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const handleKeyDown = (event, index) => {
    const next = nextRadioIndex(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
    handleSelect(options[next].value);
  };

  return (
    <div>
      {hint && <p className="st-hint">{hint}</p>}

      <div role="radiogroup" aria-label={label} className="st-choices">
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className="st-choice"
            >
              <span className="st-choice-main">
                <span className="st-choice-mark" aria-hidden="true">
                  {selected && <Check size={13} weight="bold" />}
                </span>
                <span className="st-choice-text">
                  <span className="st-choice-label">{option.label}</span>
                  {option.description && (
                    <span className="st-choice-desc">{option.description}</span>
                  )}
                </span>
              </span>
              {option.sample && (
                <span className="st-choice-sample" aria-hidden="true">
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
