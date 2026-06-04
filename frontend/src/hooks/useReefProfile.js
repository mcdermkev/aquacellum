/**
 * useReefProfile.js
 * 
 * React hooks for Reef profile management.
 * Handles profile creation, fetching, and updates.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ensureProfile,
  getProfile,
  updateProfile,
  getTankmates,
  getRelationshipStatus,
  sendTankmateRequest,
  respondToRequest,
  removeTankmate,
  getPendingRequests,
} from "../services/reefApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";
import { db } from "../db";

/**
 * Hook to ensure the current user has a Reef profile.
 * For new users: profile is created during onboarding with their chosen name.
 * For returning users: this just fetches the existing profile.
 * Fallback: if somehow a user skipped onboarding, creates a minimal profile.
 */
export function useEnsureProfile(walletAddress) {
  return useQuery({
    queryKey: ["reef", "ensure-profile", walletAddress],
    queryFn: async () => {
      if (!walletAddress || !isSupabaseConfigured()) return null;

      // Check if profile already exists (created during onboarding)
      const { data: existing } = await getProfile(walletAddress);
      if (existing) return existing;

      // Fallback: profile doesn't exist (returning user from before social layer, or skipped onboarding)
      // Pull current stats from Dexie for initial profile seeding
      let initialData = {};
      try {
        const userProfile = await db.userProfile.get(walletAddress);
        const tanks = await db.tanks.where("ownerAddress").equals(walletAddress).count();
        const companion = await db.breederCompanion.get(walletAddress);

        initialData = {
          display_name: userProfile?.alias || null,
          tank_count: tanks || 0,
          xp_total: userProfile
            ? (userProfile.prestigeXp || 0) + (userProfile.hobbyistXp || 0)
            : 0,
          companion_tier: companion?.currentTier || "Bronze",
        };
      } catch (err) {
        console.warn("[Reef] Could not read Dexie stats for profile seeding:", err);
      }

      const { data, error } = await ensureProfile(walletAddress, initialData);
      if (error) {
        console.warn("[Reef] Profile ensure failed:", error);
        return null;
      }
      return data;
    },
    enabled: !!walletAddress && isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

/**
 * Hook to fetch a public profile.
 */
export function useProfile(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["reef", "profile", walletAddress],
    queryFn: async () => {
      const { data, error } = await getProfile(walletAddress);
      if (error) throw new Error(error);
      return data;
    },
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Mutation hook for updating the current user's profile.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletAddress, updates }) => updateProfile(walletAddress, updates),
    onSuccess: (result, variables) => {
      if (result.data) {
        queryClient.setQueryData(
          ["reef", "profile", variables.walletAddress],
          result.data
        );
        queryClient.invalidateQueries({
          queryKey: ["reef", "ensure-profile", variables.walletAddress],
        });
      }
    },
  });
}

/**
 * Hook to get the Tankmate list for a user.
 */
export function useTankmates(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["reef", "tankmates", walletAddress],
    queryFn: async () => {
      const { data, error } = await getTankmates(walletAddress);
      if (error) throw new Error(error);
      return data;
    },
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to get relationship status with a target user.
 */
export function useRelationshipStatus(targetWallet, enabled = true) {
  const currentWallet = getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "relationship", currentWallet, targetWallet],
    queryFn: () => getRelationshipStatus(targetWallet),
    enabled: enabled && !!targetWallet && !!currentWallet && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Mutation for sending a Tankmate request.
 */
export function useSendTankmateRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetWallet, message }) => sendTankmateRequest(targetWallet, message),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["reef", "relationship"],
      });
      queryClient.invalidateQueries({
        queryKey: ["reef", "pending-requests"],
      });
    },
  });
}

/**
 * Mutation for accepting/declining Tankmate requests.
 */
export function useRespondToRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, accept }) => respondToRequest(requestId, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "relationship"] });
      queryClient.invalidateQueries({ queryKey: ["reef", "pending-requests"] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tankmates"] });
    },
  });
}

/**
 * Hook to get pending Tankmate requests for the current user.
 */
export function usePendingRequests(enabled = true) {
  const walletAddress = getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "pending-requests", walletAddress],
    queryFn: async () => {
      const { data, error } = await getPendingRequests();
      if (error) throw new Error(error);
      return data;
    },
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Poll every minute for new requests
  });
}

/**
 * Mutation for removing a Tankmate.
 */
export function useRemoveTankmate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetWallet }) => removeTankmate(targetWallet),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "tankmates"] });
      queryClient.invalidateQueries({ queryKey: ["reef", "relationship"] });
    },
  });
}
