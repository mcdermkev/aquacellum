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
import { ethers } from "ethers";
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
  MORPH_REGISTERED:     { points: 30,  cooldownMs: null, perTank: false, dailyMax: null },
  SPAWN_BREED:          { points: 150, cooldownMs: null, perTank: false, dailyMax: null },
  BATCH_SHIPPING:       { points: 35,  cooldownMs: null, perTank: false, dailyMax: null },
  AUDIT_GIVEN:          { points: 60,  cooldownMs: null, perTank: false, dailyMax: null },
  AUDIT_RECEIVED:       { points: 20,  cooldownMs: null, perTank: false, dailyMax: null },

  // Arrival Flow
  ARRIVAL_CONFIRMED:       { points: 25, cooldownMs: null, perTank: false, dailyMax: null },
  BATCH_ARRIVAL_CONFIRMED: { points: 15, cooldownMs: null, perTank: false, dailyMax: null },
  ACCLIMATION_COMPLETED:   { points: 20, cooldownMs: null, perTank: false, dailyMax: null },

  // Community & Social
  POST_CURRENT:         { points: 10, cooldownMs: null, perTank: false, dailyMax: 2 },
  PUBLISH_INSIGHT:      { points: 20, cooldownMs: null, perTank: false, dailyMax: null },
  ENGAGEMENT_BONUS:     { points: 8,  cooldownMs: null, perTank: false, dailyMax: null },
  JOIN_SCHOOL:          { points: 15, cooldownMs: null, perTank: false, dailyMax: null },
  MENTORED_USER:        { points: 40, cooldownMs: null, perTank: false, dailyMax: null },

  // Husbandry bookkeeping — capped, previously uncapped and unlisted
  SPECIMEN_REHOMED:     { points: 10, cooldownMs: null, perTank: false, dailyMax: 3 },
  GROWOUT_CHECKPOINT:   { points: 5,  cooldownMs: null, perTank: false, dailyMax: 10 },
  POST_COMMENT:         { points: 5,  cooldownMs: null, perTank: false, dailyMax: 5 },
};

/**
 * Actions that may legitimately be claimed for several items at once, with the
 * highest quantity accepted.
 *
 * An allowlist rather than a global cap, because a quantity multiplier on the wrong
 * action is a straightforward XP exploit: `LOG_FEEDING × 500` would sail past the
 * per-tank cooldown, which only ever inspects whether an event exists, not how much
 * it was worth. Only genuinely per-item actions belong here.
 */
