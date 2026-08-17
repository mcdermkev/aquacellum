/**
 * ProfileCard.jsx
 * 
 * Compact profile card used inline in feeds, comments, and lists.
 * Shows: avatar (or gradient placeholder), display name, companion tier icon.
 * Click navigates to full profile view.
 */

import React from "react";

const TIER_ICONS = {
  Bronze: "🥉",
  Silver: "🥈",
  Gold: "🥇",
  Master: "💎",
  "God-Tier": "👑",
};

const TIER_COLORS = {
  Bronze: "#cd7f32",
  Silver: "#c0c0c0",
  Gold: "#ffd700",
  Master: "#a855f7",
  "God-Tier": "#ffd700",
};

/**
 * Generate a deterministic gradient from a wallet address.
 */
function walletGradient(wallet) {
  if (!wallet) return "linear-gradient(135deg, #374151, #1f2937)";
  const hash = wallet.slice(2, 10);
  const h1 = parseInt(hash.slice(0, 4), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 60%, 40%), hsl(${h2}, 50%, 30%))`;
}

/**
 * Truncate wallet address for display.
 */
function truncateWallet(wallet) {
  if (!wallet) return "Unknown";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

/**
 * @param {object}  [props.profile] - A profiles row, as returned by the embedded
 *   selects across the Reef (`profile:wallet_address (wallet_address,
 *   display_name, avatar_url, companion_tier)`). Shorthand for spreading the four
 *   flat props below; explicit flat props win if both are given.
 *
 *   Supporting this shape is not sugar — it's the bug fix. Every caller in the
 *   Reef had a row in hand and passed `profile={row} compact`, but this component
 *   only ever read flat camelCase props. `displayName` was therefore always
 *   undefined, so every name fell through to `truncateWallet(undefined)` and
 *   rendered the literal string "Unknown" with a bronze medal, on tide hosts,
 *   attendee lists, chat authors, live-feed rows and the winning bidder alike.
 *   React silently ignored the unknown `compact` prop, so nothing warned.
 *
 * @param {boolean} [props.compact] - Alias for size="small", which is what the
 *   Reef call sites have always passed.
 */
export function ProfileCard({
  profile = null,
  compact = false,
  walletAddress,
  displayName,
  avatarUrl,
  companionTier,
  size, // "default" | "small" | "large"
  onClick,
  showTier = true,
  style = {},
}) {
  const wallet = walletAddress ?? profile?.wallet_address;
  const resolvedName = displayName ?? profile?.display_name;
  const avatar = avatarUrl ?? profile?.avatar_url;
  const tier = companionTier ?? profile?.companion_tier ?? "Bronze";
  const resolvedSize = size ?? (compact ? "small" : "default");

  const name = resolvedName || truncateWallet(wallet);
  const tierIcon = TIER_ICONS[tier] || "🥉";
  const tierColor = TIER_COLORS[tier] || "#cd7f32";

  const sizes = {
    small: { avatar: 24, fontSize: "0.7rem", gap: "0.35rem" },
    default: { avatar: 32, fontSize: "0.8rem", gap: "0.5rem" },
    large: { avatar: 44, fontSize: "0.9rem", gap: "0.65rem" },
  };

  const s = sizes[resolvedSize] || sizes.default;

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        cursor: onClick ? "pointer" : "default",
        borderRadius: "6px",
        padding: "0.15rem 0.3rem",
        transition: "background 0.15s ease",
        ...style,
      }}
      className="reef-profile-card"
      aria-label={`Profile: ${name}`}
    >
      {/* Avatar */}
      <div
        style={{
          width: `${s.avatar}px`,
          height: `${s.avatar}px`,
          borderRadius: "50%",
          background: avatar ? `url(${avatar}) center/cover` : walletGradient(wallet),
          flexShrink: 0,
          border: `1.5px solid ${tierColor}`,
          boxShadow: tier === "God-Tier" ? `0 0 8px ${tierColor}` : "none",
        }}
        aria-hidden="true"
      />

      {/* Name + Tier */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", minWidth: 0 }}>
        <span
          style={{
            fontSize: s.fontSize,
            fontWeight: 600,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        {showTier && (
          <span
            style={{ fontSize: resolvedSize === "small" ? "0.6rem" : "0.7rem" }}
            title={`${tier} Tier`}
          >
            {tierIcon}
          </span>
        )}
      </div>
    </div>
  );
}
