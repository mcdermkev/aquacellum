/**
 * gdprService.js
 * 
 * GDPR data export and account deletion for The Reef social layer.
 * 
 * - Export: Gathers all user social data into a downloadable JSON file
 * - Delete: Soft-deletes the account (30-day grace period) then anonymizes
 * 
 * Privacy rights: right to data portability, right to erasure.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

/**
 * Export all social data for the current user as a JSON blob.
 * Includes: profile, posts, comments, reactions, follows, notifications, insights, audit history.
 */
export async function exportUserData() {
  if (!isSupabaseConfigured()) return { data: null, error: "Supabase not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { data: null, error: "Not connected" };

  try {
    // Fetch all user data in parallel
    const [
      profileResult,
      currentsResult,
      commentsResult,
      reactionsResult,
      followsResult,
      followersResult,
      notificationsResult,
      requestsSentResult,
      requestsReceivedResult,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("wallet_address", wallet).single(),
      supabase.from("currents").select("*").eq("author_wallet", wallet).order("created_at", { ascending: false }),
      supabase.from("comments").select("*").eq("author_wallet", wallet).order("created_at", { ascending: false }),
      supabase.from("reactions").select("*").eq("user_wallet", wallet),
      supabase.from("follows").select("*").eq("follower_wallet", wallet),
      supabase.from("follows").select("*").eq("target_wallet", wallet),
      supabase.from("sonar_notifications").select("*").eq("recipient_wallet", wallet).order("created_at", { ascending: false }).limit(500),
      supabase.from("connection_requests").select("*").eq("from_wallet", wallet),
      supabase.from("connection_requests").select("*").eq("to_wallet", wallet),
    ]);

    // Also try fetching insights and audits if tables exist
    let insightsData = [];
    let auditsGivenData = [];
    let auditsReceivedData = [];

    try {
      const { data } = await supabase.from("species_insights").select("*").eq("author_wallet", wallet);
      insightsData = data || [];
    } catch { /* table may not exist */ }

    try {
      const { data } = await supabase.from("expert_audits").select("*").eq("auditor_wallet", wallet);
      auditsGivenData = data || [];
    } catch { /* table may not exist */ }

    try {
      const { data } = await supabase.from("expert_audits").select("*").eq("recipient_wallet", wallet);
      auditsReceivedData = data || [];
    } catch { /* table may not exist */ }

    const exportData = {
      export_date: new Date().toISOString(),
      wallet_address: wallet,
      profile: profileResult.data || null,
      currents: currentsResult.data || [],
      comments: commentsResult.data || [],
      reactions: reactionsResult.data || [],
      follows: followsResult.data || [],
      followers: followersResult.data || [],
      notifications: notificationsResult.data || [],
      connection_requests_sent: requestsSentResult.data || [],
      connection_requests_received: requestsReceivedResult.data || [],
      species_insights: insightsData,
      expert_audits_given: auditsGivenData,
      expert_audits_received: auditsReceivedData,
      _meta: {
        format: "aquacellum-reef-export-v1",
        tables_included: [
          "profiles", "currents", "comments", "reactions", "follows",
          "sonar_notifications", "connection_requests", "species_insights", "expert_audits",
        ],
        note: "This file contains all your social data from Aquacellum's Reef platform.",
      },
    };

    return { data: exportData, error: null };
  } catch (err) {
    return { data: null, error: err.message || "Export failed" };
  }
}

/**
 * Trigger a JSON download in the browser.
 */
export function downloadAsJson(data, filename = "aquacellum-data-export.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Request account deletion (soft-delete with 30-day grace period).
 * Sets profile.deletion_requested_at — a cron job handles permanent deletion after 30 days.
 * 
 * During grace period:
 * - Profile hidden from discovery
 * - Content hidden from feeds
 * - User can cancel deletion by logging in and clicking "Cancel Deletion"
 * 
 * After 30 days:
 * - Comments/reactions anonymized (author_wallet → "[deleted]")
 * - Profile, currents, follows, notifications permanently deleted
 * - Media files queued for R2/Storage removal
 */
export async function requestAccountDeletion(confirmationText) {
  if (!isSupabaseConfigured()) return { error: "Supabase not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { error: "Not connected" };

  // Require explicit confirmation
  if (confirmationText !== "DELETE MY ACCOUNT") {
    return { error: "Please type 'DELETE MY ACCOUNT' to confirm." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      deletion_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("wallet_address", wallet);

  return { error: error?.message || null };
}

/**
 * Cancel a pending account deletion (during the 30-day grace period).
 */
export async function cancelAccountDeletion() {
  if (!isSupabaseConfigured()) return { error: "Supabase not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { error: "Not connected" };

  const { error } = await supabase
    .from("profiles")
    .update({
      deletion_requested_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet_address", wallet);

  return { error: error?.message || null };
}

/**
 * Check if the current user has a pending deletion request.
 */
export async function getDeletionStatus() {
  if (!isSupabaseConfigured()) return { pending: false, deletionDate: null };

  const wallet = getCurrentWallet();
  if (!wallet) return { pending: false, deletionDate: null };

  const { data } = await supabase
    .from("profiles")
    .select("deletion_requested_at")
    .eq("wallet_address", wallet)
    .single();

  if (!data?.deletion_requested_at) {
    return { pending: false, deletionDate: null };
  }

  const requestedAt = new Date(data.deletion_requested_at);
  const deletionDate = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    pending: true,
    requestedAt: data.deletion_requested_at,
    deletionDate: deletionDate.toISOString(),
    daysRemaining: Math.max(0, Math.ceil((deletionDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
  };
}
