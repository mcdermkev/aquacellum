import React, { useState } from "react";
import { isHapticsPreferenceEnabled, setHapticsEnabled } from "../../utils/haptics";
import { SettingsToggle } from "./SettingsToggle";

/**
 * HapticsToggle — Settings → Accessibility control for the haptics preference.
 *
 * `aquadex_haptics` (via `setHapticsEnabled()`/`hapticsEnabled()` in
 * utils/haptics.js) was written up as "an explicit user setting" in the module
 * header but had zero callers of the setter — nothing in the app could actually
 * turn it off (docs/SETTINGS_REWORK_HANDOFF.md §3.5). This is that missing
 * writer.
 *
 * Renders through `SettingsToggle`; it previously hand-rolled the same switch
 * markup now shared with the Aquariums section.
 */
export function HapticsToggle() {
  const [enabled, setEnabled] = useState(() => isHapticsPreferenceEnabled());

  const handleChange = (next) => {
    setHapticsEnabled(next);
    setEnabled(next);
  };

  return (
    <SettingsToggle
      label="Haptic feedback"
      hint="Short vibrations on XP rewards, level-ups, and taps on supported devices. Automatically off when your device requests reduced motion."
      enabled={enabled}
      onChange={handleChange}
      announceOn="Haptic feedback turned on"
      announceOff="Haptic feedback turned off"
    />
  );
}

export default HapticsToggle;
