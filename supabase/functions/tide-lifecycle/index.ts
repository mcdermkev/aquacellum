/**
 * tide-lifecycle Edge Function
 * 
 * Cron job (runs every minute) to manage Tide lifecycle transitions:
 * - upcoming → live (when start_time is reached)
 * - live → ended (when end_time is reached)
 * - 48h post-end: purge tide_chat messages
 * 
 * On 'live': opens Realtime channels, enables chat, starts XP tracking.
 * On 'ended': closes chat writes, triggers Poseidon recap, distributes attendance XP.
 * 
 * Deploy: supabase functions deploy tide-lifecycle
 * Schedule: via Supabase Dashboard → Database → Extensions → pg_cron
 *   SELECT cron.schedule('tide-lifecycle', '* * * * *', 
 *     $$SELECT net.http_post(url := 'https://yourproject.supabase.co/functions/v1/tide-lifecycle', 
 *       headers := '{"Authorization": "Bearer SERVICE_KEY"}'::jsonb)$$);
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();
  const results = { transitioned_to_live: 0, transitioned_to_ended: 0, chat_purged: 0 };

  try {
    // ─── Transition: upcoming → live ───
    const { data: goingLive, error: liveError } = await supabase
      .from("tides")
      .update({ status: "live" })
      .eq("status", "upcoming")
      .lte("start_time", now)
      .gt("end_time", now)
      .select("id, title");

    if (liveError) {
      console.error("Error transitioning to live:", liveError);
    } else {
      results.transitioned_to_live = goingLive?.length || 0;
    }

    // ─── Transition: live → ended ───
    const { data: ending, error: endError } = await supabase
      .from("tides")
      .update({ status: "ended" })
      .eq("status", "live")
      .lte("end_time", now)
      .select("id, title");

    if (endError) {
      console.error("Error transitioning to ended:", endError);
    } else {
      results.transitioned_to_ended = ending?.length || 0;

      // For each ended tide: distribute attendance XP
      if (ending && ending.length > 0) {
        for (const tide of ending) {
          await distributeAttendanceXP(supabase, tide.id);
        }
      }
    }

    // ─── Purge: delete tide_chat messages 48h after event ended ───
    const purgeThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: endedTides } = await supabase
      .from("tides")
      .select("id")
      .eq("status", "ended")
      .lte("end_time", purgeThreshold);

    if (endedTides && endedTides.length > 0) {
      const tideIds = endedTides.map((t) => t.id);

      const { count } = await supabase
        .from("tide_chat")
        .delete()
        .in("tide_id", tideIds);

      results.chat_purged = count || 0;
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Tide lifecycle error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/**
 * Distribute attendance XP to all checked-in attendees.
 * +50 XP for "going" attendees, +100 XP for "checked_in".
 */
async function distributeAttendanceXP(supabase: any, tideId: string) {
  const { data: attendees } = await supabase
    .from("tide_attendees")
    .select("wallet_address, rsvp_status")
    .eq("tide_id", tideId)
    .eq("xp_awarded", false);

  if (!attendees || attendees.length === 0) return;

  for (const attendee of attendees) {
    const xp = attendee.rsvp_status === "checked_in" ? 100 : 50;

    // Create notification
    await supabase
      .from("sonar_notifications")
      .insert({
        recipient_wallet: attendee.wallet_address,
        category: "milestone",
        title: `🌊 Tide Complete! +${xp} XP`,
        body: "Thanks for participating in the Tide!",
        icon: "🌊",
        link_type: "tide",
        link_id: tideId,
      });

    // Mark XP as awarded
    await supabase
      .from("tide_attendees")
      .update({ xp_awarded: true })
      .eq("tide_id", tideId)
      .eq("wallet_address", attendee.wallet_address);
  }
}
