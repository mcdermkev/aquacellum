/**
 * tankHealth.js — Derived-health selector for the logbook (Logbook Rework Task 1).
 *
 * Single source of truth for turning a tank + its readings + its schedules into
 * a health verdict. Both the Living Tank visual engine (ambient water state) and
 * the status surfaces (badges, "needs attention" sorting) consume this, so the
 * two never disagree.
 *
 * Replaces:
 *   - the ad-hoc `getChemistryAlerts` in TankList.jsx (hardcoded thresholds),
 *   - the string-matched status lights ("h ago" / "Never") in the card, and
 *   - the standalone `livingTankAmbient` helper in LivingTank.jsx (now re-exported
 *     from here as the canonical implementation).
 *
 * Pure and dependency-light: safe to call in render.
 */

import { getWaterEnvelope, evaluateReading } from "./tankUtils";

/**
 * Map a 0..100 health score to an ambient water state for the Living Tank engine.
 *   - clarity    (0..1): higher = clearer water, less haze
 *   - tint       (0..1): higher = greener / murkier
 *   - liveliness (0..1): higher = fish swim faster
 *   - status: "ok" | "drifting" | "alert"
 * @param {number} score
 */
export function scoreToAmbient(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0)) / 100;
  return {
    clarity: 0.25 + 0.75 * s,
    tint: Math.pow(1 - s, 1.3),
    liveliness: 0.4 + 0.6 * s,
    status: s >= 0.7 ? "ok" : s >= 0.4 ? "drifting" : "alert",
  };
}

/**
 * Normalize a reading to plain units. Accepts either:
 *   - a normalized paramReadings row ({ temp, ph, ammonia, nitrite, nitrate }), or
 *   - an on-chain-style scaled log ({ tempCelsiusX10, phX10, ammoniaPpmX100, ... }).
 * Returns null if there's nothing usable.
 * @param {object|null|undefined} reading
 */
export function normalizeReading(reading) {
  if (!reading) return null;
  const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));

  // Already-normalized fields take precedence; fall back to scaled on-chain fields.
  const temp = reading.temp !== undefined ? num(reading.temp)
    : reading.tempCelsiusX10 !== undefined ? num(reading.tempCelsiusX10) / 10 : undefined;
  const ph = reading.ph !== undefined ? num(reading.ph)
    : reading.phX10 !== undefined ? num(reading.phX10) / 10 : undefined;
  const ammonia = reading.ammonia !== undefined ? num(reading.ammonia)
    : reading.ammoniaPpmX100 !== undefined ? num(reading.ammoniaPpmX100) / 100 : undefined;
  const nitrite = reading.nitrite !== undefined ? num(reading.nitrite)
    : reading.nitritePpmX100 !== undefined ? num(reading.nitritePpmX100) / 100 : undefined;
  const nitrate = reading.nitrate !== undefined ? num(reading.nitrate)
    : reading.nitratePpmX100 !== undefined ? num(reading.nitratePpmX100) / 100 : undefined;

  const timestamp = num(reading.timestamp);

  if ([temp, ph, ammonia, nitrite, nitrate].every((v) => v === undefined)) return null;
  return { temp, ph, ammonia, nitrite, nitrate, timestamp };
}

/**
 * Pick the most recent reading from an array (or fall back to a single tank.latestLog).
 * @param {Array} readings
 * @param {object|null} fallbackLog
 */
function pickLatest(readings, fallbackLog) {
  const list = (Array.isArray(readings) ? readings : [])
    .map(normalizeReading)
    .filter(Boolean);
  if (list.length > 0) {
    return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
  }
  return normalizeReading(fallbackLog);
}

/** Seconds-since-epoch helper tolerant of ms or s inputs. */
function toSeconds(t) {
  const n = Number(t) || 0;
  return n > 1e12 ? Math.round(n / 1000) : n; // ms → s
}

/**
 * Derive a tank's health verdict.
 *
 * @param {object} tank                    tank object (needs tankType; latestLog optional)
 * @param {object} [opts]
 * @param {Array}  [opts.readings]         normalized paramReadings rows for this tank
 * @param {Array}  [opts.schedules]        tankSchedules rows for this tank
 * @param {number} [opts.now]              current time (ms); defaults to Date.now()
 * @returns {{
 *   score:number, status:('ok'|'drifting'|'alert'),
 *   ambient:{clarity:number,tint:number,liveliness:number,status:string},
 *   flags:string[], overdue:Array<{kind:string,dueAt:number,daysOverdue:number}>,
 *   latest: (object|null)
 * }}
 */
export function deriveTankHealth(tank, opts = {}) {
  const { readings = [], schedules = [], now = Date.now() } = opts;
  const tankType = tank?.tankType;

  const latest = pickLatest(readings, tank?.latestLog);
  const { flags: paramFlags, tempOk, phOk, ammoniaOk, nitriteOk, nitrateOk } =
    latest ? evaluateReading(tankType, latest) : { flags: [], tempOk: true, phOk: true, ammoniaOk: true, nitriteOk: true, nitrateOk: true };

  // Overdue schedules
  const nowSec = toSeconds(now);
  const overdue = (Array.isArray(schedules) ? schedules : [])
    .filter((s) => s && s.enabled !== false && s.nextDueAt && toSeconds(s.nextDueAt) < nowSec)
    .map((s) => {
      const dueAt = toSeconds(s.nextDueAt);
      return { kind: s.kind, dueAt, daysOverdue: Math.floor((nowSec - dueAt) / 86400) };
    });

  // Score: start healthy, subtract for problems. Nitrogen is the most acute.
  let score = 100;
  if (!ammoniaOk) score -= 40;
  if (!nitriteOk) score -= 40;
  if (!nitrateOk) score -= 15;
  if (!tempOk) score -= 15;
  if (!phOk) score -= 15;
  score -= Math.min(30, overdue.length * 10); // overdue maintenance drags it down, capped
  // Detectable ammonia or nitrite is an acute emergency (fish-lethal), not a
  // "drifting" nudge — force it into the alert band regardless of other factors.
  if (!ammoniaOk || !nitriteOk) score = Math.min(score, 30);
  if (!latest) score = Math.min(score, 82); // never-tested tanks aren't "perfect"
  score = Math.max(0, Math.min(100, score));

  const flags = [...paramFlags];
  for (const o of overdue) {
    flags.push(o.daysOverdue > 0 ? `${labelSchedule(o.kind)} overdue ${o.daysOverdue}d` : `${labelSchedule(o.kind)} due`);
  }

  const ambient = scoreToAmbient(score);
  return { score, status: ambient.status, ambient, flags, overdue, latest };
}

function labelSchedule(kind) {
  switch (kind) {
    case "waterChange": return "Water change";
    case "test": return "Water test";
    case "filter": return "Filter service";
    case "dose": return "Dose";
    default: return kind || "Task";
  }
}
