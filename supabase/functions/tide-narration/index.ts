/**
 * tide-narration Edge Function
 *
 * Tide narration and recaps (Task 51). Service-role callers only
 * (_shared/callerRole.ts): it posts system messages into a tide's chat, so an
 * open endpoint let anyone post as "system" into any event.
 *
 * Two modes:
 * 1. narrate: a short live update in the tide chat from the last 15 minutes of
 *    activity. Echo writes it (Gemini on Vertex, _shared/vertex.ts); without the
 *    model it is the numbers in a plain sentence.
 * 2. recap: rebuilds the recap with the `build_tide_recap` database function,
 *    the one writer of tides.recap_content. This used to write its own recap with
 *    a different stats shape and an XP figure computed from a formula rather than
 *    from XP actually awarded.
 *
 * Expects body: { tide_id: UUID, mode: "narrate" | "recap" }
 * `?dry=1` returns the narration without posting it.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateText, tidyGenerated } from "../_shared/vertex.ts";
import { isDryRun, requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { tide_id, mode } = await req.json();
    if (!tide_id || !mode) return json({ error: "tide_id and mode required" }, 400);

    const { data: tide, error: tideError } = await supabase
      .from("tides")
      .select("id, title, tide_type, status")
      .eq("id", tide_id)
      .single();
    if (tideError || !tide) return json({ error: "Tide not found" }, 404);

    if (mode === "narrate") return await handleNarration(supabase, tide, isDryRun(req));
    if (mode === "recap") return await handleRecap(supabase, tide);
    return json({ error: "Invalid mode" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// deno-lint-ignore no-explicit-any
async function handleNarration(supabase: any, tide: any, dry: boolean) {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { count: recentMessages } = await supabase
    .from("tide_chat")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id)
    .eq("is_system_message", false)
    .gte("created_at", fifteenMinAgo);

  const { count: recentCheckins } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id)
    .gte("checked_in_at", fifteenMinAgo);

  const { count: totalAttendees } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id);

  const attendees = totalAttendees || 0;
  const checkins = recentCheckins || 0;
  const messages = recentMessages || 0;

  // The numbers, plainly. Also what is posted when the model is unavailable.
  const facts = [
    `${plural(attendees, "keeper", "keepers")} in ${tide.title}.`,
    checkins > 0 ? `${checkins} just checked in.` : null,
    messages > 0 ? `${plural(messages, "message", "messages")} in the last 15 minutes.` : null,
  ].filter(Boolean).join(" ");

  // Only facts worth saying, already worded with the right plurals.
  const lines = [
    `${plural(attendees, "keeper has", "keepers have")} RSVP'd.`,
    checkins > 0 ? `${plural(checkins, "keeper", "keepers")} checked in in the last 15 minutes.` : null,
    messages > 0 ? `${plural(messages, "chat message", "chat messages")} in the last 15 minutes.` : null,
  ].filter(Boolean);

  const prompt = `You are Echo, the fish guide for an aquarium community. Write one short live update for the chat of a live event called "${tide.title}" (a ${tide.tide_type}).

Facts (use only these):
${lines.map((l) => `- ${l}`).join("\n")}

Example of the style: "12 keepers here so far, and 3 just checked in. 🐟"

Rules: one sentence, under 90 characters, correct grammar for each number. Friendly and plain. No greeting. No exclamation points, no em dashes, at most one emoji.`;

  const ai = await generateText(prompt, { maxOutputTokens: 60, temperature: 0.6 });
  const narration = (tidyGenerated(ai.text) || facts).slice(0, 300);
  const source = ai.text ? ai.model : `facts (${ai.reason || "empty"})`;

  if (!dry) {
    await supabase.from("tide_chat").insert({
      tide_id: tide.id,
      author_wallet: "system",
      body: narration,
      is_system_message: true,
    });
  }

  return json({ success: true, dry, narration, source });
}

// deno-lint-ignore no-explicit-any
async function handleRecap(supabase: any, tide: any) {
  const { data, error } = await supabase.rpc("build_tide_recap", { target_tide: tide.id });
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, recap: data });
}
