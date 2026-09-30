/**
 * latestReading.js: the newest real temperature and pH logged for a tank.
 *
 * The tank post composer used to fall back to "24.5°C" and "7.2 pH" when a
 * tank had no water test, and those numbers went out to The Reef as if they
 * were readings. A missing value now stays missing.
 *
 * Logs store scaled values (tempCelsiusX10 / phX10) or plain ones (temp / ph)
 * in the same x10 units; both are read the same way the rest of TankList does.
 */

function scaled(log, x10Key, plainKey) {
  const raw = log?.[x10Key] ?? log?.[plainKey];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n / 10 : null;
}

/**
 * @param {Array<object>} logs - tank logs
 * @returns {{ temp: number|null, ph: number|null, tempText: string|null, phText: string|null, hasReading: boolean }}
 *   From the newest log that has a temperature or pH. Nulls when none does.
 */
export function latestReading(logs) {
  const list = Array.isArray(logs) ? logs : [];
  const sorted = [...list].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  for (const log of sorted) {
    const temp = scaled(log, "tempCelsiusX10", "temp");
    const ph = scaled(log, "phX10", "ph");
    if (temp != null || ph != null) {
      return {
        temp,
        ph,
        tempText: temp != null ? `${temp.toFixed(1)}°C` : null,
        phText: ph != null ? ph.toFixed(1) : null,
        hasReading: true,
      };
    }
  }
  return { temp: null, ph: null, tempText: null, phText: null, hasReading: false };
}

/** "24.5°C, pH 7.2" from whatever was logged, or null when nothing was. */
export function readingSummary(reading) {
  const parts = [];
  if (reading?.tempText) parts.push(reading.tempText);
  if (reading?.phText) parts.push(`pH ${reading.phText}`);
  return parts.length ? parts.join(", ") : null;
}
