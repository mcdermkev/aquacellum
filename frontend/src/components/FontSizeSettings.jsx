import React, { useState } from "react";
import { useFontSettings } from "../hooks/useFontSettings";
import { announce } from "../utils/a11y";

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
    return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading font settings…</p>;
  }

  return (
    <div>
      {/* Preview banner */}
      {previewMode && (
        <div style={{
          background: "rgba(251, 191, 36, 0.08)",
          border: "1px solid rgba(251, 191, 36, 0.25)",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 12,
          fontSize: 11,
          color: "#fbbf24"
        }}>
          📝 Preview mode - click Apply to keep changes or select another size
        </div>
      )}

      {/* Font scale options */}
      <div style={cardStyle}>
        <div id="font-scale-label" style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>
          Font Scale
        </div>

        <div role="radiogroup" aria-labelledby="font-scale-label">
          {Object.entries(availableScales).map(([scale, config]) => (
            <FontScaleOption
              key={scale}
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
      </div>

      {/* Sample text */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>
          Sample Text
        </div>
        <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "#38bdf8", marginBottom: 4 }}>
          Aquadex
        </div>
        <div style={{ fontSize: "var(--font-size-base)", color: "#e2e8f0", marginBottom: 4 }}>
          Your freshwater aquarium companion for species tracking and care logging.
        </div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "#94a3b8" }}>
          Tank parameters: pH 7.2 • Temp 24.5°C • 40L planted community tank
        </div>
      </div>

      {/* Reset button */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          onClick={handleReset}
          style={{
            padding: "6px 14px",
            fontSize: 11,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 6,
            color: "#f87171",
            cursor: "pointer",
          }}
        >
          Reset to Default
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
 * The preview fires on focus as well as hover, so tabbing through the options
 * previews each one — the keyboard equivalent of sweeping the mouse down the list.
 */
function FontScaleOption({
  config,
  isActive,
  isPreviewing,
  isSelected,
  onPreview,
  onApply,
  onPreviewEnd
}) {
  const borderColor = isActive 
    ? "#38bdf8" 
    : isPreviewing 
    ? "#fbbf24" 
    : "rgba(255, 255, 255, 0.08)";
    
  const backgroundColor = isActive
    ? "rgba(56, 189, 248, 0.08)"
    : isPreviewing
    ? "rgba(251, 191, 36, 0.08)"
    : "rgba(255, 255, 255, 0.02)";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={`${config.label} — ${config.description}`}
      onMouseEnter={!isActive ? onPreview : undefined}
      onMouseLeave={!isActive ? onPreviewEnd : undefined}
      onFocus={!isActive ? onPreview : undefined}
      onBlur={!isActive ? onPreviewEnd : undefined}
      onClick={() => !isActive && onApply()}
      style={{
        display: "block",
        width: "100%",
        minHeight: 44,
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        background: backgroundColor,
        cursor: isActive ? "default" : "pointer",
        transition: "all 0.2s ease"
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <span style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: isActive ? "#38bdf8" : isPreviewing ? "#fbbf24" : "#e2e8f0"
          }}>
            {config.label}
            {isActive && <span aria-hidden="true" style={{ marginLeft: 6 }}>✓</span>}
          </span>
          <span style={{ display: "block", fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {config.description}
          </span>
        </span>
        <span aria-hidden="true" style={{
          fontSize: 11,
          color: "#64748b",
          fontFamily: "monospace"
        }}>
          {config.value}×
        </span>
      </span>
    </button>
  );
}

// --- Styles ---
// No outer panel/close-button styles here anymore — the enclosing
// SettingsSection card owns that chrome now (AC-2).

const cardStyle = {
  background: "rgba(15, 23, 42, 0.6)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
};