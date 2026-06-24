/**
 * Vercel Serverless Function: /api/validate-xp
 *
 * Server-side XP validation — the authority for all XP claims.
 *
 * Flow:
 *   1. Client awards XP locally (instant UX feedback)
 *   2. Client calls this endpoint with the XP claim
 *   3. Server verifies Privy token, extracts wallet address
 *   4. Server validates: action type, cooldowns, daily limits, multipliers
 *   5. If valid → inserts into xp_events, returns confirmed points
 *   6. If rejected → returns { valid: false, reason } — client rolls back
 *
 * This replaces the fire-and-forget logXpEvent() pattern with a
 * server-authoritative validation loop.
 *
 * POST body:
 *   {
 *     actionType: string,       // XP_ACTIONS key (e.g. "LOG_FEEDING")
 *     pointsAwarded: number,    // base points claimed
 *     multiplier: number,       // claimed multiplier (1.0, 1.5, 2.0)
 *     metadata: { tankId?, challengeId?, eventId? }
 *   }
 *
 * Headers: Authorization: Bearer <privy-access-token>
 *
 * Returns:
 *   200: { valid: true, finalPoints, multiplierApplied, xpEventId, serverTotal }
 *   403: { valid: false, reason: "..." }
 *   400/401/429: { error: "..." }
 */

import { createClient } from "@supabase/supabase-js";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";
import { handleCorsPreFlight } from "./_lib/cors.js";
import { checkRateLimit } from "./_lib/rateLimiter.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// ─────────────────────────────────────────────────────────────────────────────
// Action Definitions (server-side source of truth, mirrors xp.js XP_ACTIONS)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ACTIONS = {
  // Care & Husbandry
  LOG_FEEDING:          { points: 5,   cooldownMs: 86400000,  perTank: true,  dailyMax: null },
  LOG_WATER:            { points: 10,  cooldownMs: 172800000, perTank: true,  dailyMax: null },
  LOG_PARAMETERS:       { points: 8,   cooldownMs: 172800000, perTank: true,  dailyMax: null },
  PHOTO_OBSERVATION:    { points: 12,  cooldownMs: null,      perTank: false, dailyMax: 3 },
  REGISTER_TANK:        { points: 25,  cooldownMs: null,      perTank: false, dailyMax: null },
  ADD_SPECIES:          { points: 15,  cooldownMs: null,      perTank: false, dailyMax: null },

  // Marketplace
  VERIFIED_PICKUP_BUYER:  { points: 25, cooldownMs: null, perTank: false, dailyMax: null },
  VERIFIED_PICKUP_SELLER: { points: 25, cooldownMs: null, perTank: false, dailyMax: null },
  LIST_DIRECTORY:         { points: 30, cooldownMs: null, perTank: false, dailyMax: null },
  COMPLETED_SALE:         { points: 40, cooldownMs: null, perTank: false, dailyMax: null },
  CLAIM_EXCHANGE:         { points: 20, cooldownMs: null, perTank: false, dailyMax: null },

  // Breeding & Operational
  MINT_SPECIMEN:        { points: 50,  cooldownMs: null, perTank: false, dailyMax: null },
  SPAWN_BREED:          { points: 150, cooldownMs: null, perTank: false, dailyMax: null },
  BATCH_SHIPPING:       { points: 35,  cooldownMs: null, perTank: false, dailyMax: null },
  AUDIT_GIVEN:          { points: 60,  cooldownMs: null, perTank: false, dailyMax: null },
  AUDIT_RECEIVED:       { points: 20,  cooldownMs: null, perTank: false, dailyMax: null },

  // Arrival Flow
  ARRIVAL_CONFIRMED:       { points: 25, cooldownMs: null, perTank: false, dailyMax: null },
  BATCH_ARRIVAL_CONFIRMED: { points: 15, cooldownMs: null, perTank: false, dailyMax: null },

  // Community & Social
  POST_CURRENT:         { points: 10, cooldownMs: null, perTank: false, dailyMax: 2 },
  PUBLISH_INSIGHT:      { points: 20, cooldownMs: null, perTank: false, dailyMax: null },
  ENGAGEMENT_BONUS:     { points: 8,  cooldownMs: null, perTank: false, dailyMax: null },
  JOIN_SCHOOL:          { points: 15, cooldownMs: null, perTank: false, dailyMax: null },
  MENTORED_USER:        { points: 40, cooldownMs: null, perTank: false, dailyMax: null },
};

