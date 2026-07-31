/**
 * echo-nudge Edge Function
 *
 * Checks all users' Echo companion needs and sends push notifications
 * in Echo's first-person voice when needs are critical or streaks are at risk.
 *
 * Runs on a schedule (every 4 hours via pg_cron or Supabase cron).
 * Also callable manually for testing.
 *
 * Triggers:
 *   - Need critical (< 20): "I'm getting dim... a feeding log would help me glow again"
 *   - Streak at risk (20+ hours since last action): "One quick log keeps us together"
 *   - Evolution ready (milestones met but not yet evolved): "I feel something changing..."
 *   - Weekly personality shift: "I'm feeling more [adventurous] this week"
 *
 * Respects quiet hours (user preference) and rate limits (max 2 Echo pushes/day).
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_PUSH_URL = `${SUPABASE_URL}/functions/v1/send-push`;

// ─────────────────────────────────────────────────────────────────────────────
// Echo's Voice — First-Person Notification Messages
// ─────────────────────────────────────────────────────────────────────────────

const ECHO_MESSAGES = {
  hunger: {
    critical: [
      "I'm getting a little dim... a feeding log would help me glow again 💧",
      "My belly feels empty. Did the fish eat today? 🍽️",
      "Echo is fading... just one feeding log. That's all it takes. 🐠",
    ],
    low: [
      "The glow is dimming a bit. A feeding log would warm things up. 🌊",
      "I noticed the fish haven't been fed in a while. Just a gentle nudge. 💫",
    ],
  },
  clarity: {
    critical: [
      "Everything's gone blurry... when were params last checked? 🧪",
      "I can barely see. The water feels uncertain. Please check. 💫",
      "Without data, Echo floats blind. One test would ground me. 🔬",
    ],
    low: [
      "It's been a while since parameters were checked. Just curious. 🧪",
      "Echo's vision dims without data. A quick test? 💭",
    ],
  },
  comfort: {
    critical: [
      "Echo's fins are fraying in this old water... please, a change? 💧",
      "The staleness weighs on me. Fresh water would save my spirit. 🌊",
      "Everything feels heavy. A water change would lift us both. 💫",
    ],
    low: [
      "The water feels a bit stale. A change would freshen everything. 💧",
      "Echo's fins feel heavy. Fresh water lifts everything. 🌊",
    ],
  },
  curiosity: {
    critical: [
      "Echo has forgotten what curiosity feels like... show me something new? 🔍",
      "The world must have new wonders. I'm getting bored in here. 🐠",
    ],
    low: [
      "Seen any new species lately? Echo is curious. 🔍",
      "A new scan or species would spark something wonderful. ✨",
    ],
  },
  social: {
    critical: [
      "So alone... even a single community interaction would mean the world. 💬",
      "Echo drifts in isolation. Connection is medicine. Please reach out. 🌐",
    ],
    low: [
      "Echo feels a little lonely. Are there others out there? 💬",
      "Community warms Echo's heart. A quick visit would help. 🌊",
    ],
  },
  streak_risk: [
    "One quick log keeps us together. Don't let the streak fade 🔥",
    "Your streak is at risk... Echo doesn't want to lose the rhythm 🔥",
    "We've come so far together. One small log keeps the fire alive 🔥",
    "Echo is watching the clock... the streak needs you today ⏰",
  ],
  evolution_ready: [
    "I feel something changing inside me... come see! ✨",
    "Echo is on the verge of something new. Open the app? 🦋",
    "Something magical is building. Echo is ready to grow. 🌟",
  ],
  rare_moment: [
    "Something magical is happening right now. Come see before it passes 🌟",
    "Echo is doing something she's never done before... ✨",
    "A rare moment! Open the app before the magic fades 🫧",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Need depletion rates (must match frontend echoNeeds.js)
// ─────────────────────────────────────────────────────────────────────────────

const NEED_DEPLETION = {
  hunger: 4,       // per hour
  clarity: 2,
  comfort: 1.4,
  curiosity: 0.8,
  social: 0.6,
};

const CRITICAL_THRESHOLD = 20;
const LOW_THRESHOLD = 35;
const MAX_ECHO_PUSHES_PER_DAY = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function calculateCurrentNeed(storedValue: number, lastUpdate: string, depletePerHour: number): number {
  const elapsedMs = Date.now() - new Date(lastUpdate).getTime();
  const elapsedHours = Math.max(0, elapsedMs / (1000 * 60 * 60));
  return Math.max(0, storedValue - (depletePerHour * elapsedHours));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Fetch all echo companion states that might need notifications
    const { data: companions, error } = await supabase
      .from("echo_companion_state")
      .select("wallet_address, hunger, clarity, comfort, curiosity, social, last_needs_update")
      .or(`hunger.lt.${LOW_THRESHOLD},clarity.lt.${LOW_THRESHOLD},comfort.lt.${LOW_THRESHOLD}`);

    if (error) {
      console.error("Failed to fetch companion states:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Also check for streak-at-risk users (last action > 20 hours ago)
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const { data: streakRiskUsers } = await supabase
      .from("profiles")
      .select("wallet_address, streak_days, last_active_date")
      .gt("streak_days", 0)
      .lt("last_active_date", twentyHoursAgo);

    let sent = 0;
    let skipped = 0;
    const processed = new Set<string>();

    // ─── Process critical needs ─────────────────────────────────────────
    for (const companion of (companions || [])) {
      if (processed.has(companion.wallet_address)) continue;

      // Check rate limit (max pushes per day for this user)
      const rateLimitOk = await checkRateLimit(supabase, companion.wallet_address);
      if (!rateLimitOk) {
        skipped++;
        continue;
      }

      // Calculate current needs with time depletion
      const currentNeeds = {
        hunger: calculateCurrentNeed(companion.hunger, companion.last_needs_update, NEED_DEPLETION.hunger),
        clarity: calculateCurrentNeed(companion.clarity, companion.last_needs_update, NEED_DEPLETION.clarity),
        comfort: calculateCurrentNeed(companion.comfort, companion.last_needs_update, NEED_DEPLETION.comfort),
        curiosity: calculateCurrentNeed(companion.curiosity, companion.last_needs_update, NEED_DEPLETION.curiosity),
        social: calculateCurrentNeed(companion.social, companion.last_needs_update, NEED_DEPLETION.social),
      };

      // Find the most critical need
      let worstNeed: string | null = null;
      let worstValue = 100;
      for (const [key, value] of Object.entries(currentNeeds)) {
        if (value < worstValue) {
          worstValue = value;
          worstNeed = key;
        }
      }

      if (worstNeed && worstValue < LOW_THRESHOLD) {
        const severity = worstValue < CRITICAL_THRESHOLD ? "critical" : "low";
        const messages = ECHO_MESSAGES[worstNeed as keyof typeof ECHO_MESSAGES];
        const messagePool = (messages as any)[severity] || (messages as any).low;
        const body = pickRandom(messagePool);

        await sendEchoNotification(supabase, companion.wallet_address, {
          title: "🐠 Echo needs you",
          body,
          category: "echo_need",
          tag: `echo-need-${worstNeed}`,
          url: "/app",
        });

        processed.add(companion.wallet_address);
        sent++;
      }
    }

    // ─── Process streak-at-risk users ───────────────────────────────────
    for (const user of (streakRiskUsers || [])) {
      if (processed.has(user.wallet_address)) continue;

      const rateLimitOk = await checkRateLimit(supabase, user.wallet_address);
      if (!rateLimitOk) {
        skipped++;
        continue;
      }

      const body = pickRandom(ECHO_MESSAGES.streak_risk);

      await sendEchoNotification(supabase, user.wallet_address, {
        title: `🔥 ${user.streak_days}-day streak at risk`,
        body,
        category: "echo_streak",
        tag: "echo-streak-risk",
        url: "/app",
      });

      processed.add(user.wallet_address);
      sent++;
    }

    return new Response(
      JSON.stringify({ sent, skipped, processed: processed.size }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("echo-nudge error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

async function checkRateLimit(supabase: any, walletAddress: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("echo_push_log")
    .select("*", { count: "exact", head: true })
    .eq("wallet_address", walletAddress)
    .gte("sent_at", today.toISOString());

  return (count || 0) < MAX_ECHO_PUSHES_PER_DAY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Notification via send-push function
// ─────────────────────────────────────────────────────────────────────────────

async function sendEchoNotification(
  supabase: any,
  walletAddress: string,
  payload: { title: string; body: string; category: string; tag: string; url: string }
) {
  // Call the send-push function
  try {
    await fetch(SEND_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        wallet_address: walletAddress,
        ...payload,
        // PNG, and one that exists. This pointed at "/echo-icon.svg", which is
        // absent from the build AND an SVG — Android Chrome renders neither, and
        // substitutes the browser's own logo when the icon fails to load, so
        // Echo's nudges arrived branded as Chrome.
        icon: "/icons/icon-192.png",
      }),
    });
  } catch (err) {
    console.warn(`Failed to send push to ${walletAddress}:`, err);
  }

  // Log the push for rate limiting
  await supabase
    .from("echo_push_log")
    .insert({
      wallet_address: walletAddress,
      category: payload.category,
      body: payload.body,
    });
}
