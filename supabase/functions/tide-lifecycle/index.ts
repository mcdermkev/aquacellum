/**
 * tide-lifecycle Edge Function
 * 
 * Cron job (runs every minute) to manage Tide lifecycle transitions:
 * - upcoming → live (when start_time is reached)
 * - live → ended (when end_time is reached)
 * - 48h post-end: purge tide_chat messages
 * 
 * On 'ended': builds the recap (build_tide_recap) and tells checked-in keepers.
 * Service-role callers only (_shared/callerRole.ts).
 * 
 * Deploy: supabase functions deploy tide-lifecycle
 * Schedule: via Supabase Dashboard → Database → Extensions → pg_cron
 *   SELECT cron.schedule('tide-lifecycle', '* * * * *', 
 *     $$SELECT net.http_post(url := 'https://yourproject.supabase.co/functions/v1/tide-lifecycle', 
 *       headers := '{"Authorization": "Bearer SERVICE_KEY"}'::jsonb)$$);
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // pg_cron only (it sends the service-role key). This was deployed with JWT
  // verification off, so anyone could run the lifecycle and its XP notices.
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();
  const results = { transitioned_to_live: 0, transitioned_to_ended: 0, chat_purged: 0, recaps_built: 0 };

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

      // For each ended tide: build the recap, then tell the keepers who came.
      // A tide a host ends by hand gets its recap from useEndTide; nothing
      // built one for a tide that simply ran out of time, so its Recap tab
      // never appeared.
      if (ending && ending.length > 0) {
        for (const tide of ending) {
          const { error: recapError } = await supabase.rpc("build_tide_recap", { target_tide: tide.id });
          if (recapError) console.error(`Recap failed for ${tide.id}:`, recapError.message);
          else results.recaps_built++;
          await notifyAttendees(supabase, tide);
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
 * Tell the keepers who checked in that the tide is over and the recap is up.
 *
 * This used to "distribute attendance XP": it sent "+50 XP" / "+100 XP"
 * notices and set tide_attendees.xp_awarded = true, but it never paid any XP.
 * Check-in XP is paid at check-in, claimed with an UPDATE ... WHERE
 * xp_awarded = false (20260817140000_tide_xp_awarded_coherence.sql), so
 * pre-marking a checked-in keeper as paid DENIED them a real claim, and the
 * notices promised XP nobody received. Now it only says the event ended.
 */
// deno-lint-ignore no-explicit-any
async function notifyAttendees(supabase: any, tide: { id: string; title?: string }) {
  const { data: attendees } = await supabase
    .from("tide_attendees")
    .select("wallet_address")
    .eq("tide_id", tide.id)
    .not("checked_in_at", "is", null);

  for (const attendee of attendees || []) {
    await supabase.from("sonar_notifications").insert({
      recipient_wallet: attendee.wallet_address,
      category: "milestone",
      title: `${tide.title || "The tide"} has ended`,
      body: "Thanks for coming. The recap is up.",
      icon: "🌊",
      link_type: "tide",
      link_id: tide.id,
    });
  }
}
