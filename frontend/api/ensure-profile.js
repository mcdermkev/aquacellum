/**
 * Vercel Serverless Function: /api/ensure-profile
 *
 * Multi-action endpoint (stays within Vercel Hobby 12-function limit).
 *
 * Actions:
 *   POST { action: "ensure-profile", walletAddress, initialData? }
 *     → Creates or retrieves a user profile using service role (bypasses RLS).
 *
 *   POST { action: "discord-feedback", category, description, ... }
 *     → Proxies feedback to Discord webhook (avoids browser CORS block).
 *
 *   POST { walletAddress, initialData? }  (no action field — legacy compat)
 *     → Same as "ensure-profile".
 */

import { createClient } from "@supabase/supabase-js";
import { handleCorsPreFlight } from "./_lib/cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

export default async function handler(req, res) {
  // CORS
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action } = req.body || {};

  // Route to the appropriate handler
  if (action === "discord-feedback") {
    return handleDiscordFeedback(req, res);
  }

  // Default: ensure-profile (supports legacy calls without action field)
  return handleEnsureProfile(req, res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: ensure-profile
// ─────────────────────────────────────────────────────────────────────────────
async function handleEnsureProfile(req, res) {
  const { walletAddress, initialData = {} } = req.body || {};

  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  const normalizedWallet = walletAddress.toLowerCase();

  try {
    // 1. Check if profile exists (exact lowercase match)
    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("wallet_address", normalizedWallet)
      .single();

    if (existing) {
      return res.status(200).json({ data: existing });
    }

    // 2. Case-insensitive fallback for legacy rows with checksum casing
    const { data: legacyRow } = await supabase
      .from("profiles")
      .select("*")
      .ilike("wallet_address", normalizedWallet)
      .single();

    if (legacyRow) {
      // Migrate to lowercase for consistency
      const { data: migrated } = await supabase
        .from("profiles")
        .update({ wallet_address: normalizedWallet })
        .eq("wallet_address", legacyRow.wallet_address)
        .select()
        .single();

      if (migrated) {
        return res.status(200).json({ data: migrated });
      }
      // If migration failed (e.g., unique constraint), return the legacy row as-is
      return res.status(200).json({ data: legacyRow });
    }

    // 3. Create new profile (service role bypasses RLS)
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({
        wallet_address: normalizedWallet,
        display_name: initialData.display_name || null,
        tank_count: initialData.tank_count || 0,
        species_count: initialData.species_count || 0,
        xp_total: initialData.xp_total || 0,
        companion_tier: initialData.companion_tier || "Shallow",
        onboarding_complete: initialData.onboarding_complete ?? false,
      })
      .select()
      .single();

    if (createError) {
      console.error("[ensure-profile] Insert failed:", createError);
      return res.status(500).json({ error: createError.message });
    }

    return res.status(200).json({ data: created });
  } catch (err) {
    console.error("[ensure-profile] Unexpected error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: discord-feedback
// ─────────────────────────────────────────────────────────────────────────────
async function handleDiscordFeedback(req, res) {
  const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK;
  if (!webhookUrl) {
    console.error("[discord-feedback] DISCORD_FEEDBACK_WEBHOOK env var not set");
    return res.status(500).json({ error: "Discord webhook not configured" });
  }

  const { category, description, page_url, screen_size, wallet_address, screenshot_url, created_at } = req.body;

  if (!description || !category) {
    return res.status(400).json({ error: "Missing required fields: category, description" });
  }

  const categoryEmoji = { bug: "\u{1F41B}", feature: "\u{1F4A1}", ux: "\u{1F3A8}", other: "\u{1F4AC}" };
  const categoryColor = { bug: 0xf87171, feature: 0x38bdf8, ux: 0xfbbf24, other: 0x94a3b8 };

  const embed = {
    title: `${categoryEmoji[category] || "\u{1F4AC}"} Beta Feedback: ${category.toUpperCase()}`,
    description: (description || "").slice(0, 1000),
    color: categoryColor[category] || 0x94a3b8,
    fields: [
      { name: "Page", value: page_url || "\u2014", inline: true },
      { name: "Device", value: screen_size || "\u2014", inline: true },
      ...(screenshot_url ? [{ name: "Screenshot", value: `[View](${screenshot_url})` }] : []),
    ],
    footer: { text: `Wallet: ${wallet_address?.slice(0, 8) || "anonymous"}...` },
    timestamp: created_at || new Date().toISOString(),
  };

  try {
    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      console.error("[discord-feedback] Discord API error:", discordRes.status, errText);
      return res.status(502).json({ error: "Discord webhook rejected the payload", status: discordRes.status });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[discord-feedback] Fetch to Discord failed:", err.message);
    return res.status(502).json({ error: "Failed to reach Discord" });
  }
}
