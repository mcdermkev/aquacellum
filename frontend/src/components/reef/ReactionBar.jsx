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
import { useAuth } from "../../contexts/AuthContext";
import "./ReefDaylight.css";

const EMOJIS = ["🔥", "🐟", "💧", "🌿", "👏", "⭐"];

export function ReactionBar({ currentId, compact = false }) {
  const [reactions, setReactions] = useState({});
  const [loading, setLoading] = useState(false);
  const { account } = useAuth();
  // Use reactive account from context, falling back to module-level getter
  const walletAddress = account || getCurrentWallet();

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

  // Compact mode, and anyone signed out (who can't react), only see the
  // reactions a post actually has, rather than a row of disabled buttons.
  const readOnly = !walletAddress;
  const visibleEmojis = compact || readOnly
    ? EMOJIS.filter((e) => reactions[e]?.count > 0)
    : EMOJIS;

  if (visibleEmojis.length === 0) return null;

  return (
    <div className="reef-reactions" role="group" aria-label="Reactions">
      {visibleEmojis.map((emoji) => {
        const data = reactions[emoji] || { count: 0, userReacted: false };
        const isActive = data.userReacted;

        return (
          <button
            key={emoji}
            type="button"
            className="reef-reaction"
            onClick={() => handleReact(emoji)}
            disabled={readOnly}
            aria-label={`React with ${emoji}${data.count > 0 ? `, ${data.count} ${data.count === 1 ? "reaction" : "reactions"}` : ""}`}
            aria-pressed={isActive}
            title={readOnly ? "Sign in to react" : undefined}
          >
            <span aria-hidden="true">{emoji}</span>
            {data.count > 0 && <span className="reef-reaction-count">{data.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
