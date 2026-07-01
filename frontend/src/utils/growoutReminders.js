/**
 * growoutReminders.js — Poseidon grow-out checkpoint reminder system.
 *
 * Checks for spawns with overdue checkpoints (no activity in 5+ days)
 * and sends local PWA notifications as gentle nudges from Poseidon.
 *
 * Architecture:
 * - Runs on app load and periodically (every 6 hours via localStorage timestamp)
 * - Reads spawn + checkpoint data from Dexie (local-first)
 * - Uses the Notification API for local push (no server round-trip)
 * - Respects user preference (can be disabled via localStorage flag)
 * - Deduplicated: won't re-notify for the same spawn within 24 hours
 */

import { db } from "../db";

const REMINDER_THRESHOLD_DAYS = 5;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours between reminders per spawn
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours
const STORAGE_KEY_LAST_CHECK = "aquadex_growout_reminder_lastCheck";
const STORAGE_KEY_DISMISSED = "aquadex_growout_reminder_dismissed";
const STORAGE_KEY_ENABLED = "aquadex_growout_reminders_enabled";

/**
 * Poseidon nudge messages — varied to feel natural.
 */
const NUDGE_MESSAGES = [
  "It's been {days} days since your last checkpoint on Spawn #{id}. How are the fry doing?",
  "Spawn #{id} hasn't been logged in {days} days. A quick fry count keeps your survival data sharp.",
  "Your {species} fry (Spawn #{id}) are {days} days without an update. Drop a checkpoint when you get a chance.",
  "Poseidon noticed Spawn #{id} is {days} days silent. Even a quick note helps track growth patterns.",
  "Time for a grow-out check? Spawn #{id} ({species}) hasn't been updated in {days} days.",
];

function getRandomNudge(spawnId, days, species) {
  const template = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
  return template
    .replace("{id}", String(spawnId).slice(-6))
    .replace("{days}", days)
    .replace("{species}", species || "your fry");
}

/**
 * Check if reminders are enabled by the user.
 */
export function areRemindersEnabled() {
  return localStorage.getItem(STORAGE_KEY_ENABLED) !== "false";
}

/**
 * Toggle reminders on/off.
 */
export function setRemindersEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "true" : "false");
}

/**
 * Request notification permission from the user.
 * @returns {Promise<boolean>} true if granted
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Get dismissed spawn IDs (recently notified, don't re-notify).
 */
function getDismissedMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISMISSED);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setDismissed(spawnId) {
  const map = getDismissedMap();
  map[spawnId] = Date.now();
  // Clean old entries (>48h)
  const cutoff = Date.now() - 2 * REMINDER_COOLDOWN_MS;
  for (const key of Object.keys(map)) {
    if (map[key] < cutoff) delete map[key];
  }
  localStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(map));
}

function isRecentlyDismissed(spawnId) {
  const map = getDismissedMap();
  const lastNotified = map[spawnId];
  if (!lastNotified) return false;
  return Date.now() - lastNotified < REMINDER_COOLDOWN_MS;
}

/**
 * Main check: find overdue spawns and send notifications.
 * @param {boolean} force - Skip the 6-hour cooldown check
 * @returns {Promise<number>} Number of reminders sent
 */
