/**
 * Vercel Serverless Function: /api/ensure-profile
 *
 * Creates or retrieves a user profile using the service role key (bypasses RLS).
 * This is a best-effort fallback: the browser normally creates profiles directly
 * via the anon key (dev RLS bypass policies allow it). This endpoint is only hit
 * if the direct insert fails.
 *
 * POST body: { walletAddress, initialData? }
 * Returns: { data: profile } | { error: string }
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the Vercel environment. If those
 * are missing, the function returns 503 (instead of crashing at module load, which
 * would surface as an opaque 500).
 */

import { createClient } from "@supabase/supabase-js";
import { handleCorsPreFlight } from "./_lib/cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// Lazily construct the client so a missing env var yields a clean 503 rather than
// throwing at module load (which Vercel reports as a generic 500 with no body).
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _supabase;
}

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error("[ensure-profile] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Vercel env");
    return res.status(503).json({ error: "Profile service not configured (missing Supabase env vars)" });
  }

  const { walletAddress, initialData = {} } = req.body || {};

  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  const normalizedWallet = walletAddress.toLowerCase();

  try {
    // 1. Check if profile exists (exact lowercase match)
    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("wallet_address", normalizedWallet)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ data: existing });
    }

    // 2. Case-insensitive fallback for legacy rows with checksum casing
    const { data: legacyRow } = await supabase
      .from("profiles")
      .select("*")
      .ilike("wallet_address", normalizedWallet)
      .maybeSingle();

    if (legacyRow) {
      // Return the existing (checksum-cased) row as-is. We intentionally do NOT
      // rewrite wallet_address to lowercase because it is a primary key referenced
      // by foreign keys without ON UPDATE CASCADE.
      return res.status(200).json({ data: legacyRow });
    }

    // 3. Create new profile (service role bypasses RLS)
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({
        wallet_address: normalizedWallet,
        display_name: initialData.display_name || null,
        tank_count: initialData.tank_count || 0,
        species_count: initialData.species_count || 0,
        xp_total: initialData.xp_total || 0,
        companion_tier: initialData.companion_tier || "Shallow",
        onboarding_complete: initialData.onboarding_complete ?? false,
      })
      .select()
      .single();

    if (createError) {
      console.error("[ensure-profile] Insert failed:", createError);
      return res.status(500).json({ error: createError.message });
    }

    return res.status(200).json({ data: created });
  } catch (err) {
    console.error("[ensure-profile] Unexpected error:", err);
    return res.status(500).json({ error: err.message });
  }
}
