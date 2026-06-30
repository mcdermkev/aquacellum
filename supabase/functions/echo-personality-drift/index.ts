/**
 * echo-personality-drift Edge Function
 *
 * Runs weekly (every Monday at 03:00 UTC via pg_cron or Supabase cron).
 * Calculates personality axis shifts for all active Echo companions based on
 * their care action history from the past 7 days.
 *
 * Algorithm:
 *   1. For each user with an echo_companion_state row:
 *   2. Query echo_action_log for the past 7 days
 *   3. Count actions per personality axis
 *   4. Dominant axis: +2, secondary: +1, inactive axes: -1 (floor 0, cap 100)
 *   5. Write updated personality back to echo_companion_state
 *   6. Optionally batch on-chain personality updates monthly (via relayer)
 *
 * Triggered by: Supabase cron or manual invocation
 * Schedule: 0 3 * * 1 (every Monday at 03:00 UTC)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─────────────────────────────────────────────────────────────────────────────
// Action → Personality Axis Mapping
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_AXIS_MAP: Record<string, { axis: string; weight: number }[]> = {
  LOG_FEEDING:      [{ axis: "nurturing", weight: 1 }],
  LOG_WATER:        [{ axis: "nurturing", weight: 1 }, { axis: "calm", weight: 0.5 }],
  LOG_WATER_CHANGE: [{ axis: "nurturing", weight: 1 }, { axis: "calm", weight: 0.5 }],
  LOG_PARAMETERS:   [{ axis: "analytical", weight: 1 }],
  LOG_WATER_PARAMS: [{ axis: "analytical", weight: 1 }],
  CHECK_PARAMS:     [{ axis: "analytical", weight: 1 }],
  SCAN_SPECIES:     [{ axis: "adventurous", weight: 1 }],
  ADD_SPECIES:      [{ axis: "adventurous", weight: 1 }],
  BROWSE_SPECIES:   [{ axis: "adventurous", weight: 0.5 }],
  MINT_SPECIMEN:    [{ axis: "adventurous", weight: 0.5 }, { axis: "creative", weight: 0.5 }],
  POST_COMMUNITY:   [{ axis: "social", weight: 1 }],
  REACT_POST:       [{ axis: "social", weight: 0.5 }],
  VISIT_PROFILE:    [{ axis: "social", weight: 0.5 }],
  SHARE_ECHO:       [{ axis: "social", weight: 1 }],
  SPAWN_BREED:      [{ axis: "creative", weight: 1 }],
  REGISTER_MORPH:   [{ axis: "creative", weight: 1 }],
};

const ALL_AXES = ["nurturing", "analytical", "adventurous", "social", "calm", "creative"];

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Get all users with echo companion state
    const { data: companions, error: compError } = await supabase
      .from("echo_companion_state")
      .select("wallet_address, personality_nurturing, personality_analytical, personality_adventurous, personality_social, personality_calm, personality_creative");

    if (compError) {
      return respond(500, { error: compError.message });
    }

    if (!companions || companions.length === 0) {
      return respond(200, { message: "No companions to process", updated: 0 });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let updated = 0;
    let skipped = 0;

    for (const companion of companions) {
      const wallet = companion.wallet_address;

      // Fetch this user's actions from the past 7 days
      const { data: actions, error: actError } = await supabase
        .from("echo_action_log")
        .select("action_type")
        .eq("wallet_address", wallet)
        .gte("created_at", sevenDaysAgo);

      if (actError) {
        console.warn(`Failed to fetch actions for ${wallet}:`, actError.message);
        skipped++;
        continue;
      }

      // Count weighted contributions per axis
      const axisCounts: Record<string, number> = {
        nurturing: 0,
        analytical: 0,
        adventurous: 0,
        social: 0,
        calm: 0,
        creative: 0,
      };

      for (const action of (actions || [])) {
        const mappings = ACTION_AXIS_MAP[action.action_type?.toUpperCase()];
        if (mappings) {
          for (const { axis, weight } of mappings) {
            axisCounts[axis] += weight;
          }
        }
      }

      // Sort axes by contribution (descending)
      const sorted = Object.entries(axisCounts).sort((a, b) => b[1] - a[1]);
      const dominant = sorted[0];
      const secondary = sorted[1];

      // Apply drift: dominant +2, secondary +1, inactive -1
      const newPersonality: Record<string, number> = {};

      for (const axis of ALL_AXES) {
        const currentValue = companion[`personality_${axis}`] || 10;
        let newValue = currentValue;

        if (axis === dominant[0] && dominant[1] > 0) {
          newValue = Math.min(100, currentValue + 2);
        } else if (axis === secondary[0] && secondary[1] > 0) {
          newValue = Math.min(100, currentValue + 1);
        } else if (axisCounts[axis] === 0) {
          newValue = Math.max(0, currentValue - 1);
        }
        // If axis has some activity but isn't top 2, it stays the same

        newPersonality[`personality_${axis}`] = newValue;
      }

      // Write updated personality back
      const { error: updateError } = await supabase
        .from("echo_companion_state")
        .update({
          ...newPersonality,
          last_personality_calc: new Date().toISOString(),
        })
        .eq("wallet_address", wallet);

      if (updateError) {
        console.warn(`Failed to update personality for ${wallet}:`, updateError.message);
        skipped++;
      } else {
        updated++;
      }
    }

    // ─── Monthly on-chain batch (check if it's the first Monday of the month) ──
    const now = new Date();
    const isFirstMondayOfMonth = now.getDate() <= 7 && now.getDay() === 1;

    let onChainBatchResult = null;
    if (isFirstMondayOfMonth) {
      onChainBatchResult = await scheduleOnChainPersonalityBatch(supabase, companions);
    }

    return respond(200, {
      processed: companions.length,
      updated,
      skipped,
      weekStart: sevenDaysAgo,
      onChainBatch: onChainBatchResult,
    });
  } catch (err) {
    console.error("personality-drift error:", err);
    return respond(500, { error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// On-Chain Batch (Monthly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * On the first Monday of each month, queue personality updates for on-chain
 * sync. The actual transaction is handled by the relayer service (separate
 * process that reads from a queue table and calls updatePersonality on-chain).
 */
async function scheduleOnChainPersonalityBatch(supabase: any, companions: any[]) {
  const batch = companions.map((c) => ({
    wallet_address: c.wallet_address,
    nurturing: c.personality_nurturing,
    analytical: c.personality_analytical,
    adventurous: c.personality_adventurous,
    social: c.personality_social,
    calm: c.personality_calm,
    creative: c.personality_creative,
    scheduled_at: new Date().toISOString(),
    status: "pending",
  }));

  // Write to a queue table (relayer picks up pending rows)
  const { error } = await supabase
    .from("echo_onchain_queue")
    .insert(batch);

  if (error) {
    console.warn("Failed to schedule on-chain batch:", error.message);
    return { scheduled: 0, error: error.message };
  }

  return { scheduled: batch.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
