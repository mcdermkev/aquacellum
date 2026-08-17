/**
 * tidesApi.js
 * 
 * CRUD operations for Tides (Events) in The Reef social layer.
 * Handles: tide creation, RSVP, chat, auctions, lifecycle queries.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured, resolveProfileWallet } from "./supabaseClient";

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

  const hostWallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("tides")
    .insert({
      title,
      description,
      tide_type: tideType,
      host_wallet: hostWallet,
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
    .ilike("wallet_address", walletAddress.toLowerCase())
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
        wallet_address: await resolveProfileWallet(walletAddress),
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
    .ilike("wallet_address", walletAddress.toLowerCase());

  return { error };
}

/**
 * Check in to an Expo Tide (GPS-verified on client).
 */
export async function checkInToTide(tideId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const profileWallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("tide_attendees")
    .upsert(
      {
        tide_id: tideId,
        wallet_address: profileWallet,
        rsvp_status: "checked_in",
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: "tide_id,wallet_address" }
    )
    .select()
    .single();

  if (error) return { data, error, xpClaimed: false };

  // Claim the one-time check-in XP.
  //
  // The button has always read "Check In (+100 XP)" and no code ever awarded it
  // or wrote xp_awarded. Doing it as a conditional UPDATE filtered on
  // `xp_awarded = false` makes the claim atomic: whoever's request flips the flag
  // gets rows back, and a double-tap, a retry, or a second device gets none. That
  // matters because XP is applied on the client — without a server-side claim,
  // "check in, leave, check in again" would pay out every time.
  const { data: claimed, error: claimError } = await supabase
    .from("tide_attendees")
    .update({ xp_awarded: true })
    .eq("tide_id", tideId)
    .ilike("wallet_address", profileWallet.toLowerCase())
    .eq("xp_awarded", false)
    .select("id");

  if (claimError) {
    // Never fail the check-in itself over reward bookkeeping — the attendee is
    // present either way, which is the thing that actually matters.
    console.warn("[tidesApi] check-in recorded but XP claim failed:", claimError);
    return { data, error: null, xpClaimed: false };
  }

  return { data, error: null, xpClaimed: (claimed?.length ?? 0) > 0 };
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
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: null };

  const { data, error } = await supabase
    .from("tide_attendees")
    .select("wallet_address, rsvp_status, checked_in_at, bringing_species")
    .eq("tide_id", tideId)
    .ilike("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();

  return { data, error };
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

  // Upsert, not UPDATE. A bare UPDATE ... WHERE tide_id AND wallet_address
  // matches zero rows for anyone who has not RSVP'd yet, and PostgREST reports
  // that as a clean success (`error: null`, 0 rows affected). The user filled in
  // "I'm bringing…", saw no error, and the list stayed empty forever.
  //
  // Saying what you're bringing is itself an expression of intent to attend, so
  // creating the attendee row is the honest behaviour.
  const profileWallet = await resolveProfileWallet(walletAddress);

  // Read the current status first so the upsert cannot demote it. Supabase
  // overwrites every column it is given, so passing a literal "going" would send
  // an already-checked-in attendee backwards the moment they edited their list.
  const { data: existing } = await supabase
    .from("tide_attendees")
    .select("rsvp_status")
    .eq("tide_id", tideId)
    .ilike("wallet_address", profileWallet.toLowerCase())
    .maybeSingle();

  const { data, error } = await supabase
    .from("tide_attendees")
    .upsert(
      {
        tide_id: tideId,
        wallet_address: profileWallet,
        rsvp_status: existing?.rsvp_status || "going",
        bringing_species: speciesList,
      },
      { onConflict: "tide_id,wallet_address", ignoreDuplicates: false }
    )
    .select("wallet_address, rsvp_status, bringing_species")
    .single();

  return { data, error };
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
      author_wallet: await resolveProfileWallet(walletAddress),
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
 * Post a system/narration message into tide chat (is_system_message = true).
 * Rendered as "narration" in the live feed. Used to seed the feed on go-live so
 * it never looks dead. The RLS insert policy requires the author to be an
 * attendee, so callers should ensure the host has RSVP'd first (see useStartTide).
 */
export async function postTideSystemMessage(tideId, body) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("tide_chat")
    .insert({
      tide_id: tideId,
      author_wallet: await resolveProfileWallet(walletAddress),
      body,
      is_system_message: true,
    })
    .select()
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
 * Place a bid on an auction lot.
 *
 * `amountCents` is an integer number of US cents. Aquadex settles in dollars —
 * the previous signature took wei, which was pre-launch crypto scaffolding.
 *
 * The ascending-price rule, the reserve floor, "no bidding against yourself" and
 * "the tide must be live" are all enforced by the enforce_auction_bid_rules
 * trigger, so a rejected bid comes back as a Postgres error with a message
 * written for the bidder. Don't duplicate those checks as the source of truth
 * here; the client copy is a courtesy so the common case fails fast.
 */
export async function placeBid(tideId, tokenId, amountCents) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { data: null, error: "Bid must be a positive dollar amount." };
  }

  const { data, error } = await supabase
    .from("auction_bids")
    .insert({
      tide_id: tideId,
      token_id: tokenId,
      bidder_wallet: await resolveProfileWallet(walletAddress),
      amount_cents: amountCents,
    })
    .select(`
      *,
      bidder_profile:bidder_wallet (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
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
    // Order by AMOUNT, not recency. This used to be created_at DESC, which made
    // this function return the most recent bid and call it the highest — so a $1
    // bid placed after a $5,000 bid took the lot. maybeSingle, not single:
    // single() raises PGRST116 on a lot with no bids yet, which is a completely
    // ordinary state and not an error.
    .order("amount_cents", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { data, error };
}

/**
 * Get all active auction items for a tide with their current highest bids.
 */
export async function getAuctionItems(tideId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  // Get the tide settings to know which lots are up for auction
  const { data: tide, error: tideError } = await supabase
    .from("tides")
    .select("settings")
    .eq("id", tideId)
    .single();

  if (tideError) return { data: [], error: tideError };
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
