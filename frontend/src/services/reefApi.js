/**
 * reefApi.js
 * 
 * CRUD operations for The Reef social layer.
 * All functions interact with Supabase Postgres via the JS client.
 * 
 * Tables: profiles, currents, reactions, comments, follows, 
 *         connection_requests, sonar_notifications
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// PROFILES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get or create a profile for the given wallet address.
 * Called on first login to ensure the profile row exists.
 */
export async function ensureProfile(walletAddress, initialData = {}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  // Check if profile exists
  const { data: existing, error: fetchError } = await supabase
    .from("profiles")
    .select("*")
    .eq("wallet_address", walletAddress)
    .single();

  if (existing) return { data: existing, error: null };

  // Create new profile
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      wallet_address: walletAddress,
      display_name: initialData.display_name || null,
      tank_count: initialData.tank_count || 0,
      species_count: initialData.species_count || 0,
      xp_total: initialData.xp_total || 0,
      companion_tier: initialData.companion_tier || "Bronze",
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Fetch a public profile by wallet address.
 */
export async function getProfile(walletAddress) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("wallet_address", walletAddress)
    .single();

  return { data, error };
}

/**
 * Update the current user's profile.
 */
export async function updateProfile(walletAddress, updates) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .select()
    .single();

  return { data, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENTS (Tank Posts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Tank Current (post).
 */
export async function createCurrent({
  authorWallet,
  title,
  body,
  mediaUrls = [],
  mediaAltTexts = [],
  linkedTankId,
  linkedTankName,
  speciesTags = [],
  parametersSnapshot,
  visibility = "public",
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("currents")
    .insert({
      author_wallet: authorWallet,
      title,
      body,
      media_urls: mediaUrls,
      media_alt_texts: mediaAltTexts.length > 0 ? mediaAltTexts : null,
      linked_tank_id: linkedTankId || null,
      linked_tank_name: linkedTankName || null,
      species_tags: speciesTags,
      parameters_snapshot: parametersSnapshot || null,
      visibility,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Fetch a single Current by ID with author profile.
 */
export async function getCurrent(currentId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("currents")
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("id", currentId)
    .single();

  return { data, error };
}

/**
 * Fetch the Following feed — Currents from Tankmates + watched tanks.
 * Chronological, paginated by cursor (created_at).
 */
export async function getFollowingFeed(walletAddress, { cursor, limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  // Step 1: Get list of wallets/tanks the user follows
  const { data: follows, error: followsError } = await supabase
    .from("follows")
    .select("follow_type, target_wallet, target_tank_id")
    .eq("follower_wallet", walletAddress);

  if (followsError) return { data: [], error: followsError };
  if (!follows || follows.length === 0) return { data: [], error: null };

  // Separate followed wallets and watched tanks
  const followedWallets = follows
    .filter((f) => f.follow_type === "tankmate" && f.target_wallet)
    .map((f) => f.target_wallet);

  const watchedTanks = follows
    .filter((f) => f.follow_type === "watch_tank" && f.target_tank_id)
    .map((f) => f.target_tank_id);

  // Step 2: Query currents from followed wallets OR watched tanks
  let query = supabase
    .from("currents")
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Build OR filter: author in followed wallets OR tank in watched tanks
  const orConditions = [];
  if (followedWallets.length > 0) {
    orConditions.push(`author_wallet.in.(${followedWallets.join(",")})`);
  }
  if (watchedTanks.length > 0) {
    orConditions.push(`linked_tank_id.in.(${watchedTanks.join(",")})`);
  }

  if (orConditions.length > 0) {
    query = query.or(orConditions.join(","));
  }

  // Visibility filter: public or tankmates-only (if user is a tankmate)
  query = query.in("visibility", ["public", "tankmates"]);

  // Cursor-based pagination
  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Fetch the Discover feed — all public Currents, newest first.
 */
export async function getDiscoverFeed({ cursor, limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("currents")
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Fetch Currents by a specific author.
 */
export async function getCurrentsByAuthor(walletAddress, { cursor, limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const currentWallet = getCurrentWallet();
  const visibilityFilter = walletAddress === currentWallet
    ? ["public", "tankmates", "private"]
    : ["public"];

  let query = supabase
    .from("currents")
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("author_wallet", walletAddress)
    .in("visibility", visibilityFilter)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Delete a Current (author only).
 */
export async function deleteCurrent(currentId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("currents")
    .delete()
    .eq("id", currentId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// REACTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toggle a reaction on a Current. If already reacted with same emoji, remove it.
 */
export async function toggleReaction(currentId, emoji) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  // Check if reaction exists
  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("user_wallet", walletAddress)
    .eq("target_id", currentId)
    .eq("emoji", emoji)
    .single();

  if (existing) {
    // Remove reaction
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("id", existing.id);
    return { data: { action: "removed" }, error };
  } else {
    // Add reaction
    const { data, error } = await supabase
      .from("reactions")
      .insert({
        user_wallet: walletAddress,
        target_id: currentId,
        emoji,
      })
      .select()
      .single();
    return { data: { action: "added", ...data }, error };
  }
}

/**
 * Get all reactions for a Current, grouped by emoji with counts.
 */
export async function getReactions(currentId) {
  if (!isSupabaseConfigured()) return { data: {}, error: "Not configured" };

  const { data, error } = await supabase
    .from("reactions")
    .select("emoji, user_wallet")
    .eq("target_id", currentId);

  if (error) return { data: {}, error };

  // Group by emoji
  const grouped = {};
  const currentWallet = getCurrentWallet();
  for (const r of data || []) {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = { count: 0, userReacted: false };
    }
    grouped[r.emoji].count++;
    if (r.user_wallet === currentWallet) {
      grouped[r.emoji].userReacted = true;
    }
  }

  return { data: grouped, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post a comment on a Current.
 */
export async function postComment(currentId, body, parentCommentId = null) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("comments")
    .insert({
      author_wallet: walletAddress,
      current_id: currentId,
      parent_comment_id: parentCommentId,
      body,
    })
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .single();

  return { data, error };
}

/**
 * Fetch comments for a Current (with threading).
 */
export async function getComments(currentId, { limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("comments")
    .select(`
      *,
      profiles:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("current_id", currentId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Delete a comment (author only).
 */
export async function deleteComment(commentId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOWS & CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Watch a tank (one-way, no approval needed).
 */
export async function watchTank(targetWallet, tankId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("follows")
    .insert({
      follower_wallet: walletAddress,
      follow_type: "watch_tank",
      target_wallet: targetWallet,
      target_tank_id: tankId,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Unwatch a tank.
 */
export async function unwatchTank(targetWallet, tankId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_wallet", walletAddress)
    .eq("follow_type", "watch_tank")
    .eq("target_wallet", targetWallet)
    .eq("target_tank_id", tankId);

  return { error };
}

/**
 * Check if current user is watching a specific tank.
 */
export async function isWatchingTank(targetWallet, tankId) {
  if (!isSupabaseConfigured()) return false;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return false;

  const { data } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_wallet", walletAddress)
    .eq("follow_type", "watch_tank")
    .eq("target_wallet", targetWallet)
    .eq("target_tank_id", tankId)
    .single();

  return !!data;
}

/**
 * Send a Tankmate request.
 */
export async function sendTankmateRequest(targetWallet, message = "") {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("connection_requests")
    .insert({
      from_wallet: walletAddress,
      to_wallet: targetWallet,
      message: message || null,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Accept or decline a Tankmate request.
 * On accept: creates mutual follow rows.
 */
export async function respondToRequest(requestId, accept = true) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();

  if (accept) {
    // Get the request to know who sent it
    const { data: request, error: fetchError } = await supabase
      .from("connection_requests")
      .select("from_wallet, to_wallet")
      .eq("id", requestId)
      .single();

    if (fetchError || !request) return { error: fetchError || "Request not found" };

    // Update request status
    const { error: updateError } = await supabase
      .from("connection_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);

    if (updateError) return { error: updateError };

    // Create mutual follow rows
    const { error: followError } = await supabase
      .from("follows")
      .insert([
        {
          follower_wallet: request.from_wallet,
          follow_type: "tankmate",
          target_wallet: request.to_wallet,
          is_mutual: true,
        },
        {
          follower_wallet: request.to_wallet,
          follow_type: "tankmate",
          target_wallet: request.from_wallet,
          is_mutual: true,
        },
      ]);

    return { error: followError };
  } else {
    // Decline
    const { error } = await supabase
      .from("connection_requests")
      .update({ status: "declined" })
      .eq("id", requestId);

    return { error };
  }
}

/**
 * Get pending Tankmate requests for the current user.
 */
export async function getPendingRequests() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("connection_requests")
    .select(`
      *,
      from_profile:from_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("to_wallet", walletAddress)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return { data: data || [], error };
}

/**
 * Get the relationship status between current user and a target wallet.
 * Returns: 'tankmate' | 'request_sent' | 'request_received' | 'none'
 */
export async function getRelationshipStatus(targetWallet) {
  if (!isSupabaseConfigured()) return "none";

  const walletAddress = getCurrentWallet();
  if (!walletAddress || walletAddress === targetWallet) return "self";

  // Check mutual tankmate follow
  const { data: follow } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_wallet", walletAddress)
    .eq("follow_type", "tankmate")
    .eq("target_wallet", targetWallet)
    .single();

  if (follow) return "tankmate";

  // Check pending request sent
  const { data: sentRequest } = await supabase
    .from("connection_requests")
    .select("id")
    .eq("from_wallet", walletAddress)
    .eq("to_wallet", targetWallet)
    .eq("status", "pending")
    .single();

  if (sentRequest) return "request_sent";

  // Check pending request received
  const { data: receivedRequest } = await supabase
    .from("connection_requests")
    .select("id, from_wallet")
    .eq("from_wallet", targetWallet)
    .eq("to_wallet", walletAddress)
    .eq("status", "pending")
    .single();

  if (receivedRequest) return "request_received";

  return "none";
}

/**
 * Get the current user's Tankmate list.
 */
export async function getTankmates(walletAddress) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("follows")
    .select(`
      target_wallet,
      profiles:target_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier,
        xp_total
      )
    `)
    .eq("follower_wallet", walletAddress)
    .eq("follow_type", "tankmate");

  return { data: data || [], error };
}

/**
 * Remove a Tankmate connection (removes both directions).
 */
export async function removeTankmate(targetWallet) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  // Delete both follow directions
  await supabase
    .from("follows")
    .delete()
    .eq("follower_wallet", walletAddress)
    .eq("follow_type", "tankmate")
    .eq("target_wallet", targetWallet);

  await supabase
    .from("follows")
    .delete()
    .eq("follower_wallet", targetWallet)
    .eq("follow_type", "tankmate")
    .eq("target_wallet", walletAddress);

  return { error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS (SONAR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get notifications for the current user.
 */
export async function getNotifications({ limit = 20, unreadOnly = false } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  let query = supabase
    .from("sonar_notifications")
    .select("*")
    .eq("recipient_wallet", walletAddress)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Get unread notification count.
 */
export async function getUnreadCount() {
  if (!isSupabaseConfigured()) return 0;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return 0;

  const { count, error } = await supabase
    .from("sonar_notifications")
    .select("*", { count: "exact", head: true })
    .eq("recipient_wallet", walletAddress)
    .eq("is_read", false);

  return error ? 0 : (count || 0);
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId) {
  if (!isSupabaseConfigured()) return;

  await supabase
    .from("sonar_notifications")
    .update({ is_read: true })
    .eq("id", notificationId);
}

/**
 * Mark all notifications as read.
 */
export async function markAllNotificationsRead() {
  if (!isSupabaseConfigured()) return;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return;

  await supabase
    .from("sonar_notifications")
    .update({ is_read: true })
    .eq("recipient_wallet", walletAddress)
    .eq("is_read", false);
}

/**
 * Create a notification (used client-side in anon mode, 
 * server-side via Edge Functions in production).
 */
export async function createNotification({
  recipientWallet,
  category,
  title,
  body,
  icon,
  linkType,
  linkId,
}) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("sonar_notifications")
    .insert({
      recipient_wallet: recipientWallet,
      category,
      title,
      body,
      icon,
      link_type: linkType,
      link_id: linkId,
    });

  return { error };
}
