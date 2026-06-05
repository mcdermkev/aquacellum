/**
 * CurrentCard.jsx
 * 
 * Renders a single Tank Current (post) in the feed.
 * Shows: author ProfileCard, timestamp, tank name, caption, photo grid,
 * parameter chips, species tags, ReactionBar, and CommentThread.
 */

import React, { useState } from "react";
import { ProfileCard } from "./ProfileCard";
import { ReactionBar } from "./ReactionBar";
import { CommentThread } from "./CommentThread";
import { watchTank, unwatchTank, isWatchingTank } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";

/**
 * Format relative time (e.g., "2h ago", "3d ago")
 */
function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

/**
 * Photo grid layout: 1 = full width, 2 = side by side, 3-4 = grid
 */
function PhotoGrid({ urls, altTexts }) {
  if (!urls || urls.length === 0) return null;

  const gridStyles = {
    1: { gridTemplateColumns: "1fr" },
    2: { gridTemplateColumns: "1fr 1fr" },
    3: { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" },
    4: { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" },
  };

  const count = Math.min(urls.length, 4);

  return (
    <div
      style={{
        display: "grid",
        gap: "3px",
        borderRadius: "10px",
        overflow: "hidden",
        ...gridStyles[count],
      }}
    >
      {urls.slice(0, 4).map((url, i) => (
        <div
          key={i}
          style={{
            position: "relative",
            paddingBottom: count === 1 ? "56.25%" : "100%",
            background: "rgba(255, 255, 255, 0.03)",
            ...(count === 3 && i === 0 ? { gridRow: "1 / 3" } : {}),
          }}
        >
          <img
            src={url}
            alt={altTexts?.[i] || `Tank photo ${i + 1}`}
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Parameter snapshot chips
 */
function ParameterChips({ snapshot }) {
  if (!snapshot) return null;

  const chips = [];
  if (snapshot.temp) chips.push({ icon: "🌡️", label: `${snapshot.temp}°C` });
  if (snapshot.ph) chips.push({ icon: "🧪", label: `pH ${snapshot.ph}` });
  if (snapshot.nitrate) chips.push({ icon: "💧", label: `NO₃ ${snapshot.nitrate}ppm` });
  if (snapshot.ammonia) chips.push({ icon: "⚠️", label: `NH₃ ${snapshot.ammonia}ppm` });

  if (chips.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      {chips.map((chip, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.2rem",
            padding: "0.15rem 0.45rem",
            borderRadius: "50px",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            fontSize: "0.65rem",
            color: "var(--text-secondary)",
          }}
        >
          {chip.icon} {chip.label}
        </span>
      ))}
    </div>
  );
}

export function CurrentCard({ current, onProfileClick, casualModeActive = false }) {
  const [showFullBody, setShowFullBody] = useState(false);
  const [watching, setWatching] = useState(null); // null = unknown, true/false
  const profile = current.profiles;
  const body = current.body || "";
  const isLong = body.length > 300;
  const displayBody = isLong && !showFullBody ? body.slice(0, 300) + "..." : body;
  const currentWallet = getCurrentWallet();
  const isOwnPost = currentWallet && current.author_wallet === currentWallet;

  // Check watch status on mount for posts with linked tanks
  React.useEffect(() => {
    if (!current.linked_tank_id || !current.author_wallet || isOwnPost) return;
    isWatchingTank(current.author_wallet, current.linked_tank_id).then(setWatching);
  }, [current.linked_tank_id, current.author_wallet, isOwnPost]);

  const handleToggleWatch = async () => {
    if (!current.linked_tank_id || !current.author_wallet) return;
    if (watching) {
      await unwatchTank(current.author_wallet, current.linked_tank_id);
      setWatching(false);
    } else {
      await watchTank(current.author_wallet, current.linked_tank_id);
      setWatching(true);
    }
  };

  return (
    <article
      className="glass-card reef-current-card"
      style={{
        padding: "1rem",
        borderRadius: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        background: "rgba(255, 255, 255, 0.02)",
        transition: "border-color 0.2s ease",
      }}
      aria-label={`Post by ${profile?.display_name || current.author_wallet}`}
    >
      {/* Header: Author + Timestamp + Tank name */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ProfileCard
            walletAddress={profile?.wallet_address || current.author_wallet}
            displayName={profile?.display_name}
            avatarUrl={profile?.avatar_url}
            companionTier={profile?.companion_tier}
            onClick={() => onProfileClick?.(current.author_wallet)}
          />
        </div>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {timeAgo(current.created_at)}
        </span>
      </div>

      {/* Tank name badge */}
      {current.linked_tank_name && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "50px",
              background: "rgba(56, 189, 248, 0.08)",
              border: "1px solid rgba(56, 189, 248, 0.15)",
              fontSize: "0.65rem",
              color: "var(--accent-blue, #38bdf8)",
            }}
          >
            🐠 {current.linked_tank_name}
          </span>
        </div>
      )}

      {/* Body text */}
      {body && (
        <div>
          <p style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "#e5e7eb",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {displayBody}
          </p>
          {isLong && (
            <button
              onClick={() => setShowFullBody(!showFullBody)}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent-blue, #38bdf8)",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: "0.2rem 0",
                marginTop: "0.25rem",
              }}
            >
              {showFullBody ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {/* Photo grid */}
      <PhotoGrid urls={current.media_urls} altTexts={current.media_alt_texts} />

      {/* Parameter chips */}
      <ParameterChips snapshot={current.parameters_snapshot} />

      {/* Species tags */}
      {current.species_tags?.length > 0 && (
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          {current.species_tags.map((tag, i) => (
            <span
              key={i}
              style={{
                padding: "0.1rem 0.4rem",
                borderRadius: "50px",
                background: "rgba(52, 211, 153, 0.08)",
                border: "1px solid rgba(52, 211, 153, 0.15)",
                fontSize: "0.6rem",
                color: "var(--accent-green, #34d399)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Reactions + Watch Tank */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
        <ReactionBar currentId={current.id} />
        {current.linked_tank_id && !isOwnPost && watching !== null && (
          <button
            onClick={handleToggleWatch}
            style={{
              padding: "0.25rem 0.5rem",
              borderRadius: "50px",
              border: watching
                ? "1px solid rgba(52, 211, 153, 0.3)"
                : "1px solid rgba(255, 255, 255, 0.08)",
              background: watching
                ? "rgba(52, 211, 153, 0.08)"
                : "rgba(255, 255, 255, 0.03)",
              color: watching ? "var(--accent-green, #34d399)" : "var(--text-muted)",
              fontSize: "0.65rem",
              cursor: "pointer",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            title={watching ? "Stop watching this tank" : "Watch this tank for updates"}
          >
            {watching ? "👁️ Watching" : "👁️ Watch Tank"}
          </button>
        )}
      </div>

      {/* Comments */}
      <CommentThread currentId={current.id} />
    </article>
  );
}
