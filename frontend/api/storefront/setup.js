/**
 * setup.js — Vercel Serverless Function
 *
 * POST /api/storefront/setup
 *
 * Creates or updates a breeder's storefront profile. Used by the
 * "Setup My Store" UI in the app. Gated by a beta allowlist —
 * only wallets in STOREFRONT_BETA_WALLETS env var (or hardcoded list)
 * can create/update profiles during beta.
 *
 * Body:
 *   walletAddress (required) — breeder's wallet
 *   slug (required) — URL slug (3-32 chars, lowercase alphanumeric + hyphens)
 *   displayName (required) — breeder display name
 *   bio — short bio (max 280 chars)
 *   specialties — array of strings (max 5)
 *   location — city/region string
 *
 * Environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   STOREFRONT_BETA_WALLETS — comma-separated wallet addresses (optional override)
 */

import { createClient } from "@supabase/supabase-js";
import { handleCorsPreFlight } from "../_lib/cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Beta allowlist: wallets that can create storefronts before general availability.
// Add your beta testers here or set via STOREFRONT_BETA_WALLETS env var.
const HARDCODED_BETA_WALLETS = [
  "0x53d3c6f4f11b0b08bc1a5034bbce7d46198b6851",
  "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6",
  "0x41e562ee88825ad8d79b48311a30742ac276c9eb",
];

function getBetaWallets() {
  const envWallets = process.env.STOREFRONT_BETA_WALLETS;
  if (envWallets) {
    return envWallets.split(",").map((w) => w.trim().toLowerCase());
  }
  return HARDCODED_BETA_WALLETS.map((w) => w.toLowerCase());
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { walletAddress, slug, displayName, bio, specialties, location } = req.body;

  // ─── Validation ──────────────────────────────────────────────────────────
  if (!walletAddress || !slug || !displayName) {
    return res.status(400).json({
      error: "Missing required fields: walletAddress, slug, displayName",
    });
  }

  const wallet = walletAddress.toLowerCase();

  // Beta gate check
  const betaWallets = getBetaWallets();
  if (!betaWallets.includes(wallet)) {
    return res.status(403).json({
      error: "Storefront creation is currently in beta. Your wallet is not on the allowlist.",
      code: "BETA_GATED",
    });
  }

  // Slug format validation
  if (!SLUG_REGEX.test(slug)) {
    return res.status(400).json({
      error: "Invalid slug. Must be 3-32 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens.",
      code: "INVALID_SLUG",
    });
  }

  // Display name length
  if (displayName.trim().length < 2 || displayName.trim().length > 60) {
    return res.status(400).json({
      error: "Display name must be 2-60 characters.",
      code: "INVALID_NAME",
    });
  }

  // Bio length
  if (bio && bio.length > 280) {
    return res.status(400).json({
      error: "Bio must be 280 characters or fewer.",
      code: "BIO_TOO_LONG",
    });
  }

  // Specialties limit
  if (specialties && specialties.length > 5) {
    return res.status(400).json({
      error: "Maximum 5 specialties allowed.",
      code: "TOO_MANY_SPECIALTIES",
    });
  }

  try {
    // ─── Check slug availability ─────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("breeder_profiles")
      .select("wallet_address")
      .eq("slug", slug)
      .single();

    if (existing && existing.wallet_address !== wallet) {
      return res.status(409).json({
        error: "This slug is already taken. Choose a different one.",
        code: "SLUG_TAKEN",
      });
    }

    // ─── Upsert profile ──────────────────────────────────────────────────────
    const { data: profile, error: upsertError } = await supabase
      .from("breeder_profiles")
      .upsert(
        {
          wallet_address: wallet,
          slug: slug.toLowerCase(),
          display_name: displayName.trim(),
          bio: (bio || "").trim().slice(0, 280),
          specialties: (specialties || []).slice(0, 5),
          location: location ? location.trim().slice(0, 60) : null,
          storefront_active: true,
          is_master_breeder: true, // Beta testers get Master Breeder status
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("[storefront/setup] Upsert error:", upsertError);
      return res.status(500).json({
        error: "Failed to save storefront profile.",
        detail: upsertError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Storefront published successfully.",
      profile: {
        walletAddress: profile.wallet_address,
        slug: profile.slug,
        displayName: profile.display_name,
        storefrontUrl: `https://aquadex.fish/store/${profile.slug}`,
      },
    });
  } catch (err) {
    console.error("[storefront/setup] Error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
