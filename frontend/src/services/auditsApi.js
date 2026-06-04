/**
 * auditsApi.js
 * 
 * CRUD operations for Expert Audits and Mentorship in The Reef Phase 2.
 * Tables: expert_audits, audit_requests, mentorships
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// EXPERT AUDITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Expert Audit (scorecard submission).
 */
export async function createAudit({
  recipientWallet,
  targetTankId,
  targetCurrentId,
  waterQualityScore,
  stockingScore,
  husbandryScore,
  aestheticsScore,
  commentary,
  photos = [],
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("expert_audits")
    .insert({
      auditor_wallet: walletAddress,
      recipient_wallet: recipientWallet,
      target_tank_id: targetTankId || null,
      target_current_id: targetCurrentId || null,
      water_quality_score: waterQualityScore,
      stocking_score: stockingScore,
      husbandry_score: husbandryScore,
      aesthetics_score: aestheticsScore,
      commentary: commentary || null,
      photos,
    })
    .select(`
      *,
      auditor:auditor_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      ),
      recipient:recipient_wallet (
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
 * Get audits received by a user.
 */
export async function getAuditsForUser(walletAddress, { limit = 10 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("expert_audits")
    .select(`
      *,
      auditor:auditor_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("recipient_wallet", walletAddress)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Get audits given by a user.
 */
export async function getAuditsByAuditor(walletAddress, { limit = 10 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("expert_audits")
    .select(`
      *,
      recipient:recipient_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("auditor_wallet", walletAddress)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Get audits for a specific Current.
 */
export async function getAuditsForCurrent(currentId) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("expert_audits")
    .select(`
      *,
      auditor:auditor_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      )
    `)
    .eq("target_current_id", currentId)
    .order("created_at", { ascending: false });

  return { data: data || [], error };
}

/**
 * Mark audit XP as awarded (prevents double-awarding).
 */
export async function markAuditXpAwarded(auditId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("expert_audits")
    .update({ xp_awarded: true })
    .eq("id", auditId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request an Expert Audit on a Current.
 */
export async function requestAudit({
  targetCurrentId,
  targetAuditorWallet = null,
  message = "",
}) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("audit_requests")
    .insert({
      requester_wallet: walletAddress,
      target_current_id: targetCurrentId,
      target_auditor_wallet: targetAuditorWallet,
      message: message || null,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Get open audit requests (for auditor queue in Sonar).
 */
export async function getAuditRequests({ forAuditor = false, limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const walletAddress = getCurrentWallet();

  let query = supabase
    .from("audit_requests")
    .select(`
      *,
      requester:requester_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier
      ),
      current:target_current_id (
        id,
        title,
        body,
        media_urls,
        linked_tank_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (forAuditor && walletAddress) {
    // Show requests targeted at this auditor + open public ones
    query = query.or(`target_auditor_wallet.eq.${walletAddress},target_auditor_wallet.is.null`)
      .eq("status", "open");
  } else {
    query = query.eq("status", "open");
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Claim an audit request (auditor starts working on it).
 */
export async function claimAuditRequest(requestId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("audit_requests")
    .update({
      status: "claimed",
      claimed_by_wallet: walletAddress,
    })
    .eq("id", requestId);

  return { error };
}

/**
 * Complete an audit request (after audit is submitted).
 */
export async function completeAuditRequest(requestId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("audit_requests")
    .update({ status: "completed" })
    .eq("id", requestId);

  return { error };
}

/**
 * Cancel an audit request (requester only).
 */
export async function cancelAuditRequest(requestId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("audit_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId);

  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────
// MENTORSHIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request mentorship from a Master+ tier breeder.
 */
export async function requestMentorship(mentorWallet, message = "") {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("mentorships")
    .insert({
      mentor_wallet: mentorWallet,
      mentee_wallet: walletAddress,
      message: message || null,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Accept a mentorship request (mentor action).
 */
export async function acceptMentorship(mentorshipId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("mentorships")
    .update({ status: "active" })
    .eq("id", mentorshipId);

  return { error };
}

/**
 * End a mentorship (either party).
 */
export async function endMentorship(mentorshipId) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const { error } = await supabase
    .from("mentorships")
    .update({ status: "ended" })
    .eq("id", mentorshipId);

  return { error };
}

/**
 * Get active mentorships for a user (as mentor or mentee).
 */
export async function getMentorships(walletAddress) {
  if (!isSupabaseConfigured()) return { data: { asMentor: [], asMentee: [] }, error: "Not configured" };

  // As mentor
  const { data: asMentor, error: mentorError } = await supabase
    .from("mentorships")
    .select(`
      *,
      mentee:mentee_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier,
        xp_total
      )
    `)
    .eq("mentor_wallet", walletAddress)
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  // As mentee
  const { data: asMentee, error: menteeError } = await supabase
    .from("mentorships")
    .select(`
      *,
      mentor:mentor_wallet (
        wallet_address,
        display_name,
        avatar_url,
        companion_tier,
        xp_total
      )
    `)
    .eq("mentee_wallet", walletAddress)
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  return {
    data: {
      asMentor: asMentor || [],
      asMentee: asMentee || [],
    },
    error: mentorError || menteeError,
  };
}

/**
 * Toggle accepting_mentees flag on profile.
 */
export async function toggleAcceptingMentees(accepting) {
  if (!isSupabaseConfigured()) return { error: "Not configured" };

  const walletAddress = getCurrentWallet();
  if (!walletAddress) return { error: "Not connected" };

  const { error } = await supabase
    .from("profiles")
    .update({ accepting_mentees: accepting })
    .eq("wallet_address", walletAddress);

  return { error };
}

/**
 * Get available mentors (Master+ tier, accepting mentees).
 */
export async function getAvailableMentors({ limit = 20 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url, companion_tier, xp_total, bio")
    .eq("accepting_mentees", true)
    .in("companion_tier", ["Master", "God-Tier"])
    .order("xp_total", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}
