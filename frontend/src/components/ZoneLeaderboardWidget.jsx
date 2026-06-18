/**
 * ZoneLeaderboardWidget.jsx
 * 
 * Compact sidebar/dashboard widget showing the user's zone rank + top 5.
 * Supports cross-zone browsing via a zone picker dropdown.
 * 
 * Props:
 *   - casualModeActive {boolean} - Controls label style (pts vs XP)
 *   - compact {boolean} - Renders a smaller version for sidebar use
 */

import React, { useState } from "react";
import { useMyZoneLeaderboard, useZoneLeaderboard, useUserZoneRank, useAvailableZones, useZoneDetails } from "../hooks/useZoneLeaderboard";
import { getPointsSuffix, getTierInfo, TIER_LADDER } from "../utils/xp";

// ─────────────────────────────────────────────────────────────────────────────
// Tier badge colors
// ─────────────────────────────────────────────────────────────────────────────

const TIER_COLORS = {
  Shallow: "#94a3b8",
  Coastal: "#38bdf8",
  Pelagic: "#fbbf24",
  Abyssal: "#a855f7",
  Hadal: "#f59e0b",
  "Hadal-Champion": "#f59e0b",
};

const TIER_ICONS = {
  Shallow: "🥚",
  Coastal: "🥈",
  Pelagic: "🥇",
  Abyssal: "💎",
  Hadal: "👑",
  "Hadal-Champion": "👑",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function LeaderboardRow({ entry, rank, isCurrentUser, casualModeActive }) {
  const suffix = getPointsSuffix(casualModeActive);
  const tierColor = TIER_COLORS[entry.current_tier] || "#94a3b8";
  const tierIcon = TIER_ICONS[entry.current_tier] || "🥚";

  const rankDisplay = rank === 1 ? "👑" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.4rem 0.6rem",
        borderRadius: "8px",
        background: isCurrentUser
          ? "rgba(56, 189, 248, 0.08)"
          : "transparent",
        border: isCurrentUser
          ? "1px solid rgba(56, 189, 248, 0.15)"
          : "1px solid transparent",
        transition: "background 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: rank <= 3 ? "1rem" : "0.75rem",
          width: "1.5rem",
          textAlign: "center",
          color: rank === 1 ? "#fbbf24" : "var(--text-muted)",
          fontWeight: rank <= 3 ? "700" : "400",
          flexShrink: 0,
        }}>
          {rankDisplay}
        </span>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: "0.78rem",
            fontWeight: isCurrentUser ? "700" : "500",
            color: isCurrentUser ? "#fff" : "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {entry.display_name || `${entry.wallet_address?.slice(0, 6)}...${entry.wallet_address?.slice(-4)}`}
            {isCurrentUser && <span style={{ fontSize: "0.6rem", color: "var(--accent-cyan)", marginLeft: "0.3rem" }}>(you)</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
        <span style={{
          fontSize: "0.7rem",
          fontFamily: "monospace",
          color: tierColor,
          fontWeight: "600",
        }}>
          {entry.total_xp?.toLocaleString()} {suffix}
        </span>
        <span style={{ fontSize: "0.75rem" }}>{tierIcon}</span>
      </div>
    </div>
  );
}

