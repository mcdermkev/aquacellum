/**
 * rewardsPoolApi.js
 * 
 * Supabase API functions for the Loyalty Rewards Pool system.
 * Queries reward credits, distribution history, pool balance, and
 * handles credit application at checkout.
 * 
 * Per GAMIFICATION_SPEC.md section 6:
 *   - 40% of the 4% protocol fee flows into the pool
 *   - Monthly distribution proportional to XP earned that month
 *   - Credits are platform balance for marketplace purchases (not withdrawable)
 *   - Credits expire after 12 months of non-use
 *   - Tier-based passive discount: Shallow=0%, Coastal=2%, Pelagic=4%, Abyssal=6%, Hadal=8%
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// Tier Discount Map (client-side mirror of get_tier_discount() in SQL)
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_DISCOUNTS = {
  Shallow: 0,
  Coastal: 0.02,
  Pelagic: 0.04,
  Abyssal: 0.06,
  Hadal: 0.08,
  "Hadal-Champion": 0.08,
};

/**
 * Get the discount percentage for a tier.
 * @param {string} tier
 * @returns {number} Discount as a decimal (e.g., 0.04 for 4%)
 */
export function getTierDiscount(tier) {
  return TIER_DISCOUNTS[tier] || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Credit Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current user's reward credit balance.
 * 
 * @param {string} walletAddress - Optional, defaults to connected wallet
 * @returns {Promise<{data: {credits: number, tier: string, tierDiscount: number}, error: string|null}>}
 */
export async function getRewardCredits(walletAddress) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("profiles")
    .select("reward_credits, current_tier")
    .eq("wallet_address", wallet)
    .single();

  if (error) return { data: null, error: error.message };

  return {
    data: {
      credits: Number(data.reward_credits) || 0,
      tier: data.current_tier || "Shallow",
      tierDiscount: getTierDiscount(data.current_tier),
    },
    error: null,
  };
}

/**
 * Get the user's credit transaction history (earn, spend, expire events).
 * 
 * @param {object} opts
 * @param {string} opts.walletAddress
 * @param {number} opts.limit
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function getCreditHistory(walletAddress, { limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}

/**
 * Get the user's distribution history (monthly payouts received).
 * 
 * @param {string} walletAddress
 * @param {object} opts
 * @param {number} opts.limit
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function getDistributionHistory(walletAddress, { limit = 12 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("reward_distributions")
    .select("*")
    .eq("wallet_address", wallet)
    .order("distribution_period", { ascending: false })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool Status Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current reward pool status (total contributed, distributed, balance).
 * 
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
export async function getPoolStatus() {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("reward_pool_status")
    .select("*")
    .single();

  return { data: data || null, error: error?.message || null };
}

/**
 * Get the next distribution date (first of next month).
 * 
 * @returns {{nextDate: Date, daysUntil: number, period: string}}
 */
export function getNextDistributionInfo() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysUntil = Math.ceil((nextMonth - now) / (1000 * 60 * 60 * 24));
  const period = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

  return {
    nextDate: nextMonth,
    daysUntil,
    period,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply reward credits at checkout. Calls the Supabase RPC function.
 * Returns the actual amount deducted (may be less than requested if balance insufficient).
 * 
 * @param {number} amount - Amount of credits to apply (in platform currency units)
 * @param {string} orderId - Reference order/transaction ID
 * @returns {Promise<{applied: number, error: string|null}>}
 */
export async function applyCreditsAtCheckout(amount, orderId) {
  if (!isSupabaseConfigured()) return { applied: 0, error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { applied: 0, error: "Not connected" };

  if (!amount || amount <= 0) return { applied: 0, error: null };

  const { data, error } = await supabase
    .rpc("apply_credits_at_checkout", {
      p_wallet: wallet,
      p_amount: amount,
      p_order_id: orderId || `order_${Date.now()}`,
    });

  if (error) return { applied: 0, error: error.message };

  return { applied: Number(data) || 0, error: null };
}

/**
 * Calculate the full discount breakdown for a checkout.
 * Combines tier discount + available credits into a single summary.
 * 
 * @param {number} listingPrice - Original listing price
 * @param {string} userTier - User's current tier
 * @param {number} availableCredits - User's credit balance
 * @param {boolean} applyCredits - Whether user opted to use credits
 * @returns {{tierDiscount: number, tierDiscountAmount: number, creditsToApply: number, finalPrice: number, totalSavings: number}}
 */
export function calculateCheckoutDiscount(listingPrice, userTier, availableCredits, applyCredits = true) {
  const price = Number(listingPrice) || 0;
  const tierDiscountPct = getTierDiscount(userTier);
  const tierDiscountAmount = Math.round(price * tierDiscountPct * 100) / 100;

  const priceAfterTier = price - tierDiscountAmount;

  // Credits apply against the post-tier-discount price
  let creditsToApply = 0;
  if (applyCredits && availableCredits > 0) {
    creditsToApply = Math.min(availableCredits, priceAfterTier);
    creditsToApply = Math.round(creditsToApply * 100) / 100;
  }

  const finalPrice = Math.max(0, priceAfterTier - creditsToApply);
  const totalSavings = tierDiscountAmount + creditsToApply;

  return {
    tierDiscount: tierDiscountPct,
    tierDiscountAmount,
    creditsToApply,
    finalPrice: Math.round(finalPrice * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
  };
}
