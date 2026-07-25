/**
 * careLog.js — Centralized care-action logging (Logbook Rework Task 2).
 *
 * Every husbandry log (feed, water change, test, clean, treatment, observation),
 * whether single-tank or bulk, funnels through here. This replaces ~6 near-
 * identical inline handlers in TankList.jsx (and the bulk paths in QuickLogPanel)
 * that each duplicated the same db.actionLogs.add + cooldown-check pattern.
 *
 * Responsibilities:
 *   - Write the actionLogs row with a structured `payload` (Task 1 spine) plus the
 *     human-readable `details` string.
 *   - Report whether the per-tank XP cooldown was clear, so callers can shape the
 *     toast ("+8 XP" vs "already earned today"). NOTE: XP is awarded exclusively
 *     by the Dexie `actionLogs.creating` hook in useXPSync — this service never
 *     calls addXp(); the cooldown check here is advisory (for messaging only).
 *
 * Reused by both the current detail panel and the future Casual/Pro surfaces.
 */

import { db } from "../db";
import { checkCooldown } from "../utils/xpCooldowns";
import { inferCarePayload } from "../utils/carePayload";
import { advanceSchedule, actionTypeToScheduleKind } from "./tankSchedules";

// actionType → XP cooldown key. Types not listed earn no XP (still logged).
const COOLDOWN_KEYS = {
  "Feed": "LOG_FEEDING",
  "Scraped Algae": "LOG_FEEDING",
  "Water Change": "LOG_WATER",
  "Log Immediate Water Change": "LOG_WATER",
  "Quick Water Test": "LOG_PARAMETERS",
  "Water Test": "LOG_PARAMETERS",
  "Detailed Test": "LOG_PARAMETERS",
};

function nowSeconds() {
  return Math.round(Date.now() / 1000);
}

/**
 * Log a single care action for one tank.
 * @param {object} args
 * @param {number|string} args.tankId
 * @param {string} [args.walletAccount]  used only for the advisory cooldown check
 * @param {string} args.actionType       e.g. "Feed", "Water Change"
 * @param {string} [args.details]        human summary
 * @param {object} [args.payload]        structured payload (defaults to inferred)
 * @param {number} [args.timestamp]      seconds since epoch (defaults to now)
 * @returns {Promise<{allowed:boolean, timestamp:number}>} allowed = cooldown clear
 */
export async function logCareAction({ tankId, walletAccount, actionType, details = "", payload, timestamp } = {}) {
  const ts = timestamp || nowSeconds();

  // Advisory cooldown check (for toast messaging only — the real award + cooldown
  // enforcement happens in the useXPSync actionLogs.creating hook).
  let allowed = true;
  const cooldownKey = COOLDOWN_KEYS[actionType];
  if (cooldownKey && walletAccount) {
    try {
      const cd = await checkCooldown(walletAccount, cooldownKey, String(tankId));
      allowed = cd.allowed;
    } catch {
      allowed = true;
    }
  }

  await db.actionLogs.add({
    tankId,
    actionType,
    timestamp: ts,
    details,
    payload: payload || inferCarePayload(actionType, details),
  });

  // Advance the matching maintenance schedule so "due/overdue" stays accurate.
  const scheduleKind = actionTypeToScheduleKind(actionType);
  if (scheduleKind) await advanceSchedule(tankId, scheduleKind, ts);

  return { allowed, timestamp: ts };
}

/**
 * Log the same care action across many tanks in one write.
 * @param {object} args
 * @param {Array<number|string>} args.tankIds
 * @param {string} args.actionType
 * @param {string} [args.details]
 * @param {object} [args.payload]
 * @param {number} [args.timestamp]
 * @returns {Promise<{count:number, timestamp:number}>}
 */
export async function logCareActionBulk({ tankIds = [], actionType, details = "", payload, timestamp } = {}) {
  const ts = timestamp || nowSeconds();
  const resolved = payload || inferCarePayload(actionType, details);
  const rows = tankIds.map((tankId) => ({
    tankId,
    actionType,
    timestamp: ts,
    details,
    payload: resolved,
  }));
  if (rows.length > 0) {
    await db.actionLogs.bulkAdd(rows);
    // Advance each tank's matching schedule (bulk care keeps rhythms accurate too).
    const scheduleKind = actionTypeToScheduleKind(actionType);
    if (scheduleKind) {
      await Promise.all(tankIds.map((tankId) => advanceSchedule(tankId, scheduleKind, ts)));
    }
  }
  return { count: rows.length, timestamp: ts };
}
