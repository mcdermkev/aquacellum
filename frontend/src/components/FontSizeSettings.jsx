import React, { useRef, useState } from "react";
import { ArrowCounterClockwise, Check, Eye } from "@phosphor-icons/react";
import { useFontSettings } from "../hooks/useFontSettings";
import { announce } from "../utils/a11y";
import { nextRadioIndex } from "./settings/radioKeys";

/**
 * FontSizeSettings — Font scale controls for the Settings → Accessibility
 * section.
 *
 * Lets users:
 * - Select font scale (small, medium, large, extra large)
 * - Preview font sizes before applying
 * - Reset to default settings
 * - See sample text at different scales
 *
 * Renders as plain content inside a `SettingsSection` card (docs/
 * SETTINGS_SPEC.md §5, AC-2) — it no longer draws its own navy/`system-ui`
 * panel or duplicate heading; the section primitive already provides both.
 * `onClose` is now unused, kept only so any lingering caller passing it
 * doesn't crash; there is nothing to close once this is inline content.
 */
export function FontSizeSettings() {
  const {
    currentScale,
    availableScales,
    updateFontScale,
    resetSettings,
    previewScale,
    ready
  } = useFontSettings();

  const [previewMode, setPreviewMode] = useState(false);
  const [tempScale, setTempScale] = useState(currentScale);
  // Index of the option that has focus, or null when focus is outside the group.
  const [focusedIndex, setFocusedIndex] = useState(null);
  const optionRefs = useRef([]);

  const handlePreviewStart = (scale) => {
    setPreviewMode(true);
    setTempScale(scale);
    previewScale(scale);
  };

  const handlePreviewEnd = () => {
    if (previewMode) {
      previewScale(currentScale); // Reset to current scale
      setPreviewMode(false);
      setTempScale(currentScale);
    }
  };

  const handleApplyScale = (scale) => {
    updateFontScale(scale);
    setPreviewMode(false);
    setTempScale(scale);
    // The visual result (text resizing) is not announced by screen readers, so say
    // it — same reason HighContrastToggle announces its state change.
    announce(`Font size set to ${availableScales[scale]?.label || scale}`);
  };

  const handleReset = () => {
    resetSettings();
    setPreviewMode(false);
    setTempScale('medium');
    announce("Font size reset to default");
  };

  if (!ready) {
    return <p className="st-empty">Loading font settings…</p>;
  }

  const scaleEntries = Object.entries(availableScales);
  const currentIndex = scaleEntries.findIndex(([scale]) => scale === currentScale);
  // While focus is inside the group the focused option is the Tab stop, so Tab
  // and Shift+Tab leave the group even after arrowing away from the stored
  // size. Once focus leaves, the stored size is the Tab stop again.
  const tabStop = focusedIndex ?? (currentIndex >= 0 ? currentIndex : 0);

  // Keyboard: the group is one Tab stop. Arrow keys and Home/End move focus
  // between sizes, and focus previews each one through the existing onFocus
  // handler, the keyboard version of sweeping the mouse down the list. Enter or
  // Space keeps the focused size (the native button click). Moving focus does
  // not apply a size, so this stays preview-then-apply.
  const handleOptionKeyDown = (event, index) => {
    const next = nextRadioIndex(event.key, index, scaleEntries.length);
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };

  const handleGroupFocus = (event) => {
    const index = optionRefs.current.indexOf(event.target);
    if (index >= 0) setFocusedIndex(index);
  };

  const handleGroupBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null);
  };

  return (
    <div>
      {/* Preview banner */}
      {previewMode && (
        <div className="st-callout st-callout--amber" style={{ marginBottom: "0.75rem" }}>
          <Eye size={20} aria-hidden="true" />
          <p>Previewing this size. Select it to keep it.</p>
        </div>
      )}

      {/* Font scale options */}
      <p id="font-scale-label" className="st-label" style={{ margin: "0 0 0.5rem" }}>
        Choose a size
      </p>

      <div
        role="radiogroup"
        aria-labelledby="font-scale-label"
        className="st-choices"
        onFocus={handleGroupFocus}
        onBlur={handleGroupBlur}
      >
        {scaleEntries.map(([scale, config], index) => (
          <FontScaleOption
            key={scale}
            buttonRef={(el) => {
              optionRefs.current[index] = el;
            }}
            tabIndex={index === tabStop ? 0 : -1}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
            config={config}
            isActive={currentScale === scale && !previewMode}
            isPreviewing={previewMode && tempScale === scale}
            isSelected={currentScale === scale}
            onPreview={() => handlePreviewStart(scale)}
            onApply={() => handleApplyScale(scale)}
            onPreviewEnd={handlePreviewEnd}
          />
        ))}
      </div>

      {/* Sample text */}
      <div className="st-well" style={{ marginTop: "0.9rem" }}>
        <p className="st-label" style={{ margin: "0 0 0.4rem" }}>Preview</p>
        <p className="st-sample-title">Aquacellum</p>
        <p className="st-sample-body">Track your tanks, fish and care logs in one place.</p>
        <p className="st-sample-meta">
          Tank parameters: pH 7.2 • Temp 24.5°C • 40L planted community tank
        </p>
      </div>

      {/* Reset: harmless, so a neutral button rather than a red one */}
      <div className="st-actions" style={{ marginTop: "0.9rem" }}>
        <button type="button" className="st-btn" onClick={handleReset}>
          <ArrowCounterClockwise size={18} aria-hidden="true" />
          Reset to default size
        </button>
      </div>
    </div>
  );
}

/**
 * Individual font scale option.
 *
 * A real `<button role="radio">`, not a `<div onClick>`. This used to be an
 * accessibility defect inside the accessibility panel: no `role`, no `tabIndex`,
 * no key handler, and a preview that only fired on `onMouseEnter` — so the whole
 * control was mouse-only, and the sighted keyboard users most likely to want a
 * larger font could not reach it. `HighContrastToggle` immediately below already
 * did this correctly; this now matches it.
 *
 * The preview fires on focus as well as hover, so moving through the options
 * with the arrow keys previews each one — the keyboard equivalent of sweeping
 * the mouse down the list. Styled by `.st-choice*` (SettingsDaylight.css): the
 * stored size reads as selected, a size being previewed reads amber.
 */
function FontScaleOption({
  buttonRef,
  tabIndex,
  onKeyDown,
  config,
  isActive,
  isPreviewing,
  isSelected,
  onPreview,
  onApply,
  onPreviewEnd
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={`${config.label}, ${config.description}`}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onMouseEnter={!isActive ? onPreview : undefined}
      onMouseLeave={!isActive ? onPreviewEnd : undefined}
      onFocus={!isActive ? onPreview : undefined}
      onBlur={!isActive ? onPreviewEnd : undefined}
      onClick={() => !isActive && onApply()}
      className={`st-choice${isPreviewing && !isSelected ? " st-choice--preview" : ""}`}
    >
      <span className="st-choice-main">
        <span className="st-choice-mark" aria-hidden="true">
          {isSelected && <Check size={13} weight="bold" />}
        </span>
        <span className="st-choice-text">
          <span className="st-choice-label">{config.label}</span>
          <span className="st-choice-desc">{config.description}</span>
        </span>
      </span>
      <span className="st-choice-sample" aria-hidden="true">
        {config.value}×
      </span>
    </button>
  );
}