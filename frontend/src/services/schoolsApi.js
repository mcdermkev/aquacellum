/**
 * schoolsApi.js
 * 
 * CRUD operations for Schools (Clubs) in The Reef Phase 2.
 * Tables: schools, school_members, school_challenges, school_chat
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

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

  // Create the school
  const { data: school, error: schoolError } = await supabase
    .from("schools")
    .insert({
      name,
      slug,
      description: description || null,
      banner_url: bannerUrl || null,
      school_type: schoolType,
      founder_wallet: walletAddress,
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
      wallet_address: walletAddress,
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
    .eq("wallet_address", walletAddress)
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

  const { error } = await supabase
    .from("school_members")
    .insert({
      school_id: schoolId,
      wallet_address: walletAddress,
      role: "member",
    });

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
    .eq("wallet_address", walletAddress);

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
    .eq("wallet_address", walletAddress)
    .single();

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
    .eq("wallet_address", targetWallet);

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
    .eq("wallet_address", targetWallet);

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

  const { data, error } = await supabase
    .from("school_chat")
    .insert({
      school_id: schoolId,
      author_wallet: walletAddress,
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

  const { data, error } = await supabase
    .from("school_challenges")
    .insert({
      school_id: schoolId,
      creator_wallet: walletAddress,
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
