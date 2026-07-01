/**
 * stripe.js — Consolidated Vercel Serverless Function
 *
 * Combines stripe-webhook and stripe-connect-onboard into a single function
 * to stay within Vercel Hobby plan's 12 serverless function limit.
 *
 * Routing:
 *   /api/stripe?action=webhook         → Stripe webhook handler
 *   /api/stripe?action=connect-onboard  → Stripe Connect seller onboarding
 *   /api/stripe (no action)             → defaults to webhook (for Stripe's POST)
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY — Platform Stripe secret key
 *   STRIPE_WEBHOOK_SECRET — Webhook endpoint signing secret (whsec_...)
 *   RELAYER_PRIVATE_KEY — Private key of the wallet holding FIAT_RELAYER_ROLE
 *   RPC_URL — Base Sepolia RPC endpoint
 *   MARKETPLACE_ADDRESS — AquadexMarketplace contract address
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   STRIPE_CONNECT_RETURN_URL — URL to redirect seller after onboarding
 *   STRIPE_CONNECT_REFRESH_URL — URL if the onboarding link expires
 */

import Stripe from "stripe";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { handleCorsPreFlight } from "./_lib/cors.js";

let stripe;
try {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
    apiVersion: "2024-06-20",
  });
} catch (e) {
  console.error("[Stripe] Failed to initialize Stripe SDK:", e.message);
}

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// ABI fragments for the fiat settlement functions
const MARKETPLACE_ABI = [
  "function purchaseSpecimenFiat(uint256 tokenId, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function purchaseShippingFiat(uint256 tokenId, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function purchaseBatchFiat(uint256 listingId, uint256 quantity, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function purchaseMultipleFiat(uint256[] tokenIds, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
];

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read raw body from the request stream (needed for Stripe signature verification).
 */
function getRawBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (req.body && typeof req.body === "string") {
    return Promise.resolve(Buffer.from(req.body));
  }
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Compute the on-chain stripePaymentHash from a Stripe PaymentIntent ID.
 */
function computeStripePaymentHash(paymentIntentId) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(paymentIntentId));
}

/**
 * Execute the on-chain fiat settlement transaction.
 */
