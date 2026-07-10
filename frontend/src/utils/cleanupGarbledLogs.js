/**
 * cleanupGarbledLogs.js
 *
 * One-time cleanup utility that removes action log entries whose timestamps
 * were accidentally stored in milliseconds (Date.now()) instead of seconds
 * (Date.now() / 1000). These garbled entries display dates like "year 58471"
 * in the Activity Log because ActivityLog.jsx multiplies by 1000 again.
 *
 * Detection heuristic: any timestamp > 10_000_000_000 is clearly in ms
 * (that threshold is year 2286 in seconds — far beyond any real log entry).
 *
 * This runs once per device (flagged in localStorage) and removes bad
 * entries from both local Dexie and Supabase cloud.
 */

import { db } from "../db";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";

const CLEANUP_FLAG = "aquadex_garbled_logs_cleaned_v1";

// Any timestamp above this is clearly in milliseconds, not seconds.
// 10 billion seconds = year 2286; no real log should have a timestamp this high.
const MAX_VALID_SECONDS_TIMESTAMP = 10_000_000_000;

/**
 * Detect and remove action logs with garbled (millisecond) timestamps.
 * Safe to call multiple times — no-ops after the first successful run.
 *
 * @param {string} walletAddress - current user's wallet (for cloud cleanup)
 */
export async function cleanupGarbledActionLogs(walletAddress) {
  // Only run once per device
  if (localStorage.getItem(CLEANUP_FLAG)) return;

  try {
    // Find all action logs with timestamps that are too large (stored in ms)
    const allLogs = await db.actionLogs.toArray();
    const garbled = allLogs.filter(
      (log) => Number(log.timestamp || 0) > MAX_VALID_SECONDS_TIMESTAMP
    );

    if (garbled.length === 0) {
      // Nothing to clean — mark as done
      localStorage.setItem(CLEANUP_FLAG, Date.now().toString());
      return;
    }

    console.info(
      `[Cleanup] Found ${garbled.length} action log(s) with garbled timestamps. Removing...`
    );

    // Delete from local Dexie
    const idsToDelete = garbled.map((log) => log.id).filter(Boolean);
    if (idsToDelete.length > 0) {
      await db.actionLogs.bulkDelete(idsToDelete);
    }

    // Delete from Supabase cloud (so they don't get pulled back on next sync)
    if (isSupabaseConfigured() && walletAddress) {
      const localIds = idsToDelete.map(String);
      // Delete in batches of 50 to stay under query limits
      for (let i = 0; i < localIds.length; i += 50) {
        const batch = localIds.slice(i, i + 50);
        const { error } = await supabase
          .from("aquadex_action_logs")
          .delete()
          .eq("owner_address", walletAddress.toLowerCase())
          .in("local_id", batch);
        if (error) {
          console.warn("[Cleanup] Cloud delete batch failed:", error.message);
        }
      }
    }

    console.info(`[Cleanup] Removed ${garbled.length} garbled action log(s).`);
    localStorage.setItem(CLEANUP_FLAG, Date.now().toString());
  } catch (e) {
    console.warn("[Cleanup] Garbled log cleanup failed:", e.message);
    // Don't set the flag so it retries next session
  }
}
