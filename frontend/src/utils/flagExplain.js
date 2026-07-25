/**
 * flagExplain.js — grounded "why is this flagged?" explanations for tank health
 * (Logbook Rework Task 10, Knowledge layer).
 *
 * Turns each out-of-range water parameter and each overdue maintenance schedule
 * into a plain-language explanation the keeper can act on. Grounding rules:
 *
 *   - Every numeric target comes from the parameter-envelope module
 *     (`getWaterEnvelope`), the single source of truth — never a literal here.
 *   - Every observed value comes from the tank's own latest reading via
 *     `deriveTankHealth` — never invented.
 *   - The "why it matters" / "what to do" copy states established, non-negotiable
 *     aquarium husbandry (ammonia/nitrite toxicity, nitrate accumulation,
 *     temp/pH stress) — no species-specific or speculative claims.
 *
 * Pure and dependency-light: safe to call in render. Poseidon/AI is NOT consulted
 * here; this layer is deterministic so it can never fabricate a care claim.
 */

import { deriveTankHealth } from "./tankHealth";
import { getWaterEnvelope } from "./tankUtils";

function labelScheduleKind(kind) {
  switch (kind) {
    case "waterChange": return "Water change";
    case "test": return "Water test";
    case "filter": return "Filter service";
    case "dose": return "Dose";
    default: return kind || "Maintenance";
  }
}

/** Grounded why/what-to-do for an overdue maintenance kind. */
function scheduleGuidance(kind) {
  switch (kind) {
    case "waterChange":
      return {
        why: "Regular water changes are the main way nitrate and dissolved waste get removed between tests.",
        action: "Log a partial water change to reset the clock.",
      };
    case "test":
      return {
        why: "Testing catches ammonia, nitrite and nitrate problems days before fish show visible stress.",
        action: "Run a water test so the numbers are current.",
      };
    case "filter":
      return {
        why: "Filter media carries the bacteria that process ammonia and nitrite; neglected media loses flow and capacity.",
        action: "Rinse or service the filter (in old tank water, never tap water).",
      };
    case "dose":
      return {
        why: "Skipped doses let the treatment or supplement drift out of its intended range.",
        action: "Log the scheduled dose.",
      };
    default:
      return { why: "This task is part of the tank's maintenance routine.", action: "Log it to stay on schedule." };
  }
}

/**
 * Build grounded explanations for everything currently flagged on a tank.
 *
 * @param {object} tank                 tank object (needs tankType; latestLog optional)
 * @param {object} [opts]
 * @param {Array}  [opts.readings]      normalized paramReadings rows for this tank
 * @param {Array}  [opts.schedules]     tankSchedules rows for this tank
 * @param {number} [opts.now]           current time (ms); defaults to Date.now()
 * @returns {{ status:('ok'|'drifting'|'alert'), score:number, items:Array<{
 *   id:string, severity:('alert'|'caution'), label:string,
 *   observed:string, target:string, why:string, action:string
 * }> }}
 */
export function explainTankFlags(tank, opts = {}) {
  const { readings = [], schedules = [], now = Date.now() } = opts;
  const health = deriveTankHealth(tank, { readings, schedules, now });
  const env = getWaterEnvelope(tank?.tankType);
  const r = health.latest || {};
  const items = [];

  const has = (v) => v !== undefined && v !== null && !Number.isNaN(Number(v));

  // Ammonia — acute, fish-lethal.
  if (has(r.ammonia) && Number(r.ammonia) > env.ammoniaMax) {
    items.push({
      id: "ammonia",
      severity: "alert",
      label: "Ammonia too high",
      observed: `${Number(r.ammonia).toFixed(2)} ppm`,
      target: `≤ ${env.ammoniaMax} ppm`,
      why: "Ammonia is toxic to fish even in small amounts — it burns gills and suppresses the immune system.",
      action: "Do a partial water change now and check that the tank is fully cycled and not overfed.",
    });
  }

  // Nitrite — acute, blocks oxygen transport.
  if (has(r.nitrite) && Number(r.nitrite) > env.nitriteMax) {
    items.push({
      id: "nitrite",
      severity: "alert",
      label: "Nitrite too high",
      observed: `${Number(r.nitrite).toFixed(2)} ppm`,
      target: `≤ ${env.nitriteMax} ppm`,
      why: "Nitrite stops blood from carrying oxygen (\u201cbrown blood disease\u201d), so fish suffocate even in clear water.",
      action: "Do a partial water change now; the filter's bacteria still need to catch up.",
    });
  }

  // Nitrate — chronic accumulation between water changes.
  if (has(r.nitrate) && Number(r.nitrate) > env.nitrateMax) {
    items.push({
      id: "nitrate",
      severity: "caution",
      label: "Nitrate above target",
      observed: `${Number(r.nitrate).toFixed(1)} ppm`,
      target: `≤ ${env.nitrateMax} ppm`,
      why: "Nitrate builds up between water changes; sustained high levels stress fish over time and fuel algae.",
      action: "A partial water change lowers it — and more frequent changes keep it down.",
    });
  }

  // Temperature — directional (too warm / too cold).
  if (has(r.temp) && (Number(r.temp) < env.tempMin || Number(r.temp) > env.tempMax)) {
    const hot = Number(r.temp) > env.tempMax;
    items.push({
      id: "temp",
      severity: "caution",
      label: hot ? "Water too warm" : "Water too cold",
      observed: `${Number(r.temp).toFixed(1)}\u00b0C`,
      target: `${env.tempMin}\u2013${env.tempMax}\u00b0C`,
      why: hot
        ? "Warm water holds less oxygen and speeds fish metabolism, which adds stress."
        : "Cold water slows fish metabolism and immune response, leaving them prone to illness.",
      action: hot
        ? "Check the heater setting and room temperature; a fan or partial cooler helps in a heatwave."
        : "Check the heater is working and correctly sized for the tank.",
    });
  }

  // pH — directional, but stability matters most.
  if (has(r.ph) && (Number(r.ph) < env.phMin || Number(r.ph) > env.phMax)) {
    const high = Number(r.ph) > env.phMax;
    items.push({
      id: "ph",
      severity: "caution",
      label: high ? "pH above range" : "pH below range",
      observed: Number(r.ph).toFixed(1),
      target: `${env.phMin}\u2013${env.phMax}`,
      why: "A steady pH matters more than a specific number — sudden swings stress fish more than the reading itself.",
      action: "Change pH slowly: check source water and buffering, and avoid sudden large corrections.",
    });
  }

  // Overdue maintenance schedules.
  for (const o of Array.isArray(health.overdue) ? health.overdue : []) {
    const g = scheduleGuidance(o.kind);
    items.push({
      id: `schedule:${o.kind}`,
      severity: "caution",
      label: `${labelScheduleKind(o.kind)} ${o.daysOverdue > 0 ? `overdue ${o.daysOverdue}d` : "due"}`,
      observed: o.daysOverdue > 0 ? `${o.daysOverdue} day${o.daysOverdue === 1 ? "" : "s"} overdue` : "due now",
      target: "on schedule",
      why: g.why,
      action: g.action,
    });
  }

  return { status: health.status, score: health.score, items };
}
