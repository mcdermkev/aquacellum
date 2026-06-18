/**
 * depthScoreApi.js
 * 
 * API functions for the Depth Score reputation system.
 * Reads depth score, tier, and event history.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

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
 * Manually award depth score (for client-side triggers like spawn success).
 * In production, most scores are awarded via server-side triggers.
 */
export async function awardDepthScore({ walletAddress, delta, reason, sourceType, sourceId }) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { error: "Not connected" };

  const { error } = await supabase
    .from("depth_score_events")
    .insert({
      wallet_address: wallet,
      delta,
      reason,
      source_type: sourceType,
      source_id: sourceId || null,
    });

  return { error };
}

/**
 * Report content (creates a moderation flag).
 */
export async function reportContent({ targetType, targetId, reason, details }) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { error: "Not connected" };

  const { error } = await supabase
    .from("moderation_flags")
    .insert({
      reporter_wallet: wallet,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
    });

  return { error };
}

/**
 * Check privileges based on depth tier.
 * Aligned with GAMIFICATION_SPEC.md section 3.2.
 * 
 * Tier privilege unlocks:
 *   Shallow (Bronze):  Post currents, join schools
 *   Coastal (Silver):  + Create schools, request audits
 *   Pelagic (Gold):    + Post insights (inherits all below)
 *   Abyssal (Master):  + Give audits, mentor, host virtual Tides
 *   Hadal (Champion):  + Host expo Tides, moderate
 */
export function getTierPrivileges(tier) {
  const privileges = {
    Shallow: {
      canPostCurrents: true,
      canPostInsights: false,
      canJoinSchools: true,
      canCreateSchools: false,
      canRequestAudits: false,
      canGiveAudits: false,
      canMentor: false,
      canHostVirtualTides: false,
      canHostExpoTides: false,
      canModerate: false,
    },
    Coastal: {
      canPostCurrents: true,
      canPostInsights: true,
      canJoinSchools: true,
      canCreateSchools: true,
      canRequestAudits: true,
      canGiveAudits: false,
      canMentor: false,
      canHostVirtualTides: false,
      canHostExpoTides: false,
      canModerate: false,
    },
    Pelagic: {
      canPostCurrents: true,
      canPostInsights: true,
      canJoinSchools: true,
      canCreateSchools: true,
      canRequestAudits: true,
      canGiveAudits: false,
      canMentor: false,
      canHostVirtualTides: false,
      canHostExpoTides: false,
      canModerate: false,
    },
    Abyssal: {
      canPostCurrents: true,
      canPostInsights: true,
      canJoinSchools: true,
      canCreateSchools: true,
      canRequestAudits: true,
      canGiveAudits: true,
      canMentor: true,
      canHostVirtualTides: true,
      canHostExpoTides: false,
      canModerate: false,
    },
    Hadal: {
      canPostCurrents: true,
      canPostInsights: true,
      canJoinSchools: true,
      canCreateSchools: true,
      canRequestAudits: true,
      canGiveAudits: true,
      canMentor: true,
      canHostVirtualTides: true,
      canHostExpoTides: true,
      canModerate: true,
    },
  };

  // Normalize "Hadal-Champion" to "Hadal" for privilege lookup
  const normalizedTier = tier === "Hadal-Champion" ? "Hadal" : tier;
  return privileges[normalizedTier] || privileges.Shallow;
}

/**
 * Canonical tier metadata (icons, colors, thresholds).
 * Aligned with GAMIFICATION_SPEC.md section 3.1 and xp.js TIER_LADDER.
 * 
 * Thresholds:
 *   Shallow:  0 – 1,499
 *   Coastal:  1,500 – 2,499
 *   Pelagic:  2,500 – 4,999
 *   Abyssal:  5,000 – 9,999
 *   Hadal:    10,000+
 */
export const DEPTH_TIERS = [
  { key: "Shallow", label: "Shallow", hobbyistLabel: "Bronze Fry", icon: "🥚", color: "#94a3b8", min: 0, max: 1499 },
  { key: "Coastal", label: "Coastal", hobbyistLabel: "Silver Keeper", icon: "🥈", color: "#38bdf8", min: 1500, max: 2499 },
  { key: "Pelagic", label: "Pelagic", hobbyistLabel: "Gold Aquarist", icon: "🥇", color: "#fbbf24", min: 2500, max: 4999 },
  { key: "Abyssal", label: "Abyssal", hobbyistLabel: "Master Keeper", icon: "💎", color: "#a855f7", min: 5000, max: 9999 },
  { key: "Hadal", label: "Hadal", hobbyistLabel: "God-Tier Champion", icon: "👑", color: "#f59e0b", min: 10000, max: Infinity },
];
