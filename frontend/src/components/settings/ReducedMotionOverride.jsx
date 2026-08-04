import React, { useState } from "react";
import { getReducedMotionOverride, setReducedMotionOverride } from "../../utils/a11y";
import { SettingsRadioGroup } from "./SettingsRadioGroup";

const OPTIONS = [
  { value: "auto", label: "Match device", description: "Use your OS/browser setting" },
  { value: "on", label: "Reduced", description: "Minimize animation everywhere in the app" },
  { value: "off", label: "Full motion", description: "Never reduce, even if your OS asks for it" },
];

/**
 * ReducedMotionOverride — Settings → Accessibility control that lets a user
 * override `prefers-reduced-motion` inside the app specifically, rather than
 * only inheriting whatever their OS/browser reports.
 *
 * `prefersReducedMotion()` (utils/a11y.js) already reads this override before
 * falling back to the OS media query, so every existing call site — Echo's
 * animations, the storefront reorder transition, map fly-tos, and others —
 * picks this up with no further wiring.
 *
 * Renders through `SettingsRadioGroup`; it previously hand-rolled the same
 * radiogroup markup this now shares with the Units controls.
 */
export function ReducedMotionOverride() {
  const [value, setValue] = useState(() => getReducedMotionOverride());

  const handleChange = (next) => {
    setReducedMotionOverride(next);
    setValue(next);
  };

  return (
    <SettingsRadioGroup
      label="Motion preference"
      announceAs="Motion preference"
      hint="Controls animation throughout the app — Echo's movements, transitions, and map flythroughs."
      options={OPTIONS}
      value={value}
      onChange={handleChange}
    />
  );
}

export default ReducedMotionOverride;
