import React from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsRadioGroup } from "../SettingsRadioGroup";
import { SettingsSubsectionLabel } from "../SettingsSubsectionLabel";
import { useUnitPrefs } from "../../../hooks/useUnitPrefs";
import {
  DISTANCE_UNIT_LABELS,
  TEMP_UNIT_LABELS,
  VOLUME_UNIT_LABELS,
  formatDistance,
  formatTemperature,
  formatVolume,
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
 * VOLUME was deliberately excluded here, on the grounds that a display-only
 * toggle over a value feeding capacity maths "is how you ship a control that
 * lies about whether a fish fits", and that the conversion needed to live in the
 * calculation layer first. The caution was right; the prerequisite turns out to
 * be already met, so volume is now included:
 *
 *   - The calculation layer NEVER reads this preference. stockingGuidance.js and
 *     compatibleTanks.js each hold their own LITERS_TO_GALLONS and do their
 *     arithmetic in gallons whatever is displayed. Species minimums are stored as
 *     `minVolumeGallons` and compared against a gallons figure derived from
 *     litres, independently of any setting.
 *   - Leaving it out was not neutral. Every volume INPUT is already labelled in
 *     gallons and multiplies by 3.78541 before storing, so a keeper typed 20 and
 *     their tank card read "76L" — while StockingGuidance showed "20 gal" for
 *     that same tank. The absent control was not "no opinion", it was a
 *     contradiction, and it is what the first new user asked about.
 *
 * Date format and currency remain out of scope.
 *
 * The live samples beside each option are the point of the section, not
 * decoration: they show what the choice actually does, so the panel demonstrates
 * rather than asserts.
 */
export function UnitsSection({ casualModeActive }) {
  const { distanceUnit, tempUnit, volumeUnit, setDistanceUnit, setTempUnit, setVolumeUnit } =
    useUnitPrefs();

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

  // 76 litres deliberately: it is what a "20 gallon" tank stores as, so the
  // samples read "20 gal" and "76L" — the exact pair a keeper was confused by.
  const volumeOptions = ["gal", "l"].map((value) => ({
    value,
    label: VOLUME_UNIT_LABELS[value],
    sample: formatVolume(76, value),
  }));

  return (
    <SettingsSection
      id="units"
      icon="📐"
      title="Units & Formatting"
      description={{
        casual:
          "Choose how tank sizes, temperatures and distances are shown. This changes the display only — your saved logs keep the exact values you entered.",
        pro:
          "Display-unit preferences. Conversion is applied at render time only; stored values remain canonical (litres for volume, °C at tenth precision, distances in miles).",
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
          <SettingsSubsectionLabel>Tank volume</SettingsSubsectionLabel>
          <SettingsRadioGroup
            label="Volume unit"
            announceAs="Tank volume unit"
            hint={
              casualModeActive
                ? "How tank sizes are shown. You always ENTER sizes in gallons — this only changes how they're displayed back to you."
                : "Applies to tank cards, the tank selector, facility tree and reef HUD. Stored canonically in litres; entry remains in gallons."
            }
            options={volumeOptions}
            value={volumeUnit}
            onChange={setVolumeUnit}
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
