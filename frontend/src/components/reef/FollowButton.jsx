/**
 * FollowButton.jsx
 * 
 * One-tap follow/unfollow button for user profiles and feed cards.
 * Shows current follow state and handles optimistic updates.
 */

import React, { useState, useEffect } from "react";
import { followUser, unfollowUser, isFollowingUser } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

export function FollowButton({ targetWallet, compact = false, onFollowChange }) {
  const [following, setFollowing] = useState(null); // null = loading
  const [loading, setLoading] = useState(false);
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();

  // Check follow status on mount
  useEffect(() => {
    if (!targetWallet || !currentWallet || currentWallet === targetWallet?.toLowerCase()) return;
    isFollowingUser(targetWallet).then(setFollowing);
  }, [targetWallet, currentWallet]);

  // Don't render for own profile or if not connected
  if (!currentWallet || currentWallet === targetWallet?.toLowerCase()) return null;

  const handleToggle = async (e) => {
    e.stopPropagation();
    if (loading || following === null) return;

    setLoading(true);
    const previousState = following;

    // Optimistic update
    setFollowing(!following);

    try {
      if (following) {
        const { error } = await unfollowUser(targetWallet);
        if (error) throw error;
      } else {
        const { error } = await followUser(targetWallet);
        if (error) throw error;
      }
      if (onFollowChange) onFollowChange(!previousState);
    } catch {
      // Revert on error
      setFollowing(previousState);
    } finally {
      setLoading(false);
    }
  };

  // Still loading initial state
  if (following === null) return null;

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        style={{
          padding: "0.2rem 0.5rem",
          borderRadius: "50px",
          border: following
            ? "1px solid rgba(52, 211, 153, 0.3)"
            : "1px solid rgba(56, 189, 248, 0.3)",
          background: following
            ? "rgba(52, 211, 153, 0.08)"
            : "rgba(56, 189, 248, 0.08)",
          color: following ? "#34d399" : "#38bdf8",
          fontSize: "0.6rem",
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
          transition: "all 0.15s ease",
          opacity: loading ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
        aria-label={following ? "Unfollow" : "Follow"}
      >
        {following ? "✓ Following" : "+ Follow"}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      style={{
        padding: "0.4rem 0.9rem",
        borderRadius: "50px",
        border: following
          ? "1px solid rgba(52, 211, 153, 0.3)"
          : "none",
        background: following
          ? "rgba(52, 211, 153, 0.08)"
          : "linear-gradient(135deg, #0ea5e9, #0369a1)",
        color: following ? "#34d399" : "#fff",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: loading ? "default" : "pointer",
        transition: "all 0.15s ease",
        opacity: loading ? 0.6 : 1,
        boxShadow: following ? "none" : "0 2px 8px rgba(14, 165, 233, 0.2)",
      }}
      aria-label={following ? "Unfollow" : "Follow"}
    >
      {following ? "✓ Following" : "+ Follow"}
    </button>
  );
}

export default FollowButton;
