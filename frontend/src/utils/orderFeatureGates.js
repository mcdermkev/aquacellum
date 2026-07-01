/**
 * orderFeatureGates.js
 *
 * XP-based feature gating for advanced order features.
 * Features are earned through activity, not purchased.
 *
 * Tier Thresholds:
 *   Shallow:   0 XP     — Basic orders, receipts, filters
 *   Coastal:   1,500 XP — Priority protection badge, extended dispute window
 *   Pelagic:   2,500 XP — Order analytics, CSV export, watchlist
 *   Abyssal:   5,000 XP — Smart reorder, auto-release rules, bulk management
 *   Hadal:     10,000 XP — Full analytics dashboard, carrier API integration, priority curator queue
 */

// Feature definitions with their unlock tiers
export const ORDER_FEATURES = {
  // Coastal (1,500 XP) — Early trust features
  PRIORITY_PROTECTION: {
    key: "priority_protection",
    label: "Priority Protection",
    description: "Extended 14-day safety window and priority dispute resolution",
    unlockTier: "Coastal",
    unlockXp: 1500,
    icon: "🛡️",
  },
  DISPATCH_REMINDERS: {
    key: "dispatch_reminders",
    label: "Dispatch Reminders",
    description: "Smart nudges when your seller hasn't dispatched yet",
    unlockTier: "Coastal",
    unlockXp: 1500,
    icon: "🔔",
  },

  // Pelagic (2,500 XP) — Data & insights
  ORDER_ANALYTICS: {
    key: "order_analytics",
    label: "Order Analytics",
    description: "Revenue charts, fulfillment speed stats, and order trends",
    unlockTier: "Pelagic",
    unlockXp: 2500,
    icon: "📊",
  },
  CSV_EXPORT: {
    key: "csv_export",
    label: "CSV Export",
    description: "Export your order history as spreadsheet data",
    unlockTier: "Pelagic",
    unlockXp: 2500,
    icon: "📥",
  },
  SPECIES_WATCHLIST: {
    key: "species_watchlist",
    label: "Species Watchlist",
    description: "Get alerts when watched species drop in price",
    unlockTier: "Pelagic",
    unlockXp: 2500,
    icon: "👁️",
  },

  // Abyssal (5,000 XP) — Power seller/buyer tools
  SMART_REORDER: {
    key: "smart_reorder",
    label: "Smart Reorder",
    description: "One-tap reorder from completed orders when the species is available",
    unlockTier: "Abyssal",
    unlockXp: 5000,
    icon: "🔄",
  },
  AUTO_RELEASE_RULES: {
    key: "auto_release_rules",
    label: "Auto-Release Rules",
    description: "Set conditions to automatically release escrow (e.g., after delivery scan)",
    unlockTier: "Abyssal",
    unlockXp: 5000,
    icon: "⚡",
  },
  BULK_MANAGEMENT: {
    key: "bulk_management",
    label: "Bulk Order Management",
    description: "Batch dispatch, print labels, and bulk status updates for high-volume sellers",
    unlockTier: "Abyssal",
    unlockXp: 5000,
    icon: "📦",
  },

  // Hadal (10,000 XP) — Elite features
  LIVE_CARRIER_TRACKING: {
    key: "live_carrier_tracking",
    label: "Live Carrier Tracking",
    description: "Real-time delivery estimates from USPS, UPS, and FedEx",
    unlockTier: "Hadal",
    unlockXp: 10000,
    icon: "🗺️",
  },
  PRIORITY_CURATOR_QUEUE: {
    key: "priority_curator_queue",
    label: "Priority Curator Queue",
    description: "Disputes are resolved first by curators — skip the queue",
    unlockTier: "Hadal",
    unlockXp: 10000,
    icon: "👑",
  },
  SELLER_REPUTATION_SCORE: {
    key: "seller_reputation_score",
    label: "Reputation Insights",
    description: "See detailed seller reliability scores before purchasing",
    unlockTier: "Hadal",
    unlockXp: 10000,
    icon: "⭐",
  },
};

// Tier ordering for comparison
const TIER_ORDER = ["Shallow", "Coastal", "Pelagic", "Abyssal", "Hadal"];

/**
 * Check if a user's tier unlocks a specific feature.
 *
 * @param {string} userTier - Current tier ("Shallow", "Coastal", etc.)
 * @param {string} featureKey - Key from ORDER_FEATURES (e.g., "ORDER_ANALYTICS")
 * @returns {boolean}
 */
export function isFeatureUnlocked(userTier, featureKey) {
  const feature = ORDER_FEATURES[featureKey];
  if (!feature) return false;

  const userTierIdx = TIER_ORDER.indexOf(userTier || "Shallow");
  const requiredTierIdx = TIER_ORDER.indexOf(feature.unlockTier);

  return userTierIdx >= requiredTierIdx;
}

/**
 * Get all features grouped by unlock status for the user's current tier.
 *
 * @param {string} userTier - Current tier
 * @param {number} totalXp - User's total XP
 * @returns {{ unlocked: Array, locked: Array }}
 */
export function getFeatureStatus(userTier, totalXp) {
  const unlocked = [];
  const locked = [];

  for (const [key, feature] of Object.entries(ORDER_FEATURES)) {
    const isUnlocked = isFeatureUnlocked(userTier, key);
    const item = { ...feature, featureKey: key, isUnlocked };

    if (!isUnlocked) {
      item.xpNeeded = feature.unlockXp - (totalXp || 0);
      item.progressPct = Math.min(100, Math.round(((totalXp || 0) / feature.unlockXp) * 100));
    }

    if (isUnlocked) {
      unlocked.push(item);
    } else {
      locked.push(item);
    }
  }

  // Sort locked by XP needed (closest to unlock first)
  locked.sort((a, b) => a.xpNeeded - b.xpNeeded);

  return { unlocked, locked };
}

/**
 * Get XP progress toward the next tier that unlocks new order features.
 *
 * @param {string} userTier - Current tier
 * @param {number} totalXp - User's total XP
 * @returns {{ nextTier: string|null, xpNeeded: number, features: Array }}
 */
export function getNextTierUnlocks(userTier, totalXp) {
  const userIdx = TIER_ORDER.indexOf(userTier || "Shallow");

  if (userIdx >= TIER_ORDER.length - 1) {
    return { nextTier: null, xpNeeded: 0, features: [] };
  }

  const nextTier = TIER_ORDER[userIdx + 1];
  const nextTierFeatures = Object.values(ORDER_FEATURES).filter(
    (f) => f.unlockTier === nextTier
  );

  const thresholds = { Coastal: 1500, Pelagic: 2500, Abyssal: 5000, Hadal: 10000 };
  const xpNeeded = Math.max(0, (thresholds[nextTier] || 0) - (totalXp || 0));

  return { nextTier, xpNeeded, features: nextTierFeatures };
}
