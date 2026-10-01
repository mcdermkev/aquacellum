/**
 * FollowButton.jsx
 * 
 * One-tap follow/unfollow button for user profiles and feed cards.
 * Shows current follow state and handles optimistic updates.
 */

import React, { useState, useEffect } from "react";
import { Check, Plus } from "@phosphor-icons/react";
import { followUser, unfollowUser, isFollowingUser } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import "./ReefDaylight.css";

export function FollowButton({ targetWallet, compact = false, onFollowChange }) {
  const [following, setFollowing] = useState(null); // null = loading
  const [loading, setLoading] = useState(false);
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();

  // Check follow status on mount
  useEffect(() => {
    if (!targetWallet || !currentWallet || currentWallet.toLowerCase() === targetWallet?.toLowerCase()) return;
    isFollowingUser(targetWallet).then(setFollowing);
  }, [targetWallet, currentWallet]);

  // Don't render for own profile or if not connected
  if (!currentWallet || currentWallet.toLowerCase() === targetWallet?.toLowerCase()) return null;

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
    } catch (err) {
      // Surface the real reason instead of silently swallowing it — a swallowed
      // FK/constraint error here is what made this bug look like "nothing happens".
      console.error("[FollowButton] follow toggle failed:", err?.message || err);
      // Revert optimistic update on error
      setFollowing(previousState);
    } finally {
      setLoading(false);
    }
  };

  // Still loading initial state
  if (following === null) return null;

  // Compact is the feed-card variant; styled by .reef-follow (ReefDaylight.css).
  if (compact) {
    return (
      <button
        type="button"
        className="reef-follow"
        onClick={handleToggle}
        disabled={loading}
        aria-pressed={following}
        title={following ? "You follow this keeper. Tap to unfollow." : "Follow to see their posts in your feed"}
      >
        {following ? "Following" : "Follow"}
      </button>
    );
  }

  // Full-size variant on the profile header (reef-btn, ReefDaylight.css). The
  // visible label already says the state, so no aria-pressed here; with it,
  // screen readers would announce "Following, pressed".
  return (
    <button
      type="button"
      className={following ? "reef-btn" : "reef-btn reef-btn--primary"}
      onClick={handleToggle}
      disabled={loading}
      title={following ? "You follow this keeper. Tap to unfollow." : "Follow to see their posts in your feed"}
    >
      {following
        ? <Check size={18} weight="bold" aria-hidden="true" />
        : <Plus size={18} weight="bold" aria-hidden="true" />}
      {following ? "Following" : "Follow"}
    </button>
  );
}

export default FollowButton;
