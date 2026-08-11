/**
 * DiscoveryPanel.jsx
 *
 * Discovery features for The Reef (Task 17):
 * 1. Breeders Who Keep [Species] — search breeders by species
 * 2. Top Contributors This Week — leaderboard (Insights posted + Audits given)
 *
 * The location-based "Nearby Breeders" section was retired from the UI (the
 * regional-zone surfaces were pulled); the zone backend/hooks remain parked.
 *
 * Renders as a sidebar/section within the Discover tab of the ReefFeed.
 */

import React, { useState, useCallback } from "react";
import { ProfileCard } from "./ProfileCard";
import { useBreedersForSpecies, useTopContributors } from "../../hooks/useDiscovery";
import { useWeeklyContributors } from "../../hooks/useZoneLeaderboard";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle, isExpanded }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: "0.4rem" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h4 style={{
          margin: 0,
          fontSize: "0.85rem",
          fontWeight: 700,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}>
          <span>{icon}</span> {title}
        </h4>
        {subtitle && (
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.65rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </p>
        )}
      </div>
      <span style={{
        fontSize: "0.75rem",
        color: "var(--text-muted)",
        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        marginLeft: "0.5rem",
        flexShrink: 0
      }}>
        ▼
      </span>
    </div>
  );
}

function BreederRow({ profile, onProfileClick, extra }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.4rem 0.5rem",
        borderRadius: "8px",
        transition: "background 0.15s ease",
        cursor: "pointer",
      }}
      className="discovery-breeder-row"
      onClick={() => onProfileClick(profile.wallet_address)}
      onKeyDown={(e) => e.key === "Enter" && onProfileClick(profile.wallet_address)}
      role="button"
      tabIndex={0}
      aria-label={`View profile: ${profile.display_name || profile.wallet_address}`}
    >
      <ProfileCard
        walletAddress={profile.wallet_address}
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        companionTier={profile.companion_tier}
        size="small"
        showTier={true}
      />
      {extra && (
        <span style={{
          fontSize: "0.6rem",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          marginLeft: "0.5rem",
        }}>
          {extra}
        </span>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <p style={{
      fontSize: "0.7rem",
      color: "var(--text-muted)",
      textAlign: "center",
      padding: "0.75rem 0.5rem",
      margin: 0,
      fontStyle: "italic",
    }}>
      {message}
    </p>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: "32px",
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.03)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function DiscoveryPanel({ onProfileClick, casualModeActive = false }) {
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [speciesQuery, setSpeciesQuery] = useState("");
  const [expandedSection, setExpandedSection] = useState(null);

  // Hooks
  const { data: speciesBreeders, isLoading: speciesLoading } = useBreedersForSpecies(speciesQuery);
  const { data: topContributors, isLoading: contributorsLoading } = useTopContributors();
  const { data: weeklyLeaderboard } = useWeeklyContributors({ limit: 10 });

  // Prefer the materialized view (includes all XP actions) over the manual query
  const contributorsData = weeklyLeaderboard && weeklyLeaderboard.length > 0
    ? weeklyLeaderboard.map((entry) => ({
        wallet: entry.wallet_address,
        profile: {
          wallet_address: entry.wallet_address,
          display_name: entry.display_name,
          avatar_url: entry.avatar_url,
          companion_tier: entry.current_tier || "Shallow",
        },
        weeklyXp: entry.weekly_xp,
        actionCount: entry.action_count,
        insights: 0,
        audits: 0,
        total: entry.weekly_xp,
      }))
    : topContributors;

  const handleSpeciesSearch = useCallback((e) => {
    e.preventDefault();
    setSpeciesQuery(speciesSearch.trim());
  }, [speciesSearch]);

  const toggleSection = (section) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const sectionStyle = {
    padding: "0.75rem",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    marginBottom: "0.75rem",
  };

  return (
    <div
      className="discovery-panel"
      style={{ marginBottom: "1.25rem" }}
      role="region"
      aria-label="Discover breeders"
    >
      {/* ─── Breeders Who Keep [Species] ─── */}
      <div style={sectionStyle}>
        <div
          onClick={() => toggleSection("species")}
          style={{ cursor: "pointer" }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && toggleSection("species")}
          aria-expanded={expandedSection === "species"}
        >
          <SectionHeader
            icon="🐠"
            title={casualModeActive ? "Who Keeps This Fish?" : "Breeders By Species"}
            subtitle="Find breeders who keep a specific species"
            isExpanded={expandedSection === "species"}
          />
        </div>

        {expandedSection === "species" && (
          <>
            <form
              onSubmit={handleSpeciesSearch}
              style={{
                display: "flex",
                gap: "0.35rem",
                marginBottom: "0.5rem",
              }}
            >
              <input
                type="text"
                value={speciesSearch}
                onChange={(e) => setSpeciesSearch(e.target.value)}
                placeholder={casualModeActive ? "e.g. Neon Tetra" : "Species common name..."}
                style={{
                  flex: 1,
                  padding: "0.4rem 0.6rem",
                  borderRadius: "6px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(0, 0, 0, 0.2)",
                  color: "#fff",
                  fontSize: "0.75rem",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
                aria-label="Search species"
              />
              <button
                type="submit"
                disabled={!speciesSearch.trim()}
                style={{
                  padding: "0.4rem 0.65rem",
                  borderRadius: "6px",
                  border: "none",
                  background: speciesSearch.trim()
                    ? "rgba(56, 189, 248, 0.15)"
                    : "rgba(255, 255, 255, 0.03)",
                  color: speciesSearch.trim() ? "#fff" : "var(--text-muted)",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  cursor: speciesSearch.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.15s ease",
                }}
                aria-label="Search"
              >
                🔍
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {speciesLoading && speciesQuery && <LoadingSkeleton />}
              {!speciesLoading && speciesQuery && speciesBreeders?.length === 0 && (
                <EmptyState message={`No breeders found keeping "${speciesQuery}"`} />
              )}
              {!speciesLoading && speciesBreeders?.map((breeder) => (
                <BreederRow
                  key={breeder.wallet_address}
                  profile={breeder}
                  onProfileClick={onProfileClick}
                  extra={breeder.tank_count ? `${breeder.tank_count} tanks` : null}
                />
              ))}
              {!speciesQuery && (
                <EmptyState message="Search for a species to find who keeps them" />
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Top Contributors This Week ─── */}
      <div style={sectionStyle}>
        <div
          onClick={() => toggleSection("contributors")}
          style={{ cursor: "pointer" }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && toggleSection("contributors")}
          aria-expanded={expandedSection === "contributors"}
        >
          <SectionHeader
            icon="🏆"
            title={casualModeActive ? "Top Helpers This Week" : "Top Contributors"}
            subtitle="Most Insights posted and Audits given this week"
            isExpanded={expandedSection === "contributors"}
          />
        </div>

        {expandedSection === "contributors" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {contributorsLoading && <LoadingSkeleton />}
            {!contributorsLoading && contributorsData?.length === 0 && (
              <EmptyState message={casualModeActive
                ? "No contributions this week yet — be the first!"
                : "No contributor activity this week."
              } />
            )}
            {!contributorsLoading && contributorsData?.map((entry, index) => (
              <div
                key={entry.wallet}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.4rem 0.5rem",
                  borderRadius: "8px",
                  transition: "background 0.15s ease",
                  cursor: "pointer",
                }}
                className="discovery-breeder-row"
                onClick={() => onProfileClick(entry.wallet)}
                onKeyDown={(e) => e.key === "Enter" && onProfileClick(entry.wallet)}
                role="button"
                tabIndex={0}
                aria-label={`Rank ${index + 1}: ${entry.profile.display_name || entry.wallet}`}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: index === 0 ? "#ffd700" : index === 1 ? "#c0c0c0" : index === 2 ? "#cd7f32" : "var(--text-muted)",
                    width: "1.2rem",
                    textAlign: "center",
                  }}>
                    {index < 3 ? ["🥇", "🥈", "🥉"][index] : `#${index + 1}`}
                  </span>
                  <ProfileCard
                    walletAddress={entry.profile.wallet_address}
                    displayName={entry.profile.display_name}
                    avatarUrl={entry.profile.avatar_url}
                    companionTier={entry.profile.companion_tier}
                    size="small"
                    showTier={true}
                  />
                </div>
                <div style={{
                  display: "flex",
                  gap: "0.5rem",
                  fontSize: "0.6rem",
                  color: "var(--text-muted)",
                  alignItems: "center",
                }}>
                  {entry.weeklyXp > 0 && (
                    <span title="Weekly XP earned" style={{ fontFamily: "monospace", fontWeight: "600", color: "var(--accent-amber, #fbbf24)" }}>
                      {entry.weeklyXp.toLocaleString()} {casualModeActive ? "pts" : "XP"}
                    </span>
                  )}
                  {entry.actionCount > 0 && (
                    <span title="Actions this week" style={{ color: "var(--text-muted)" }}>
                      ({entry.actionCount})
                    </span>
                  )}
                  {entry.insights > 0 && (
                    <span title="Insights posted">💡{entry.insights}</span>
                  )}
                  {entry.audits > 0 && (
                    <span title="Audits given">⭐{entry.audits}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hover styles */}
      <style>{`
        .discovery-breeder-row:hover {
          background: rgba(255, 255, 255, 0.04) !important;
        }
        .discovery-breeder-row:focus-visible {
          outline: 2px solid rgba(56, 189, 248, 0.5);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}
