/**
 * gdprService.js
 * 
 * GDPR data export and account deletion for The Reef social layer.
 * 
 * - Export: Gathers all user social data into a downloadable JSON file
 * - Delete: records a deletion request; 30 days later the daily purge job
 *   (/api/retention?action=purge-deletions, api/_lib/accountPurge.js) removes
 *   the account's personal data and keeps the records listed in DELETION_KEPT.
 * 
 * Privacy rights: right to data portability, right to erasure.
 */

import {
  supabase,
  getCurrentWallet,
  isSupabaseConfigured,
  isFullyAuthenticated,
  waitForReefSession,
} from "./supabaseClient";
import { fetchMyPrivateProfile } from "./profileColumns";

/** Days between the request and the purge. Must match api/_lib/accountPurge.js. */
export const DELETION_GRACE_DAYS = 30;

/** The exact confirmation phrase the user must type. */
export const DELETION_CONFIRM_PHRASE = "DELETE MY ACCOUNT";

/**
 * What the purge removes, in plain words. Mirrors PURGE_PLAN in
 * api/_lib/accountPurge.js; accountPurge.test.js pins the two together.
 */
export const DELETION_REMOVED = Object.freeze([
  "Your profile details: name, photo, bio, email, notification and privacy settings",
  "Your synced tanks, livestock, care logs, spawns and grow-out records",
  "Reef posts, comments, reactions, species insights, follows and tankmate requests",
  "Direct messages you sent and conversations you are part of",
  "Club and event activity: memberships, posts, chat, challenge entries and votes",
  "Notifications, push subscriptions, XP and depth score history, Echo companion data",
  "Your storefront page, store sections, pickup spots, parcel presets and ship-from address",
  "Saved payment method reference, carts and order watchlist",
  "Photos you uploaded for Reef posts, specimens and certificates",
  "Fish Room showcase pages, if you have one: removed by our team by hand, and the account closes once that is done",
]);

/** What the purge keeps, and why. */
export const DELETION_KEPT = Object.freeze([
  "Orders, payments, refunds, payouts, shipping labels and auction results, including the email on an order, because we need them for accounting, tax and disputes",
  "Your marketplace listings, switched off so nobody can buy them",
  "Offers you made or received. Any that are still open are withdrawn or declined, so the other person sees they are closed",
  "Your auction lots and bids. Lots with no bids are cancelled. If a lot you sell has bids, you hold the high bid on an open lot, a lot you won or sold is not yet paid and handed over, or you host a club or event auction that is still open, we wait for it to finish and close the account at the next daily check after that",
  "Moderation reports and any account restrictions",
  "Reward credit records",
  "Species catalog suggestions and morph submissions you contributed",
  "Your wallet address, on the records above and on a closed-account marker",
]);

/**
 * Map a Supabase RPC error to a message a person can act on.
 */
function deletionErrorMessage(error) {
  if (!error) return null;
  if (error.code === "PGRST202") {
    return "Account deletion is not available yet. Please try again later or contact support.";
  }
  if (error.code === "42501") return "Please sign in again to manage your account.";
  if (error.code === "P0002") return "We could not find a profile for this account.";
  return error.message || "Something went wrong. Please try again.";
}

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
      // Own full row (private columns included) via my_profile_private(); a
      // direct select("*") on profiles is refused since the column lockdown.
      fetchMyPrivateProfile(),
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
 * Turn the RPC status payload into what the UI renders.
 */
function toDeletionStatus(payload) {
  if (!payload?.pending || !payload.requested_at) {
    return { pending: false, deletionDate: null };
  }
  const requestedAt = new Date(payload.requested_at);
  const deletionDate = payload.purge_after
    ? new Date(payload.purge_after)
    : new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  return {
    pending: true,
    requestedAt: payload.requested_at,
    deletionDate: deletionDate.toISOString(),
    daysRemaining: Math.max(0, Math.ceil((deletionDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
  };
}

/**
 * Request account deletion.
 *
 * Calls request_account_deletion() (20261003_account_deletion.sql), which sets
 * profiles.deletion_requested_at for the wallet in the signed session. Nothing
 * is hidden or removed during the grace period; the account keeps working and
 * the request can be cancelled. After DELETION_GRACE_DAYS the daily purge job
 * removes everything in DELETION_REMOVED and keeps DELETION_KEPT.
 *
 * Repeating the request keeps the original date.
 *
 * @returns {Promise<{ error: string|null, status?: object }>}
 */
export async function requestAccountDeletion(confirmationText) {
  if (!isSupabaseConfigured()) return { error: "Supabase not configured" };
  if (!getCurrentWallet()) return { error: "Not connected" };

  if (confirmationText !== DELETION_CONFIRM_PHRASE) {
    return { error: `Please type '${DELETION_CONFIRM_PHRASE}' to confirm.` };
  }
  if (!isFullyAuthenticated()) {
    return { error: "Please sign in again to manage your account." };
  }

  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) return { error: deletionErrorMessage(error) };
  return { error: null, status: toDeletionStatus(data) };
}

/**
 * Cancel a pending account deletion (any time before the purge runs).
 */
export async function cancelAccountDeletion() {
  if (!isSupabaseConfigured()) return { error: "Supabase not configured" };
  if (!getCurrentWallet()) return { error: "Not connected" };
  if (!isFullyAuthenticated()) {
    return { error: "Please sign in again to manage your account." };
  }

  const { error } = await supabase.rpc("cancel_account_deletion");
  return { error: deletionErrorMessage(error) };
}

/**
 * Check if the current user has a pending deletion request.
 *
 * @returns {Promise<{ pending: boolean, deletionDate: string|null,
 *   requestedAt?: string, daysRemaining?: number, error?: string }>}
 */
export async function getDeletionStatus() {
  if (!isSupabaseConfigured()) return { pending: false, deletionDate: null };
  if (!getCurrentWallet()) return { pending: false, deletionDate: null };
  // Settings mounts this on first render, which can beat the JWT bridge on a
  // slow connection. The status RPC needs the signed session, so wait for it
  // rather than reporting "no deletion scheduled" when one is.
  await waitForReefSession({ timeoutMs: 8000 });
  if (!isFullyAuthenticated()) {
    return { pending: false, deletionDate: null, error: "Please sign in again to manage your account." };
  }

  const { data, error } = await supabase.rpc("my_account_deletion_status");
  if (error) return { pending: false, deletionDate: null, error: deletionErrorMessage(error) };
  return toDeletionStatus(data);
}
