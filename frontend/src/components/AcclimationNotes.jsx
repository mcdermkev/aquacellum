import React from "react";

/**
 * AcclimationNotes — Optional textarea for recording acclimation details
 * when confirming specimen arrival. Persona-aware placeholders.
 */

const MAX_CHARS = 500;

function AcclimationNotes({ value = "", onChange, casualModeActive = true }) {
  const placeholder = casualModeActive
    ? "How did you acclimate? (optional)"
    : "Acclimation protocol notes (optional)";

  const charCount = (value || "").length;
  const isNearLimit = charCount > MAX_CHARS * 0.9;

  return (
    <div style={{ width: "100%" }}>
      <textarea
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          if (text.length <= MAX_CHARS) {
            onChange(text);
          }
        }}
        placeholder={placeholder}
        maxLength={MAX_CHARS}
        rows={3}
        aria-label={casualModeActive ? "Acclimation notes" : "Acclimation protocol notes"}
        style={{
          width: "100%",
          padding: "0.6rem 0.75rem",
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.03)",
          color: "var(--text-primary, #f1f5f9)",
          fontSize: "0.8rem",
          resize: "vertical",
          minHeight: "60px",
          fontFamily: "inherit",
          transition: "border-color 0.15s",
        }}
      />
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        marginTop: "0.25rem",
        fontSize: "0.65rem",
        color: isNearLimit ? "var(--accent-amber, #fbbf24)" : "var(--text-muted, #94a3b8)",
      }}>
        {charCount}/{MAX_CHARS}
      </div>
    </div>
  );
}

export { AcclimationNotes };
export default AcclimationNotes;
