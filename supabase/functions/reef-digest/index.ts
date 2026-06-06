/**
 * reef-digest Edge Function
 * 
 * Weekly Reef Digest generation (Task 48).
 * Cron: Sunday 9am UTC.
 * For each active user, generates a personalized digest via Poseidon (Gemini).
 * Stores as sonar_notification with category 'poseidon'.
 * 
 * Schedule via pg_cron:
 *   SELECT cron.schedule('reef-digest', '0 9 * * 0', ...)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let generated = 0;

  try {
    // Get active users (posted or reacted in last 7 days)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: activeUsers } = await supabase
      .from("profiles")
      .select("wallet_address, display_name")
      .gte("updated_at", oneWeekAgo);

    if (!activeUsers || activeUsers.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "No active users" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    for (const user of activeUsers) {
      try {
        // Gather context for this user
        const context = await gatherDigestContext(supabase, user.wallet_address, oneWeekAgo);

        if (!context.hasActivity) continue;

        // Generate digest via Gemini
        const digest = await generateDigest(user, context);

        // Store as notification
        await supabase.from("sonar_notifications").insert({
          recipient_wallet: user.wallet_address,
          category: "poseidon",
          title: "🐙 Your Weekly Reef Digest",
          body: digest,
          icon: "🐙",
          link_type: "digest",
          link_id: new Date().toISOString().split("T")[0],
        });

        generated++;
      } catch (err) {
        console.error(`Digest failed for ${user.wallet_address}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, generated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function gatherDigestContext(supabase: any, wallet: string, since: string) {
  // Get user's tankmates' recent posts
  const { data: follows } = await supabase
    .from("follows")
    .select("target_wallet")
    .eq("follower_wallet", wallet)
    .eq("follow_type", "tankmate");

  const tankmateWallets = (follows || []).map((f: any) => f.target_wallet).filter(Boolean);

  let tankmateActivity = 0;
  if (tankmateWallets.length > 0) {
    const { count } = await supabase
      .from("currents")
      .select("*", { count: "exact", head: true })
      .in("author_wallet", tankmateWallets)
      .gte("created_at", since);
    tankmateActivity = count || 0;
  }

  // Get trending insights this week
  const { data: trendingInsights } = await supabase
    .from("species_insights")
    .select("body, spec_code, upvotes")
    .gte("created_at", since)
    .order("upvotes", { ascending: false })
    .limit(3);

  // Get upcoming tides
  const { data: upcomingTides } = await supabase
    .from("tides")
    .select("title, tide_type, start_time")
    .eq("status", "upcoming")
    .order("start_time", { ascending: true })
    .limit(3);

  // Get user's recent reactions received
  const { count: reactionsReceived } = await supabase
    .from("reactions")
    .select("*", { count: "exact", head: true })
    .in("target_id", (
      await supabase.from("currents").select("id").eq("author_wallet", wallet)
    ).data?.map((c: any) => c.id) || [])
    .gte("created_at", since);

  return {
    hasActivity: tankmateActivity > 0 || (trendingInsights?.length || 0) > 0 || (upcomingTides?.length || 0) > 0,
    tankmateActivity,
    trendingInsights: trendingInsights || [],
    upcomingTides: upcomingTides || [],
    reactionsReceived: reactionsReceived || 0,
  };
}

async function generateDigest(user: any, context: any): Promise<string> {
  if (!GEMINI_API_KEY) {
    // Fallback without AI
    const parts = [];
    if (context.tankmateActivity > 0) parts.push(`Your tankmates posted ${context.tankmateActivity} updates this week.`);
    if (context.reactionsReceived > 0) parts.push(`You received ${context.reactionsReceived} reactions.`);
    if (context.trendingInsights.length > 0) parts.push(`Top insight: "${context.trendingInsights[0].body.slice(0, 60)}..."`);
    if (context.upcomingTides.length > 0) parts.push(`Upcoming: ${context.upcomingTides[0].title}`);
    return parts.join(" ") || "Stay active on The Reef to see your personalized weekly digest!";
  }

  const prompt = `You are Poseidon, the AI companion for Aquacellum (a fishkeeping community platform). Generate a brief, warm weekly digest (2-3 sentences max) for ${user.display_name || "this breeder"}.

Context:
- Tankmate posts this week: ${context.tankmateActivity}
- Reactions received on their content: ${context.reactionsReceived}
- Trending insights: ${context.trendingInsights.map((i: any) => i.body.slice(0, 50)).join("; ")}
- Upcoming events: ${context.upcomingTides.map((t: any) => t.title).join(", ")}

Keep it concise, friendly, and motivating. Use aquatic metaphors sparingly.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 150, temperature: 0.7 },
        }),
      }
    );

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Check out what's happening on The Reef this week!";
  } catch {
    return "Your weekly Reef activity awaits — dive in to see what your tankmates are up to!";
  }
}
