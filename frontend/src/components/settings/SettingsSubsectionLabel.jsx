import React from "react";

/**
 * SettingsSubsectionLabel — the small uppercase heading that divides a
 * `SettingsSection` into named groups ("Temperature", "Active tank", "Version").
 *
 * Extracted because four sections had each declared their own identical local
 * copy. It is also a real heading (`<h4>`) rather than a styled `<span>`, so the
 * panel keeps a valid heading outline under each section's `<h3>` — AC-5 requires
 * every section heading to be a real heading in document order, and subsection
 * labels are part of that outline.
 */
export function SettingsSubsectionLabel({ children }) {
  return (
    <h4
      style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-muted)",
        margin: "0 0 0.6rem",
      }}
    >
      {children}
    </h4>
  );
}

export default SettingsSubsectionLabel;
