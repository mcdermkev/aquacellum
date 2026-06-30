/**
 * messagesApi.js
 * 
 * CRUD operations for Direct Messages between Tankmates.
 * Tables: conversations, messages
 * 
 * Conversation pair convention: participant_a is always the alphabetically
 * smaller wallet address, participant_b is the larger. This ensures one
 * unique row per user pair regardless of who messages first.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";
import { checkRateLimit, recordAction } from "./rateLimiter";

/**
 * Order two wallets alphabetically for consistent pair storage.
 */
function orderPair(walletA, walletB) {
  const a = walletA.toLowerCase();
  const b = walletB.toLowerCase();
  return a < b ? [walletA, walletB] : [walletB, walletA];
}

/**
 * Get or create a conversation between two users.
 */
export async function getOrCreateConversation(targetWallet) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const [participantA, participantB] = orderPair(walletAddress, targetWallet);

  // Check if conversation exists
  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("participant_a", participantA)
    .eq("participant_b", participantB)
    .single();

  if (existing) return { data: existing, error: null };

  // Create new conversation
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      participant_a: participantA,
      participant_b: participantB,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Get all conversations for the current user, sorted by most recent message.
 */
export async function getMyConversations() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  // Query conversations where user is participant_a OR participant_b
  // Use PostgREST FK hint syntax (profiles!column_name) to disambiguate
  // since conversations has two FKs to profiles (participant_a, participant_b).
  const { data: asA, error: errA } = await supabase
    .from("conversations")
    .select(`
      *,
      other_profile:profiles!conversations_participant_b_fkey (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("participant_a", walletAddress)
    .order("last_message_at", { ascending: false });

  const { data: asB, error: errB } = await supabase
    .from("conversations")
    .select(`
      *,
      other_profile:profiles!conversations_participant_a_fkey (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("participant_b", walletAddress)
    .order("last_message_at", { ascending: false });

  // If the FK hint syntax fails (e.g. constraint names differ), fall back to manual profile lookup
  if ((errA && errA.message?.includes("relationship")) || (errB && errB.message?.includes("relationship"))) {
    // Fallback: fetch conversations without profile joins, then look up profiles manually
    const { data: rawA } = await supabase
      .from("conversations")
      .select("*")
      .eq("participant_a", walletAddress)
      .order("last_message_at", { ascending: false });

    const { data: rawB } = await supabase
      .from("conversations")
      .select("*")
      .eq("participant_b", walletAddress)
      .order("last_message_at", { ascending: false });

    // Collect all "other" wallet addresses for batch profile lookup
    const otherWallets = [
      ...(rawA || []).map((c) => c.participant_b),
      ...(rawB || []).map((c) => c.participant_a),
    ].filter(Boolean);

    let profileMap = {};
    if (otherWallets.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("wallet_address, display_name, avatar_url, companion_tier")
        .in("wallet_address", [...new Set(otherWallets)]);
      for (const p of profiles || []) {
        profileMap[p.wallet_address] = p;
      }
    }

    const all = [
      ...(rawA || []).map((c) => ({
        ...c,
        otherWallet: c.participant_b,
        otherProfile: profileMap[c.participant_b] || null,
        myUnread: c.unread_a,
      })),
      ...(rawB || []).map((c) => ({
        ...c,
        otherWallet: c.participant_a,
        otherProfile: profileMap[c.participant_a] || null,
        myUnread: c.unread_b,
      })),
    ].sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

    return { data: all, error: null };
  }

  if (errA || errB) return { data: [], error: errA || errB };

  // Merge, add helper fields, sort by recency
  const all = [
    ...(asA || []).map((c) => ({
      ...c,
      otherWallet: c.participant_b,
      otherProfile: c.other_profile,
      myUnread: c.unread_a,
    })),
    ...(asB || []).map((c) => ({
      ...c,
      otherWallet: c.participant_a,
      otherProfile: c.other_profile,
      myUnread: c.unread_b,
    })),
  ].sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

  return { data: all, error: null };
}

/**
 * Get total unread message count across all conversations.
 */
export async function getTotalUnreadCount() {
  if (!isSupabaseConfigured()) return 0;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return 0;

  const { data: asA } = await supabase
    .from("conversations")
    .select("unread_a")
    .eq("participant_a", walletAddress)
    .gt("unread_a", 0);

  const { data: asB } = await supabase
    .from("conversations")
    .select("unread_b")
    .eq("participant_b", walletAddress)
    .gt("unread_b", 0);

  const countA = (asA || []).reduce((sum, c) => sum + c.unread_a, 0);
  const countB = (asB || []).reduce((sum, c) => sum + c.unread_b, 0);

  return countA + countB;
}

/**
 * Get messages in a conversation (paginated, oldest first).
 */
export async function getMessages(conversationId, { limit = 50, before } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Send a message in a conversation.
 */
export async function sendMessage(conversationId, body) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  // Rate limit: 1 message per 3 seconds
  const rateCheck = checkRateLimit("message");
  if (!rateCheck.allowed) return { data: null, error: rateCheck.message };

  const trimmed = body.trim();
  if (!trimmed) return { data: null, error: "Message cannot be empty" };
  if (trimmed.length > 2000) return { data: null, error: "Message too long (max 2000 chars)" };

  // Insert message
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_wallet: walletAddress,
      body: trimmed,
    })
    .select()
    .single();

  if (msgError) return { data: null, error: msgError };

  // Update conversation metadata (last message + increment other user's unread)
  const preview = trimmed.slice(0, 100);

  // Determine which participant field to increment
  const { data: convo } = await supabase
    .from("conversations")
    .select("participant_a, participant_b, unread_a, unread_b")
    .eq("id", conversationId)
    .single();

  if (convo) {
    const isParticipantA = convo.participant_a === walletAddress;
    const updates = {
      last_message_preview: preview,
      last_message_at: new Date().toISOString(),
    };

    if (isParticipantA) {
      updates.unread_b = (convo.unread_b || 0) + 1;
    } else {
      updates.unread_a = (convo.unread_a || 0) + 1;
    }

    await supabase
      .from("conversations")
      .update(updates)
      .eq("id", conversationId);
  }

  recordAction("message");
  return { data: message, error: null };
}

/**
 * Mark all messages in a conversation as read (for the current user).
 * Resets the unread counter for the current user's participant slot.
 */
export async function markConversationRead(conversationId) {
  if (!isSupabaseConfigured()) return;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return;

  // Mark individual messages as read
  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_wallet", walletAddress)
    .eq("is_read", false);

  // Reset unread counter
  const { data: convo } = await supabase
    .from("conversations")
    .select("participant_a, participant_b")
    .eq("id", conversationId)
    .single();

  if (convo) {
    const isParticipantA = convo.participant_a === walletAddress;
    const updates = isParticipantA ? { unread_a: 0 } : { unread_b: 0 };

    await supabase
      .from("conversations")
      .update(updates)
      .eq("id", conversationId);
  }
}
