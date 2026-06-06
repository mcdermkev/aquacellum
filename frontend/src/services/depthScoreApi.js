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
 */
export function getTierPrivileges(tier) {
  const privileges = {
    Shallow: {
      canPostInsights: false,
      canJoinSchools: false,
      canCreateSchools: false,
      canRequestAudits: false,
      canGiveAudits: false,
      canMentor: false,
      canHostVirtualTides: false,
      canHostExpoTides: false,
      canModerate: false,
    },
    Coastal: {
      canPostInsights: true,
      canJoinSchools: true,
      canCreateSchools: false,
      canRequestAudits: false,
      canGiveAudits: false,
      canMentor: false,
      canHostVirtualTides: false,
      canHostExpoTides: false,
      canModerate: false,
    },
    Pelagic: {
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

  return privileges[tier] || privileges.Shallow;
}

/**
 * Tier metadata (icons, colors, thresholds).
 */
export const DEPTH_TIERS = [
  { key: "Shallow", label: "Shallow", icon: "🏖️", color: "#94a3b8", min: 0, max: 99 },
  { key: "Coastal", label: "Coastal", icon: "🌊", color: "#38bdf8", min: 100, max: 499 },
  { key: "Pelagic", label: "Pelagic", icon: "🐟", color: "#34d399", min: 500, max: 1499 },
  { key: "Abyssal", label: "Abyssal", icon: "🦑", color: "#a855f7", min: 1500, max: 4999 },
  { key: "Hadal", label: "Hadal", icon: "🔱", color: "#f59e0b", min: 5000, max: Infinity },
];
