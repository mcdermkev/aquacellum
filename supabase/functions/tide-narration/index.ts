/**
 * tide-narration Edge Function
 * 
 * Tide narration and recaps (Task 51).
 * Two modes:
 * 1. Live narration: called every 15 min during a live tide to post a system message summarizing activity
 * 2. Post-event recap: called after tide ends to generate structured recap JSON
 * 
 * Expects body:
 * {
 *   tide_id: UUID,
 *   mode: "narrate" | "recap"
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
    const { tide_id, mode } = await req.json();

    if (!tide_id || !mode) {
      return new Response(JSON.stringify({ error: "tide_id and mode required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Get tide details
    const { data: tide, error: tideError } = await supabase
      .from("tides")
      .select("*")
      .eq("id", tide_id)
      .single();

    if (tideError || !tide) {
      return new Response(JSON.stringify({ error: "Tide not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    if (mode === "narrate") {
      return await handleNarration(supabase, tide);
    } else if (mode === "recap") {
      return await handleRecap(supabase, tide);
    }

    return new Response(JSON.stringify({ error: "Invalid mode" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

async function handleNarration(supabase: any, tide: any) {
  // Get recent activity (last 15 min)
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
    .eq("rsvp_status", "checked_in")
    .gte("checked_in_at", fifteenMinAgo);

  const { count: totalAttendees } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id);

  // Generate narration
  let narration = "";
  if (GEMINI_API_KEY) {
    const prompt = `You are Poseidon, a live event narrator for an aquarium community. Write ONE short, energetic narration message (max 100 chars) for a live event update.

Event: "${tide.title}" (${tide.tide_type})
Stats: ${totalAttendees} attendees, ${recentCheckins} new check-ins, ${recentMessages} messages in last 15 min.

Be concise, use 1 emoji max. Example: "🌊 12 breeders active, 3 just checked in. The current is strong!"`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 60, temperature: 0.8 },
          }),
        }
      );
      const data = await response.json();
      narration = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } catch {}
  }

  if (!narration) {
    narration = `🌊 ${totalAttendees} in the tide. ${recentCheckins > 0 ? `${recentCheckins} just checked in!` : "Activity flowing."}`;
  }

  // Post as system message
  await supabase.from("tide_chat").insert({
    tide_id: tide.id,
    author_wallet: "system",
    body: narration.slice(0, 300),
    is_system_message: true,
  });

  return new Response(JSON.stringify({ success: true, narration }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRecap(supabase: any, tide: any) {
  // Gather recap stats
  const { count: totalAttendees } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id);

  const { count: checkedIn } = await supabase
    .from("tide_attendees")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id)
    .eq("rsvp_status", "checked_in");

  const { count: chatMessages } = await supabase
    .from("tide_chat")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id)
    .eq("is_system_message", false);

  const { count: bidsPlaced } = await supabase
    .from("auction_bids")
    .select("*", { count: "exact", head: true })
    .eq("tide_id", tide.id);

  // Get species from swap sheet
  const { data: swapData } = await supabase
    .from("tide_attendees")
    .select("bringing_species")
    .eq("tide_id", tide.id)
    .not("bringing_species", "eq", "[]");

  const allSpecies = new Set<string>();
  for (const row of (swapData || [])) {
    for (const s of (row.bringing_species || [])) {
      allSpecies.add(s.commonName || s.specCode);
    }
  }

  const stats = {
    total_attendees: totalAttendees || 0,
    checked_in: checkedIn || 0,
    chat_messages: chatMessages || 0,
    bids_placed: bidsPlaced || 0,
    species_traded: allSpecies.size,
    xp_awarded: (checkedIn || 0) * 100 + ((totalAttendees || 0) - (checkedIn || 0)) * 50,
  };

  // Generate AI summary
  let summary = "";
  if (GEMINI_API_KEY) {
    const prompt = `Write a 2-sentence event recap for "${tide.title}" (${tide.tide_type} event). Stats: ${stats.total_attendees} attendees, ${stats.checked_in} checked in, ${stats.chat_messages} chat messages, ${stats.species_traded} species involved. Warm, concise, no emojis.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 100, temperature: 0.5 },
          }),
        }
      );
      const data = await response.json();
      summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } catch {}
  }

  if (!summary) {
    summary = `${tide.title} wrapped up with ${stats.total_attendees} attendees and ${stats.chat_messages} messages exchanged.`;
  }

  const recapContent = { summary, stats, generated_at: new Date().toISOString() };

  // Save recap to tide
  await supabase
    .from("tides")
    .update({ recap_content: recapContent })
    .eq("id", tide.id);

  return new Response(JSON.stringify({ success: true, recap: recapContent }), {
    headers: { "Content-Type": "application/json" },
  });
}
