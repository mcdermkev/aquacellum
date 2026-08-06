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
  MORPH_REGISTERED: { points: 30, label: "Submitted Morph for Verification" },
  SPAWN_BREED: { points: 150, label: "Successful Breeding Spawn" },
  BATCH_SHIPPING: { points: 35, label: "Batch Shipping Dispatched" },
  AUDIT_GIVEN: { points: 60, label: "Pedigree Audit Completed" },
  AUDIT_RECEIVED: { points: 20, label: "Pedigree Audit Received" },

  // Arrival Flow
  ARRIVAL_CONFIRMED: { points: 25, label: "Confirmed Specimen Arrival" },
  BATCH_ARRIVAL_CONFIRMED: { points: 15, label: "Confirmed Batch Arrival" },
  ACCLIMATION_COMPLETED: { points: 20, label: "Completed Acclimation" },

  // Community & Social
  POST_CURRENT: { points: 10, label: "Posted Tank Current", dailyMax: 2 },
  PUBLISH_INSIGHT: { points: 20, label: "Published Species Insight" },
  ENGAGEMENT_BONUS: { points: 8, label: "Post Reached 5+ Reactions" },
  JOIN_SCHOOL: { points: 15, label: "Joined a School" },
  MENTORED_USER: { points: 40, label: "Mentored Another User" },

  // ── Actions that were being awarded with NO canonical entry ───────────────
  //
  // Each of these was a bare `addXp(<magic number>, "<prose label>")` call. The
  // amounts are preserved exactly so nobody's earn rate changes — retuning the
  // reward schedule is a separate, deliberate exercise — but they now exist in the
  // table, which is what lets the server recognise them instead of 403-ing the
  // claim and silently clawing it back after the user has already seen the toast.
  //
  // The dailyMax values are NEW, and they close farms rather than tune rewards:
  // every one of these was uncapped and infinitely repeatable.
  //   SPECIMEN_REHOMED — moving a fish A→B→A→B paid 10 XP per click, forever.
  //   POST_COMMENT     — 5 XP per comment with no limit at all.
  //   GROWOUT_CHECKPOINT — logged per spawn, so a breeder with many spawns has a
  //     legitimately high ceiling; the cap only stops a single spawn being logged
  //     hundreds of times in one sitting.
  SPECIMEN_REHOMED: { points: 10, label: "Specimen Rehomed", dailyMax: 3 },
  GROWOUT_CHECKPOINT: { points: 5, label: "Logged Grow-Out Checkpoint", dailyMax: 10 },
  POST_COMMENT: { points: 5, label: "Posted Tank Observation Comment", dailyMax: 5 },
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
 * Force the stored profile's point total to an authoritative value.
 *
 * Exists for rollback. `aquadex_xp_profile.points` is what `getXp()` returns, so
 * correcting only the scalar mirrors (`aquadex_xp`, `aquadex_xp_points`) left the
 * displayed score holding points the server had rejected — and every subsequent
 * rejection compounded it. The tier is re-derived here so the profile can never
 * report a tier its own point total does not support.
 *
 * Not an award: fires no event and appends no history entry.
 *
 * @param {number} points authoritative total (from Dexie `userProfile.totalXp`)
 */
export function setXpProfilePoints(points) {
  const total = Math.max(0, Number(points) || 0);
  const profile = getXpProfile();
  const info = getTierInfo(total);
  profile.points = total;
  profile.tier = info.key;
  profile.level = info.level;
  try {
    localStorage.setItem("aquadex_xp_profile", JSON.stringify(profile));
  } catch (e) {
    console.error("Failed correcting XP profile in local storage:", e);
  }
  return total;
}

