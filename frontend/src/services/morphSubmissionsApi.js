/**
 * morphSubmissionsApi.js
 *
 * CRUD for breeder morph submissions (Supabase-backed). Mirrors the service
 * style used across the app (auditsApi.js, breederRegistry.js): every function
 * guards `isSupabaseConfigured()` + `getCurrentWallet()` and returns
 * `{ data, error }` rather than throwing.
 *
 * Reads + inserts are client-side via the shared `supabase` client. Status
 * flips (verify/reject) and promotion to a sub-species are privileged and go
 * through the service-role routes `/api/validate-xp?action=review-morph` and
 * `?action=promote-morph`, which verify the caller holds a curation role
 * (founder/curator) via a Privy token — RLS can't express that because those
 * roles have no Supabase JWT claim.
 *
 * Table: morph_submissions (see supabase/migrations/20260628_morph_submissions.sql)
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

// ── Auth bridge ──────────────────────────────────────────────────────────────
// review/promote/notify hit privileged server routes that derive the acting
// wallet from a Privy token, never from the body. Same `setSessionTokenGetter`
// pattern as speciesCurationApi.js / reviewsApi.js, registered in AuthContext.
let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    console.warn("[MorphSubmissions] Could not resolve session token:", err.message);
    return null;
  }
}

async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

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
export async function reviewMorphSubmission({ id, status, note }) {
  try {
    const res = await fetch("/api/validate-xp?action=review-morph", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ id, status, note }),
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

/**
 * Curator promote: turn a verified morph into an on-chain sub-species/strain.
 * Server-role endpoint re-verifies the caller is a curator (founder/curator
 * role via Privy), that the row is 'verified', resolves the base species,
 * signs addSpecies with the curator key, and records the off-chain parent link.
 */
export async function promoteMorphSubmission({ id }) {
  try {
    const res = await fetch("/api/validate-xp?action=promote-morph", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: null, error: body.error || `Request failed (${res.status})` };
    }
    return { data: body, error: null };
  } catch (err) {
    return { data: null, error: err.message || "Network error" };
  }
}

/**
 * Best-effort: ask the server to email the curators that a new morph is queued.
 * The in-app bell is fired by a DB trigger regardless; this only adds email and
 * must never block or fail the submission flow.
 */
export async function notifyMorphSubmitted(id) {
  try {
    await fetch("/api/validate-xp?action=notify-morph", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ id }),
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Get count of submissions with status updates since the user last viewed the
 * Morphs tab. Uses localStorage timestamp to determine "unseen" reviews.
 */
const MORPH_LAST_SEEN_KEY = "aquadex_morph_last_seen";

export function markMorphsViewed() {
  localStorage.setItem(MORPH_LAST_SEEN_KEY, new Date().toISOString());
}

export function getMorphLastSeenTime() {
  const raw = localStorage.getItem(MORPH_LAST_SEEN_KEY);
  return raw ? new Date(raw) : null;
}

export async function getUnseenMorphUpdates(walletAddress) {
  if (!isSupabaseConfigured()) return { count: 0, error: "Not configured" };

  const wallet = (walletAddress || getCurrentWallet() || "").toLowerCase();
  if (!wallet) return { count: 0, error: "Not connected" };

  const lastSeen = getMorphLastSeenTime();

  const { data, error } = await supabase
    .from("morph_submissions")
    .select("id, status, reviewed_at")
    .eq("submitter_wallet", wallet)
    .neq("status", "pending");

  if (error) return { count: 0, error };

  // If user has never viewed the tab, all non-pending submissions are "unseen"
  const unseen = lastSeen
    ? (data || []).filter((m) => m.reviewed_at && new Date(m.reviewed_at) > lastSeen)
    : (data || []).filter((m) => m.reviewed_at);

  return { count: unseen.length, error: null };
}
