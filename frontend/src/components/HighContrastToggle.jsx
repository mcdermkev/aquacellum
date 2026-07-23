import React from "react";
import { announce } from "../utils/a11y";

/**
 * HighContrastToggle — Settings-tab control for app-wide high-contrast mode
 * (Task 21D). Sits in the same accessibility cluster as FontSizeSettings.
 *
 * A real `<button>` with `role="switch"`/`aria-checked` (keyboard-operable
 * by default — Enter/Space activate a button natively), labeled, and
 * `announce()`s the new state so the change is perceivable to screen-reader
 * users even though the visual change (contrast) is not.
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
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "#38bdf8" }}>
          ◐ High Contrast Mode
        </h3>
      </div>

      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 14, lineHeight: 1.4 }}>
        Increases text, border, and surface contrast throughout the app for better readability.
      </p>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="High contrast mode"
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          minHeight: 44,
          padding: "10px 14px",
          borderRadius: 10,
          border: `1px solid ${enabled ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
          background: enabled ? "rgba(56, 189, 248, 0.08)" : "rgba(255,255,255,0.02)",
          color: "#e2e8f0",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <span>{enabled ? "On" : "Off"}</span>
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            width: 40,
            height: 22,
            borderRadius: 11,
            background: enabled ? "#38bdf8" : "rgba(255,255,255,0.15)",
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
    </div>
  );
}

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