/**
 * Award XP for a NAMED action. This is the API every award site should use.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * XP used to be awarded as a bare number plus a prose label, and `useXPSync`
 * recovered the action by LOWERCASING THE LABEL AND SUBSTRING-MATCHING IT against
 * ~20 `includes()` checks, with `return "LOG_FEEDING"` as the fallback. The server
 * then rejected any claim whose points did not match the action it had inferred,
 * and the client silently rolled the award back.
 *
 * That produced live, invisible breakage:
 *   "Specimen Rehomed"  → matched nothing → fell back to LOG_FEEDING (5 expected,
 *                         10 claimed) → 403 → removed after the toast said +10.
 *   "⚡ LIVE EVENT DOUBLE LOYALTY REWARDS (Cash Handshake checkout)"
 *                       → contains "handshake" → VERIFIED_PICKUP_BUYER (25
 *                         expected, 40×N claimed) → 403 → removed.
 *
 * So the highest-value marketplace actions were the ones most likely to evaporate,
 * and the only trace was a `console.info`. Passing the KEY removes the guessing:
 * the amount is derived from the canonical table, so client and server cannot
 * disagree about what an action is worth.
 *
 * An unknown key is a loud no-op rather than a silent fallback — a typo must not
 * quietly become a feeding award.
 *
 * @param {string} actionKey a key of XP_ACTIONS
 * @param {{quantity?: number, tankId?: string|number|null}} [opts]
 *   quantity multiplies the canonical points for genuinely batched actions
 *   (registering 10 certificates at once). The server validates
 *   `points === action.points * quantity`, so it must be passed, not folded in.
 * @returns {{newXp:number, tierInfo:object, tierChanged:boolean, awarded:number}}
 */
export function awardXp(actionKey, opts = {}) {
  const action = XP_ACTIONS[actionKey];
  if (!action) {
    // Loud, and deliberately not an exception: a mistyped key must not break the
    // user's actual action (registering a fish, completing a sale) just because the
    // reward bookkeeping is wrong.
    console.error(
      `[XP] awardXp called with unknown action key "${actionKey}". No XP awarded. ` +
        `Add it to XP_ACTIONS (and to VALID_ACTIONS in api/validate-xp.js) first.`
    );
    const current = getXp();
    return { newXp: current, tierInfo: getTierInfo(current), tierChanged: false, awarded: 0 };
  }

  const quantity = Math.max(1, Math.floor(Number(opts.quantity) || 1));
  const points = action.points * quantity;
  const label = quantity > 1 ? `${action.label} ×${quantity}` : action.label;

  const result = applyXp(points, label, {
    actionKey,
    quantity,
    tankId: opts.tankId ?? null,
    // Passed through to the server, which is the only side that can confirm an
    // event is live and apply its multiplier. The client never doubles its own
    // award — it just says which event it believes it was part of.
    eventId: opts.eventId ?? null,
  });
  return { ...result, awarded: points };
}

/**
 * Add XP by raw amount and prose label.
 *
 * ⚠️ LEGACY. Prefer `awardXp(actionKey, opts)`. Awards made through here carry no
 * action key, so `useXPSync` has to infer one from the label and may infer wrong —
 * see the note on `awardXp`. Retained only for the on-chain `XPEarned` path, where
 * the reason genuinely arrives as a free-text string from the contract.
 *
 * Returns { newXp, tierInfo, tierChanged }.
 */
export function addXp(pointsToAdd, actionLabel = "Husbandry Activity") {
  return applyXp(pointsToAdd, actionLabel, { actionKey: null, quantity: 1, tankId: null });
}

/**
 * Shared write path for both award APIs. Persists, then announces.
 */
function applyXp(pointsToAdd, actionLabel, meta) {
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
      // The canonical identity of this award. `useXPSync` uses these instead of
      // guessing the action from `actionLabel`; null means the award came through
      // the legacy `addXp` path and still needs inferring.
      actionKey: meta.actionKey,
      quantity: meta.quantity,
      tankId: meta.tankId,
      eventId: meta.eventId,
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
  const fallbackTier = TIER_LADDER[0];
  return {
    level: fallbackTier.level,
    key: fallbackTier.key,
    icon: fallbackTier.icon,
    color: fallbackTier.color,
    colorHex: fallbackTier.colorHex,
    companionForm: fallbackTier.companionForm,
    hobbyistLabel: fallbackTier.hobbyistLabel,
    breederLabel: fallbackTier.breederLabel,
    baseXp: fallbackTier.min,
    nextLevelXp: TIER_LADDER[1] ? TIER_LADDER[1].min : null,
    progressPct: 0,
    badge: fallbackTier.hobbyistLabel,
  };
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
