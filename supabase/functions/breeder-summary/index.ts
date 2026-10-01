/**
 * breeder-summary Edge Function
 * 
 * Weekly Breeder Summary generation (Task 49).
 * For each active profile, Echo writes a 2-sentence summary from the profile's
 * real counts (Gemini on Vertex, _shared/vertex.ts). If the model is
 * unavailable the summary is the facts themselves; with no facts it is null.
 * Stores in profiles.poseidon_summary. Service-role callers only.
 * `?dry=1` returns sample summaries and writes nothing.
 * 
 * Schedule via pg_cron (weekly, e.g. Monday 3am UTC):
 *   SELECT cron.schedule('breeder-summary', '0 3 * * 1', ...)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateText, tidyGenerated } from "../_shared/vertex.ts";
import { isDryRun, requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Cron only. Without this anyone could rewrite every keeper's public summary.
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const dry = isDryRun(req);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let updated = 0;
  let aiWritten = 0;
  const samples: Array<{ text: string | null; source: string }> = [];

  try {
    // Get profiles with any activity
    const { data: profiles } = await supabase
      .from("profiles")
      .select("wallet_address, display_name, depth_score, depth_tier, companion_tier, tank_count, species_count, xp_total")
      .gt("xp_total", 0);

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    for (const profile of profiles) {
      try {
        const context = await gatherProfileContext(supabase, profile.wallet_address);
        const summary = await generateSummary(profile, context);
        if (!summary.source.startsWith("facts") && summary.source !== "none") aiWritten++;

        if (dry) {
          if (samples.length < 3) samples.push(summary);
          continue;
        }

        // null when there is nothing true to say, which also clears the stock
        // "Active community member." line the broken AI call used to leave.
        await supabase
          .from("profiles")
          .update({ poseidon_summary: summary.text })
          .eq("wallet_address", profile.wallet_address);

        updated++;
      } catch (err) {
        console.error(`Summary failed for ${profile.wallet_address}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, dry, updated, aiWritten, ...(dry ? { samples } : {}) }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function gatherProfileContext(supabase: any, wallet: string) {
  // Recent posts count
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count: recentPosts } = await supabase
    .from("currents")
    .select("*", { count: "exact", head: true })
    .eq("author_wallet", wallet)
    .gte("created_at", thirtyDaysAgo);

  // Insights count
  const { count: insights } = await supabase
    .from("species_insights")
    .select("*", { count: "exact", head: true })
    .eq("author_wallet", wallet);

  // Audits given
  const { count: auditsGiven } = await supabase
    .from("expert_audits")
    .select("*", { count: "exact", head: true })
    .eq("auditor_wallet", wallet);

  // Schools joined
  const { count: schools } = await supabase
    .from("school_members")
    .select("*", { count: "exact", head: true })
    .eq("wallet_address", wallet);

  // Species they post about most (from currents species_tags)
  const { data: recentCurrents } = await supabase
    .from("currents")
    .select("species_tags")
    .eq("author_wallet", wallet)
    .order("created_at", { ascending: false })
    .limit(10);

  const speciesFocus = extractTopSpecies(recentCurrents || []);

  return { recentPosts: recentPosts || 0, insights: insights || 0, auditsGiven: auditsGiven || 0, schools: schools || 0, speciesFocus };
}

function extractTopSpecies(currents: any[]): string[] {
  const counts: Record<string, number> = {};
  for (const c of currents) {
    for (const tag of (c.species_tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The facts worth a sentence, from real counts. Empty when there are none. */
function profileFacts(profile: any, context: any): string[] {
  const facts: string[] = [];
  if (context.speciesFocus.length > 0) facts.push(`Posts most about ${context.speciesFocus.join(", ")}.`);
  if (Number(profile.tank_count) > 0) facts.push(`Keeps ${plural(Number(profile.tank_count), "tank", "tanks")}.`);
  if (Number(profile.species_count) > 0) facts.push(`Has logged ${plural(Number(profile.species_count), "species", "species")}.`);
  if (context.recentPosts > 0) facts.push(`Shared ${plural(context.recentPosts, "post", "posts")} in the last 30 days.`);
  if (context.insights > 0) facts.push(`Wrote ${plural(context.insights, "species insight", "species insights")}.`);
  if (context.auditsGiven > 0) facts.push(`Gave ${plural(context.auditsGiven, "expert audit", "expert audits")}.`);
  if (context.schools > 0) facts.push(`Member of ${plural(context.schools, "club", "clubs")}.`);
  return facts;
}

/**
 * Two sentences for the profile, from the facts above. `text: null` when there
 * is nothing true to say: an empty summary is better than a stock line.
 */
async function generateSummary(profile: any, context: any): Promise<{ text: string | null; source: string }> {
  const facts = profileFacts(profile, context);
  if (facts.length === 0) return { text: null, source: "none" };

  const prompt = `You are Echo, the fish guide in Aquacellum, an app for aquarium keepers and breeders. Write a two-sentence public summary of this keeper's profile, in the third person.

Facts (use only these; do not add any other claim, number or species):
${facts.map((f) => `- ${f}`).join("\n")}

Rules: two short sentences, under 45 words. Plain and warm. Add nothing that is not in the facts: no places, rooms, feelings, skill or descriptions of the tanks. No exclamation points, no em dashes, no emoji, no markdown. Do not mention tiers, scores or the app itself.`;

  const ai = await generateText(prompt, { maxOutputTokens: 120, temperature: 0.2 });
  const text = tidyGenerated(ai.text);
  if (text) return { text, source: ai.model || "ai" };
  return { text: facts.slice(0, 2).join(" "), source: `facts (${ai.reason || "empty"})` };
}
