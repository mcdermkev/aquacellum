/**
 * useDepthScore.js
 * 
 * React hooks for the Depth Score reputation system.
 */

import { useQuery } from "@tanstack/react-query";
import { getDepthScore, getDepthScoreHistory, getDepthLeaderboard } from "../services/depthScoreApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";
import { unwrap } from "../utils/unwrapEnvelope";

/**
 * Get the current user's (or specified user's) depth score and tier.
 */
export function useDepthScore(walletAddress) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "depth-score", wallet],
    queryFn: () => unwrap(getDepthScore(wallet), "getDepthScore"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 60 * 1000,
  });
}

/**
 * Get depth score event history.
 */
export function useDepthScoreHistory(walletAddress, { limit = 20 } = {}) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "depth-history", wallet, limit],
    queryFn: () => unwrap(getDepthScoreHistory(wallet, { limit }), "getDepthScoreHistory"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Get the global depth score leaderboard.
 */
export function useDepthLeaderboard({ limit = 20 } = {}) {
  return useQuery({
    queryKey: ["reef", "depth-leaderboard", limit],
    queryFn: () => unwrap(getDepthLeaderboard({ limit }), "getDepthLeaderboard"),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
  });
}
