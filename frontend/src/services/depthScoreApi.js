/**
 * depthScoreApi.js
 * 
 * API functions for the Depth Score reputation system.
 * Reads depth score, tier, and event history.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";
import { submitContentReport } from "./reefTrustApi";

/**
 * Get the current user's depth score and tier.
 */
export async function getDepthScore(walletAddress) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("profiles")
    .select("depth_score, depth_tier")
    .eq("wallet_address", wallet)
    .single();

  return { data, error };
}

/**
 * Get depth score event history for a user.
 */
export async function getDepthScoreHistory(walletAddress, { limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("depth_score_events")
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Get the depth score leaderboard (top users by score).
 */
export async function getDepthLeaderboard({ limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url, companion_tier, depth_score, depth_tier")
    .gt("depth_score", 0)
    .order("depth_score", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Report content (creates a moderation flag).
 */
export function reportContent({ targetType, targetId, targetWallet, reason, details }) {
  return submitContentReport({ targetType, targetId, targetWallet, reason, details });
}

/**
 * Depth reputation metadata. This is intentionally NOT the XP ladder: Depth
 * is awarded in smaller increments for verified contributions.
 *
 * Thresholds:
 *   Shallow:  0 – 99
 *   Coastal:  100 – 499
 *   Pelagic:  500 – 1,499
 *   Abyssal:  1,500 – 4,999
 *   Hadal:    5,000+
 */
export const DEPTH_TIERS = [
  { key: "Shallow", label: "Shallow", hobbyistLabel: "New Voice", icon: "🥚", color: "#94a3b8", min: 0, max: 99 },
  { key: "Coastal", label: "Coastal", hobbyistLabel: "Contributor", icon: "🥈", color: "#38bdf8", min: 100, max: 499 },
  { key: "Pelagic", label: "Pelagic", hobbyistLabel: "Trusted Contributor", icon: "🥇", color: "#fbbf24", min: 500, max: 1499 },
  { key: "Abyssal", label: "Abyssal", hobbyistLabel: "Community Expert", icon: "💎", color: "#a855f7", min: 1500, max: 4999 },
  { key: "Hadal", label: "Hadal", hobbyistLabel: "Community Pillar", icon: "👑", color: "#f59e0b", min: 5000, max: Infinity },
];
