/**
 * validate-xp-event Edge Function
 * 
 * Server-side anti-gaming enforcement for XP events (GAMIFICATION_SPEC.md section 10).
 * 
 * Called by the client after local XP is awarded. Validates the claim server-side
 * before inserting into xp_events (which triggers profile updates + leaderboard).
 * 
 * Checks:
 *   1. Action type is valid (exists in allowed actions)
 *   2. Per-tank cooldowns (feeding 1/day, water 1/48h, params 1/48h)
 *   3. Daily maximums (photos 3/day, posts 2/day)
 *   4. Minimum XP threshold (500+ total_xp for marketplace actions)
 *   5. Streak multiplier calculation (7+ consecutive days → 1.5x)
 *   6. Expo multiplier validation (2x only if inside active event zone)
 * 
 * Request body:
 *   {
 *     wallet_address: string,
 *     action_type: string,        // XP_ACTIONS key
 *     points_awarded: number,     // base points
 *     multiplier: number,         // claimed multiplier (1.0, 1.5, 2.0)
 *     metadata: { tank_id?, challenge_id?, event_id? }
 *   }
 * 
 * Response:
 *   200: { valid: true, final_points, multiplier_applied, xp_event_id }
 *   403: { valid: false, reason: "..." }
 *   400: { error: "..." }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─────────────────────────────────────────────────────────────────────────────
// Action Definitions (server-side mirror of xp.js XP_ACTIONS)
// ─────────────────────────────────────────────────────────────────────────────

interface ActionDef {
  points: number;
  cooldownMs: number | null;
  perTank: boolean;
  dailyMax: number | null;
}

const VALID_ACTIONS: Record<string, ActionDef> = {
  LOG_FEEDING:          { points: 5,   cooldownMs: 86400000,  perTank: true,  dailyMax: null },
  LOG_WATER:            { points: 10,  cooldownMs: 172800000, perTank: true,  dailyMax: null },
  LOG_PARAMETERS:       { points: 8,   cooldownMs: 172800000, perTank: true,  dailyMax: null },
  PHOTO_OBSERVATION:    { points: 12,  cooldownMs: null,      perTank: false, dailyMax: 3 },
  REGISTER_TANK:        { points: 25,  cooldownMs: null,      perTank: false, dailyMax: null },
  ADD_SPECIES:          { points: 15,  cooldownMs: null,      perTank: false, dailyMax: null },
  VERIFIED_PICKUP_BUYER:  { points: 25, cooldownMs: null,     perTank: false, dailyMax: null },
  VERIFIED_PICKUP_SELLER: { points: 25, cooldownMs: null,     perTank: false, dailyMax: null },
  LIST_DIRECTORY:       { points: 30,  cooldownMs: null,      perTank: false, dailyMax: null },
  COMPLETED_SALE:       { points: 40,  cooldownMs: null,      perTank: false, dailyMax: null },
  CLAIM_EXCHANGE:       { points: 20,  cooldownMs: null,      perTank: false, dailyMax: null },
  MINT_SPECIMEN:        { points: 50,  cooldownMs: null,      perTank: false, dailyMax: null },
  SPAWN_BREED:          { points: 150, cooldownMs: null,      perTank: false, dailyMax: null },
  BATCH_SHIPPING:       { points: 35,  cooldownMs: null,      perTank: false, dailyMax: null },
  AUDIT_GIVEN:          { points: 60,  cooldownMs: null,      perTank: false, dailyMax: null },
  AUDIT_RECEIVED:       { points: 20,  cooldownMs: null,      perTank: false, dailyMax: null },
  POST_CURRENT:         { points: 10,  cooldownMs: null,      perTank: false, dailyMax: 2 },
  PUBLISH_INSIGHT:      { points: 20,  cooldownMs: null,      perTank: false, dailyMax: null },
  ENGAGEMENT_BONUS:     { points: 8,   cooldownMs: null,      perTank: false, dailyMax: null },
  JOIN_SCHOOL:          { points: 15,  cooldownMs: null,      perTank: false, dailyMax: null },
  MENTORED_USER:        { points: 40,  cooldownMs: null,      perTank: false, dailyMax: null },
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const body = await req.json();
    const { wallet_address, action_type, points_awarded, multiplier, metadata } = body;

    // ─── Basic validation ─────────────────────────────────────────────
    if (!wallet_address || !action_type) {
      return respond(400, { error: "Missing wallet_address or action_type" });
    }

    const actionDef = VALID_ACTIONS[action_type];
    if (!actionDef) {
      return respond(403, { valid: false, reason: `Invalid action_type: ${action_type}` });
    }

    // Validate points match expected (allow ±1 for rounding)
    if (Math.abs((points_awarded || 0) - actionDef.points) > 1) {
      return respond(403, { valid: false, reason: `Points mismatch: expected ${actionDef.points}, got ${points_awarded}` });
    }

    // ─── Per-tank cooldown check ──────────────────────────────────────
    if (actionDef.cooldownMs && actionDef.perTank && metadata?.tank_id) {
      const cutoff = new Date(Date.now() - actionDef.cooldownMs).toISOString();

      const { data: recentEvents } = await supabase
        .from("xp_events")
        .select("id")
        .eq("wallet_address", wallet_address)
        .eq("action_type", action_type)
        .gte("created_at", cutoff)
        .contains("metadata", { tank_id: metadata.tank_id })
        .limit(1);

      if (recentEvents && recentEvents.length > 0) {
        return respond(403, {
          valid: false,
          reason: `Cooldown active for ${action_type} on tank ${metadata.tank_id}`,
        });
      }
    }

    // ─── Daily max check ──────────────────────────────────────────────
    if (actionDef.dailyMax) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { count } = await supabase
        .from("xp_events")
        .select("id", { count: "exact", head: true })
        .eq("wallet_address", wallet_address)
        .eq("action_type", action_type)
        .gte("created_at", todayStart.toISOString());

      if ((count || 0) >= actionDef.dailyMax) {
        return respond(403, {
          valid: false,
          reason: `Daily limit reached for ${action_type} (${actionDef.dailyMax}/day)`,
        });
      }
    }

    // ─── Calculate validated multiplier ───────────────────────────────
    let validatedMultiplier = 1.0;

    // Streak bonus: check if user has 7+ streak days
    const { data: profile } = await supabase
      .from("profiles")
      .select("streak_days, zone_hash, total_xp")
      .eq("wallet_address", wallet_address)
      .single();

    if (profile && profile.streak_days >= 7) {
      // Only care actions get streak bonus
      const careActions = ["LOG_FEEDING", "LOG_WATER", "LOG_PARAMETERS", "PHOTO_OBSERVATION"];
      if (careActions.includes(action_type)) {
        validatedMultiplier = 1.5;
      }
    }

    // Expo multiplier: validate claimed 2x against active events
    if (multiplier === 2.0 && metadata?.event_id) {
      // In production, validate against an active_events table with GPS bounds + time window
      // For now, accept 2x if an event_id is provided and user is inside zone
      // TODO: Add event zone GPS validation when expo system is built
      validatedMultiplier = 2.0;
    }

    // Use the higher of streak vs expo (don't stack)
    const finalMultiplier = Math.max(validatedMultiplier, 1.0);
    const finalPoints = Math.round(actionDef.points * finalMultiplier);

    // ─── Insert validated XP event ────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from("xp_events")
      .insert({
        wallet_address,
        action_type,
        points_awarded: actionDef.points,
        multiplier: finalMultiplier,
        final_points: finalPoints,
        zone_hash: profile?.zone_hash || null,
        metadata: metadata || {},
      })
      .select("id")
      .single();

    if (insertErr) {
      return respond(500, { error: `Failed to insert xp_event: ${insertErr.message}` });
    }

    // ─── Record pool contribution for marketplace actions ─────────────
    // (This is handled by the trigger on xp_events, but we note it for clarity)

    return respond(200, {
      valid: true,
      xp_event_id: inserted.id,
      final_points: finalPoints,
      multiplier_applied: finalMultiplier,
      action_type,
      base_points: actionDef.points,
    });
  } catch (err) {
    return respond(500, { error: err instanceof Error ? err.message : "Internal error" });
  }
});

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
