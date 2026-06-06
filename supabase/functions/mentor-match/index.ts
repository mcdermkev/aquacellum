/**
 * mentor-match Edge Function
 * 
 * Poseidon mentor matching (Task 53).
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

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
        message: "No mentors are currently accepting mentees. Check back soon!",
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

    if (GEMINI_API_KEY && species_focus?.length > 0) {
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
 * AI-powered matching via Gemini.
 */
async function aiMatchMentors(mentors: any[], userSpecies: string[], struggles?: string) {
  const mentorList = mentors.slice(0, 10).map((m, i) => (
    `${i + 1}. ${m.display_name || m.wallet_address.slice(0, 10)} — ${m.companion_tier}, Depth: ${m.depth_score}, Species expertise: [${m.expertise_species.join(",")}], Audits: ${m.audits_given}, Current mentees: ${m.active_mentees}`
  )).join("\n");

  const prompt = `You are Poseidon, matching a fishkeeper with mentors. The user keeps: [${userSpecies.join(", ")}].${struggles ? ` They're struggling with: "${struggles}"` : ""}

Available mentors:
${mentorList}

Pick the top 3 best matches. For each, respond with a JSON array:
[{"index": 1, "reason": "one sentence why this is a good match"}]

Consider: species overlap, experience level, availability (fewer current mentees = better).`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.4 },
        }),
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const aiResults = JSON.parse(jsonMatch[0]);
      return aiResults.map((r: any) => {
        const mentor = mentors[r.index - 1];
        if (!mentor) return null;
        return {
          wallet_address: mentor.wallet_address,
          display_name: mentor.display_name,
          avatar_url: mentor.avatar_url,
          companion_tier: mentor.companion_tier,
          depth_tier: mentor.depth_tier,
          depth_score: mentor.depth_score,
          match_score: 100 - (r.index * 10),
          reason: r.reason,
        };
      }).filter(Boolean);
    }
  } catch (err) {
    console.error("AI matching failed:", err);
  }

  // Fallback to heuristic
  return heuristicMatchMentors(mentors, userSpecies);
}
