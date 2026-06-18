/**
 * distribute-rewards Edge Function
 * 
 * Monthly Loyalty Rewards Pool distribution (GAMIFICATION_SPEC.md section 6.2).
 * 
 * Schedule via pg_cron (1st of each month at 00:05 UTC):
 *   SELECT cron.schedule('distribute-rewards', '5 0 1 * *', $$
 *     SELECT net.http_post(
 *       url := '<SUPABASE_URL>/functions/v1/distribute-rewards',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>'),
 *       body := '{}'
 *     );
 *   $$);
 * 
 * What it does:
 *   1. Expires old credits (12-month limit)
 *   2. Calculates monthly distribution using calculate_monthly_distribution()
 *   3. Refreshes the zone_leaderboard materialized view
 *   4. Returns summary stats
 * 
 * Eligibility (per spec):
 *   - 500+ total_xp
 *   - 1+ marketplace transaction in the past 90 days
 *   - monthly_xp > 0 (earned something that month)
 * 
 * Formula:
 *   user_share = (user_monthly_xp / total_eligible_monthly_xp) * pool_balance
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const startTime = Date.now();
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    steps: [],
  };

  try {
    // ─── Step 1: Expire old credits ─────────────────────────────────────
    const { data: expiredCount, error: expireErr } = await supabase
      .rpc("expire_old_credits");

    if (expireErr) {
      results.steps.push({ step: "expire_credits", error: expireErr.message });
    } else {
      results.steps.push({ step: "expire_credits", expired: expiredCount || 0 });
    }

    // ─── Step 2: Determine distribution period ──────────────────────────
    // Distribution is for the previous month
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

    results.period = period;

    // ─── Step 3: Check if already distributed ───────────────────────────
    const { data: existing } = await supabase
      .from("reward_distributions")
      .select("id")
      .eq("distribution_period", period)
      .limit(1);

    if (existing && existing.length > 0) {
      results.steps.push({ step: "distribution", skipped: true, reason: `Already distributed for ${period}` });
      results.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ─── Step 4: Run distribution ───────────────────────────────────────
    const { data: distResult, error: distErr } = await supabase
      .rpc("calculate_monthly_distribution", { p_period: period });

    if (distErr) {
      results.steps.push({ step: "distribution", error: distErr.message });
    } else {
      const row = distResult?.[0] || distResult;
      results.steps.push({
        step: "distribution",
        distributed_to: row?.distributed_to || 0,
        total_credits: row?.total_credits || 0,
        pool_balance_before: row?.pool_balance_before || 0,
      });
    }

    // ─── Step 5: Refresh materialized views ─────────────────────────────
    const { error: refreshErr } = await supabase
      .rpc("refresh_leaderboard_views");

    if (refreshErr) {
      results.steps.push({ step: "refresh_views", error: refreshErr.message });
    } else {
      results.steps.push({ step: "refresh_views", success: true });
    }

    // ─── Step 6: Send notifications to recipients ───────────────────────
    // Get users who received credits this period
    const { data: recipients } = await supabase
      .from("reward_distributions")
      .select("wallet_address, credits_awarded")
      .eq("distribution_period", period)
      .gt("credits_awarded", 0);

    let notified = 0;
    if (recipients && recipients.length > 0) {
      const notifications = recipients.map((r) => ({
        recipient_wallet: r.wallet_address,
        category: "milestone",
        title: "⭐ Loyalty Rewards Distributed!",
        body: `You earned $${Number(r.credits_awarded).toFixed(2)} in platform credits from this month's Loyalty Rewards Pool.`,
        icon: "⭐",
        link_type: "rewards",
        link_id: period,
      }));

      // Batch insert (Supabase handles chunking)
      const { error: notifErr } = await supabase
        .from("sonar_notifications")
        .insert(notifications);

      if (!notifErr) {
        notified = notifications.length;
      }
      results.steps.push({ step: "notifications", sent: notified, error: notifErr?.message || null });
    } else {
      results.steps.push({ step: "notifications", sent: 0 });
    }

    // ─── Summary ────────────────────────────────────────────────────────
    results.success = true;
    results.duration_ms = Date.now() - startTime;

    return new Response(JSON.stringify(results, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    results.success = false;
    results.error = err instanceof Error ? err.message : String(err);
    results.duration_ms = Date.now() - startTime;

    return new Response(JSON.stringify(results, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
