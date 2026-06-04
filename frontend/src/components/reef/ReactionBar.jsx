/**
 * ReactionBar.jsx
 * 
 * Emoji reaction row for Currents.
 * Shows 6 emoji options with counts. Click to toggle your reaction.
 * Optimistic UI: instant local update, background sync.
 */

import React, { useState, useEffect } from "react";
import { getReactions, toggleReaction } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";

const EMOJIS = ["🔥", "🐟", "💧", "🌿", "👏", "⭐"];

export function ReactionBar({ currentId, compact = false }) {
  const [reactions, setReactions] = useState({});
  const [loading, setLoading] = useState(false);
  const walletAddress = getCurrentWallet();

  // Fetch reactions on mount
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;

    getReactions(currentId).then(({ data }) => {
      if (!cancelled && data) setReactions(data);
    });

    return () => { cancelled = true; };
  }, [currentId]);

  const handleReact = async (emoji) => {
    if (!walletAddress || loading) return;

    // Optimistic update
    setReactions((prev) => {
      const current = prev[emoji] || { count: 0, userReacted: false };
      if (current.userReacted) {
        return {
          ...prev,
          [emoji]: { count: Math.max(0, current.count - 1), userReacted: false },
        };
      } else {
        return {
          ...prev,
          [emoji]: { count: current.count + 1, userReacted: true },
        };
      }
    });

    // Background sync
    setLoading(true);
    try {
      await toggleReaction(currentId, emoji);
      // Re-fetch to ensure consistency
      const { data } = await getReactions(currentId);
      if (data) setReactions(data);
    } catch (err) {
      console.warn("[Reef] Reaction toggle failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // In compact mode, only show emojis that have reactions
  const visibleEmojis = compact
    ? EMOJIS.filter((e) => reactions[e]?.count > 0)
    : EMOJIS;

  if (compact && visibleEmojis.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "0.35rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
      role="group"
      aria-label="Reactions"
    >
      {visibleEmojis.map((emoji) => {
        const data = reactions[emoji] || { count: 0, userReacted: false };
        const isActive = data.userReacted;

        return (
          <button
            key={emoji}
            onClick={() => handleReact(emoji)}
            disabled={!walletAddress}
            aria-label={`React with ${emoji}${data.count > 0 ? `, ${data.count} reactions` : ""}`}
            aria-pressed={isActive}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.2rem",
              padding: "0.25rem 0.5rem",
              borderRadius: "50px",
              border: isActive
                ? "1px solid rgba(56, 189, 248, 0.4)"
                : "1px solid rgba(255, 255, 255, 0.08)",
              background: isActive
                ? "rgba(56, 189, 248, 0.1)"
                : "rgba(255, 255, 255, 0.03)",
              cursor: walletAddress ? "pointer" : "default",
              fontSize: "0.8rem",
              transition: "all 0.15s ease",
              opacity: walletAddress ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (walletAddress) {
                e.currentTarget.style.background = isActive
                  ? "rgba(56, 189, 248, 0.15)"
                  : "rgba(255, 255, 255, 0.06)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isActive
                ? "rgba(56, 189, 248, 0.1)"
                : "rgba(255, 255, 255, 0.03)";
            }}
          >
            <span>{emoji}</span>
            {data.count > 0 && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: isActive ? "var(--accent-blue, #38bdf8)" : "var(--text-muted, #9ca3af)",
                }}
              >
                {data.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