const BATCHABLE_ACTIONS = Object.freeze({
  MINT_SPECIMEN: 100,        // registering a spawn's certificates in one pass
  BATCH_ARRIVAL_CONFIRMED: 100,
  ACCLIMATION_COMPLETED: 100,
  GROWOUT_CHECKPOINT: 50,    // one checkpoint across many spawns
  SPECIMEN_REHOMED: 50,
  LOG_PARAMETERS: 50,        // "log all tanks" writes one reading per tank
  CLAIM_EXCHANGE: 50,        // a multi-item cart settles as one checkout
});

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

  // ── Route: ?action=review-morph → curator morph status flip ──────────────
  const action = req.query?.action || req.body?.action;
  if (action === "review-morph") {
    return handleMorphReview(req, res);
  }

  // ── Default route: XP validation ─────────────────────────────────────────

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
  const { actionType, pointsAwarded, quantity = 1, multiplier = 1.0, metadata = {} } = req.body || {};

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

  // ── Validate the claimed quantity ────────────────────────────────────────────
  //
  // Batched awards are real (registering ten certificates from one spawn, logging
  // parameters across every tank), and rejecting them was losing users legitimate
  // XP: the old check compared the claim against a SINGLE action's points, so any
  // `points × N` award failed and was silently rolled back on the client.
  //
  // The multiplier is still adversarial input, so it is bounded twice: the action
  // must be on the batchable allowlist, and the count must not exceed that action's
  // ceiling.
  const claimedQuantity = Math.floor(Number(quantity) || 1);
  if (!Number.isFinite(claimedQuantity) || claimedQuantity < 1) {
    return res.status(403).json({ valid: false, reason: `Invalid quantity: ${quantity}` });
  }
  if (claimedQuantity > 1) {
    const maxQuantity = BATCHABLE_ACTIONS[actionType];
    if (!maxQuantity) {
      return res.status(403).json({
        valid: false,
        reason: `${actionType} may not be claimed in batches`,
      });
    }
    if (claimedQuantity > maxQuantity) {
      return res.status(403).json({
        valid: false,
        reason: `Quantity ${claimedQuantity} exceeds the maximum ${maxQuantity} for ${actionType}`,
      });
    }
  }

  // ── Validate points match expected (allow ±1 for rounding) ──────────────────
  const expectedPoints = actionDef.points * claimedQuantity;
  if (pointsAwarded !== undefined && Math.abs(pointsAwarded - expectedPoints) > 1) {
    return res.status(403).json({ valid: false, reason: `Points mismatch: expected ${expectedPoints}, got ${pointsAwarded}` });
  }

  // ── Check Supabase availability ─────────────────────────────────────────────
  const supabase = getSupabase();
  if (!supabase) {
    // If Supabase isn't configured, accept the claim optimistically
    // (local-first still works, just no server validation)
    return res.status(200).json({
      valid: true,
      finalPoints: expectedPoints,
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
    const finalPoints = Math.round(expectedPoints * finalMultiplier);

    // ── Insert validated XP event ───────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from("xp_events")
      .insert({
        wallet_address: walletAddress,
        action_type: actionType,
        points_awarded: expectedPoints,
        multiplier: finalMultiplier,
        final_points: finalPoints,
        zone_hash: profile?.zone_hash || null,
        // Record the batch size so a 10-certificate award is distinguishable from
        // ten separate ones when the ledger is audited later.
        metadata: { ...(metadata || {}), quantity: claimedQuantity },
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
      basePoints: expectedPoints,
      quantity: claimedQuantity,
      xpEventId: inserted.id,
      serverTotal: newServerTotal,
      actionType,
    });
  } catch (err) {
    console.error("[validate-xp] Unexpected error:", err);
    return res.status(500).json({ error: "Internal validation error" });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MORPH REVIEW — curator-gated status flip for morph submissions.
// Folded into validate-xp to stay within Vercel Hobby's 12-function limit.
// Called via POST /api/validate-xp?action=review-morph
// ─────────────────────────────────────────────────────────────────────────────

const MANAGER_ADDRESS =
  process.env.MANAGER_ADDRESS ||
  process.env.VITE_MANAGER_ADDRESS ||
  process.env.VITE_CONTRACT_ADDRESS ||
  "";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  process.env.BASE_SEPOLIA_RPC_URL ||
  "";

const VALID_MORPH_STATUSES = ["pending", "verified", "rejected"];

async function getOnChainCurator() {
  if (!MANAGER_ADDRESS || !RPC_URL) return { error: "not_configured" };
  try {
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(
      MANAGER_ADDRESS,
      ["function curator() view returns (address)"],
      provider
    );
    const addr = await contract.curator();
    return { curator: String(addr).toLowerCase() };
  } catch (err) {
    console.error("[review-morph] curator() read failed:", err.message);
    return { error: "rpc_failed" };
  }
}

async function handleMorphReview(req, res) {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Service not configured (missing Supabase env vars)" });
  }

  const { id, status, callerWallet, note } = req.body || {};

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id is required" });
  }
  if (!VALID_MORPH_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_MORPH_STATUSES.join(", ")}` });
  }
  if (!callerWallet || typeof callerWallet !== "string") {
    return res.status(400).json({ error: "callerWallet is required" });
  }

  // Verify the caller is the on-chain curator.
  const { curator, error: curatorErr } = await getOnChainCurator();
  if (curatorErr === "not_configured") {
    return res.status(503).json({ error: "Curator verification not configured (missing manager address / RPC URL)" });
  }
  if (curatorErr === "rpc_failed" || !curator) {
    return res.status(502).json({ error: "Could not verify curator on-chain. Try again." });
  }
  if (callerWallet.toLowerCase() !== curator) {
    return res.status(403).json({ error: "Only the curator can review morph submissions." });
  }

  try {
    const { data, error } = await supabase
      .from("morph_submissions")
      .update({
        status,
        reviewer_wallet: callerWallet.toLowerCase(),
        review_note: typeof note === "string" && note.trim() ? note.trim() : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[review-morph] Update failed:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ data });
  } catch (err) {
    console.error("[review-morph] Unexpected error:", err);
    return res.status(500).json({ error: err.message });
  }
}
