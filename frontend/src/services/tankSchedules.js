/**
 * tankSchedules.js — Per-tank maintenance cadences (Logbook Rework Task 8).
 *
 * Turns "due / overdue" from an inferred guess (the 7-day recency heuristic the
 * Care Coach shipped with) into a real, stored value that advances when the
 * matching care action is logged. Backs the `tankSchedules` table added in v23.
 *
 * A schedule row: { id, tankId, kind, cadenceDays, lastDoneAt, nextDueAt, enabled }
 *   kind ∈ "waterChange" | "test" | "filter" | "dose"
 *   timestamps are seconds-since-epoch (matching actionLogs / paramReadings).
 *
 * New tanks are provisioned with sensible default cadences that read as "due now"
 * (lastDoneAt = null) so the coach encourages establishing the habit; logging the
 * action advances the schedule one cadence into the future.
 */

import { db } from "../db";

/** Default cadences (days) for the habits the Casual coach teaches. */
export const SCHEDULE_DEFAULTS = [
  { kind: "waterChange", cadenceDays: 7 },
  { kind: "test", cadenceDays: 7 },
];

const DEFAULT_CADENCE = { waterChange: 7, test: 7, filter: 14, dose: 7 };

function nowSeconds() {
  return Math.round(Date.now() / 1000);
}

/** Pure: next due time given a completion time + cadence. */
export function computeNextDue(atSeconds, cadenceDays) {
  return Math.round(Number(atSeconds) + Number(cadenceDays) * 86400);
}

/** Pure: is this schedule due (never done, or past its next-due)? */
export function isScheduleDue(schedule, nowSec = nowSeconds()) {
  if (!schedule || schedule.enabled === false) return false;
  if (schedule.lastDoneAt == null) return true; // never done → establish the habit
  return Number(schedule.nextDueAt) <= nowSec;
}

/** Map a care actionType to the schedule kind it satisfies (or null). */
export function actionTypeToScheduleKind(actionType) {
  switch (actionType) {
    case "Water Change":
    case "Log Immediate Water Change":
      return "waterChange";
    case "Quick Water Test":
    case "Water Test":
    case "Detailed Test":
      return "test";
    default:
      return null;
  }
}

const idKeysOf = (tankId) => [tankId, String(tankId), Number(tankId)];

/** Read all schedules for a tank. */
export async function getTankSchedules(tankId) {
  if (tankId == null) return [];
  try {
    return await db.tankSchedules.where("tankId").anyOf(idKeysOf(tankId)).toArray();
  } catch {
    return [];
  }
}

/**
 * Read schedules for a tank, creating the default set (due now) if none exist.
 * Idempotent — only creates kinds that are missing.
 */
export async function getOrInitTankSchedules(tankId) {
  if (tankId == null) return [];
  try {
    const existing = await getTankSchedules(tankId);
    const present = new Set(existing.map((s) => s.kind));
    const now = nowSeconds();
    const toCreate = SCHEDULE_DEFAULTS.filter((d) => !present.has(d.kind)).map((d) => ({
      tankId,
      kind: d.kind,
      cadenceDays: d.cadenceDays,
      lastDoneAt: null,
      nextDueAt: now, // due now → coach encourages the first one
      enabled: true,
    }));
    if (toCreate.length > 0) {
      await db.tankSchedules.bulkAdd(toCreate);
      return [...existing, ...toCreate];
    }
    return existing;
  } catch {
    return [];
  }
}

/**
 * Mark a schedule done and advance it one cadence. Creates the schedule with a
 * default cadence if it doesn't exist yet (so logging always maintains a rhythm).
 */
export async function advanceSchedule(tankId, kind, atSeconds = nowSeconds()) {
  if (tankId == null || !kind) return;
  try {
    const existing = (await getTankSchedules(tankId)).find((s) => s.kind === kind);
    if (existing) {
      await db.tankSchedules.update(existing.id, {
        lastDoneAt: atSeconds,
        nextDueAt: computeNextDue(atSeconds, existing.cadenceDays || DEFAULT_CADENCE[kind] || 7),
      });
    } else {
      const cadenceDays = DEFAULT_CADENCE[kind] || 7;
      await db.tankSchedules.add({
        tankId, kind, cadenceDays,
        lastDoneAt: atSeconds,
        nextDueAt: computeNextDue(atSeconds, cadenceDays),
        enabled: true,
      });
    }
  } catch {
    /* non-fatal — scheduling is a convenience layer */
  }
}

/** Set a schedule's cadence (and enabled), recomputing nextDueAt from lastDoneAt/now. */
export async function setScheduleCadence(tankId, kind, cadenceDays, enabled = true) {
  if (tankId == null || !kind) return;
  try {
    const existing = (await getTankSchedules(tankId)).find((s) => s.kind === kind);
    const base = existing?.lastDoneAt ?? nowSeconds();
    const nextDueAt = computeNextDue(base, cadenceDays);
    if (existing) {
      await db.tankSchedules.update(existing.id, { cadenceDays, enabled, nextDueAt });
    } else {
      await db.tankSchedules.add({ tankId, kind, cadenceDays, lastDoneAt: null, nextDueAt: nowSeconds(), enabled });
    }
  } catch {
    /* non-fatal */
  }
}
