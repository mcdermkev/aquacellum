/**
 * BadgeShelf.jsx
 * 
 * Visual badge row displayed on profiles.
 * Badges are auto-calculated from user stats (XP, tanks, species, tier, etc.)
 * Non-transferable visual indicators — purely cosmetic achievements.
 */

import React, { useMemo } from "react";
import { Lock, Medal } from "@phosphor-icons/react";
import "./ProfileDaylight.css";

/**
 * Badge definitions with unlock criteria.
 * Each badge has: id, icon, name, description, and an unlock function.
 * 
 * Updated per GAMIFICATION_SPEC.md section 7:
 *   - Tier badges use canonical names (Shallow/Coastal/Pelagic/Abyssal/Hadal)
 *   - Added event badges (Expo Attendee, Challenge Victor, Care Streak)
 *   - Added weekly Contributor of the Week badge
 */
const BADGE_DEFINITIONS = [
  // ─── Collection Badges ─────────────────────────────────────────────────
  {
    id: "first_tank",
    icon: "🐠",
    name: "First Tank",
    description: "Registered your first aquarium",
    category: "collection",
    unlock: (stats) => stats.tankCount >= 1,
  },
  {
    id: "five_tanks",
    icon: "🏠",
    name: "Tank Collector",
    description: "Managing 5 or more tanks",
    category: "collection",
    unlock: (stats) => stats.tankCount >= 5,
  },
  {
    id: "ten_tanks",
    icon: "🏭",
    name: "Facility Operator",
    description: "Running 10 or more tanks",
    category: "collection",
    unlock: (stats) => stats.tankCount >= 10,
  },
  {
    id: "ten_species",
    icon: "🐟",
    name: "Species Explorer",
    description: "Keeping 10 or more species",
    category: "collection",
    unlock: (stats) => stats.speciesCount >= 10,
  },
  {
    id: "fifty_species",
    icon: "📚",
    name: "Catalog Scholar",
    description: "Logged 50+ species in your collection",
    category: "collection",
    unlock: (stats) => stats.speciesCount >= 50,
  },
  {
    id: "hundred_species",
    icon: "🧬",
    name: "Biodiversity Champion",
    description: "Kept 100 or more species",
    category: "collection",
    unlock: (stats) => stats.speciesCount >= 100,
  },

  // ─── Tier Badges (canonical names) ─────────────────────────────────────
  {
    id: "coastal_tier",
    icon: "🥈",
    name: "Coastal Tier",
    description: "Reached Coastal tier (1,500+ pts)",
    category: "tier",
    unlock: (stats) => ["Coastal", "Pelagic", "Abyssal", "Hadal", "Hadal-Champion"].includes(stats.companionTier),
  },
  {
    id: "pelagic_tier",
    icon: "🥇",
    name: "Pelagic Tier",
    description: "Reached Pelagic tier (2,500+ pts)",
    category: "tier",
    unlock: (stats) => ["Pelagic", "Abyssal", "Hadal", "Hadal-Champion"].includes(stats.companionTier),
  },
  {
    id: "abyssal_tier",
    icon: "💎",
    name: "Abyssal Tier",
    description: "Reached Abyssal tier (5,000+ pts)",
    category: "tier",
    unlock: (stats) => ["Abyssal", "Hadal", "Hadal-Champion"].includes(stats.companionTier),
  },
  {
    id: "hadal_tier",
    icon: "🔱",
    name: "Hadal Tier",
    description: "Reached Hadal tier (10,000+ pts)",
    category: "tier",
    unlock: (stats) => ["Hadal", "Hadal-Champion"].includes(stats.companionTier),
  },
  {
    id: "zone_champion",
    icon: "👑",
    name: "Zone Champion",
    description: "The #1 ranked keeper in your regional zone",
    category: "tier",
    unlock: (stats) => stats.companionTier === "Hadal-Champion" || stats.isZoneChampion,
  },

  // ─── Community Badges ──────────────────────────────────────────────────
  {
    id: "first_post",
    icon: "🪸",
    name: "Reef Pioneer",
    description: "Posted your first tank update",
    category: "community",
    unlock: (stats) => stats.postCount >= 1,
  },
  {
    id: "ten_posts",
    icon: "📢",
    name: "Active Voice",
    description: "Shared 10 or more updates on The Reef",
    category: "community",
    unlock: (stats) => stats.postCount >= 10,
  },
  {
    id: "first_insight",
    icon: "💡",
    name: "Knowledge Sharer",
    description: "Posted your first Species Insight",
    category: "community",
    unlock: (stats) => stats.insightCount >= 1,
  },
  {
    id: "five_tankmates",
    icon: "🤝",
    name: "Social Swimmer",
    description: "Connected with 5 or more tankmates",
    category: "social",
    unlock: (stats) => stats.tankmateCount >= 5,
  },

  // ─── XP Milestone Badges ───────────────────────────────────────────────
  {
    id: "xp_500",
    icon: "⚡",
    name: "Rising Current",
    description: "Earned 500+ total XP",
    category: "xp",
    unlock: (stats) => stats.xpTotal >= 500,
  },
  {
    id: "xp_2000",
    icon: "🌊",
    name: "Tidal Force",
    description: "Earned 2,000+ total XP",
    category: "xp",
    unlock: (stats) => stats.xpTotal >= 2000,
  },
  {
    id: "xp_5000",
    icon: "🔱",
    name: "Poseidon's Favor",
    description: "Earned 5,000+ total XP",
    category: "xp",
    unlock: (stats) => stats.xpTotal >= 5000,
  },
  {
    id: "xp_10000",
    icon: "🐉",
    name: "Deep Sea Legend",
    description: "Earned 10,000+ total XP",
    category: "xp",
    unlock: (stats) => stats.xpTotal >= 10000,
  },

  // ─── Event Badges ──────────────────────────────────────────────────────
  {
    id: "expo_attendee",
    icon: "🎪",
    name: "Expo Attendee",
    description: "Completed a transaction at a verified swap meet",
    category: "event",
    unlock: (stats) => stats.expoTransactions >= 1,
  },
  {
    id: "challenge_victor",
    icon: "🏆",
    name: "Challenge Victor",
    description: "Finished in the top 3 of a club challenge",
    category: "event",
    unlock: (stats) => stats.challengeWins >= 1,
  },
  {
    id: "care_streak_30",
    icon: "🔥",
    name: "30-Day Streak",
    description: "Kept a 30-day care streak",
    category: "event",
    unlock: (stats) => stats.longestStreak >= 30,
  },
  {
    id: "care_streak_90",
    icon: "💫",
    name: "90-Day Streak",
    description: "Kept a 90-day care streak",
    category: "event",
    unlock: (stats) => stats.longestStreak >= 90,
  },

  // ─── Dex Completion Badges (COSMETIC_EXPRESSION_SPEC.md §5) ─────────────
  //
  // Tracks % of the combined catalog you've kept. As new species are added it
  // incentivizes research into what was added — the Dex is a living target.
  {
    id: "dex_10",
    icon: "🗺️",
    name: "Explorer",
    description: "Kept 10% of the known species catalog",
    category: "collection",
    unlock: (stats) => (stats.dexPercent || 0) >= 10,
  },
  {
    id: "dex_25",
    icon: "📖",
    name: "Collector",
    description: "Kept 25% of the known species catalog",
    category: "collection",
    unlock: (stats) => (stats.dexPercent || 0) >= 25,
  },
  {
    id: "dex_50",
    icon: "🌿",
    name: "Naturalist",
    description: "Kept 50% of the known species catalog",
    category: "collection",
    unlock: (stats) => (stats.dexPercent || 0) >= 50,
  },
  {
    id: "dex_75",
    icon: "🧭",
    name: "Encyclopedist",
    description: "Kept 75% of the known species catalog",
    category: "collection",
    unlock: (stats) => (stats.dexPercent || 0) >= 75,
  },
  {
    id: "dex_100",
    icon: "🏅",
    name: "Complete Dex",
    description: "Kept every species in both the curated and on-chain catalogs",
    category: "collection",
    unlock: (stats) => (stats.dexPercent || 0) >= 100,
  },

  // ─── Weekly Contributor Badge (non-permanent, refreshes weekly) ─────────
  {
    id: "weekly_contributor",
    icon: "🌟",
    name: "Contributor of the Week",
    description: "Ranked top 3 in weekly contributions (refreshes Monday)",
    category: "event",
    unlock: (stats) => stats.isWeeklyTopContributor,
  },
];

