import React from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { InstallAppPanel } from "../InstallAppPanel";
import { CURRENT_VERSION } from "../../WhatsNewModal";

/**
 * AppSupportSection — Settings → App & Support.
 *
 * Install App + a version/build readout. The old "Replay Onboarding" card was
 * removed along with the onboarding wizard it replayed (the Starter Quest in the
 * Profile hub is the new activation surface).
 */
export function AppSupportSection({ casualModeActive }) {
  return (
    <SettingsSection id="app" icon="📲" title="App & Support" casualModeActive={casualModeActive}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <InstallAppPanel casualModeActive={casualModeActive} />
        <VersionSubsection />
      </div>
    </SettingsSection>
  );
}

function VersionSubsection() {
  return (
    <div>
      <SubsectionLabel>Version</SubsectionLabel>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Aquadex <span style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>v{CURRENT_VERSION}</span>
      </p>
    </div>
  );
}

export default AppSupportSection;
