/**
 * reef-digest Edge Function
 * 
 * Weekly Reef Digest generation (Task 48).
 * Cron: Sunday 9am UTC. Service-role callers only (_shared/callerRole.ts).
 * For each active user, Echo writes a short note from the week's real numbers
 * (Gemini on Vertex, _shared/vertex.ts). If the model is unavailable the note is
 * the numbers themselves, never a stock sentence.
 * Stores as sonar_notification with category 'poseidon'.
 * `?dry=1` returns a few sample digests and writes nothing.
 * 
 * Schedule via pg_cron:
 *   SELECT cron.schedule('reef-digest', '0 9 * * 0', ...)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateText, tidyGenerated } from "../_shared/vertex.ts";
import { isDryRun, requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// `?dry=1` writes nothing and returns this many digests, so it can be checked
// without notifying anyone.
const DRY_RUN_SAMPLE = 3;

serve(async (req) => {
  // Cron only. Without this anyone could send every active keeper a digest.
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const dry = isDryRun(req);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let generated = 0;
  let aiWritten = 0;
  const samples: Array<{ text: string; source: string }> = [];

  try {
    // Get active users (posted or reacted in last 7 days). A dry run may look
    // further back (`&days=60`) so there is someone to write a sample for.
    const dryDays = Number(new URL(req.url).searchParams.get("days"));
    const days = dry && Number.isFinite(dryDays) && dryDays > 0 ? Math.min(dryDays, 90) : 7;
    const oneWeekAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

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

        const digest = await generateDigest(user, context);
        if (!digest.source.startsWith("facts")) aiWritten++;

        if (dry) {
          samples.push(digest);
          generated++;
          if (samples.length >= DRY_RUN_SAMPLE) break;
          continue;
        }

        // Store as notification. Category and link_type are what the
        // preferences gate and the weekly email sender read; keep them.
        await supabase.from("sonar_notifications").insert({
          recipient_wallet: user.wallet_address,
          category: "poseidon",
          title: "Your week on The Reef",
          body: digest.text,
          icon: "🐙",
          link_type: "digest",
          link_id: new Date().toISOString().split("T")[0],
        });

        generated++;
      } catch (err) {
        console.error(`Digest failed for ${user.wallet_address}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, dry, generated, aiWritten, ...(dry ? { samples } : {}) }), {
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Shorten at a word boundary. A cut mid-word got copied into digests as "bettas col". */
function clip(text: string, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** The digest built from the numbers alone. Also what is sent when the AI is unavailable. */
function factsDigest(context: any): string {
  const parts: string[] = [];
  if (context.tankmateActivity > 0) parts.push(`Your tankmates posted ${plural(context.tankmateActivity, "update", "updates")} this week.`);
  if (context.reactionsReceived > 0) parts.push(`Your posts got ${plural(context.reactionsReceived, "reaction", "reactions")}.`);
  const top = clip(context.trendingInsights[0]?.body || "", 90);
  if (top) parts.push(`Top insight: "${top}"`);
  if (context.upcomingTides.length > 0) parts.push(`Coming up: ${context.upcomingTides[0].title}.`);
  return parts.join(" ") || "Here is your week on The Reef.";
}

async function generateDigest(user: any, context: any): Promise<{ text: string; source: string }> {
  const facts = factsDigest(context);
  const insights = context.trendingInsights
    .map((i: any) => clip(i.body || "", 160))
    .filter(Boolean)
    .slice(0, 2);

  // Only the facts that are worth saying go in. Asking a model to "skip the
  // zeros" did not work: it wrote "your posts received zero reactions".
  const lines = [
    context.tankmateActivity > 0 ? `- Their tankmates posted ${plural(context.tankmateActivity, "update", "updates")} this week.` : null,
    context.reactionsReceived > 0 ? `- Their own posts got ${plural(context.reactionsReceived, "reaction", "reactions")} this week.` : null,
    insights.length ? `- Most upvoted insights this week: ${insights.join(" | ")}` : null,
    context.upcomingTides.length ? `- Coming up: ${context.upcomingTides.map((t: any) => t.title).join(", ")}` : null,
  ].filter(Boolean);
  if (lines.length === 0) return { text: facts, source: "facts (nothing to say)" };

  const prompt = `You are Echo, the fish guide on The Reef, a community feed for aquarium keepers. Write a short weekly note to a keeper about their week.

Facts (use only these):
${lines.join("\n")}

Rules: at most two sentences and 45 words. Speak to them directly ("you"), warm and plain. Do not greet them by name and do not introduce yourself. Report insights as what other keepers shared ("keepers shared that..."), never as advice or instructions to the reader. Mention only what is in the facts; add no numbers, names, events, places, opinions or feelings. No exclamation points, no em dashes, no emoji, no markdown.`;

  const ai = await generateText(prompt, { maxOutputTokens: 160, temperature: 0.3 });
  const text = tidyGenerated(ai.text);
  if (text) return { text, source: ai.model || "ai" };
  // The facts are the honest fallback, not a stock sentence.
  return { text: facts, source: `facts (${ai.reason || "empty"})` };
}
