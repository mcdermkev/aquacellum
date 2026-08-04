import React from "react";
import { announce } from "../../utils/a11y";

/**
 * AiCompanionToggle — one row of the Settings → AI Companions card.
 *
 * Replaces the two hand-rolled `<label>` + hidden-checkbox switches that read
 * `localStorage` inline during render (so a write never re-rendered and the thumb
 * could look stuck). State now comes from `useAiPrefs()` via props.
 *
 * Accessibility follows `HighContrastToggle`, which already got this right while
 * the panel beside it did not: a real `<button>` with `role="switch"` /
 * `aria-checked` (Enter and Space activate a button natively), a label, and
 * `announce()` so the change is perceivable when the visual result is off-screen —
 * turning Echo off hides a companion that may not be in view.
 *
 * Props:
 *   - name (string)        — display name, e.g. "Poseidon"
 *   - description (string) — one-line role description, mode-branched by the caller
 *   - avatarSrc (string)   — decorative avatar; rendered with empty alt
 *   - accentRgb (string)   — "6, 182, 212" — the row's accent as raw RGB channels
 *   - enabled (boolean)
 *   - onChange (function)  — called with the next boolean
 *   - note (string)        — optional line below the row (e.g. a coupling warning)
 */
export function AiCompanionToggle({
  name,
  description,
  avatarSrc,
  accentRgb,
  enabled,
  onChange,
  note,
}) {
  const handleToggle = () => {
    const next = !enabled;
    onChange(next);
    announce(`${name} ${next ? "enabled" : "disabled"}`);
  };

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={name}
        onClick={handleToggle}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          width: "100%",
          minHeight: 44,
          padding: "1rem",
          borderRadius: "12px",
          background: `rgba(${accentRgb}, 0.04)`,
          border: `1px solid rgba(${accentRgb}, ${enabled ? "0.35" : "0.12"})`,
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          {avatarSrc && (
            <img
              src={avatarSrc}
              alt=""
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                objectFit: "cover",
                border: `1.5px solid rgba(${accentRgb}, 0.3)`,
                flexShrink: 0,
                // Reads as "off" at a glance without relying on the thumb alone.
                opacity: enabled ? 1 : 0.45,
              }}
            />
          )}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, color: "#fff" }}>
              {name}
            </span>
            <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {description}
            </span>
          </span>
        </span>

        <span
          aria-hidden="true"
          style={{
            position: "relative",
            width: 44,
            height: 24,
            borderRadius: "12px",
            background: enabled ? `rgba(${accentRgb}, 0.5)` : "rgba(255,255,255,0.1)",
            border: `1px solid ${enabled ? `rgba(${accentRgb}, 0.6)` : "rgba(255,255,255,0.15)"}`,
            transition: "background 0.3s ease",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: enabled ? "21px" : "2px",
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.3s ease",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          />
        </span>
      </button>

      {note && (
        <p
          style={{
            margin: "0.4rem 0 0",
            fontSize: "0.7rem",
            color: "var(--accent-amber)",
            lineHeight: 1.4,
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

export default AiCompanionToggle;
