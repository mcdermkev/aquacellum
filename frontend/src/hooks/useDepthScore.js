/**
 * useDepthScore.js
 * 
 * React hooks for the Depth Score reputation system.
 */

import { useQuery } from "@tanstack/react-query";
import { getDepthScore, getDepthScoreHistory, getDepthLeaderboard, getTierPrivileges } from "../services/depthScoreApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

/**
 * Get the current user's (or specified user's) depth score and tier.
 */
export function useDepthScore(walletAddress) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "depth-score", wallet],
    queryFn: () => getDepthScore(wallet),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 60 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Get depth score event history.
 */
export function useDepthScoreHistory(walletAddress, { limit = 20 } = {}) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "depth-history", wallet, limit],
    queryFn: () => getDepthScoreHistory(wallet, { limit }),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Get the global depth score leaderboard.
 */
export function useDepthLeaderboard({ limit = 20 } = {}) {
  return useQuery({
    queryKey: ["reef", "depth-leaderboard", limit],
    queryFn: () => getDepthLeaderboard({ limit }),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Get the current user's tier privileges.
 */
export function useDepthPrivileges(walletAddress) {
  const { data } = useDepthScore(walletAddress);
  return getTierPrivileges(data?.depth_tier || "Shallow");
}
