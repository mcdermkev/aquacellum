import React from "react";
import { Info, SlidersHorizontal } from "@phosphor-icons/react";
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
      icon={<SlidersHorizontal size={20} />}
      title="Experience Mode"
      description={{
        casual:
          "You're in Casual mode: everyday words, progress rewards, and the technical record details kept out of the way.",
        pro:
          "You're in Pro mode: breeder terms, lineage data and record details shown up front.",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ marginBottom: "1.1rem" }}>
        <ModeSegmentedControl
          casualModeActive={casualModeActive}
          onToggle={(newCasualVal) => { if (onToggleMode) onToggleMode(newCasualVal); }}
        />
      </div>

      <div className="st-callout">
        <Info size={20} aria-hidden="true" />
        <div className="st-callout-body">
          <p className="st-callout-title">What changes</p>
          <ul>
            <li>Tab and page names: My Aquariums or Aquariums, Fish Finder or Breed Gallery, The Reef or Social, Breeder Store or Marketplace.</li>
            <li>Casual adds Echo and progress rewards. Pro shows lineage and record details up front.</li>
            <li>Casual hides the Breeder Tools tab. That is the only tab that differs.</li>
          </ul>
          <p className="st-callout-note">
            Nothing is locked either way. Every capability stays available in both modes, and you can
            switch back at any time.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

export default ExperienceModeSection;
