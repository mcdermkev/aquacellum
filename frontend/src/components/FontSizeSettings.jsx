import React, { useState } from "react";
import { useFontSettings } from "../hooks/useFontSettings";

/**
 * FontSizeSettings — Panel for configuring application-wide font size settings.
 *
 * Lets users:
 * - Select font scale (small, medium, large, extra large)
 * - Preview font sizes before applying
 * - Reset to default settings
 * - See sample text at different scales
 */
export function FontSizeSettings({ onClose }) {
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
  };

  const handleReset = () => {
    resetSettings();
    setPreviewMode(false);
    setTempScale('medium');
  };

  if (!ready) {
    return (
      <div style={panelStyle}>
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading font settings…</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "#38bdf8" }}>
          🔤 Font Size Settings
        </h3>
        {onClose && (
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close font settings">
            ✕
          </button>
        )}
      </div>

      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.4 }}>
        Adjust the application font size for better readability. Changes apply to all text 
        throughout the interface.
      </p>

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
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>
          Font Scale
        </div>
        
        {Object.entries(availableScales).map(([scale, config]) => (
          <FontScaleOption
            key={scale}
            scale={scale}
            config={config}
            isActive={currentScale === scale && !previewMode}
            isPreviewing={previewMode && tempScale === scale}
            onPreview={() => handlePreviewStart(scale)}
            onApply={() => handleApplyScale(scale)}
            onPreviewEnd={handlePreviewEnd}
          />
        ))}
      </div>

      {/* Sample text */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>
          Sample Text
        </div>
        <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "#38bdf8", marginBottom: 4 }}>
          Aquacellum Tank Manager
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

/** Individual font scale option */
function FontScaleOption({ 
  scale, 
  config, 
  isActive, 
  isPreviewing, 
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
    <div style={{
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      padding: "10px 12px",
      marginBottom: 8,
      background: backgroundColor,
      cursor: "pointer",
      transition: "all 0.2s ease"
    }}
    onMouseEnter={!isActive ? onPreview : undefined}
    onMouseLeave={!isActive ? onPreviewEnd : undefined}
    onClick={() => !isActive && onApply()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            color: isActive ? "#38bdf8" : isPreviewing ? "#fbbf24" : "#e2e8f0" 
          }}>
            {config.label}
            {isActive && <span style={{ marginLeft: 6 }}>✓</span>}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {config.description}
          </div>
        </div>
        <div style={{ 
          fontSize: 11, 
          color: "#64748b", 
          fontFamily: "monospace" 
        }}>
          {config.value}×
        </div>
      </div>
    </div>
  );
}

// --- Styles ---

const panelStyle = {
  position: "relative",
  width: "100%",
  maxWidth: 640,
  margin: "0 auto",
  background: "rgba(10, 22, 40, 0.95)",
  border: "1px solid rgba(56, 189, 248, 0.2)",
  borderRadius: 14,
  padding: "16px 18px",
  color: "#e2e8f0",
  fontFamily: "system-ui, sans-serif",
  backdropFilter: "blur(14px)",
};

const closeBtnStyle = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  fontSize: 16,
  cursor: "pointer",
};

const cardStyle = {
  background: "rgba(15, 23, 42, 0.6)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
};