import React, { useEffect } from "react";
import { useAiPrefs } from "../../hooks/useAiPrefs";
import { useHighContrast } from "../../hooks/useHighContrast";
import { ExperienceModeSection } from "./sections/ExperienceModeSection";
import { AccountSection } from "./sections/AccountSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { AccessibilitySection } from "./sections/AccessibilitySection";
import { CompanionsSection } from "./sections/CompanionsSection";
import { UnitsSection } from "./sections/UnitsSection";
import { AquariumsSection } from "./sections/AquariumsSection";
import { DiscoverySection } from "./sections/DiscoverySection";
import { SellerSection } from "./sections/SellerSection";
import { ZoneSection } from "./sections/ZoneSection";
import { BackupSection } from "./sections/BackupSection";
import { AppSupportSection } from "./sections/AppSupportSection";
import { SmartWalletSection } from "./sections/SmartWalletSection";
import { ResetSection } from "./sections/ResetSection";
import { PrivacySection } from "./sections/PrivacySection";

/**
 * SettingsPanel — the single child of `App.jsx`'s `case "settings"`
 * (docs/SETTINGS_SPEC.md AC-1).
 *
 * Replaces `DataPortabilityWidget.jsx` (1112 lines, nine unrelated concerns,
 * named after its second section, no shared card primitive) plus the two
 * siblings App.jsx rendered directly alongside it (`FontSizeSettings`,
 * `HighContrastToggle`). Every section below is now a `SettingsSection`
 * (AC-2) living in its own file under 300 lines (AC-1).
 *
 * Section order follows docs/SETTINGS_SPEC.md §6's grouping — "the switch
 * that changes everything else first; the irreversible things last" — for
 * every section that exists as of Phase 3. Sections not yet built
 * (`account`, `units`, `aquariums`, `discovery`, `seller`, `privacy` — all
 * Phase 4/4b per the phase map in §9) are simply absent rather than stubbed;
 * an empty placeholder card would itself be a dead control.
 *
 * Group headings are visual only — Settings is one scrolling page, not
 * sub-tabs (§6: "Sections are individually collapsible… Settings is a page
 * you scan, and sub-tabs hide the thing you are hunting for").
 */
export function SettingsPanel({
  casualModeActive,
  onToggleMode,
  contractAddress,
  walletAccount,
  displayTank,
  setDisplayTank,
  onSyncNow,
  syncStatus,
  lastSyncedAt,
}) {
  const { poseidonEnabled, echoEnabled, setPoseidonEnabled, setEchoEnabled } = useAiPrefs();
  // A second, independent binding to the same persisted preference — the
  // app-wide *application* of high contrast is still the root-level
  // useHighContrast() call in App.jsx (unchanged); this one just gives the
  // Accessibility section its own { enabled, toggle } to render the switch.
  // This is exactly the "thin React binding over shared load/persist/apply
  // functions" useHighContrast() was built as, so two independent call sites
  // stay in sync via the same localStorage-backed functions.
  const highContrast = useHighContrast();

  // Deep-link support (`id` doubles as the anchor per SettingsSection's
  // docblock): #settings/notifications scrolls to and focuses that section on
  // mount, matching how the rest of the app treats tab hashes.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const sectionId = hash.startsWith("settings/") ? hash.slice("settings/".length) : null;
    if (!sectionId) return;
    const el = document.getElementById(`settings-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-panel__group-heading">You</div>
      <ExperienceModeSection casualModeActive={casualModeActive} onToggleMode={onToggleMode} />
      <AccountSection casualModeActive={casualModeActive} />

      <div className="settings-panel__group-heading">Alerts</div>
      <NotificationsSection casualModeActive={casualModeActive} poseidonAiDisabled={!poseidonEnabled} />

      <div className="settings-panel__group-heading">Interface</div>
      <AccessibilitySection casualModeActive={casualModeActive} highContrast={highContrast} />
      <UnitsSection casualModeActive={casualModeActive} />
      <CompanionsSection
        casualModeActive={casualModeActive}
        poseidonEnabled={poseidonEnabled}
        echoEnabled={echoEnabled}
        setPoseidonEnabled={setPoseidonEnabled}
        setEchoEnabled={setEchoEnabled}
      />

      <div className="settings-panel__group-heading">Your Fishroom</div>
      <AquariumsSection
        casualModeActive={casualModeActive}
        contractAddress={contractAddress}
        walletAccount={walletAccount}
        displayTank={displayTank}
        setDisplayTank={setDisplayTank}
        onSyncNow={onSyncNow}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
      />
      <DiscoverySection casualModeActive={casualModeActive} />
      <SellerSection casualModeActive={casualModeActive} />
      <ZoneSection casualModeActive={casualModeActive} />

      <div className="settings-panel__group-heading">App</div>
      <BackupSection casualModeActive={casualModeActive} />
      <AppSupportSection casualModeActive={casualModeActive} />
      <SmartWalletSection casualModeActive={casualModeActive} />
      <ResetSection casualModeActive={casualModeActive} />
      {/*
        Privacy & Data renders LAST, after Reset (docs/SETTINGS_SPEC.md D-S-1 and
        §6's ordering principle: the irreversible things last). Account deletion is
        the most consequential control in the product, and Reset now points down to
        it for anyone who mistook one for the other.
      */}
      <PrivacySection casualModeActive={casualModeActive} />
    </div>
  );
}

export default SettingsPanel;
