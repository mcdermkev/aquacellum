/**
 * breeder-summary Edge Function
 * 
 * Weekly Breeder Summary generation (Task 49).
 * For each active profile, generates a 2-sentence AI summary.
 * Stores in profiles.poseidon_summary.
 * 
 * Schedule via pg_cron (weekly, e.g. Monday 3am UTC):
 *   SELECT cron.schedule('breeder-summary', '0 3 * * 1', ...)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let updated = 0;

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

        await supabase
          .from("profiles")
          .update({ poseidon_summary: summary })
          .eq("wallet_address", profile.wallet_address);

        updated++;
      } catch (err) {
        console.error(`Summary failed for ${profile.wallet_address}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, updated }), {
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

async function generateSummary(profile: any, context: any): Promise<string> {
  if (!GEMINI_API_KEY) {
    // Fallback
    const parts = [];
    if (context.speciesFocus.length > 0) parts.push(`Focuses on ${context.speciesFocus.join(", ")}.`);
    if (context.auditsGiven > 0) parts.push(`Has given ${context.auditsGiven} Expert Audits.`);
    if (context.insights > 0) parts.push(`Contributed ${context.insights} Species Insights.`);
    if (parts.length === 0) parts.push("Active community member.");
    return parts.slice(0, 2).join(" ");
  }

  const prompt = `You are Poseidon. Write exactly 2 sentences summarizing this aquarium breeder's profile for public display. Be factual and concise.

Profile:
- Name: ${profile.display_name || "Anonymous Breeder"}
- Tier: ${profile.companion_tier}, Depth: ${profile.depth_tier}
- Tanks: ${profile.tank_count}, Species: ${profile.species_count}
- Recent posts (30d): ${context.recentPosts}
- Species Insights shared: ${context.insights}
- Expert Audits given: ${context.auditsGiven}
- Schools: ${context.schools}
- Focus species: ${context.speciesFocus.join(", ") || "varied"}

Write 2 short sentences. No emojis. Professional but warm tone.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 100, temperature: 0.4 },
        }),
      }
    );

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Active community member.";
  } catch {
    return "Active community member.";
  }
}
