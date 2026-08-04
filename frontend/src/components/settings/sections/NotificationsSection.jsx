import React from "react";
import { SettingsSection } from "../SettingsSection";
import { SonarPreferences } from "../../reef/SonarPreferences";

/**
 * NotificationsSection — Settings → Notifications ("Sonar & Alerts" in Pro).
 *
 * Wraps `SonarPreferences` without rewriting it (constraint #8 — reworked
 * last session across six push-notification bugs; its permission-request
 * ordering is load-bearing). This wrapper's only job is the section chrome
 * and the Poseidon coupling: `poseidonAiDisabled` comes from the AI
 * Companions toggle (useAiPrefs) so the Poseidon notification category
 * reflects, rather than ignores, the switch that turns Poseidon off
 * (docs/SETTINGS_SPEC.md §6 #3 — previously zero relationship between them).
 */
export function NotificationsSection({ casualModeActive, poseidonAiDisabled }) {
  return (
    <SettingsSection
      id="notifications"
      icon="🔔"
      title={{ casual: "Notifications", pro: "Sonar & Alerts" }}
      casualModeActive={casualModeActive}
    >
      <SonarPreferences
        casualModeActive={casualModeActive}
        poseidonAiDisabled={poseidonAiDisabled}
        embedded
      />
    </SettingsSection>
  );
}

export default NotificationsSection;
