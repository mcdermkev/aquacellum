/**
 * morphSubmissionsApi.js
 *
 * CRUD for breeder morph submissions (Supabase-backed). Mirrors the service
 * style used across the app (auditsApi.js, breederRegistry.js): every function
 * guards `isSupabaseConfigured()` + `getCurrentWallet()` and returns
 * `{ data, error }` rather than throwing.
 *
 * Reads + inserts are client-side via the shared `supabase` client. Status
 * flips (pending → verified/rejected) are privileged and go through the
 * service-role route `/api/update-morph-status`, which verifies the caller is
 * the on-chain curator — RLS can't express that because "curator" has no
 * Supabase JWT claim.
 *
 * Table: morph_submissions (see supabase/migrations/20260628_morph_submissions.sql)
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

/**
 * Submit a new morph for curator verification.
 */
export async function createMorphSubmission({ baseSpecies, morphName, traitType, description, proofUrl }) {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };

  const wallet = getCurrentWallet();
  if (!wallet) return { data: null, error: "Not connected" };

  const { data, error } = await supabase
    .from("morph_submissions")
    .insert({
      submitter_wallet: wallet,
      base_species: baseSpecies,
      morph_name: morphName,
      trait_type: traitType,
      description: description || null,
      proof_url: proofUrl || null,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * List the submissions made by a given wallet (defaults to the connected one).
 */
export async function getMyMorphSubmissions(walletAddress) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = (walletAddress || getCurrentWallet() || "").toLowerCase();
  if (!wallet) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("morph_submissions")
    .select("*")
    .eq("submitter_wallet", wallet)
    .order("created_at", { ascending: false });

  return { data: data || [], error };
}

/**
 * List the whole queue (for the curator review panel).
 */
export async function getAllMorphSubmissions({ limit = 200 } = {}) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const { data, error } = await supabase
    .from("morph_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

/**
 * Curator review: flip a submission's status. Routed through the service-role
 * endpoint, which re-checks that `callerWallet` is the on-chain curator before
 * writing. The UI should still gate visibility with the same curator check.
 */
export async function reviewMorphSubmission({ id, status, callerWallet, note }) {
  try {
    const res = await fetch("/api/validate-xp?action=review-morph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, callerWallet, note }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: null, error: body.error || `Request failed (${res.status})` };
    }
    return { data: body.data, error: null };
  } catch (err) {
    return { data: null, error: err.message || "Network error" };
  }
}
