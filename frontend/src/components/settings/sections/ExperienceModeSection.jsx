import React from "react";
import { SettingsSection } from "../SettingsSection";
import { ModeSegmentedControl } from "../../ModeSegmentedControl";

/**
 * ExperienceModeSection — Settings → Experience Mode.
 *
 * Split out of the old DataPortabilityWidget.jsx (docs/SETTINGS_SPEC.md §5).
 * Renders the same `ModeSegmentedControl` as the header (D-S-2): mode is a
 * display preference, not an entitlement, so it switches instantly with no
 * confirmation step. This card's value over the header control is the
 * explanation below, which the header has no room for.
 */
export function ExperienceModeSection({ casualModeActive, onToggleMode }) {
  return (
    <SettingsSection
      id="experience-mode"
      icon={casualModeActive ? "🐠" : "🧬"}
      title="Experience Mode"
      description={{
        casual:
          "You're currently in Casual Hobbyist mode. The interface uses friendly language, gamified progress, and keeps technical blockchain details tucked away.",
        pro:
          "You're currently in Professional Breeder mode. The interface uses operational language, shows lineage data, and exposes protocol-level details.",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ marginBottom: "1.25rem" }}>
        <ModeSegmentedControl
          casualModeActive={casualModeActive}
          onToggle={(newCasualVal) => { if (onToggleMode) onToggleMode(newCasualVal); }}
        />
      </div>

      <div
        style={{
          padding: "1rem",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <p style={{ fontSize: "0.75rem", color: "var(--text-primary)", fontWeight: 600, margin: "0 0 0.5rem" }}>
          What changes
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: "1.1rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            lineHeight: 1.6,
          }}
        >
          <li>Wording throughout — My Aquariums / Aquariums, Fish Finder / Breed Gallery, The Reef / Social, Breeder Store / Marketplace.</li>
          <li>Casual adds Echo's ambient companion and gamified progress; Pro shows lineage and protocol detail up front.</li>
          <li>Casual hides the Breeder Tools tab. That is the only tab that differs.</li>
        </ul>
        <p style={{ fontSize: "0.75rem", color: "var(--accent-green)", margin: "0.75rem 0 0", lineHeight: 1.5 }}>
          Nothing is locked either way. Every capability stays available in both modes, and you can
          switch back at any time.
        </p>
      </div>
    </SettingsSection>
  );
}

export default ExperienceModeSection;
