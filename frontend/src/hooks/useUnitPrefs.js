/**
 * useUnitPrefs.js — React binding over `utils/units.js`.
 *
 * Same shape as `useAiPrefs()`: storage is the single source of truth, setters
 * persist then broadcast, and the hook re-reads on its own event plus cross-tab
 * `storage` events. That is what makes the Settings control update the logbook's
 * temperature readout and the zone card's radius without a reload — the property
 * the AI-companion copy used to claim while the event had zero listeners
 * (docs/SETTINGS_SPEC.md D-S-5).
 */
import { useCallback, useEffect, useState } from "react";
import {
  DISTANCE_UNIT_KEY,
  TEMP_UNIT_KEY,
  VOLUME_UNIT_KEY,
  UNITS_CHANGED_EVENT,
  broadcastUnitsChanged,
  loadDistanceUnit,
  loadTempUnit,
  loadVolumeUnit,
  persistDistanceUnit,
  persistTempUnit,
  persistVolumeUnit,
} from "../utils/units";

export function useUnitPrefs() {
  const [prefs, setPrefs] = useState(() => ({
    distanceUnit: loadDistanceUnit(),
    tempUnit: loadTempUnit(),
    volumeUnit: loadVolumeUnit(),
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const resync = () =>
      setPrefs({
        distanceUnit: loadDistanceUnit(),
        tempUnit: loadTempUnit(),
        volumeUnit: loadVolumeUnit(),
      });

    const onStorage = (event) => {
      // `key === null` is a localStorage.clear(); re-read for that too.
      if (
        event.key === null ||
        event.key === DISTANCE_UNIT_KEY ||
        event.key === TEMP_UNIT_KEY ||
        event.key === VOLUME_UNIT_KEY
      ) {
        resync();
      }
    };

    window.addEventListener(UNITS_CHANGED_EVENT, resync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(UNITS_CHANGED_EVENT, resync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setDistanceUnit = useCallback((unit) => {
    persistDistanceUnit(unit);
    setPrefs((prev) => ({ ...prev, distanceUnit: unit }));
    broadcastUnitsChanged();
  }, []);

  const setTempUnit = useCallback((unit) => {
    persistTempUnit(unit);
    setPrefs((prev) => ({ ...prev, tempUnit: unit }));
    broadcastUnitsChanged();
  }, []);

  const setVolumeUnit = useCallback((unit) => {
    persistVolumeUnit(unit);
    setPrefs((prev) => ({ ...prev, volumeUnit: unit }));
    broadcastUnitsChanged();
  }, []);

  return {
    distanceUnit: prefs.distanceUnit,
    tempUnit: prefs.tempUnit,
    volumeUnit: prefs.volumeUnit,
    setDistanceUnit,
    setTempUnit,
    setVolumeUnit,
  };
}

export default useUnitPrefs;