// Care actions eligible for streak bonus
const CARE_ACTIONS = ["LOG_FEEDING", "LOG_WATER", "LOG_PARAMETERS", "PHOTO_OBSERVATION"];

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _supabase;
}

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Rate limit (100 XP claims/hr per user — generous but prevents scripts) ──
  const { verified, userId, walletAddress: tokenWallet, error: authError } = await verifyPrivyToken(req);

  if (!verified) {
    return res.status(401).json({ error: authError || "Authentication failed" });
  }

  const rateLimitKey = `xp:${userId}`;
  const { allowed, remaining, resetIn } = checkRateLimit(rateLimitKey, { maxRequests: 100, windowMs: 3600000 });

  if (!allowed) {
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("Retry-After", String(resetIn));
    return res.status(429).json({ error: "Rate limit exceeded", retryAfter: resetIn });
  }
  res.setHeader("X-RateLimit-Remaining", String(remaining));

  // ── Parse request body ──────────────────────────────────────────────────────
  const { actionType, pointsAwarded, multiplier = 1.0, metadata = {} } = req.body || {};

  if (!actionType) {
    return res.status(400).json({ error: "actionType is required" });
  }

  // ── Get wallet address (from token or body) ─────────────────────────────────
  const walletAddress = (tokenWallet || req.body?.walletAddress || "").toLowerCase();
  if (!walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "Valid wallet address required" });
  }

  // ── Validate action type ────────────────────────────────────────────────────
  const actionDef = VALID_ACTIONS[actionType];
  if (!actionDef) {
    return res.status(403).json({ valid: false, reason: `Invalid action_type: ${actionType}` });
  }

  // ── Validate points match expected (allow ±1 for rounding) ──────────────────
  if (pointsAwarded !== undefined && Math.abs(pointsAwarded - actionDef.points) > 1) {
    return res.status(403).json({ valid: false, reason: `Points mismatch: expected ${actionDef.points}, got ${pointsAwarded}` });
  }

  // ── Check Supabase availability ─────────────────────────────────────────────
  const supabase = getSupabase();
  if (!supabase) {
    // If Supabase isn't configured, accept the claim optimistically
    // (local-first still works, just no server validation)
    return res.status(200).json({
      valid: true,
      finalPoints: actionDef.points,
      multiplierApplied: 1.0,
      xpEventId: null,
      serverTotal: null,
      fallback: true,
    });
  }

  try {
    // ── Per-tank cooldown check ─────────────────────────────────────────────
    if (actionDef.cooldownMs && actionDef.perTank && metadata.tankId) {
      const cutoff = new Date(Date.now() - actionDef.cooldownMs).toISOString();

      const { data: recentEvents } = await supabase
        .from("xp_events")
        .select("id")
        .eq("wallet_address", walletAddress)
        .eq("action_type", actionType)
        .gte("created_at", cutoff)
        .contains("metadata", { tankId: metadata.tankId })
        .limit(1);

      if (recentEvents && recentEvents.length > 0) {
        return res.status(403).json({
          valid: false,
          reason: `Cooldown active for ${actionType} on tank ${metadata.tankId}`,
          cooldownMs: actionDef.cooldownMs,
        });
      }
    }

    // ── Daily max check ─────────────────────────────────────────────────────
    if (actionDef.dailyMax) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { count } = await supabase
        .from("xp_events")
        .select("id", { count: "exact", head: true })
        .eq("wallet_address", walletAddress)
        .eq("action_type", actionType)
        .gte("created_at", todayStart.toISOString());

      if ((count || 0) >= actionDef.dailyMax) {
        return res.status(403).json({
          valid: false,
          reason: `Daily limit reached for ${actionType} (${actionDef.dailyMax}/day)`,
        });
      }
    }

    // ── Calculate validated multiplier ──────────────────────────────────────
    let validatedMultiplier = 1.0;

    // Get user profile for streak info
    const { data: profile } = await supabase
      .from("profiles")
      .select("streak_days, zone_hash, total_xp")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    // Streak bonus: 7+ consecutive days → 1.5x on care actions
    if (profile && profile.streak_days >= 7 && CARE_ACTIONS.includes(actionType)) {
      validatedMultiplier = 1.5;
    }

    // Expo multiplier: 2x inside active event zone
    if (multiplier === 2.0 && metadata.eventId) {
      // Validate against active events (basic check — event exists and is active)
      const { data: activeEvent } = await supabase
        .from("tides")
        .select("id")
        .eq("id", metadata.eventId)
        .eq("status", "active")
        .maybeSingle();

      if (activeEvent) {
        validatedMultiplier = 2.0;
      }
    }

    // Use the highest validated multiplier (don't stack streak + expo)
    const finalMultiplier = Math.max(validatedMultiplier, 1.0);
    const finalPoints = Math.round(actionDef.points * finalMultiplier);

    // ── Insert validated XP event ───────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from("xp_events")
      .insert({
        wallet_address: walletAddress,
        action_type: actionType,
        points_awarded: actionDef.points,
        multiplier: finalMultiplier,
        final_points: finalPoints,
        zone_hash: profile?.zone_hash || null,
        metadata: metadata || {},
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[validate-xp] Insert failed:", insertErr.message);
      return res.status(500).json({ error: "Failed to record XP event" });
    }

    // ── Update the server-authoritative xp_total on profiles ────────────────
    // NOTE: The trigger_update_profile_xp (from migration 011) automatically
    // increments profiles.total_xp on xp_events INSERT. We don't need to
    // update it manually here. Just read back the new total for the response.
    const { data: updatedProfile } = await supabase
      .from("profiles")
      .select("total_xp")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    const newServerTotal = updatedProfile?.total_xp || (profile?.xp_total || 0) + finalPoints;

    return res.status(200).json({
      valid: true,
      finalPoints,
      multiplierApplied: finalMultiplier,
      basePoints: actionDef.points,
      xpEventId: inserted.id,
      serverTotal: newServerTotal,
      actionType,
    });
  } catch (err) {
    console.error("[validate-xp] Unexpected error:", err);
    return res.status(500).json({ error: "Internal validation error" });
  }
}
