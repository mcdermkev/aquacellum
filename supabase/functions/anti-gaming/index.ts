/**
 * anti-gaming Edge Function
 * 
 * Anti-gaming detection for Depth Score (Task 59).
 * Scans for suspicious patterns and flags accounts for curator review.
 * 
 * Patterns detected:
 * 1. Mutual upvote rings (A always upvotes B and vice versa)
 * 2. Sudden score spikes from single source
 * 3. Accounts with high activity but zero engagement from others
 * 
 * Schedule via pg_cron (daily at 4am UTC):
 *   SELECT cron.schedule('anti-gaming', '0 4 * * *', ...)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const flagged: string[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // ── Pattern 1: Mutual upvote rings ──
    // Find pairs where A reacts to B's content AND B reacts to A's content
    // with suspiciously high frequency (>5 mutual reactions in 7 days)
    const { data: recentReactions } = await supabase
      .from("reactions")
      .select(`
        user_wallet,
        target_id
      `)
      .gte("created_at", sevenDaysAgo);

    if (recentReactions && recentReactions.length > 0) {
      // Build a map: reactor → set of content authors they reacted to
      const reactorToAuthors: Record<string, Record<string, number>> = {};

      // Get the author of each reacted content
      const targetIds = [...new Set(recentReactions.map(r => r.target_id))];

      // Batch fetch content authors (in chunks of 50)
      const authorMap: Record<string, string> = {};
      for (let i = 0; i < targetIds.length; i += 50) {
        const chunk = targetIds.slice(i, i + 50);
        const { data: currents } = await supabase
          .from("currents")
          .select("id, author_wallet")
          .in("id", chunk);

        for (const c of (currents || [])) {
          authorMap[c.id] = c.author_wallet;
        }
      }

      // Count reactions per pair
      for (const reaction of recentReactions) {
        const author = authorMap[reaction.target_id];
        if (!author || author === reaction.user_wallet) continue;

        if (!reactorToAuthors[reaction.user_wallet]) {
          reactorToAuthors[reaction.user_wallet] = {};
        }
        reactorToAuthors[reaction.user_wallet][author] =
          (reactorToAuthors[reaction.user_wallet][author] || 0) + 1;
      }

      // Detect mutual high-frequency pairs
      const checkedPairs = new Set<string>();
      for (const [walletA, targets] of Object.entries(reactorToAuthors)) {
        for (const [walletB, countAtoB] of Object.entries(targets)) {
          const pairKey = [walletA, walletB].sort().join(":");
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          const countBtoA = reactorToAuthors[walletB]?.[walletA] || 0;

          // Flag if both directions have 5+ reactions in a week
          if (countAtoB >= 5 && countBtoA >= 5) {
            flagged.push(walletA);
            flagged.push(walletB);

            // Create moderation flag
            await supabase.from("moderation_flags").insert({
              target_type: "profile",
              target_id: walletA, // Using wallet as UUID-like identifier
              reason: "other",
              auto_flagged: true,
              ai_confidence: 0.8,
              details: `Mutual upvote ring detected: ${walletA.slice(0, 10)} ↔ ${walletB.slice(0, 10)} (${countAtoB}/${countBtoA} mutual reactions in 7 days)`,
            });
          }
        }
      }
    }

    // ── Pattern 2: Sudden score spikes (>100 points in 24h from one source type) ──
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentEvents } = await supabase
      .from("depth_score_events")
      .select("wallet_address, delta, source_type")
      .gte("created_at", oneDayAgo)
      .gt("delta", 0);

    if (recentEvents) {
      const walletSourceTotals: Record<string, Record<string, number>> = {};

      for (const event of recentEvents) {
        if (!walletSourceTotals[event.wallet_address]) {
          walletSourceTotals[event.wallet_address] = {};
        }
        walletSourceTotals[event.wallet_address][event.source_type] =
          (walletSourceTotals[event.wallet_address][event.source_type] || 0) + event.delta;
      }

      for (const [wallet, sources] of Object.entries(walletSourceTotals)) {
        for (const [source, total] of Object.entries(sources)) {
          if (total > 100) {
            if (!flagged.includes(wallet)) {
              flagged.push(wallet);
              await supabase.from("moderation_flags").insert({
                target_type: "profile",
                target_id: wallet,
                reason: "other",
                auto_flagged: true,
                ai_confidence: 0.7,
                details: `Score spike: +${total} from "${source}" in 24 hours`,
              });
            }
          }
        }
      }
    }

    // ── Pattern 3: High activity, zero engagement ──
    // Users who post a lot but receive zero reactions/comments in 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: prolificPosters } = await supabase
      .from("currents")
      .select("author_wallet")
      .gte("created_at", thirtyDaysAgo);

    if (prolificPosters) {
      // Count posts per author
      const postCounts: Record<string, number> = {};
      for (const p of prolificPosters) {
        postCounts[p.author_wallet] = (postCounts[p.author_wallet] || 0) + 1;
      }

      // Check authors with 10+ posts for zero engagement
      for (const [wallet, count] of Object.entries(postCounts)) {
        if (count < 10) continue;

        // Get their content IDs
        const { data: userContent } = await supabase
          .from("currents")
          .select("id")
          .eq("author_wallet", wallet)
          .gte("created_at", thirtyDaysAgo);

        const contentIds = (userContent || []).map(c => c.id);
        if (contentIds.length === 0) continue;

        // Check reactions received
        const { count: reactionsReceived } = await supabase
          .from("reactions")
          .select("*", { count: "exact", head: true })
          .in("target_id", contentIds.slice(0, 50))
          .neq("user_wallet", wallet); // Exclude self-reactions

        if (reactionsReceived === 0) {
          if (!flagged.includes(wallet)) {
            flagged.push(wallet);
            await supabase.from("moderation_flags").insert({
              target_type: "profile",
              target_id: wallet,
              reason: "spam",
              auto_flagged: true,
              ai_confidence: 0.6,
              details: `High activity (${count} posts in 30 days) with zero engagement from others. Possible spam account.`,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, flagged_count: [...new Set(flagged)].length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
