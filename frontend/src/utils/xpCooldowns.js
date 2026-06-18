/**
 * XP Cooldown Enforcement
 * 
 * Anti-gaming system per GAMIFICATION_SPEC.md section 10.
 * Uses the Dexie xpCooldowns table to track per-action-per-tank cooldowns
 * and daily maximums.
 * 
 * Cooldown rules:
 *   - Per-tank actions (feeding, water change, params): one award per cooldown window per tank
 *   - Daily-max actions (photos, posts): N awards per calendar day globally
 *   - One-time actions (register tank, add species): no cooldown, but checked for duplicates
 */

import { db } from "../db";
import { XP_ACTIONS } from "./xp";

/**
 * Check if an XP action is allowed (not on cooldown).
 * 
 * @param {string} walletAddress - User's wallet
 * @param {string} actionKey - Key from XP_ACTIONS (e.g., "LOG_FEEDING")
 * @param {string|null} tankId - Tank ID for per-tank cooldowns (null for global actions)
 * @returns {Promise<{allowed: boolean, reason?: string, remainingMs?: number}>}
 */
export async function checkCooldown(walletAddress, actionKey, tankId = null) {
  if (!walletAddress || !actionKey) return { allowed: true };

  const actionDef = XP_ACTIONS[actionKey];
  if (!actionDef) return { allowed: true };

  const now = Date.now();

  try {
    // ─── Per-tank cooldown check ─────────────────────────────────────────
    if (actionDef.cooldownMs && actionDef.perTank && tankId) {
      const cutoff = now - actionDef.cooldownMs;
      const existing = await db.xpCooldowns
        .where("[walletAddress+actionType+tankId]")
        .between(
          [walletAddress, actionKey, tankId],
          [walletAddress, actionKey, tankId],
          true, true
        )
        .filter((entry) => entry.timestamp > cutoff)
        .first();

      if (existing) {
        const remainingMs = (existing.timestamp + actionDef.cooldownMs) - now;
        return {
          allowed: false,
          reason: `Cooldown active for ${actionDef.label} on this tank`,
          remainingMs,
        };
      }
    }

    // ─── Global cooldown (non-per-tank) ──────────────────────────────────
    if (actionDef.cooldownMs && !actionDef.perTank) {
      const cutoff = now - actionDef.cooldownMs;
      const existing = await db.xpCooldowns
        .where("walletAddress")
        .equals(walletAddress)
        .filter((entry) => entry.actionType === actionKey && entry.timestamp > cutoff)
        .first();

      if (existing) {
        const remainingMs = (existing.timestamp + actionDef.cooldownMs) - now;
        return {
          allowed: false,
          reason: `Cooldown active for ${actionDef.label}`,
          remainingMs,
        };
      }
    }

    // ─── Daily max check ─────────────────────────────────────────────────
    if (actionDef.dailyMax) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const todayCount = await db.xpCooldowns
        .where("walletAddress")
        .equals(walletAddress)
        .filter((entry) => entry.actionType === actionKey && entry.timestamp >= todayMs)
        .count();

      if (todayCount >= actionDef.dailyMax) {
        return {
          allowed: false,
          reason: `Daily limit reached for ${actionDef.label} (${actionDef.dailyMax}/day)`,
          remainingMs: null,
        };
      }
    }

    return { allowed: true };
  } catch (err) {
    // If Dexie fails (e.g., table not ready), allow the action gracefully
    console.warn("xpCooldowns check failed, allowing action:", err);
    return { allowed: true };
  }
}

/**
 * Record that an XP action was performed (stamps the cooldown).
 * Call this AFTER successfully awarding XP.
 * 
 * @param {string} walletAddress
 * @param {string} actionKey - Key from XP_ACTIONS
 * @param {string|null} tankId - Tank ID for per-tank tracking
 */
export async function recordCooldown(walletAddress, actionKey, tankId = null) {
  if (!walletAddress || !actionKey) return;

  try {
    await db.xpCooldowns.add({
      walletAddress,
      actionType: actionKey,
      tankId: tankId || "__global__",
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn("Failed to record XP cooldown:", err);
  }
}

/**
 * Combined check-and-record: checks cooldown, and if allowed, records it.
 * Returns the cooldown check result. Caller should only award XP if allowed=true.
 * 
 * @param {string} walletAddress
 * @param {string} actionKey
 * @param {string|null} tankId
 * @returns {Promise<{allowed: boolean, reason?: string, remainingMs?: number}>}
 */
export async function enforceXpCooldown(walletAddress, actionKey, tankId = null) {
  const result = await checkCooldown(walletAddress, actionKey, tankId);
  if (result.allowed) {
    await recordCooldown(walletAddress, actionKey, tankId);
  }
  return result;
}

/**
 * Clean up old cooldown records (older than 7 days) to prevent unbounded growth.
 * Call periodically (e.g., on app startup or daily).
 */
export async function pruneOldCooldowns() {
  try {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    await db.xpCooldowns.where("timestamp").below(cutoff).delete();
  } catch (err) {
    console.warn("Failed to prune old cooldowns:", err);
  }
}
