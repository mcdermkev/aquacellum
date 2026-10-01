import React from "react";
import { DeviceMobile } from "@phosphor-icons/react";
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
    <SettingsSection
      id="app"
      icon={<DeviceMobile size={20} />}
      title="App & Support"
      casualModeActive={casualModeActive}
    >
      <div className="st-stack">
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
      <p className="st-text" style={{ margin: 0 }}>
        Aquacellum <span className="st-mono">v{CURRENT_VERSION}</span>
      </p>
    </div>
  );
}

export default AppSupportSection;
