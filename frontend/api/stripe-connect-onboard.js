/**
 * stripe-connect-onboard.js — Vercel Serverless Function
 *
 * Handles Stripe Connect seller onboarding. Creates a Connected Account for
 * the seller and returns an Account Link URL to complete identity verification
 * and bank account setup.
 *
 * Flow:
 *   1. Frontend calls POST with seller's wallet address + email
 *   2. This endpoint creates (or retrieves) a Stripe Connected Account
 *   3. Returns an onboarding URL → seller completes KYC in Stripe's hosted flow
 *   4. On completion, Stripe redirects back to the provided return_url
 *
 * Environment variables (set in Vercel dashboard):
 *   STRIPE_SECRET_KEY — Stripe secret key (sk_test_... or sk_live_...)
 *   STRIPE_CONNECT_RETURN_URL — URL to redirect seller after onboarding
 *   STRIPE_CONNECT_REFRESH_URL — URL if the onboarding link expires
 *   SUPABASE_URL — Supabase project URL (for storing seller ↔ Stripe mapping)
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ─── GET: Check onboarding status for a seller ───────────────────────────
  if (req.method === "GET") {
    const { wallet } = req.query;
    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet query parameter" });
    }

    try {
      // Look up the seller's Stripe account in Supabase
      const { data, error } = await supabase
        .from("seller_stripe_accounts")
        .select("stripe_account_id, onboarding_complete, created_at")
        .eq("wallet_address", wallet.toLowerCase())
        .single();

      if (error || !data) {
        return res.status(200).json({ connected: false, onboardingComplete: false });
      }

      // Verify with Stripe that the account is fully onboarded
      const account = await stripe.accounts.retrieve(data.stripe_account_id);
      const isComplete = account.charges_enabled && account.payouts_enabled;

      // Update our record if status changed
      if (isComplete && !data.onboarding_complete) {
        await supabase
          .from("seller_stripe_accounts")
          .update({ onboarding_complete: true })
          .eq("wallet_address", wallet.toLowerCase());
      }

      return res.status(200).json({
        connected: true,
        onboardingComplete: isComplete,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        stripeAccountId: data.stripe_account_id,
      });
    } catch (err) {
      console.error("[Stripe Connect] Status check failed:", err);
      return res.status(500).json({ error: "Failed to check onboarding status" });
    }
  }

  // ─── POST: Create or resume onboarding ───────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { walletAddress, email, displayName } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: "Missing walletAddress" });
  }

  const RETURN_URL =
    process.env.STRIPE_CONNECT_RETURN_URL || "https://aquadex.fish/seller/onboarding-complete";
  const REFRESH_URL =
    process.env.STRIPE_CONNECT_REFRESH_URL || "https://aquadex.fish/seller/onboarding-refresh";

  try {
    // Check if seller already has a Stripe account
    const { data: existing } = await supabase
      .from("seller_stripe_accounts")
      .select("stripe_account_id")
      .eq("wallet_address", walletAddress.toLowerCase())
      .single();

    let stripeAccountId;

    if (existing?.stripe_account_id) {
      // Seller already has an account — generate a new onboarding link
      stripeAccountId = existing.stripe_account_id;
    } else {
      // Create a new Stripe Connected Account (Express type for simplest UX)
      const account = await stripe.accounts.create({
        type: "express",
        email: email || undefined,
        metadata: {
          wallet_address: walletAddress.toLowerCase(),
          platform: "aquadex",
        },
        business_profile: {
          name: displayName || "Aquadex Seller",
          product_description: "Live aquarium fish, invertebrates, and coral specimens",
          mcc: "5947", // Gift, card, novelty, and souvenir shops (closest to live fish)
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      // Store the mapping in Supabase
      await supabase.from("seller_stripe_accounts").upsert({
        wallet_address: walletAddress.toLowerCase(),
        stripe_account_id: stripeAccountId,
        email: email || null,
        display_name: displayName || null,
        onboarding_complete: false,
        created_at: new Date().toISOString(),
      });
    }

    // Generate an Account Link for the seller to complete onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      return_url: RETURN_URL,
      refresh_url: REFRESH_URL,
      type: "account_onboarding",
    });

    return res.status(200).json({
      success: true,
      onboardingUrl: accountLink.url,
      stripeAccountId,
    });
  } catch (err) {
    console.error("[Stripe Connect] Onboarding failed:", err);
    return res.status(500).json({
      error: "Failed to create onboarding session",
      details: err.message,
    });
  }
}