export async function checkGrowoutReminders(force = false) {
  // Check if enabled
  if (!areRemindersEnabled()) return 0;

  // Check cooldown (don't run more than once per 6 hours)
  if (!force) {
    const lastCheck = Number(localStorage.getItem(STORAGE_KEY_LAST_CHECK) || 0);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return 0;
  }

  // Mark this check
  localStorage.setItem(STORAGE_KEY_LAST_CHECK, String(Date.now()));

  // Check notification permission
  if (!("Notification" in window) || Notification.permission !== "granted") return 0;

  try {
    // Get all spawns
    const allSpawns = await db.spawns.toArray();
    if (allSpawns.length === 0) return 0;

    // Get all growout checkpoints
    const allCheckpoints = await db.spawnGrowout.toArray();

    // Build last-checkpoint-time per spawn
    const lastCheckpointMap = {};
    for (const cp of allCheckpoints) {
      if (cp.type === "narration") continue; // Skip narration entries
      const existing = lastCheckpointMap[cp.spawnId];
      if (!existing || cp.timestamp > existing) {
        lastCheckpointMap[cp.spawnId] = cp.timestamp;
      }
    }

    const now = Math.round(Date.now() / 1000);
    const thresholdSeconds = REMINDER_THRESHOLD_DAYS * 24 * 60 * 60;
    let sentCount = 0;

    // Load species catalog for names
    const speciesCatalog = {};
    try {
      const records = await db.table("species").toArray();
      for (const sp of records) {
        const id = Number(sp.speciesId || sp.specCode);
        if (id) speciesCatalog[id] = sp.commonName || sp.scientificName || "";
      }
    } catch (e) {}

    for (const spawn of allSpawns) {
      const spawnId = spawn.spawnId;

      // Skip recently notified
      if (isRecentlyDismissed(spawnId)) continue;

      // Calculate days since last activity
      const lastActivity = lastCheckpointMap[spawnId] || spawn.timestamp || 0;
      const daysSince = Math.floor((now - lastActivity) / 86400);

      if (daysSince >= REMINDER_THRESHOLD_DAYS) {
        const species = speciesCatalog[spawn.speciesId] || "";
        const message = getRandomNudge(spawnId, daysSince, species);

        // Send local notification
        sendLocalNotification(message, spawnId);
        setDismissed(spawnId);
        sentCount++;

        // Limit to 3 notifications per check to avoid spam
        if (sentCount >= 3) break;
      }
    }

    return sentCount;
  } catch (err) {
    console.warn("[GrowOut Reminders] Check failed:", err);
    return 0;
  }
}

/**
 * Send a local notification (no server needed).
 */
function sendLocalNotification(body, spawnId) {
  try {
    const notification = new Notification("🌊 Poseidon — Grow-Out Reminder", {
      body,
      icon: "/poseidon-avatar.jpg",
      badge: "/favicon.svg",
      tag: `growout-reminder-${spawnId}`,
      renotify: false,
      silent: false,
      data: { url: "/app", spawnId },
    });

    // Auto-close after 10 seconds
    setTimeout(() => notification.close(), 10000);
  } catch (err) {
    console.warn("[GrowOut Reminders] Notification failed:", err);
  }
}

/**
 * Get a list of overdue spawns (for in-app display without notifications).
 * @returns {Promise<Array<{ spawnId, daysSince, speciesName }>>}
 */
export async function getOverdueSpawns() {
  try {
    const allSpawns = await db.spawns.toArray();
    if (allSpawns.length === 0) return [];

    const allCheckpoints = await db.spawnGrowout.toArray();
    const lastCheckpointMap = {};
    for (const cp of allCheckpoints) {
      if (cp.type === "narration") continue;
      const existing = lastCheckpointMap[cp.spawnId];
      if (!existing || cp.timestamp > existing) {
        lastCheckpointMap[cp.spawnId] = cp.timestamp;
      }
    }

    const now = Math.round(Date.now() / 1000);
    const thresholdSeconds = REMINDER_THRESHOLD_DAYS * 24 * 60 * 60;

    const speciesCatalog = {};
    try {
      const records = await db.table("species").toArray();
      for (const sp of records) {
        const id = Number(sp.speciesId || sp.specCode);
        if (id) speciesCatalog[id] = sp.commonName || sp.scientificName || "";
      }
    } catch (e) {}

    const overdue = [];
    for (const spawn of allSpawns) {
      const lastActivity = lastCheckpointMap[spawn.spawnId] || spawn.timestamp || 0;
      const daysSince = Math.floor((now - lastActivity) / 86400);
      if (daysSince >= REMINDER_THRESHOLD_DAYS) {
        overdue.push({
          spawnId: spawn.spawnId,
          daysSince,
          speciesName: speciesCatalog[spawn.speciesId] || `Species #${spawn.speciesId}`,
        });
      }
    }

    return overdue.sort((a, b) => b.daysSince - a.daysSince);
  } catch (err) {
    console.warn("[GrowOut Reminders] getOverdueSpawns failed:", err);
    return [];
  }
}

/**
 * Initialize the reminder system — call once on app boot.
 * Runs the first check and sets up a periodic interval.
 */
export function initGrowoutReminders() {
  // Run initial check after a short delay (let app settle)
  setTimeout(() => checkGrowoutReminders(), 5000);

  // Set up periodic check (every 6 hours while app is open)
  setInterval(() => checkGrowoutReminders(), CHECK_INTERVAL_MS);
}