function ZonePicker({ zones, selectedZone, onSelect, isLoading }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "6px",
          padding: "0.3rem 0.6rem",
          fontSize: "0.65rem",
          color: "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          transition: "border-color 0.15s ease",
        }}
        aria-label="Browse other zones"
      >
        🌐 {selectedZone ? "Other Zones" : "Browse Zones"}
        <span style={{ fontSize: "0.55rem", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          zIndex: 100,
          background: "rgba(10, 10, 20, 0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          padding: "0.5rem",
          maxHeight: "200px",
          overflowY: "auto",
          minWidth: "180px",
          backdropFilter: "blur(12px)",
        }}>
          {/* Reset to own zone */}
          <div
            onClick={() => { onSelect(null); setOpen(false); }}
            style={{
              padding: "0.35rem 0.5rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.7rem",
              color: !selectedZone ? "var(--accent-cyan)" : "var(--text-secondary)",
              fontWeight: !selectedZone ? "600" : "400",
              background: !selectedZone ? "rgba(56,189,248,0.08)" : "transparent",
            }}
          >
            📍 My Zone
          </div>

          {isLoading && (
            <div style={{ padding: "0.5rem", fontSize: "0.65rem", color: "var(--text-muted)", textAlign: "center" }}>
              Loading zones...
            </div>
          )}

          {zones?.map((zone) => (
            <div
              key={zone.zone_hash}
              onClick={() => { onSelect(zone.zone_hash); setOpen(false); }}
              style={{
                padding: "0.35rem 0.5rem",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.7rem",
                color: selectedZone === zone.zone_hash ? "var(--accent-cyan)" : "var(--text-secondary)",
                fontWeight: selectedZone === zone.zone_hash ? "600" : "400",
                background: selectedZone === zone.zone_hash ? "rgba(56,189,248,0.08)" : "transparent",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {zone.display_name}
              </span>
              <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", flexShrink: 0, marginLeft: "0.4rem" }}>
                {zone.member_count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Widget
// ─────────────────────────────────────────────────────────────────────────────

export function ZoneLeaderboardWidget({ casualModeActive = true, compact = false }) {
  const [browsingZone, setBrowsingZone] = useState(null); // null = own zone

  // Data hooks
  const { data: myLeaderboard, isLoading: myLoading } = useMyZoneLeaderboard({ limit: 5 });
  const { data: browseLeaderboard, isLoading: browseLoading } = useZoneLeaderboard(browsingZone, { limit: 5 });
  const { data: userRank } = useUserZoneRank();
  const { data: allZones, isLoading: zonesLoading } = useAvailableZones({ limit: 30 });
  const { data: browseZoneDetails } = useZoneDetails(browsingZone);

  const isViewingOwnZone = !browsingZone;
  const leaderboard = isViewingOwnZone ? myLeaderboard : browseLeaderboard;
  const isLoading = isViewingOwnZone ? myLoading : browseLoading;

  const currentWallet = userRank?.wallet_address;
  const zoneName = isViewingOwnZone
    ? (userRank?.zone_name || "Your Zone")
    : (browseZoneDetails?.display_name || "Zone");

  // Empty state: no zone assigned
  if (!isLoading && !userRank && isViewingOwnZone && !leaderboard?.length) {
    return (
      <div
        className="glass-card"
        style={{
          padding: compact ? "0.75rem" : "1rem 1.25rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "1rem" }}>🏆</span>
          <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#fff" }}>Zone Rankings</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: "1.5", margin: 0 }}>
          Enable location to join your regional zone leaderboard and compete with nearby keepers.
        </p>
      </div>
    );
  }

  return (
    <div
      className="glass-card"
      style={{
        padding: compact ? "0.75rem" : "1rem 1.25rem",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(251, 191, 36, 0.1)",
        background: "rgba(251, 191, 36, 0.02)",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "0.6rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "1rem" }}>🏆</span>
          <div>
            <h4 style={{ margin: 0, fontSize: "0.8rem", fontWeight: "700", color: "#fff" }}>
              {zoneName}
            </h4>
            {userRank && isViewingOwnZone && (
              <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                Your rank: #{userRank.zone_rank}
                {userRank.is_champion && " · 👑 Champion"}
              </span>
            )}
          </div>
        </div>

        <ZonePicker
          zones={allZones}
          selectedZone={browsingZone}
          onSelect={setBrowsingZone}
          isLoading={zonesLoading}
        />
      </div>

      {/* Leaderboard rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {isLoading ? (
          <div style={{ padding: "1rem 0", textAlign: "center", fontSize: "0.7rem", color: "var(--text-muted)" }}>
            Loading leaderboard...
          </div>
        ) : leaderboard?.length > 0 ? (
          leaderboard.map((entry, idx) => (
            <LeaderboardRow
              key={entry.wallet_address}
              entry={entry}
              rank={entry.zone_rank || idx + 1}
              isCurrentUser={entry.wallet_address?.toLowerCase() === currentWallet?.toLowerCase()}
              casualModeActive={casualModeActive}
            />
          ))
        ) : (
          <div style={{ padding: "0.75rem 0", textAlign: "center", fontSize: "0.7rem", color: "var(--text-muted)" }}>
            No ranked users in this zone yet.
          </div>
        )}
      </div>

      {/* User's position if not in top 5 */}
      {isViewingOwnZone && userRank && userRank.zone_rank > 5 && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.4rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.1)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.72rem",
        }}>
          <span style={{ color: "var(--text-secondary)" }}>
            ···  You: #{userRank.zone_rank}
          </span>
          <span style={{ color: TIER_COLORS[userRank.current_tier] || "#94a3b8", fontFamily: "monospace", fontWeight: "600" }}>
            {userRank.total_xp?.toLocaleString()} {getPointsSuffix(casualModeActive)}
          </span>
        </div>
      )}

      {/* Zone champion callout */}
      {leaderboard?.[0]?.is_champion && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.35rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(251, 191, 36, 0.05)",
          border: "1px solid rgba(251, 191, 36, 0.12)",
          fontSize: "0.6rem",
          color: "var(--text-muted)",
          textAlign: "center",
        }}>
          👑 <strong style={{ color: "var(--accent-amber)" }}>
            {leaderboard[0].display_name || "Anonymous"}
          </strong> holds God-Tier Champion for this zone
        </div>
      )}
    </div>
  );
}

export default ZoneLeaderboardWidget;