async function settleOnChain(purchaseType, metadata, paymentIntentId, amountCents) {
  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  const MARKETPLACE_ADDRESS =
    process.env.MARKETPLACE_ADDRESS || "0x16168B514144e0380610b78d904a4de51ba03Ca3";

  if (!PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY not configured");
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, wallet);

  const stripePaymentHash = computeStripePaymentHash(paymentIntentId);
  const buyerWallet = metadata.buyerWallet;

  let tx;

  switch (purchaseType) {
    case "specimen": {
      const tokenId = Number(metadata.tokenId);
      tx = await marketplace.purchaseSpecimenFiat(
        tokenId, buyerWallet, amountCents, stripePaymentHash
      );
      break;
    }
    case "shipping": {
      const tokenId = Number(metadata.tokenId);
      tx = await marketplace.purchaseShippingFiat(
        tokenId, buyerWallet, amountCents, stripePaymentHash
      );
      break;
    }
    case "batch": {
      const listingId = Number(metadata.listingId);
      const quantity = Number(metadata.quantity);
      tx = await marketplace.purchaseBatchFiat(
        listingId, quantity, buyerWallet, amountCents, stripePaymentHash
      );
      break;
    }
    case "multi": {
      const tokenIds = JSON.parse(metadata.tokenIds).map(Number);
      tx = await marketplace.purchaseMultipleFiat(
        tokenIds, buyerWallet, amountCents, stripePaymentHash
      );
      break;
    }
    default:
      throw new Error(`Unknown purchaseType in metadata: ${purchaseType}`);
  }

  const receipt = await tx.wait();
  return {
    txHash: receipt.transactionHash,
    stripePaymentHash,
    blockNumber: receipt.blockNumber,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleWebhook(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!stripe) {
    console.error("[Stripe Webhook] Stripe SDK not initialized");
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata;
      const purchaseType = metadata?.purchaseType;
      const paymentIntentId = paymentIntent.id;
      const amountCents = paymentIntent.amount;

      if (!purchaseType || !metadata?.buyerWallet) {
        console.log("[Stripe Webhook] Ignoring non-Aquadex payment:", paymentIntentId);
        return res.status(200).json({ received: true, action: "ignored" });
      }

      // Guest purchases: defer on-chain settlement until buyer links an account
      if (metadata.isGuestPurchase === "true" || metadata.buyerWallet === "guest") {
        console.log(`[Stripe Webhook] Guest purchase — deferring settlement: ${paymentIntentId}`);

        await supabase.from("fiat_settlements").insert({
          stripe_payment_intent_id: paymentIntentId,
          stripe_payment_hash: computeStripePaymentHash(paymentIntentId),
          purchase_type: purchaseType,
          buyer_wallet: null,
          seller_wallet: metadata.sellerWallet,
          amount_cents_usd: amountCents,
          tx_hash: null,
          block_number: null,
          status: "pending_claim",
          metadata: JSON.stringify(metadata),
          created_at: new Date().toISOString(),
        });

        return res.status(200).json({
          received: true,
          action: "deferred_guest",
        });
      }

      console.log(`[Stripe Webhook] Processing ${purchaseType} purchase: ${paymentIntentId}`);

      try {
        const settlement = await settleOnChain(
          purchaseType, metadata, paymentIntentId, amountCents
        );

        await supabase.from("fiat_settlements").insert({
          stripe_payment_intent_id: paymentIntentId,
          stripe_payment_hash: settlement.stripePaymentHash,
          purchase_type: purchaseType,
          buyer_wallet: metadata.buyerWallet,
          seller_wallet: metadata.sellerWallet,
          amount_cents_usd: amountCents,
          tx_hash: settlement.txHash,
          block_number: settlement.blockNumber,
          status: "settled",
          metadata: JSON.stringify(metadata),
          created_at: new Date().toISOString(),
        });

        console.log(`[Stripe Webhook] Settlement complete: ${settlement.txHash}`);
        return res.status(200).json({
          received: true,
          action: "settled",
          txHash: settlement.txHash,
        });
      } catch (err) {
        console.error("[Stripe Webhook] On-chain settlement failed:", err);

        await supabase.from("fiat_settlements").insert({
          stripe_payment_intent_id: paymentIntentId,
          stripe_payment_hash: computeStripePaymentHash(paymentIntentId),
          purchase_type: purchaseType,
          buyer_wallet: metadata.buyerWallet,
          seller_wallet: metadata.sellerWallet,
          amount_cents_usd: amountCents,
          tx_hash: null,
          block_number: null,
          status: "failed",
          error_message: err.message || "Unknown error",
          metadata: JSON.stringify(metadata),
          created_at: new Date().toISOString(),
        });

        return res.status(200).json({
          received: true,
          action: "failed",
          error: err.message,
        });
      }
    }

    case "charge.dispute.created": {
      const dispute = event.data.object;
      const paymentIntentId = dispute.payment_intent;

      console.warn(`[Stripe Webhook] Dispute opened for: ${paymentIntentId}`);

      await supabase
        .from("fiat_settlements")
        .update({ status: "disputed", disputed_at: new Date().toISOString() })
        .eq("stripe_payment_intent_id", paymentIntentId);

      return res.status(200).json({ received: true, action: "dispute_flagged" });
    }

    case "account.updated": {
      const account = event.data.object;
      if (account.charges_enabled && account.payouts_enabled) {
        await supabase
          .from("seller_stripe_accounts")
          .update({ onboarding_complete: true })
          .eq("stripe_account_id", account.id);

        console.log(`[Stripe Webhook] Seller onboarding complete: ${account.id}`);
      }
      return res.status(200).json({ received: true, action: "account_updated" });
    }

    default:
      return res.status(200).json({ received: true, action: "unhandled" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECT ONBOARD HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleConnectOnboard(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, GET, OPTIONS" })) return;

  // ─── GET: Check onboarding status for a seller ───────────────────────────
  if (req.method === "GET") {
    const { wallet } = req.query;
    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet query parameter" });
    }

    try {
      const { data, error } = await supabase
        .from("seller_stripe_accounts")
        .select("stripe_account_id, onboarding_complete, created_at")
        .eq("wallet_address", wallet.toLowerCase())
        .single();

      if (error || !data) {
        return res.status(200).json({ connected: false, onboardingComplete: false });
      }

      const account = await stripe.accounts.retrieve(data.stripe_account_id);
      const isComplete = account.charges_enabled && account.payouts_enabled;

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
    const { data: existing } = await supabase
      .from("seller_stripe_accounts")
      .select("stripe_account_id")
      .eq("wallet_address", walletAddress.toLowerCase())
      .single();

    let stripeAccountId;

    if (existing?.stripe_account_id) {
      stripeAccountId = existing.stripe_account_id;
    } else {
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
          mcc: "5947",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      await supabase.from("seller_stripe_accounts").upsert({
        wallet_address: walletAddress.toLowerCase(),
        stripe_account_id: stripeAccountId,
        email: email || null,
        display_name: displayName || null,
        onboarding_complete: false,
        created_at: new Date().toISOString(),
      });
    }

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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const action = req.query.action || "webhook";

  switch (action) {
    case "webhook":
      return handleWebhook(req, res);
    case "connect-onboard":
      return handleConnectOnboard(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}
