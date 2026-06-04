/**
 * BadgeShelf.jsx
 * 
 * Visual badge row displayed on profiles.
 * Badges are auto-calculated from user stats (XP, tanks, species, tier, etc.)
 * Non-transferable visual indicators — purely cosmetic achievements.
 */

import React, { useMemo } from "react";

/**
 * Badge definitions with unlock criteria.
 * Each badge has: id, icon, name, description, and an unlock function.
 */
const BADGE_DEFINITIONS = [
  {
    id: "first_tank",
    icon: "🐠",
    name: "First Tank",
    description: "Registered your first aquarium",
    unlock: (stats) => stats.tankCount >= 1,
  },
  {
    id: "five_tanks",
    icon: "🏠",
    name: "Tank Collector",
    description: "Managing 5 or more tanks",
    unlock: (stats) => stats.tankCount >= 5,
  },
  {
    id: "ten_tanks",
    icon: "🏭",
    name: "Facility Operator",
    description: "Running 10+ tanks like a pro",
    unlock: (stats) => stats.tankCount >= 10,
  },
  {
    id: "ten_species",
    icon: "🐟",
    name: "Species Explorer",
    description: "Keeping 10+ different species",
    unlock: (stats) => stats.speciesCount >= 10,
  },
  {
    id: "fifty_species",
    icon: "📚",
    name: "Catalog Scholar",
    description: "Logged 50+ species in your collection",
    unlock: (stats) => stats.speciesCount >= 50,
  },
  {
    id: "hundred_species",
    icon: "🧬",
    name: "Biodiversity Champion",
    description: "100+ species mastered",
    unlock: (stats) => stats.speciesCount >= 100,
  },
  {
    id: "silver_tier",
    icon: "🥈",
    name: "Silver Tier",
    description: "Reached Silver companion tier",
    unlock: (stats) => ["Silver", "Gold", "Master", "God-Tier"].includes(stats.companionTier),
  },
  {
    id: "gold_tier",
    icon: "🥇",
    name: "Gold Tier",
    description: "Reached Gold companion tier",
    unlock: (stats) => ["Gold", "Master", "God-Tier"].includes(stats.companionTier),
  },
  {
    id: "master_tier",
    icon: "💎",
    name: "Master Breeder",
    description: "Achieved Master tier — elite status",
    unlock: (stats) => ["Master", "God-Tier"].includes(stats.companionTier),
  },
  {
    id: "god_tier",
    icon: "👑",
    name: "God-Tier Champion",
    description: "The #1 breeder in your region",
    unlock: (stats) => stats.companionTier === "God-Tier",
  },
  {
    id: "first_post",
    icon: "🪸",
    name: "Reef Pioneer",
    description: "Published your first Tank Current",
    unlock: (stats) => stats.postCount >= 1,
  },
  {
    id: "ten_posts",
    icon: "📢",
    name: "Active Voice",
    description: "Shared 10+ updates on The Reef",
    unlock: (stats) => stats.postCount >= 10,
  },
  {
    id: "first_insight",
    icon: "💡",
    name: "Knowledge Sharer",
    description: "Posted your first Species Insight",
    unlock: (stats) => stats.insightCount >= 1,
  },
  {
    id: "five_tankmates",
    icon: "🤝",
    name: "Social Swimmer",
    description: "Connected with 5+ Tankmates",
    unlock: (stats) => stats.tankmateCount >= 5,
  },
  {
    id: "xp_500",
    icon: "⚡",
    name: "Rising Current",
    description: "Earned 500+ total XP",
    unlock: (stats) => stats.xpTotal >= 500,
  },
  {
    id: "xp_2000",
    icon: "🌊",
    name: "Tidal Force",
    description: "Earned 2,000+ total XP",
    unlock: (stats) => stats.xpTotal >= 2000,
  },
  {
    id: "xp_5000",
    icon: "🔱",
    name: "Poseidon's Favor",
    description: "Earned 5,000+ total XP — legendary dedication",
    unlock: (stats) => stats.xpTotal >= 5000,
  },
];

/**
 * Calculate which badges a user has unlocked.
 */
function getUnlockedBadges(stats) {
  return BADGE_DEFINITIONS.filter((badge) => badge.unlock(stats));
}

/**
 * Single badge display.
 */
function Badge({ badge, unlocked = true, size = "default" }) {
  const sizes = {
    small: { box: "28px", icon: "0.8rem", font: "0.5rem" },
    default: { box: "38px", icon: "1.1rem", font: "0.55rem" },
    large: { box: "48px", icon: "1.4rem", font: "0.6rem" },
  };
  const s = sizes[size] || sizes.default;

  return (
    <div
      title={unlocked ? `${badge.name}: ${badge.description}` : `🔒 ${badge.name}: ${badge.description}`}
      style={{
        width: s.box,
        height: s.box,
        borderRadius: "10px",
        background: unlocked ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.02)",
        border: unlocked
          ? "1px solid rgba(56, 189, 248, 0.2)"
          : "1px solid rgba(255, 255, 255, 0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: s.icon,
        opacity: unlocked ? 1 : 0.3,
        cursor: "default",
        transition: "all 0.2s ease",
        position: "relative",
        flexShrink: 0,
      }}
      aria-label={`Badge: ${badge.name}${unlocked ? "" : " (locked)"}`}
    >
      {badge.icon}
      {!unlocked && (
        <span style={{
          position: "absolute",
          bottom: "-1px",
          right: "-1px",
          fontSize: "0.45rem",
        }}>
          🔒
        </span>
      )}
    </div>
  );
}

/**
 * BadgeShelf — displays unlocked badges (and optionally locked ones).
 * 
 * @param {object} stats - User stats for badge calculation
 * @param {number} stats.tankCount - Number of tanks
 * @param {number} stats.speciesCount - Number of species
 * @param {string} stats.companionTier - Current companion tier
 * @param {number} stats.xpTotal - Total XP
 * @param {number} stats.postCount - Number of Reef posts
 * @param {number} stats.insightCount - Number of Species Insights
 * @param {number} stats.tankmateCount - Number of Tankmate connections
 * @param {boolean} showLocked - Whether to show locked badges too
 * @param {string} size - Badge size: "small" | "default" | "large"
 */
export function BadgeShelf({
  stats = {},
  showLocked = false,
  size = "default",
  casualModeActive = false,
}) {
  const unlockedBadges = useMemo(() => getUnlockedBadges(stats), [stats]);
  const lockedBadges = useMemo(
    () => BADGE_DEFINITIONS.filter((b) => !b.unlock(stats)),
    [stats]
  );

  if (unlockedBadges.length === 0 && !showLocked) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {/* Unlocked badges */}
      {unlockedBadges.length > 0 && (
        <div>
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>
            {casualModeActive ? `✨ Achievements (${unlockedBadges.length})` : `Badges (${unlockedBadges.length})`}
          </span>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {unlockedBadges.map((badge) => (
              <Badge key={badge.id} badge={badge} unlocked size={size} />
            ))}
          </div>
        </div>
      )}

      {/* Locked badges (optional — for "view all" mode) */}
      {showLocked && lockedBadges.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>
            {casualModeActive ? "🔒 Locked" : "Upcoming"}
          </span>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {lockedBadges.map((badge) => (
              <Badge key={badge.id} badge={badge} unlocked={false} size={size} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
