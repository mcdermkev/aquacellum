/**
 * echoNotifications.js
 *
 * Client-side Echo notification scheduler.
 * When the app is running as a PWA and the user has granted notification permission,
 * this service monitors Echo's needs and fires local notifications in Echo's voice.
 *
 * This complements the server-side echo-nudge Edge Function:
 *   - Server-side: catches users who haven't opened the app (true push)
 *   - Client-side: immediate feedback when needs become critical during an active session
 *
 * Rate limited to max 2 local Echo notifications per day.
 */

import {
  calculateCurrentNeeds,
  getMostCriticalNeed,
  NEED_CONFIG,
} from "../utils/echoNeeds";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes
const MAX_LOCAL_NOTIFICATIONS_PER_DAY = 2;
const NOTIFICATION_COOLDOWN_MS = 2 * 60 * 60 * 1000; // Minimum 2 hours between notifications
const STREAK_RISK_HOURS = 20; // Warn at 20h since last action

// ─────────────────────────────────────────────────────────────────────────────
// Echo's Voice — Notification Messages
// ─────────────────────────────────────────────────────────────────────────────

const NEED_MESSAGES = {
  hunger: [
    "I'm getting a little dim... a feeding log would help me glow again 💧",
    "My belly is fading. Did the fish eat today? 🍽️",
    "Echo needs food vibes. Log a feeding? 🐠",
  ],
  clarity: [
    "Everything's going blurry... when were params last checked? 🧪",
    "Echo's eyes are dimming. A quick test would sharpen things. 💭",
  ],
  comfort: [
    "The water feels stale... fresh water would lift my spirits 💧",
    "Echo's fins feel heavy. A water change would help. 🌊",
  ],
  curiosity: [
    "Echo is getting bored... show me something new? 🔍",
    "The world must have new wonders out there. 🐠",
  ],
  social: [
    "Echo feels a little lonely. Are there others out there? 💬",
    "Connection warms everything. A quick visit would help. 🌐",
  ],
};

const STREAK_MESSAGES = [
  "Your streak is at risk! One quick log keeps us together 🔥",
  "Don't let the fire die... Echo is counting on you 🔥",
  "Echo is watching the clock. The streak needs you today ⏰",
];

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let checkInterval = null;
let isRunning = false;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the Echo notification scheduler.
 * Call once after login when the user has push permission and an active Echo.
 *
 * @param {function} getNeedsState - Returns current stored needs state object
 * @param {function} getStreakInfo - Returns { streakDays, lastActiveDate }
 */
export function startEchoNotificationScheduler(getNeedsState, getStreakInfo) {
  if (isRunning) return;
  if (Notification.permission !== "granted") return;

  isRunning = true;

  // Run first check after a delay (don't spam on app open)
  setTimeout(() => {
    checkAndNotify(getNeedsState, getStreakInfo);
  }, 60 * 1000); // 1 minute after start

  // Schedule periodic checks
  checkInterval = setInterval(() => {
    checkAndNotify(getNeedsState, getStreakInfo);
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the scheduler (call on logout or when Echo is inactive).
 */
export function stopEchoNotificationScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  isRunning = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────────────

function checkAndNotify(getNeedsState, getStreakInfo) {
  if (document.visibilityState === "visible") {
    // Don't notify if the app is in the foreground — use in-app whispers instead
    return;
  }

  if (!canSendNotification()) return;

  const needsState = getNeedsState();
  if (!needsState) return;

  const currentNeeds = calculateCurrentNeeds(needsState);
  const critical = getMostCriticalNeed(currentNeeds);

  // Check critical needs
  if (critical && critical.value < 20) {
    const messages = NEED_MESSAGES[critical.key];
    if (messages) {
      const body = messages[Math.floor(Math.random() * messages.length)];
      fireNotification("🐠 Echo needs you", body, "echo_need");
      return;
    }
  }

  // Check streak risk
  const streakInfo = getStreakInfo();
  if (streakInfo && streakInfo.streakDays > 0 && streakInfo.lastActiveDate) {
    const hoursSince = (Date.now() - new Date(streakInfo.lastActiveDate).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= STREAK_RISK_HOURS) {
      const body = STREAK_MESSAGES[Math.floor(Math.random() * STREAK_MESSAGES.length)];
      fireNotification(`🔥 ${streakInfo.streakDays}-day streak at risk`, body, "echo_streak");
    }
  }
}

function canSendNotification() {
  const today = new Date().toDateString();
  const logKey = "echo_local_notif_log";
  const stored = localStorage.getItem(logKey);

  let log = { date: today, count: 0, lastSent: 0 };
  if (stored) {
    try {
      log = JSON.parse(stored);
      if (log.date !== today) {
        log = { date: today, count: 0, lastSent: 0 };
      }
    } catch {
      log = { date: today, count: 0, lastSent: 0 };
    }
  }

  // Rate limit: max per day
  if (log.count >= MAX_LOCAL_NOTIFICATIONS_PER_DAY) return false;

  // Cooldown: minimum time between notifications
  if (Date.now() - log.lastSent < NOTIFICATION_COOLDOWN_MS) return false;

  return true;
}

function recordNotificationSent() {
  const today = new Date().toDateString();
  const logKey = "echo_local_notif_log";
  const stored = localStorage.getItem(logKey);

  let log = { date: today, count: 0, lastSent: 0 };
  if (stored) {
    try {
      log = JSON.parse(stored);
      if (log.date !== today) {
        log = { date: today, count: 0, lastSent: 0 };
      }
    } catch {
      // Reset
    }
  }

  log.count++;
  log.lastSent = Date.now();
  localStorage.setItem(logKey, JSON.stringify(log));
}

function fireNotification(title, body, tag) {
  if (Notification.permission !== "granted") return;

  try {
    const registration = navigator.serviceWorker?.controller;
    if (registration) {
      // Use service worker notification (works when app is backgrounded)
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, {
          body,
          icon: "/favicon.svg",
          badge: "/favicon.svg",
          tag: `${tag}-${Date.now()}`,
          data: { url: "/app", category: tag },
          renotify: true,
          vibrate: [100, 50, 100],
        });
      });
    } else {
      // Fallback: use Notification API directly
      new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag,
      });
    }

    recordNotificationSent();
  } catch (err) {
    console.warn("[EchoNotifications] Failed to fire notification:", err);
  }
}
