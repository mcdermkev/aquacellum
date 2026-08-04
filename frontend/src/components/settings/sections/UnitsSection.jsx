import React from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsRadioGroup } from "../SettingsRadioGroup";
import { SettingsSubsectionLabel } from "../SettingsSubsectionLabel";
import { useUnitPrefs } from "../../../hooks/useUnitPrefs";
import {
  DISTANCE_UNIT_LABELS,
  TEMP_UNIT_LABELS,
  formatDistance,
  formatTemperature,
} from "../../../utils/units";

/**
 * UnitsSection — Settings → Units & Formatting (docs/SETTINGS_SPEC.md §6 #5).
 *
 * Scope is deliberately TWO units, not the five that §3.7 of the handoff lists.
 * Distance and temperature are here because each has a real, reachable reader
 * today:
 *
 *   distance    → `ZoneAssignmentFlow`'s radius line, which hardcoded "mi"
 *   temperature → `ActivityLog` and the `TankList` telemetry tile, which
 *                 hardcoded showing BOTH °C and °F
 *
 * Volume (gallons/litres), date format and currency are NOT here. Volume is the
 * tempting one — but `minVolumeGallons` is the stored unit across ~34 render
 * sites including the stocking calculator, and a display-only toggle over a
 * value that feeds capacity maths is how you ship a control that lies about
 * whether a fish fits. That needs the conversion to live in the calculation
 * layer first, which is its own task. Shipping a toggle here before then would
 * be a new dead control, which is the thing this rework exists to stop (§2).
 *
 * The live samples beside each option are the point of the section, not
 * decoration: they show what the choice actually does, so the panel demonstrates
 * rather than asserts.
 */
export function UnitsSection({ casualModeActive }) {
  const { distanceUnit, tempUnit, setDistanceUnit, setTempUnit } = useUnitPrefs();

  // A representative reading (24.5°C / 76.1°F) and a representative zone radius
  // (20 mi / 32.2 km) — real values from the app's own defaults, formatted by the
  // same functions the logbook and zone card use.
  const tempOptions = ["both", "c", "f"].map((value) => ({
    value,
    label: TEMP_UNIT_LABELS[value],
    sample: formatTemperature(24.5, value),
  }));

  const distanceOptions = ["mi", "km"].map((value) => ({
    value,
    label: DISTANCE_UNIT_LABELS[value],
    sample: formatDistance(20, value, { precision: 0 }),
  }));

  return (
    <SettingsSection
      id="units"
      icon="📐"
      title="Units & Formatting"
      description={{
        casual:
          "Choose how temperatures and distances are shown. This changes the display only — your saved logs keep the exact values you entered.",
        pro:
          "Display-unit preferences. Conversion is applied at render time only; stored readings remain canonical (°C at tenth precision, distances in miles).",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div>
          <SettingsSubsectionLabel>Temperature</SettingsSubsectionLabel>
          <SettingsRadioGroup
            label="Temperature unit"
            announceAs="Temperature unit"
            hint={
              casualModeActive
                ? "Water temperature in your logbook and tank readouts. Both is the default."
                : "Applies to the logbook activity feed and the tank telemetry tile."
            }
            options={tempOptions}
            value={tempUnit}
            onChange={setTempUnit}
          />
        </div>

        <div>
          <SettingsSubsectionLabel>Distance</SettingsSubsectionLabel>
          <SettingsRadioGroup
            label="Distance unit"
            announceAs="Distance unit"
            hint={
              casualModeActive
                ? "Used for your regional zone radius."
                : "Applies to zone radius reporting. Stored distances remain in miles."
            }
            options={distanceOptions}
            value={distanceUnit}
            onChange={setDistanceUnit}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

export default UnitsSection;
