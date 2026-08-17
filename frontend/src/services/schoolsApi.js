/**
 * schoolsApi.js
 * 
 * CRUD operations for Schools (Clubs) in The Reef Phase 2.
 * Tables: schools, school_members, school_challenges, school_chat
 */

import { supabase, getCurrentWallet, isSupabaseConfigured, resolveProfileWallet } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new School.
 * Auto-adds the creator as Founder role.
 */
export async function createSchool({
  name,
  slug,
  description,
  bannerUrl,
  schoolType,
  memberCap,
  isInviteOnly,
  trackedSpecies = [],
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  // Resolve to the casing stored in profiles so founder/member FKs are satisfied.
  const founderWallet = await resolveProfileWallet(walletAddress);

  // Create the school
  const { data: school, error: schoolError } = await supabase
    .from("schools")
    .insert({
      name,
      slug,
      description: description || null,
      banner_url: bannerUrl || null,
      school_type: schoolType,
      founder_wallet: founderWallet,
      member_cap: memberCap || null,
      is_invite_only: isInviteOnly || false,
      tracked_species: trackedSpecies,
    })
    .select()
    .single();

  if (schoolError) return { data: null, error: schoolError };

  // Add creator as Founder member
  const { error: memberError } = await supabase
    .from("school_members")
    .insert({
      school_id: school.id,
      wallet_address: founderWallet,
      role: "founder",
    });

  if (memberError) {
    // Rollback school creation on failure
    await supabase.from("schools").delete().eq("id", school.id);
    return { data: null, error: memberError };
  }

  return { data: school, error: null };
}

/**
 * Get a school by slug (for URL routing).
 */
export async function getSchoolBySlug(slug) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("schools")
    .select(`
      *,
      founder:founder_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("slug", slug)
    .single();

  return { data, error };
}

/**
 * Get a school by ID.
 */
export async function getSchoolById(schoolId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("schools")
    .select(`
      *,
      founder:founder_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("id", schoolId)
    .single();

  return { data, error };
}

/**
 * List all schools with pagination and optional filters.
 */
export async function listSchools({ type, search, cursor, limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("schools")
    .select(`
      *,
      founder:founder_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .order("member_count", { ascending: false })
    .limit(limit);

  if (type && type !== "all") {
    query = query.eq("school_type", type);
  }

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Get schools the current user is a member of.
 */
export async function getMySchools() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("school_members")
    .select(`
      role,
      joined_at,
      school:school_id (
        id,
        name,
        slug,
        banner_url,
        school_type,
        member_count,
        is_invite_only
      )
    `)
    .ilike("wallet_address", walletAddress.toLowerCase())
    .order("joined_at", { ascending: false });

  return { data: data || [], error };
}

/**
 * Update school settings (Founder only).
 */
export async function updateSchool(schoolId, updates) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const { data, error } = await supabase
    .from("schools")
    .update(updates)
    .eq("id", schoolId)
    .select()
    .single();

  return { data, error };
}

/**
 * List official (platform-curated) master schools.
 */
export async function listOfficialSchools() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("schools")
    .select("*")
    .eq("is_official", true)
    .order("name", { ascending: true });

  return { data: data || [], error };
}

/**
 * Check if slug is available.
 */
export async function isSlugAvailable(slug) {
  if (!isSupabaseConfigured()) return false;

  const { data } = await supabase
    .from("schools")
    .select("id")
    .eq("slug", slug)
    .single();

  return !data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL MEMBERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Join a school (open schools only).
 */
export async function joinSchool(schoolId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const memberWallet = await resolveProfileWallet(walletAddress);

  const { error } = await supabase
    .from("school_members")
    .insert({
      school_id: schoolId,
      wallet_address: memberWallet,
      role: "member",
    });

  if (error) console.warn("[Reef] joinSchool error:", error.message || error);
  return { error };
}

/**
 * Leave a school.
 */
export async function leaveSchool(schoolId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("school_members")
    .delete()
    .eq("school_id", schoolId)
    .ilike("wallet_address", walletAddress.toLowerCase());

  return { error };
}

/**
 * Get members of a school with profiles.
 */
export async function getSchoolMembers(schoolId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("school_members")
    .select(`
      role,
      joined_at,
      profile:wallet_address (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier,
        xp_total
      )
    `)
    .eq("school_id", schoolId)
    .order("joined_at", { ascending: true });

  return { data: data || [], error };
}

/**
 * Get current user's role in a school (null if not a member).
 */
export async function getMySchoolRole(schoolId) {
  if (!isSupabaseConfigured()) return null;

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return null;

  const { data } = await supabase
    .from("school_members")
    .select("role")
    .eq("school_id", schoolId)
    .ilike("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();

  return data?.role || null;
}

/**
 * Update a member's role (Founder/Elder only).
 */
export async function updateMemberRole(schoolId, targetWallet, newRole) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_members")
    .update({ role: newRole })
    .eq("school_id", schoolId)
    .ilike("wallet_address", (targetWallet || "").toLowerCase());

  return { error };
}

/**
 * Remove a member from a school (Founder/Elder moderation).
 */
export async function removeMember(schoolId, targetWallet) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_members")
    .delete()
    .eq("school_id", schoolId)
    .ilike("wallet_address", (targetWallet || "").toLowerCase());

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL CHAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a chat message in a school.
 */
export async function sendSchoolMessage(schoolId, body) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const authorWallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("school_chat")
    .insert({
      school_id: schoolId,
      author_wallet: authorWallet,
      body,
    })
    .select(`
      *,
      profile:author_wallet (
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
 * Get chat messages for a school (paginated, newest last).
 */
export async function getSchoolMessages(schoolId, { limit = 50, before } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("school_chat")
    .select(`
      *,
      profile:author_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("school_id", schoolId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  // Reverse so oldest is first (chat order)
  return { data: (data || []).reverse(), error };
}

/**
 * Delete a chat message (soft delete — Elders/Founders moderation).
 */
export async function deleteSchoolMessage(messageId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_chat")
    .update({ is_deleted: true })
    .eq("id", messageId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL CHALLENGES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a challenge within a school.
 */
export async function createChallenge(schoolId, {
  title,
  description,
  challengeType,
  targetSpecies,
  startTime,
  endTime,
  rewardXp = 100,
  rewardBadge,
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const creatorWallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("school_challenges")
    .insert({
      school_id: schoolId,
      creator_wallet: creatorWallet,
      title,
      description: description || null,
      challenge_type: challengeType,
      target_species: targetSpecies || null,
      start_time: startTime,
      end_time: endTime,
      reward_xp: rewardXp,
      reward_badge: rewardBadge || null,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Get challenges for a school.
 */
export async function getSchoolChallenges(schoolId, { status } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  let query = supabase
    .from("school_challenges")
    .select("*")
    .eq("school_id", schoolId)
    .order("start_time", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Update challenge status or leaderboard.
 */
export async function updateChallenge(challengeId, updates) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_challenges")
    .update(updates)
    .eq("id", challengeId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL INVITES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invite a user to a school (Founder/Elder only).
 */
export async function inviteToSchool(schoolId, targetWallet) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  // Resolve both wallets to the casing stored in profiles so the
  // school_invites FKs (invited_wallet/invited_by -> profiles) are satisfied.
  const inviterWallet = await resolveProfileWallet(walletAddress);
  const inviteeWallet = await resolveProfileWallet(targetWallet);

  // Check if already invited or already a member
  const { data: existing } = await supabase
    .from("school_invites")
    .select("id, status")
    .eq("school_id", schoolId)
    .ilike("invited_wallet", (targetWallet || "").toLowerCase())
    .eq("status", "pending")
    .maybeSingle();

  if (existing) return { data: null, error: "User already has a pending invite" };

  const { data, error } = await supabase
    .from("school_invites")
    .insert({
      school_id: schoolId,
      invited_wallet: inviteeWallet,
      invited_by: inviterWallet,
      status: "pending",
    })
    .select()
    .single();

  if (error) console.warn("[Reef] inviteToSchool error:", error.message || error);
  return { data, error };
}

/**
 * Get pending invites for the current user.
 */
export async function getMySchoolInvites() {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("school_invites")
    .select(`
      *,
      school:school_id (
        id,
        name,
        slug,
        school_type,
        banner_url,
        member_count
      ),
      inviter:profiles!school_invites_invited_by_fkey (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .ilike("invited_wallet", walletAddress.toLowerCase())
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Fallback if FK hint syntax fails
  if (error && (error.message?.includes("relationship") || error.message?.includes("could not"))) {
    const { data: rawInvites } = await supabase
      .from("school_invites")
      .select("*")
      .ilike("invited_wallet", walletAddress.toLowerCase())
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!rawInvites?.length) return { data: [], error: null };

    // Batch fetch schools
    const schoolIds = [...new Set(rawInvites.map((i) => i.school_id).filter(Boolean))];
    const inviterWallets = [...new Set(rawInvites.map((i) => i.invited_by).filter(Boolean))];

    let schoolMap = {};
    if (schoolIds.length > 0) {
      const { data: schools } = await supabase
        .from("schools")
        .select("id, name, slug, school_type, banner_url, member_count")
        .in("id", schoolIds);
      for (const s of schools || []) schoolMap[s.id] = s;
    }

    let inviterMap = {};
    if (inviterWallets.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("wallet_address, display_name, avatar_url, companion_tier")
        .in("wallet_address", inviterWallets);
      for (const p of profiles || []) inviterMap[p.wallet_address] = p;
    }

    const enriched = rawInvites.map((inv) => ({
      ...inv,
      school: schoolMap[inv.school_id] || null,
      inviter: inviterMap[inv.invited_by] || null,
    }));

    return { data: enriched, error: null };
  }

  return { data: data || [], error };
}

/**
 * Get pending invites sent for a specific school (for Founder/Elder to see).
 */
export async function getSchoolPendingInvites(schoolId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("school_invites")
    .select(`
      *,
      invitee:profiles!school_invites_invited_wallet_fkey (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("school_id", schoolId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Fallback if FK hint fails
  if (error && (error.message?.includes("relationship") || error.message?.includes("could not"))) {
    const { data: rawInvites } = await supabase
      .from("school_invites")
      .select("*")
      .eq("school_id", schoolId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!rawInvites?.length) return { data: [], error: null };

    const invitedWallets = [...new Set(rawInvites.map((i) => i.invited_wallet).filter(Boolean))];
    let profileMap = {};
    if (invitedWallets.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("wallet_address, display_name, avatar_url, companion_tier")
        .in("wallet_address", invitedWallets);
      for (const p of profiles || []) profileMap[p.wallet_address] = p;
    }

    const enriched = rawInvites.map((inv) => ({
      ...inv,
      invitee: profileMap[inv.invited_wallet] || null,
    }));

    return { data: enriched, error: null };
  }

  return { data: data || [], error };
}

/**
 * Accept a school invite — adds user as member.
 */
export async function acceptSchoolInvite(inviteId, schoolId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  // Update invite status
  const { error: updateError } = await supabase
    .from("school_invites")
    .update({ status: "accepted" })
    .eq("id", inviteId);

  if (updateError) return { error: updateError };

  // Add as member
  const memberWallet = await resolveProfileWallet(walletAddress);
  const { error: memberError } = await supabase
    .from("school_members")
    .insert({
      school_id: schoolId,
      wallet_address: memberWallet,
      role: "member",
    });

  return { error: memberError };
}

/**
 * Decline a school invite.
 */
export async function declineSchoolInvite(inviteId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_invites")
    .update({ status: "declined" })
    .eq("id", inviteId);

  return { error };
}

/**
 * Cancel a pending invite (Founder/Elder action).
 */
export async function cancelSchoolInvite(inviteId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_invites")
    .delete()
    .eq("id", inviteId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL POSTS — the durable feed
//
// Distinct from school_chat. Chat is conversation: fast, ephemeral, read in
// order. Posts are the things worth keeping — a spawn report, an announcement, a
// question — so they support pinning, reactions and editing.
//
// The Feed tab was a "coming soon" placeholder AND the default tab, so every
// school opened onto an empty state.
// ─────────────────────────────────────────────────────────────────────────────

const POST_SELECT = `
  *,
  profile:author_wallet (
    wallet_address,
    display_name,
    avatar_url,
    companion_tier
  ),
  reactions:school_post_reactions (
    wallet_address,
    emoji
  )
`;

/**
 * Post to a school's feed.
 *
 * @param {string} schoolId
 * @param {{ body: string, imageUrl?: string|null }} content
 */
export async function createSchoolPost(schoolId, { body, imageUrl = null } = {}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  // Validated here as well as by the DB CHECK so the composer can say something
  // useful instead of surfacing a constraint violation.
  const trimmed = (body || "").trim();
  if (!trimmed) return { data: null, error: "Write something first." };
  if (trimmed.length > 2000) return { data: null, error: "Posts are limited to 2000 characters." };

  const authorWallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("school_posts")
    .insert({
      school_id: schoolId,
      author_wallet: authorWallet,
      body: trimmed,
      image_url: imageUrl || null,
    })
    .select(POST_SELECT)
    .single();

  return { data, error };
}

/**
 * Read a school's feed: pinned posts first, then newest.
 *
 * Soft-deleted posts are filtered here rather than by RLS so moderators can still
 * audit them directly if they ever need to.
 */
export async function getSchoolPosts(schoolId, { limit = 30 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("school_posts")
    .select(POST_SELECT)
    .eq("school_id", schoolId)
    .eq("is_deleted", false)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Edit your own post. RLS also allows admins here (for moderation), but the UI
 * only offers editing to the author.
 */
export async function updateSchoolPost(postId, { body }) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const trimmed = (body || "").trim();
  if (!trimmed) return { data: null, error: "Write something first." };
  if (trimmed.length > 2000) return { data: null, error: "Posts are limited to 2000 characters." };

  const { data, error } = await supabase
    .from("school_posts")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", postId)
    .select(POST_SELECT)
    .single();

  return { data, error };
}

/**
 * Soft-delete a post. Author or elder/founder, enforced by RLS.
 *
 * Soft, not hard: moderation should be reversible and leave a record of what was
 * removed. Mirrors school_chat.is_deleted.
 */
export async function deleteSchoolPost(postId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_posts")
    .update({ is_deleted: true })
    .eq("id", postId);

  return { error };
}

/**
 * Pin or unpin a post. Elders and founders only (enforced by RLS).
 *
 * pinned_at/pinned_by are constrained to travel together, so both are always
 * written as a pair.
 */
export async function setSchoolPostPinned(postId, pinned) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const patch = pinned
    ? { pinned_at: new Date().toISOString(), pinned_by: await resolveProfileWallet(walletAddress) }
    : { pinned_at: null, pinned_by: null };

  const { data, error } = await supabase
    .from("school_posts")
    .update(patch)
    .eq("id", postId)
    .select(POST_SELECT)
    .single();

  return { data, error };
}

/**
 * Toggle the current user's reaction on a post.
 *
 * One reaction per member per post, enforced by a UNIQUE constraint — without it
 * a "like" is just a counter anyone can inflate by clicking repeatedly. Reacting
 * with the same emoji removes it; a different emoji replaces it.
 */
export async function toggleSchoolPostReaction(postId, emoji = "🌊") {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const wallet = await resolveProfileWallet(walletAddress);

  const { data: existing, error: readError } = await supabase
    .from("school_post_reactions")
    .select("id, emoji")
    .eq("post_id", postId)
    .ilike("wallet_address", wallet.toLowerCase())
    .maybeSingle();

  if (readError) return { data: null, error: readError };

  // Same emoji again = un-react.
  if (existing && existing.emoji === emoji) {
    const { error } = await supabase
      .from("school_post_reactions")
      .delete()
      .eq("id", existing.id);
    return { data: { removed: true }, error };
  }

  // Different emoji = change it rather than stacking a second reaction.
  if (existing) {
    const { error } = await supabase
      .from("school_post_reactions")
      .update({ emoji })
      .eq("id", existing.id);
    return { data: { changed: true }, error };
  }

  const { error } = await supabase
    .from("school_post_reactions")
    .insert({ post_id: postId, wallet_address: wallet, emoji });

  return { data: { added: true }, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE LIFECYCLE — join, submit, vote, finalize
//
// createChallenge() wrote a row and that was the end of it. `status` never
// changed, `leaderboard` was never written, and there was no way to enter, score
// or win anything. ChallengesTab filters on status === 'completed', so that tab
// was permanently empty.
//
// The rules that decide who wins live in the database (triggers +
// finalize_school_challenge), not here. These functions surface those errors
// rather than duplicating the checks as the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

/** Enter a challenge. One row per member, enforced by a UNIQUE constraint. */
export async function joinChallenge(challengeId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("school_challenge_participants")
    .insert({
      challenge_id: challengeId,
      wallet_address: await resolveProfileWallet(walletAddress),
    })
    .select()
    .single();

  return { data, error };
}

/** Withdraw from a challenge. */
export async function leaveChallenge(challengeId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("school_challenge_participants")
    .delete()
    .eq("challenge_id", challengeId)
    .ilike("wallet_address", (await resolveProfileWallet(walletAddress)).toLowerCase());

  return { error };
}

/**
 * Everyone entered, with their score and rank once finalized.
 * Ordered by rank when scored, otherwise by who joined first.
 */
export async function getChallengeParticipants(challengeId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("school_challenge_participants")
    .select(`
      *,
      profile:wallet_address (
        wallet_address, display_name, avatar_url, companion_tier
      )
    `)
    .eq("challenge_id", challengeId)
    .order("rank", { ascending: true, nullsFirst: false })
    .order("joined_at", { ascending: true });

  return { data: data || [], error };
}

/**
 * Submit or update your entry.
 *
 * One entry per member (UNIQUE), so this upserts: without that, a photo contest
 * becomes "whoever uploads the most photos", which is not the contest.
 */
export async function submitChallengeEntry(challengeId, { body, imageUrl, declaredValue } = {}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const hasContent =
    (body && body.trim()) || imageUrl || (declaredValue !== null && declaredValue !== undefined && declaredValue !== "");
  if (!hasContent) return { data: null, error: "Add a photo, a measurement, or a note." };

  let value = null;
  if (declaredValue !== null && declaredValue !== undefined && declaredValue !== "") {
    value = Number(declaredValue);
    if (!Number.isFinite(value) || value < 0) {
      return { data: null, error: "Enter a measurement as a positive number." };
    }
  }

  const wallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("school_challenge_submissions")
    .upsert(
      {
        challenge_id: challengeId,
        wallet_address: wallet,
        body: (body || "").trim() || null,
        image_url: imageUrl || null,
        declared_value: value,
        edited_at: new Date().toISOString(),
      },
      { onConflict: "challenge_id,wallet_address" }
    )
    .select()
    .single();

  return { data, error };
}

/** All live entries for a challenge, with vote counts. */
export async function getChallengeSubmissions(challengeId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("school_challenge_submissions")
    .select(`
      *,
      profile:wallet_address (
        wallet_address, display_name, avatar_url, companion_tier
      ),
      votes:school_challenge_votes (
        voter_wallet
      )
    `)
    .eq("challenge_id", challengeId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  return { data: data || [], error };
}

/** Withdraw your entry (soft delete, so its votes stay auditable). */
export async function withdrawChallengeEntry(submissionId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_challenge_submissions")
    .update({ is_deleted: true })
    .eq("id", submissionId);

  return { error };
}

/**
 * Cast or move your single vote.
 *
 * One vote per member per challenge (UNIQUE), you cannot vote for your own entry,
 * and voting closes when results are locked — all enforced by
 * enforce_challenge_vote. Voting the same entry again retracts it; voting a
 * different entry moves the vote rather than adding a second.
 */
export async function voteForChallengeEntry(challengeId, submissionId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const voter = await resolveProfileWallet(walletAddress);

  const { data: existing, error: readError } = await supabase
    .from("school_challenge_votes")
    .select("id, submission_id")
    .eq("challenge_id", challengeId)
    .ilike("voter_wallet", voter.toLowerCase())
    .maybeSingle();

  if (readError) return { data: null, error: readError };

  if (existing?.submission_id === submissionId) {
    const { error } = await supabase.from("school_challenge_votes").delete().eq("id", existing.id);
    return { data: { removed: true }, error };
  }

  if (existing) {
    const { error } = await supabase
      .from("school_challenge_votes")
      .update({ submission_id: submissionId })
      .eq("id", existing.id);
    return { data: { moved: true }, error };
  }

  const { error } = await supabase
    .from("school_challenge_votes")
    .insert({ challenge_id: challengeId, submission_id: submissionId, voter_wallet: voter });

  return { data: { added: true }, error };
}

/**
 * Score and close a challenge. Founders and elders only.
 *
 * Everything happens inside finalize_school_challenge: it scores every
 * participant according to the challenge type, ranks them (ties share a rank),
 * writes the leaderboard, and stamps finalized_at. It refuses to run on a
 * challenge that is still going, or one already finalized — rescoring after the
 * fact would invalidate a reward someone has already claimed.
 */
export async function finalizeChallenge(challengeId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase.rpc("finalize_school_challenge", {
    target_challenge: challengeId,
    actor_wallet: await resolveProfileWallet(walletAddress),
  });

  return { data, error };
}

/** Cancel a challenge. Founders and elders only (RLS on school_challenges). */
export async function cancelChallenge(challengeId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("school_challenges")
    .update({ cancelled_at: new Date().toISOString(), status: "cancelled" })
    .eq("id", challengeId);

  return { error };
}

/**
 * Claim the reward XP for a finished challenge, once.
 *
 * XP is applied on the client, so the claim has to be atomic here or a refresh
 * pays out again. Filtering the UPDATE on `xp_claimed_at IS NULL` means whichever
 * request flips it gets a row back and every retry gets none — the same pattern
 * as the tide check-in claim.
 *
 * @returns {{ data: { claimed: boolean, rank: number|null }, error: any }}
 */
export async function claimChallengeReward(challengeId) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const wallet = await resolveProfileWallet(walletAddress);

  const { data, error } = await supabase
    .from("school_challenge_participants")
    .update({ xp_claimed_at: new Date().toISOString() })
    .eq("challenge_id", challengeId)
    .ilike("wallet_address", wallet.toLowerCase())
    .is("xp_claimed_at", null)
    .not("scored_at", "is", null)   // only after the challenge has been scored
    .select("rank, score");

  if (error) return { data: null, error };

  const row = data?.[0];
  return { data: { claimed: !!row, rank: row?.rank ?? null }, error: null };
}
