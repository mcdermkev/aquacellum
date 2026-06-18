/**
 * zoneLeaderboardApi.js
 * 
 * Supabase API functions for the Zone Leaderboard system.
 * Queries the zone_leaderboard materialized view, zones table, and xp_events.
 * Supports cross-zone browsing per GAMIFICATION_SPEC.md section 4.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// Zone Leaderboard Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the leaderboard for the current user's zone.
 * Returns ranked entries for the user's assigned zone.
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max entries to return (default 20)
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function fetchMyZoneLeaderboard({ limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { data: [], error: "Not connected" };

  // First get user's zone_hash
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("zone_hash")
    .eq("wallet_address", wallet)
    .single();

  if (profileErr || !profile?.zone_hash) {
    return { data: [], error: profileErr?.message || "No zone assigned" };
  }

  return fetchZoneLeaderboardByHash(profile.zone_hash, { limit });
}

/**
 * Fetch the leaderboard for a specific zone (cross-zone browsing).
 * 
 * @param {string} zoneHash - The zone_hash to query
 * @param {object} opts
 * @param {number} opts.limit - Max entries (default 20)
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function fetchZoneLeaderboardByHash(zoneHash, { limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };
  if (!zoneHash) return { data: [], error: "No zone hash provided" };

  const { data, error } = await supabase
    .from("zone_leaderboard")
    .select("*")
    .eq("zone_hash", zoneHash)
    .order("zone_rank", { ascending: true })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}

/**
 * Fetch the current user's rank within their zone.
 * 
 * @param {string} walletAddress - Optional, defaults to connected wallet
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
export async function fetchUserZoneRank(walletAddress) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("zone_leaderboard")
    .select("*")
    .eq("wallet_address", wallet)
    .single();

  return { data: data || null, error: error?.message || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone Directory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all available zones for the zone picker (cross-zone browsing).
 * Returns zones sorted by member count (most active first).
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max zones to return (default 50)
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function fetchAllZones({ limit = 50 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("zones")
    .select("zone_hash, display_name, center_lat, center_lng, radius_miles, population_tier, member_count, champion_wallet")
    .order("member_count", { ascending: false })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}

/**
 * Search zones by name (for zone picker autocomplete).
 * 
 * @param {string} query - Search term
 * @param {number} limit - Max results (default 10)
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function searchZones(query, limit = 10) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };
  if (!query || query.length < 2) return { data: [], error: null };

  const { data, error } = await supabase
    .from("zones")
    .select("zone_hash, display_name, member_count, population_tier")
    .ilike("display_name", `%${query}%`)
    .order("member_count", { ascending: false })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}

/**
 * Get a single zone's details by hash.
 * 
 * @param {string} zoneHash
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
export async function fetchZoneDetails(zoneHash) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };
  if (!zoneHash) return { data: null, error: "No zone hash" };

  const { data, error } = await supabase
    .from("zones")
    .select("*")
    .eq("zone_hash", zoneHash)
    .single();

  return { data: data || null, error: error?.message || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone Assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assign the user to a zone. Updates profiles.zone_hash and increments zone member_count.
 * Enforces 90-day transfer cooldown.
 * 
 * @param {string} zoneHash - Zone to assign
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function assignUserToZone(zoneHash) {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { success: false, error: "Not connected" };

  // Check transfer cooldown
  const { data: profile } = await supabase
    .from("profiles")
    .select("zone_hash, zone_transfer_cooldown")
    .eq("wallet_address", wallet)
    .single();

  if (profile?.zone_hash && profile?.zone_transfer_cooldown) {
    const cooldownEnd = new Date(profile.zone_transfer_cooldown);
    if (cooldownEnd > new Date()) {
      const daysLeft = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60 * 24));
      return { success: false, error: `Zone transfer on cooldown. ${daysLeft} days remaining.` };
    }
  }

  const oldZoneHash = profile?.zone_hash;

  // Update user's zone
  const { error: updateErr } = await supabase
    .from("profiles")
    .update({
      zone_hash: zoneHash,
      zone_assigned_at: new Date().toISOString(),
      zone_transfer_cooldown: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("wallet_address", wallet);

  if (updateErr) return { success: false, error: updateErr.message };

  // Increment new zone's member count
  await supabase.rpc("increment_zone_member_count", { p_zone_hash: zoneHash });

  // Decrement old zone's member count if transferring
  if (oldZoneHash && oldZoneHash !== zoneHash) {
    await supabase.rpc("decrement_zone_member_count", { p_zone_hash: oldZoneHash });
  }

  return { success: true, error: null };
}

/**
 * Register a new zone (typically called by the zone assignment utility
 * when a user's location doesn't match any existing zone).
 * 
 * @param {object} zoneData
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
export async function registerZone(zoneData) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("zones")
    .upsert(zoneData, { onConflict: "zone_hash" })
    .select()
    .single();

  return { data, error: error?.message || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// XP Event Logging (client-side supplement to server-side triggers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log an XP event to Supabase (syncs local XP to server for leaderboard).
 * 
 * @param {object} event
 * @param {string} event.actionType - XP_ACTIONS key
 * @param {number} event.pointsAwarded - Base points
 * @param {number} event.multiplier - Multiplier applied (1.0, 1.5, 2.0)
 * @param {object} event.metadata - Additional context (tankId, challengeId, etc.)
 * @returns {Promise<{error: string|null}>}
 */
export async function logXpEvent({ actionType, pointsAwarded, multiplier = 1.0, metadata = {} }) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { error: "Not connected" };

  // Get user's zone_hash
  const { data: profile } = await supabase
    .from("profiles")
    .select("zone_hash")
    .eq("wallet_address", wallet)
    .single();

  const finalPoints = Math.round(pointsAwarded * multiplier);

  const { error } = await supabase
    .from("xp_events")
    .insert({
      wallet_address: wallet,
      action_type: actionType,
      points_awarded: pointsAwarded,
      multiplier,
      final_points: finalPoints,
      zone_hash: profile?.zone_hash || null,
      metadata,
    });

  return { error: error?.message || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Contributors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the weekly contributors leaderboard.
 * 
 * @param {object} opts
 * @param {number} opts.limit - Max entries (default 10)
 * @returns {Promise<{data: Array, error: string|null}>}
 */
export async function fetchWeeklyContributors({ limit = 10 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("weekly_contributors")
    .select("*")
    .order("weekly_rank", { ascending: true })
    .limit(limit);

  return { data: data || [], error: error?.message || null };
}