/**
 * Calculate which badges a user has unlocked.
 */
function getUnlockedBadges(stats) {
  return BADGE_DEFINITIONS.filter((badge) => badge.unlock(stats));
}

/**
 * Single badge: the badge art (decorative), its name, and the description as
 * a tooltip plus screen-reader text.
 */
function Badge({ badge, unlocked = true }) {
  return (
    <li className={`pf-badge${unlocked ? "" : " pf-badge--locked"}`} title={badge.description}>
      <span className="pf-badge-art" aria-hidden="true">
        {unlocked ? badge.icon : <Lock size={14} weight="bold" />}
      </span>
      <span>{badge.name}</span>
      <span className="pf-sr-only">
        {unlocked ? `: ${badge.description}` : `, locked: ${badge.description}`}
      </span>
    </li>
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
 */
export function BadgeShelf({
  stats = {},
  showLocked = false,
  casualModeActive = false,
}) {
  const unlockedBadges = useMemo(() => getUnlockedBadges(stats), [stats]);
  const lockedBadges = useMemo(
    () => BADGE_DEFINITIONS.filter((b) => !b.unlock(stats)),
    [stats]
  );

  if (unlockedBadges.length === 0 && !showLocked) return null;

  return (
    <section className="pf-card" aria-labelledby="pf-badges-title">
      <h3 id="pf-badges-title" className="pf-section-title">
        <Medal size={20} weight="bold" aria-hidden="true" />
        {casualModeActive ? `Achievements (${unlockedBadges.length})` : `Badges (${unlockedBadges.length})`}
      </h3>

      {/* Unlocked badges */}
      {unlockedBadges.length > 0 ? (
        <ul className="pf-badges">
          {unlockedBadges.map((badge) => (
            <Badge key={badge.id} badge={badge} unlocked />
          ))}
        </ul>
      ) : (
        <p className="pf-muted">No badges yet.</p>
      )}

      {/* Locked badges (optional, for a "view all" mode) */}
      {showLocked && lockedBadges.length > 0 && (
        <>
          <h4 className="pf-badges-label">{casualModeActive ? "Locked" : "Upcoming"}</h4>
          <ul className="pf-badges">
            {lockedBadges.map((badge) => (
              <Badge key={badge.id} badge={badge} unlocked={false} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
