/**
 * mentor-match Edge Function
 * 
 * Mentor matching (Task 53). Gemini on Vertex via _shared/vertex.ts, with a
 * heuristic fallback when the model is unavailable.
 * Analyzes user's species/struggles and matches with available mentors.
 * Returns top 3 suggested mentors with explanations.
 * 
 * Expects body:
 * {
 *   wallet_address: string,
 *   species_focus?: string[],   // species the user keeps
 *   struggles?: string          // optional free-text about what they need help with
 * }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiConfigured, generateText, parseJson, tidyGenerated } from "../_shared/vertex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { wallet_address, species_focus, struggles } = await req.json();

    if (!wallet_address) {
      return new Response(JSON.stringify({ error: "wallet_address required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Step 1: Get available mentors (Master+ tier, accepting mentees)
    const { data: mentors } = await supabase
      .from("profiles")
      .select("wallet_address, display_name, avatar_url, companion_tier, depth_score, depth_tier, poseidon_summary")
      .eq("accepting_mentees", true)
      .in("companion_tier", ["Master", "God-Tier"])
      .neq("wallet_address", wallet_address)
      .order("depth_score", { ascending: false })
      .limit(20);

    if (!mentors || mentors.length === 0) {
      return new Response(JSON.stringify({
        matches: [],
        message: "No mentors are accepting mentees right now. Check back soon.",
      }), { headers: { "Content-Type": "application/json" } });
    }

    // Step 2: Gather mentor context (their species expertise from insights + audits)
    const mentorProfiles = await Promise.all(
      mentors.map(async (mentor) => {
        // Get their top insight species
        const { data: insights } = await supabase
          .from("species_insights")
          .select("spec_code")
          .eq("author_wallet", mentor.wallet_address)
          .order("upvotes", { ascending: false })
          .limit(5);

        // Get audits given count
        const { count: auditsGiven } = await supabase
          .from("expert_audits")
          .select("*", { count: "exact", head: true })
          .eq("auditor_wallet", mentor.wallet_address);

        // Get active mentee count
        const { count: activeMentees } = await supabase
          .from("mentorships")
          .select("*", { count: "exact", head: true })
          .eq("mentor_wallet", mentor.wallet_address)
          .eq("status", "active");

        return {
          ...mentor,
          expertise_species: (insights || []).map((i: any) => i.spec_code),
          audits_given: auditsGiven || 0,
          active_mentees: activeMentees || 0,
        };
      })
    );

    // Step 3: Score and rank mentors
    let matches;

    if (aiConfigured() && species_focus?.length > 0) {
      matches = await aiMatchMentors(mentorProfiles, species_focus, struggles);
    } else {
      matches = heuristicMatchMentors(mentorProfiles, species_focus || []);
    }

    return new Response(JSON.stringify({ matches: matches.slice(0, 3) }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

/**
 * Heuristic matching: score by species overlap + depth score + availability.
 */
function heuristicMatchMentors(mentors: any[], userSpecies: string[]) {
  return mentors
    .map((mentor) => {
      let score = 0;

      // Species overlap
      const overlap = mentor.expertise_species.filter((s: string) => userSpecies.includes(s));
      score += overlap.length * 30;

      // Depth score bonus
      score += Math.min(mentor.depth_score / 100, 20);

      // Audits given (experience)
      score += Math.min(mentor.audits_given * 5, 25);

      // Penalize if already has many mentees
      score -= mentor.active_mentees * 10;

      return {
        wallet_address: mentor.wallet_address,
        display_name: mentor.display_name,
        avatar_url: mentor.avatar_url,
        companion_tier: mentor.companion_tier,
        depth_tier: mentor.depth_tier,
        depth_score: mentor.depth_score,
        match_score: Math.max(score, 0),
        reason: overlap.length > 0
          ? `Expertise in ${overlap.length} of your species. ${mentor.audits_given} audits given.`
          : `Experienced breeder (${mentor.companion_tier} tier) with ${mentor.audits_given} audits.`,
      };
    })
    .sort((a, b) => b.match_score - a.match_score);
}

/**
 * AI-powered matching (Gemini on Vertex, _shared/vertex.ts). The model picks
 * from a numbered list; the pick is a string enum, not a free number, so it
 * cannot name a mentor who is not on the list.
 */
async function aiMatchMentors(mentors: any[], userSpecies: string[], struggles?: string) {
  const shortlist = mentors.slice(0, 10);
  const mentorList = shortlist.map((m, i) => (
    `${i + 1}. ${m.display_name || m.wallet_address.slice(0, 10)}: ${m.companion_tier}, depth score ${m.depth_score}, species expertise [${m.expertise_species.join(", ")}], audits given ${m.audits_given}, current mentees ${m.active_mentees}`
  )).join("\n");

  const prompt = `You are Echo, the fish guide in Aquacellum, matching a fishkeeper with mentors. The keeper keeps: [${userSpecies.join(", ")}].${struggles ? ` They want help with: "${String(struggles).slice(0, 300)}"` : ""}

Mentors:
${mentorList}

Pick the best 3 (fewer if fewer fit). For each give its number and one plain sentence on why, based only on the facts listed. Consider species overlap, experience, and availability (fewer current mentees is better). No exclamation points, no em dashes.`;

  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        pick: { type: "string", enum: shortlist.map((_, i) => String(i + 1)) },
        reason: { type: "string" },
      },
      required: ["pick", "reason"],
    },
  };

  const res = await generateText(prompt, { schema, maxOutputTokens: 300, temperature: 0.3 });
  const picks = parseJson<Array<{ pick: string; reason: string }>>(res.text);
  if (Array.isArray(picks) && picks.length > 0) {
    const seen = new Set<number>();
    const matches = picks.map((r, rank) => {
      const i = Number(r?.pick) - 1;
      const mentor = shortlist[i];
      if (!mentor || seen.has(i)) return null;
      seen.add(i);
      return {
        wallet_address: mentor.wallet_address,
        display_name: mentor.display_name,
        avatar_url: mentor.avatar_url,
        companion_tier: mentor.companion_tier,
        depth_tier: mentor.depth_tier,
        depth_score: mentor.depth_score,
        // Rank order from the model, not a score it computed.
        match_score: 100 - rank * 10,
        reason: tidyGenerated(r.reason) || "Good fit for the species you keep.",
      };
    }).filter(Boolean);
    if (matches.length > 0) return matches;
  }

  return heuristicMatchMentors(mentors, userSpecies);
}
