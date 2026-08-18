/**
 * useRewardsPool.js
 * 
 * React Query hooks for the Loyalty Rewards Pool system.
 * Wraps rewardsPoolApi.js for reactive UI consumption.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRewardCredits,
  getCreditHistory,
  getDistributionHistory,
  getPoolStatus,
  applyCreditsAtCheckout,
} from "../services/rewardsPoolApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";
import { unwrap } from "../utils/unwrapEnvelope";

// ─────────────────────────────────────────────────────────────────────────────
// Credit Balance & Tier Discount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current user's reward credits, tier, and tier discount.
 * 
 * @param {string} walletAddress - Optional override
 * @returns {{ data: {credits, tier, tierDiscount}, isLoading, error }}
 */
export function useRewardCredits(walletAddress) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["rewards", "credits", wallet],
    queryFn: () => unwrap(getRewardCredits(wallet), "getRewardCredits"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the user's credit transaction history.
 * 
 * @param {object} opts
 * @param {number} opts.limit
 */
export function useCreditHistory({ limit = 20 } = {}) {
  const wallet = getCurrentWallet();

  return useQuery({
    queryKey: ["rewards", "credit-history", wallet, limit],
    queryFn: () => unwrap(getCreditHistory(wallet, { limit }), "getCreditHistory"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Get the user's monthly distribution history.
 * 
 * @param {object} opts
 * @param {number} opts.limit
 */
export function useDistributionHistory({ limit = 12 } = {}) {
  const wallet = getCurrentWallet();

  return useQuery({
    queryKey: ["rewards", "distributions", wallet, limit],
    queryFn: () => unwrap(getDistributionHistory(wallet, { limit }), "getDistributionHistory"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool Status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the global reward pool status (balance, total contributed/distributed).
 */
export function usePoolStatus() {
  return useQuery({
    queryKey: ["rewards", "pool-status"],
    queryFn: () => unwrap(getPoolStatus(), "getPoolStatus"),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Credits Mutation (Checkout)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for applying credits at checkout.
 * Invalidates credit balance cache on success.
 * 
 * Usage:
 *   const applyCredits = useApplyCredits();
 *   const result = await applyCredits.mutateAsync({ amount: 5.00, orderId: "order_123" });
 *   // result.applied = actual amount deducted
 */
export function useApplyCredits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ amount, orderId }) => applyCreditsAtCheckout(amount, orderId),
    onSuccess: () => {
      const wallet = getCurrentWallet();
      queryClient.invalidateQueries({ queryKey: ["rewards", "credits", wallet] });
      queryClient.invalidateQueries({ queryKey: ["rewards", "credit-history"] });
    },
  });
}
