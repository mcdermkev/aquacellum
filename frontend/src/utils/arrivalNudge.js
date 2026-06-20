/**
 * arrivalNudge.js
 *
 * Utility functions for the Arrival Flow nudge system.
 * Determines when a specimen or batch in transit should show a nudge badge.
 */

/**
 * Get the nudge threshold (in milliseconds) for a given purchase type.
 * - Shipping: 7 days (transit time is long)
 * - In-person / instant / fiat: 48 hours (buyer is carrying home or already has it)
 */
export function getNudgeThreshold(purchaseType) {
  switch (purchaseType) {
    case "shipping":
      return 7 * 24 * 60 * 60 * 1000; // 7 days
    case "in-person":
    case "instant":
    case "fiat":
    default:
      return 48 * 60 * 60 * 1000; // 48 hours
  }
}

/**
 * Determine if a specimen's nudge should be active (past threshold, not dismissed).
 *
 * @param {object} specimen - Specimen record with arrivalStatus, purchasedAt, purchaseType
 * @param {number|null} nudgeDismissedAt - Timestamp of last nudge dismissal (optional)
 * @returns {boolean}
 */
export function isNudgeActive(specimen, nudgeDismissedAt = null) {
  if (!specimen) return false;
  if (specimen.arrivalStatus !== "transit") return false;
  if (!specimen.purchasedAt) return false;

  const threshold = getNudgeThreshold(specimen.purchaseType);
  const elapsed = Date.now() - (specimen.purchasedAt * 1000);

  if (elapsed <= threshold) return false;

  // Check if nudge was dismissed within last 7 days
  if (nudgeDismissedAt) {
    const dismissElapsed = Date.now() - (nudgeDismissedAt * 1000);
    const DISMISS_COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (dismissElapsed < DISMISS_COOLDOWN) return false;
  }

  return true;
}

/**
 * Determine if a batch order's nudge should be active.
 *
 * @param {object} order - Market order record
 * @returns {boolean}
 */
export function isBatchNudgeActive(order) {
  if (!order) return false;
  if (order.assignedTankId) return false; // Already assigned
  if (!order.createdAt) return false;

  // Batches use 48h threshold (typically in-person or local)
  const threshold = 48 * 60 * 60 * 1000;
  const elapsed = Date.now() - (order.createdAt * 1000);

  if (elapsed <= threshold) return false;

  // Check dismissal
  if (order.nudgeDismissedAt) {
    const dismissElapsed = Date.now() - (order.nudgeDismissedAt * 1000);
    const DISMISS_COOLDOWN = 7 * 24 * 60 * 60 * 1000;
    if (dismissElapsed < DISMISS_COOLDOWN) return false;
  }

  return true;
}

/**
 * Get a human-readable relative time string (e.g., "3 days ago").
 */
export function getRelativeTime(unixTimestamp) {
  if (!unixTimestamp) return "";
  const diff = Date.now() - (unixTimestamp * 1000);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Get purchase type display label.
 */
export function getPurchaseTypeLabel(purchaseType, casualMode = true) {
  switch (purchaseType) {
    case "shipping":
      return "Shipped";
    case "in-person":
      return "Picked Up";
    case "instant":
    case "fiat":
      return "Transferred";
    default:
      return casualMode ? "Incoming" : "In Transit";
  }
}
