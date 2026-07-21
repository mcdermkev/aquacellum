/**
 * orderStatus.js
 *
 * Pure, dependency-free helpers for the CURRENT (legacy) order-status
 * representations. Extracted verbatim from ordersSync.js so the behavior can be
 * pinned by characterization tests before the canonical state machine
 * (marketplaceStateMachine.js) supersedes it during the Task 23 migration.
 *
 * These functions intentionally preserve existing quirks (e.g. the flat
 * STATUS_ORDER ranking and the "terminal/disputed always wins from cloud"
 * rules). Do not "fix" them here — changes belong in the canonical model, and
 * the characterization tests exist to catch accidental drift.
 *
 * See docs/MARKETPLACE_STATE_MODEL.md §6 for how these legacy representations
 * map onto the canonical states.
 */

// Flat ranking used to decide whether an incoming cloud status is "further
// along" than the local one. Order matters and is behavior-defining.
export const STATUS_ORDER = [
  "pending", "locked", "dispatched", "released", "completed",
  "settled", "disputed", "resolved_released", "refunded", "failed",
];

// Cloud statuses treated as terminal for the purpose of the advance check.
export const TERMINAL_CLOUD_STATUSES = [
  "released", "completed", "settled", "refunded", "failed", "resolved_released",
];

/**
 * Decide whether an incoming cloud status should overwrite the local status.
 * Cloud wins if it is terminal (and local isn't), if it is a dispute branch,
 * or if it ranks later in STATUS_ORDER.
 *
 * @param {string} cloudStatus
 * @param {string} localStatus
 * @returns {boolean}
 */
export function isStatusAdvanced(cloudStatus, localStatus) {
  // Terminal states always win from cloud
  if (TERMINAL_CLOUD_STATUSES.includes(cloudStatus) && !TERMINAL_CLOUD_STATUSES.includes(localStatus)) return true;
  if (cloudStatus === localStatus) return false;

  // Disputed is a branch, always accept from cloud
  if (cloudStatus === "disputed") return true;

  const cloudIdx = STATUS_ORDER.indexOf(cloudStatus);
  const localIdx = STATUS_ORDER.indexOf(localStatus);
  return cloudIdx > localIdx;
}

/**
 * Derive the string status of a local Dexie order from its per-type
 * integer/string status fields.
 *
 * @param {Object} localOrder - Dexie marketOrders record
 * @returns {string}
 */
export function getLocalStatusString(localOrder) {
  if (localOrder.orderType === "shipping") {
    return ["locked", "dispatched", "released", "disputed", "refunded"][localOrder.status] || "locked";
  }
  if (localOrder.orderType === "batch") {
    return ["pending", "released", "refunded"][localOrder.state] || "pending";
  }
  return localOrder.status || "pending";
}

/**
 * Map a cloud shipping status string to the local Dexie integer enum.
 * @param {string} status
 * @returns {number}
 */
export function mapCloudStatusToShippingInt(status) {
  const map = { locked: 0, dispatched: 1, released: 2, disputed: 3, refunded: 4, resolved_released: 2 };
  return map[status] ?? 0;
}

/**
 * Map a cloud batch status string to the local Dexie integer enum.
 * @param {string} status
 * @returns {number}
 */
export function mapCloudStatusToBatchInt(status) {
  const map = { pending: 0, released: 1, refunded: 2 };
  return map[status] ?? 0;
}
