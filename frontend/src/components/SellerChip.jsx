/**
 * SellerChip — compact seller badge on a listing card.
 *
 * COSMETIC_EXPRESSION_SPEC.md §2. Shown on marketplace browse cards so a buyer
 * sees at a glance WHO is selling and what their track record with this species is.
 *
 * Renders:   [🥇 Gold Aquarist · 2yr Neon Tetra]
 *
 * Trust model: both values are server-derived.
 *   - Tier: profiles.companion_tier, synced from validated XP events
 *   - Mastery: species_mastery view over aquadex_specimens/spawns/growout
 *
 * Props:
 *   sellerTier     — "Shallow"|"Coastal"|"Pelagic"|"Abyssal"|"Hadal"|"Hadal-Champion"
 *   speciesMastery — { tier, daysKept } from getMasteryForSpecies, or null
 *   compact        — smaller variant for tight grids (default: false)
 */

import React from "react";

const TIER_CHIPS = {
  Shallow: { icon: "🥚", label: "New Keeper", color: "#94a3b8" },
  Coastal: { icon: "🥈", label: "Silver Keeper", color: "#38bdf8" },
  Pelagic: { icon: "🥇", label: "Gold Aquarist", color: "#fbbf24" },
  Abyssal: { icon: "💎", label: "Master Keeper", color: "#a855f7" },
  Hadal: { icon: "👑", label: "Champion", color: "#f59e0b" },
  "Hadal-Champion": { icon: "👑", label: "Zone Champion", color: "#f59e0b" },
};

function formatDuration(days) {
  if (!days || days < 1) return null;
  if (days >= 365) return `${Math.floor(days / 365)}yr`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days)}d`;
}

export function SellerChip({ sellerTier, speciesMastery, compact = false }) {
  const chip = TIER_CHIPS[sellerTier] || TIER_CHIPS.Shallow;
  const duration = speciesMastery?.entry?.daysKept
    ? formatDuration(speciesMastery.entry.daysKept)
    : null;

  // Don't render for brand-new sellers with no mastery — showing "🥚 New Keeper"
  // next to someone's first listing feels discouraging rather than informative.
  // The chip earns its space by communicating something the buyer wouldn't
  // otherwise know; "this person is new" is already implied by having no reviews.
  if (sellerTier === "Shallow" && !duration) return null;

  return (
    <span
      className="seller-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? "0.2rem" : "0.3rem",
        padding: compact ? "0.15rem 0.4rem" : "0.2rem 0.5rem",
        borderRadius: "50px",
        background: `${chip.color}0a`,
        border: `1px solid ${chip.color}25`,
        fontSize: compact ? "0.55rem" : "0.62rem",
        fontWeight: 600,
        color: chip.color,
        whiteSpace: "nowrap",
        lineHeight: 1.2,
      }}
      title={
        duration
          ? `${chip.label} — kept this species ${duration}`
          : chip.label
      }
    >
      <span style={{ fontSize: compact ? "0.6rem" : "0.7rem" }}>{chip.icon}</span>
      {!compact && <span>{chip.label}</span>}
      {duration && (
        <>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{duration}</span>
        </>
      )}
    </span>
  );
}

export default SellerChip;
