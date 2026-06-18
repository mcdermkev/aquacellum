/**
 * Aquacellum Unified XP System
 * 
 * Single point pool ("totalXp") with mode-aware display labels:
 *   - Casual Hobbyist: "Loyalty Points" / "pts"
 *   - Pro Breeder: "Reputation XP" / "XP"
 * 
 * Canonical Tier Ladder (from GAMIFICATION_SPEC.md):
 *   Tier 1: 0–1,499      (Shallow / Bronze Fry)
 *   Tier 2: 1,500–2,499  (Coastal / Silver Keeper)
 *   Tier 3: 2,500–4,999  (Pelagic / Gold Aquarist)
 *   Tier 4: 5,000–9,999  (Abyssal / Master Keeper)
 *   Tier 5: 10,000+      (Hadal / God-Tier Champion)
 */

// ─────────────────────────────────────────────────────────────────────────────
// XP Action Definitions (point values per spec section 2)
// ─────────────────────────────────────────────────────────────────────────────

export const XP_ACTIONS = {
  // Care & Husbandry
  LOG_FEEDING: { points: 5, label: "Daily Feeding Log", cooldownMs: 86400000, perTank: true },
  LOG_WATER: { points: 10, label: "Water Change Logged", cooldownMs: 172800000, perTank: true },
  LOG_PARAMETERS: { points: 8, label: "Water Parameters Tested", cooldownMs: 172800000, perTank: true },
  PHOTO_OBSERVATION: { points: 12, label: "Photo Observation Shared", cooldownMs: null, dailyMax: 3 },
  REGISTER_TANK: { points: 25, label: "Registered Aquarium Tank", cooldownMs: null },
  ADD_SPECIES: { points: 15, label: "Species Added to Collection", cooldownMs: null },

  // Marketplace
  VERIFIED_PICKUP_BUYER: { points: 25, label: "Verified Local Pickup" },
  VERIFIED_PICKUP_SELLER: { points: 25, label: "Verified Local Pickup (Seller)" },
  LIST_DIRECTORY: { points: 30, label: "Listed Specimen for Sale" },
  COMPLETED_SALE: { points: 40, label: "Completed Sale" },
  CLAIM_EXCHANGE: { points: 20, label: "Purchased Specimen" },

  // Breeding & Operational
  MINT_SPECIMEN: { points: 50, label: "Registered Birth Certificate" },
  SPAWN_BREED: { points: 150, label: "Successful Breeding Spawn" },
  BATCH_SHIPPING: { points: 35, label: "Batch Shipping Dispatched" },
  AUDIT_GIVEN: { points: 60, label: "Pedigree Audit Completed" },
  AUDIT_RECEIVED: { points: 20, label: "Pedigree Audit Received" },

  // Community & Social
  POST_CURRENT: { points: 10, label: "Posted Tank Current", dailyMax: 2 },
  PUBLISH_INSIGHT: { points: 20, label: "Published Species Insight" },
  ENGAGEMENT_BONUS: { points: 8, label: "Post Reached 5+ Reactions" },
  JOIN_SCHOOL: { points: 15, label: "Joined a School" },
  MENTORED_USER: { points: 40, label: "Mentored Another User" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Tier Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_LADDER = [
  {
    level: 1,
    key: "Shallow",
    min: 0,
    max: 1499,
    hobbyistLabel: "Bronze Fry",
    breederLabel: "Shallow Operator",
    icon: "🥚",
    color: "var(--accent-blue)",
    colorHex: "#94a3b8",
    companionForm: "Translucent fry",
  },
  {
    level: 2,
    key: "Coastal",
    min: 1500,
    max: 2499,
    hobbyistLabel: "Silver Keeper",
    breederLabel: "Coastal Operator",
    icon: "🥈",
    color: "var(--accent-cyan)",
    colorHex: "#38bdf8",
    companionForm: "Silver-blue shimmer",
  },
  {
    level: 3,
    key: "Pelagic",
    min: 2500,
    max: 4999,
    hobbyistLabel: "Gold Aquarist",
    breederLabel: "Pelagic Operator",
    icon: "🥇",
    color: "var(--accent-amber)",
    colorHex: "#fbbf24",
    companionForm: "Golden aura",
  },
  {
    level: 4,
    key: "Abyssal",
    min: 5000,
    max: 9999,
    hobbyistLabel: "Master Keeper",
    breederLabel: "Abyssal Operator",
    icon: "💎",
    color: "var(--accent-purple)",
    colorHex: "#a855f7",
    companionForm: "Evolved deep form",
  },
  {
    level: 5,
    key: "Hadal",
    min: 10000,
    max: Infinity,
    hobbyistLabel: "God-Tier Champion",
    breederLabel: "Hadal Champion",
    icon: "👑",
    color: "var(--accent-gold)",
    colorHex: "#f59e0b",
    companionForm: "Legendary golden koi",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the full user XP Profile from local storage, with fallback initialization.
 */
export function getXpProfile() {
  try {
    const val = localStorage.getItem("aquadex_xp_profile");
    if (val && val !== "undefined" && val !== "null") {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object" && typeof parsed.points === "number") {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to parse aquadex_xp_profile local storage value:", e);
  }

  const fallback = {
    points: 0,
    tier: "Shallow",
    level: 1,
    history: [],
  };
  try {
    localStorage.setItem("aquadex_xp_profile", JSON.stringify(fallback));
    localStorage.setItem("aquadex_xp", "0");
    localStorage.setItem("aquadex_xp_points", "0");
  } catch (e) {
    console.error("Local storage is not writable:", e);
  }
  return fallback;
}

/**
 * Get current user XP points from local storage.
 */
export function getXp() {
  const profile = getXpProfile();
  return profile.points;
}

/**
 * Add XP points and fire event notifications.
 * Returns { newXp, tierInfo, tierChanged }.
 */
export function addXp(pointsToAdd, actionLabel = "Husbandry Activity") {
  const points = Number(pointsToAdd || 0);
  if (points <= 0) return { newXp: getXp(), tierInfo: getTierInfo(getXp()), tierChanged: false };

  const profile = getXpProfile();
  const currentXp = profile.points;
  const newXp = currentXp + points;

  const oldInfo = getTierInfo(currentXp);
  const newInfo = getTierInfo(newXp);
  const tierChanged = oldInfo.level !== newInfo.level;

  // Update profile
  profile.points = newXp;
  profile.tier = newInfo.key;
  profile.level = newInfo.level;
  if (!profile.history) profile.history = [];
  profile.history.push({
    timestamp: Date.now(),
    action: actionLabel,
    points,
  });

  try {
    localStorage.setItem("aquadex_xp_profile", JSON.stringify(profile));
    localStorage.setItem("aquadex_xp", newXp.toString());
    localStorage.setItem("aquadex_xp_points", newXp.toString());
  } catch (e) {
    console.error("Failed saving XP state to local storage:", e);
  }

  // Dispatch global event for UI components (toasts, companion reactions, etc.)
  const event = new CustomEvent("aquadex_xp_added", {
    detail: {
      points,
      actionLabel,
      totalXp: newXp,
      tierInfo: newInfo,
      tierChanged,
      newLevel: newInfo.level,
      // Legacy compat fields
      levelInfo: newInfo,
      levelChanged: tierChanged,
    },
  });
  window.dispatchEvent(event);

  return { newXp, tierInfo: newInfo, tierChanged };
}

/**
 * Get tier info for a given XP amount.
 * Replaces the old getLevelInfo() — same interface shape for backwards compat.
 */
export function getTierInfo(xp) {
  const currentPoints = Number(xp || 0);

  for (let i = TIER_LADDER.length - 1; i >= 0; i--) {
    if (currentPoints >= TIER_LADDER[i].min) {
      const tier = TIER_LADDER[i];
      const nextTier = TIER_LADDER[i + 1] || null;
      const range = tier.max === Infinity ? 1 : (tier.max - tier.min + 1);
      const progress = tier.max === Infinity
        ? 100
        : Math.min(100, Math.max(0, ((currentPoints - tier.min) / range) * 100));

      return {
        // Core tier data
        level: tier.level,
        key: tier.key,
        icon: tier.icon,
        color: tier.color,
        colorHex: tier.colorHex,
        companionForm: tier.companionForm,

        // Mode-aware labels (consumers pick the right one)
        hobbyistLabel: tier.hobbyistLabel,
        breederLabel: tier.breederLabel,

        // Progress data
        baseXp: tier.min,
        nextLevelXp: nextTier ? nextTier.min : null,
        progressPct: progress,

        // Legacy compat (old getLevelInfo shape)
        badge: tier.hobbyistLabel,
      };
    }
  }

  // Fallback (should never reach here)
  return getTierInfoForTier(TIER_LADDER[0]);
}

/**
 * Convenience: get the display label for current mode.
 * @param {object} tierInfo - Result from getTierInfo()
 * @param {boolean} isCasualMode - true = hobbyist labels, false = breeder labels
 */
export function getTierLabel(tierInfo, isCasualMode = true) {
  return isCasualMode ? tierInfo.hobbyistLabel : tierInfo.breederLabel;
}

/**
 * Get the points currency label for the current mode.
 * @param {boolean} isCasualMode
 */
export function getPointsLabel(isCasualMode = true) {
  return isCasualMode ? "Loyalty Points" : "XP";
}

/**
 * Get the short points suffix for the current mode.
 * @param {boolean} isCasualMode
 */
export function getPointsSuffix(isCasualMode = true) {
  return isCasualMode ? "pts" : "XP";
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Alias — backwards compatibility for existing consumers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use getTierInfo() instead. Kept for existing call sites.
 */
export function getLevelInfo(xp) {
  return getTierInfo(xp);
}
