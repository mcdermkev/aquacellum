/**
 * tidesApi.js
 * 
 * CRUD operations for Tides (Events) in The Reef social layer.
 * Handles: tide creation, RSVP, chat, auctions, lifecycle queries.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// TIDES — CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Tide.
 * Only Council members or School Elders can create.
 */
export async function createTide({
  title,
  description,
  tideType,
  startTime,
  endTime,
  gpsBounds = null,
  zoneHash = null,
  bannerUrl = null,
  streamUrl = null,
  maxAttendees = null,
  hostSchoolId = null,
  onChainEventId = null,
  settings = {},
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("tides")
    .insert({
      title,
      description,
      tide_type: tideType,
      host_wallet: walletAddress,
      host_school_id: hostSchoolId,
      start_time: startTime,
      end_time: endTime,
      gps_bounds: gpsBounds,
      zone_hash: zoneHash,
      banner_url: bannerUrl,
      stream_url: streamUrl,
      max_attendees: maxAttendees,
      on_chain_event_id: onChainEventId,
      settings,
    })
    .select(`
      *,
      host_profile:host_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .single();

  return { data, error };
}

/**
 * Fetch a single Tide by ID with host profile and attendee count.
 */
export async function getTide(tideId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("tides")
    .select(`
      *,
      host_profile:host_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("id", tideId)
    .single();

  if (error) return { data: null, error };

  // Get attendee count
  const { count } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tideId);

  return { data: { ...data, attendee_count: count || 0 }, error: null };
}

/**
 * Fetch upcoming tides with optional filters.
 */
export async function getUpcomingTides({ tideType, schoolId, limit = 20, cursor } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("tides")
    .select(`
      *,
      host_profile:host_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .in("status", ["upcoming", "live"])
    .order("start_time", { ascending: true })
    .limit(limit);

  if (tideType) {
    query = query.eq("tide_type", tideType);
  }
  if (schoolId) {
    query = query.eq("host_school_id", schoolId);
  }
  if (cursor) {
    query = query.gt("start_time", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Fetch past (ended) tides.
 */
export async function getPastTides({ limit = 20, cursor } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("tides")
    .select(`
      *,
      host_profile:host_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("status", "ended")
    .order("end_time", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt("end_time", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Fetch tides the current user is attending (RSVPd to).
 */
export async function getMyTides() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("tide_attendees")
    .select(`
      rsvp_status,
      tides:tide_id (
        *,
        host_profile:host_wallet (
          wallet_address, display_name, avatar_url, companion_tier
        )
      )
    `)
    .eq("wallet_address", walletAddress)
    .order("created_at", { ascending: false });

  // Flatten the response
  const tides = (data || []).map((row) => ({
    ...row.tides,
    my_rsvp: row.rsvp_status,
  }));

  return { data: tides, error };
}

/**
 * Update a tide (host only).
 */
export async function updateTide(tideId, updates) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("tides")
    .update(updates)
    .eq("id", tideId)
    .select()
    .single();

  return { data, error };
}

/**
 * Cancel a tide (host only).
 */
export async function cancelTide(tideId) {
  return updateTide(tideId, { status: "cancelled" });
}

// ─────────────────────────────────────────────────────────────────────────────
// RSVP / ATTENDEES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RSVP to a tide (going / interested).
 */
export async function rsvpTide(tideId, status = "going") {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("tide_attendees")
    .upsert(
      {
        tide_id: tideId,
        wallet_address: walletAddress,
        rsvp_status: status,
      },
      { onConflict: "tide_id,wallet_address" }
    )
    .select()
    .single();

  return { data, error };
}

/**
 * Cancel RSVP (remove attendee row).
 */
export async function cancelRsvp(tideId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("tide_attendees")
    .delete()
    .eq("tide_id", tideId)
    .eq("wallet_address", walletAddress);

  return { error };
}

/**
 * Check in to an Expo Tide (GPS-verified on client).
 */
export async function checkInToTide(tideId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("tide_attendees")
    .upsert(
      {
        tide_id: tideId,
        wallet_address: walletAddress,
        rsvp_status: "checked_in",
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: "tide_id,wallet_address" }
    )
    .select()
    .single();

  return { data, error };
}

/**
 * Get attendees for a tide.
 */
export async function getTideAttendees(tideId, { limit = 50 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("tide_attendees")
    .select(`
      *,
      profile:wallet_address (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("tide_id", tideId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Get the current user's RSVP status for a tide.
 */
export async function getMyRsvp(tideId) {
  if (!isSupabaseConfigured()) return null;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return null;

  const { data } = await supabase
    .from("tide_attendees")
    .select("rsvp_status, checked_in_at, bringing_species")
    .eq("tide_id", tideId)
    .eq("wallet_address", walletAddress)
    .single();

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SWAP SHEET — "I'm bringing..."
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update the species the user plans to bring to the tide.
 */
export async function updateBringingSpecies(tideId, speciesList) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("tide_attendees")
    .update({ bringing_species: speciesList })
    .eq("tide_id", tideId)
    .eq("wallet_address", walletAddress);

  return { error };
}

/**
 * Get the full swap sheet (all attendees' bringing_species).
 */
export async function getSwapSheet(tideId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("tide_attendees")
    .select(`
      wallet_address,
      bringing_species,
      profile:wallet_address (
        display_name, avatar_url, companion_tier
      )
    `)
    .eq("tide_id", tideId)
    .not("bringing_species", "eq", "[]");

  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDE CHAT (Ephemeral)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a message in tide chat.
 * Rate-limited to 1 msg per 5 seconds on the client side.
 */
export async function sendTideChatMessage(tideId, body) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  if (!body || body.trim().length === 0) return { data: null, error: "Empty message" };
  if (body.length > 300) return { data: null, error: "Message too long (300 char limit)" };

  const { data, error } = await supabase
    .from("tide_chat")
    .insert({
      tide_id: tideId,
      author_wallet: walletAddress,
      body: body.trim(),
    })
    .select(`
      *,
      profile:author_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .single();

  return { data, error };
}

/**
 * Fetch recent tide chat messages (for initial load).
 */
export async function getTideChatMessages(tideId, { limit = 50 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("tide_chat")
    .select(`
      *,
      profile:author_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("tide_id", tideId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUCTION BIDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Place a bid on an auction item.
 */
export async function placeBid(tideId, tokenId, amountWei) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("auction_bids")
    .insert({
      tide_id: tideId,
      token_id: tokenId,
      bidder_wallet: walletAddress,
      amount_wei: amountWei,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Get bid history for a specific auction item.
 */
export async function getBidHistory(tideId, tokenId, { limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("auction_bids")
    .select(`
      *,
      bidder_profile:bidder_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("tide_id", tideId)
    .eq("token_id", tokenId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Get the current highest bid for an auction item.
 */
export async function getHighestBid(tideId, tokenId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("auction_bids")
    .select(`
      *,
      bidder_profile:bidder_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("tide_id", tideId)
    .eq("token_id", tokenId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { data, error };
}

/**
 * Get all active auction items for a tide with their current highest bids.
 */
export async function getAuctionItems(tideId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  // Get the tide settings to know which tokens are up for auction
  const { data: tide } = await supabase
    .from("tides")
    .select("settings")
    .eq("id", tideId)
    .single();

  if (!tide?.settings?.auction_items) return { data: [], error: null };

  // For each auction item, get the current highest bid
  const items = tide.settings.auction_items;
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const { data: highBid } = await getHighestBid(tideId, item.token_id);
      return { ...item, highest_bid: highBid };
    })
  );

  return { data: enrichedItems, error: null };
}
