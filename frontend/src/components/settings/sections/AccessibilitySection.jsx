import React from "react";
import { Wheelchair } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel } from "../SettingsSubsectionLabel";
import { FontSizeSettings } from "../../FontSizeSettings";
import { HighContrastToggle } from "../../HighContrastToggle";
import { HapticsToggle } from "../HapticsToggle";
import { ReducedMotionOverride } from "../ReducedMotionOverride";

/**
 * AccessibilitySection — Settings → Accessibility.
 *
 * `FontSizeSettings` and `HighContrastToggle` used to draw their own navy/
 * `system-ui` panel, a visibly different product from the rest of the tab
 * (docs/SETTINGS_SPEC.md §5). Both were restyled in Phase 3 to render as
 * plain content and are composed here inside one `SettingsSection`, along
 * with the two previously-orphaned prefs this section rescues (handoff §3.5):
 * haptics (`HapticsToggle` — the setter had zero callers) and a reduced-motion
 * override (new; `prefersReducedMotion()` previously only read the OS query).
 *
 * Voice/narration is NOT part of this cluster despite looking like it belongs
 * (docs/SETTINGS_SPEC.md D-S-7): those profiles only affect narration inside
 * the intentionally-unlinked Immersive Reef, so the controls stay in that
 * page's own HUD rather than becoming a Settings row that changes nothing the
 * user can hear.
 */
export function AccessibilitySection({ casualModeActive, highContrast }) {
  return (
    <SettingsSection
      id="accessibility"
      icon={<Wheelchair size={20} />}
      title="Accessibility"
      casualModeActive={casualModeActive}
    >
      <div className="st-stack">
        <AccessibilitySubsection label="Font size">
          <FontSizeSettings />
        </AccessibilitySubsection>

        <AccessibilitySubsection label="High contrast">
          <HighContrastToggle enabled={highContrast.enabled} onToggle={highContrast.toggle} />
        </AccessibilitySubsection>

        <AccessibilitySubsection label="Haptic feedback">
          <HapticsToggle />
        </AccessibilitySubsection>

        <AccessibilitySubsection label="Motion">
          <ReducedMotionOverride />
        </AccessibilitySubsection>
      </div>
    </SettingsSection>
  );
}

function AccessibilitySubsection({ label, children }) {
  return (
    <div>
      <SettingsSubsectionLabel>{label}</SettingsSubsectionLabel>
      {children}
    </div>
  );
}

export default AccessibilitySection;
