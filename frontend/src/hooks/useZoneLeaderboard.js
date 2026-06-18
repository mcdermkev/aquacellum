/**
 * useZoneLeaderboard.js
 * 
 * React Query hooks for the Zone Leaderboard system.
 * Wraps zoneLeaderboardApi.js for reactive UI consumption.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMyZoneLeaderboard,
  fetchZoneLeaderboardByHash,
  fetchUserZoneRank,
  fetchAllZones,
  searchZones,
  fetchZoneDetails,
  assignUserToZone,
  fetchWeeklyContributors,
} from "../services/zoneLeaderboardApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// Zone Leaderboard Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the leaderboard for the current user's zone.
 * Auto-resolves zone_hash from the user's profile.
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max entries (default 20)
 */
export function useMyZoneLeaderboard({ limit = 20 } = {}) {
  const wallet = getCurrentWallet();

  return useQuery({
    queryKey: ["zone", "my-leaderboard", wallet, limit],
    queryFn: () => fetchMyZoneLeaderboard({ limit }),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 2 * 60 * 1000, // 2 min — leaderboard is a materialized view refreshed every 5 min
    select: (res) => res.data,
  });
}

/**
 * Fetch the leaderboard for a specific zone (cross-zone browsing).
 * 
 * @param {string} zoneHash - Zone to browse
 * @param {object} opts
 * @param {number} opts.limit - Max entries (default 20)
 */
export function useZoneLeaderboard(zoneHash, { limit = 20 } = {}) {
  return useQuery({
    queryKey: ["zone", "leaderboard", zoneHash, limit],
    queryFn: () => fetchZoneLeaderboardByHash(zoneHash, { limit }),
    enabled: !!zoneHash && isSupabaseConfigured(),
    staleTime: 2 * 60 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch the current user's rank within their zone.
 * 
 * @param {string} walletAddress - Optional, defaults to connected wallet
 */
export function useUserZoneRank(walletAddress) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["zone", "user-rank", wallet],
    queryFn: () => fetchUserZoneRank(wallet),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 60 * 1000,
    select: (res) => res.data,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone Directory Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all available zones for the zone picker.
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max zones (default 50)
 */
export function useAvailableZones({ limit = 50 } = {}) {
  return useQuery({
    queryKey: ["zone", "all-zones", limit],
    queryFn: () => fetchAllZones({ limit }),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000, // Zones don't change often
    select: (res) => res.data,
  });
}

/**
 * Search zones by name (debounced query for zone picker).
 * 
 * @param {string} query - Search term (min 2 chars)
 */
export function useZoneSearch(query) {
  return useQuery({
    queryKey: ["zone", "search", query],
    queryFn: () => searchZones(query),
    enabled: !!query && query.length >= 2 && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch details for a specific zone.
 * 
 * @param {string} zoneHash
 */
export function useZoneDetails(zoneHash) {
  return useQuery({
    queryKey: ["zone", "details", zoneHash],
    queryFn: () => fetchZoneDetails(zoneHash),
    enabled: !!zoneHash && isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone Assignment Mutation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for assigning the user to a zone.
 * Invalidates leaderboard and rank caches on success.
 */
export function useAssignZone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (zoneHash) => assignUserToZone(zoneHash),
    onSuccess: () => {
      // Invalidate all zone-related queries so UI reflects the new assignment
      queryClient.invalidateQueries({ queryKey: ["zone"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Contributors Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the weekly contributors leaderboard (rolling 7-day window).
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max entries (default 10)
 */
export function useWeeklyContributors({ limit = 10 } = {}) {
  return useQuery({
    queryKey: ["zone", "weekly-contributors", limit],
    queryFn: () => fetchWeeklyContributors({ limit }),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
  });
}
