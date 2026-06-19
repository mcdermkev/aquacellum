/**
 * stripe-webhook.js — Vercel Serverless Function
 *
 * Handles Stripe webhook events. When a payment succeeds, this endpoint:
 *   1. Verifies the webhook signature (prevents spoofing)
 *   2. Extracts purchase metadata from the PaymentIntent
 *   3. Calls the appropriate on-chain fiat settlement function via the relayer wallet
 *   4. Records the settlement in Supabase for cross-device sync
 *
 * The relayer wallet must hold the FIAT_RELAYER_ROLE on AquadexMarketplace.
 *
 * Listened events:
 *   - payment_intent.succeeded → triggers NFT transfer
 *   - charge.dispute.created → flags the order for review (future)
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY — Platform Stripe secret key
 *   STRIPE_WEBHOOK_SECRET — Webhook endpoint signing secret (whsec_...)
 *   RELAYER_PRIVATE_KEY — Private key of the wallet holding FIAT_RELAYER_ROLE
 *   RPC_URL — Base Sepolia RPC endpoint
 *   MARKETPLACE_ADDRESS — AquadexMarketplace contract address
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import Stripe from "stripe";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";

let stripe;
try {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
    apiVersion: "2024-06-20",
  });
} catch (e) {
  console.error("[Stripe Webhook] Failed to initialize Stripe SDK:", e.message);
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

// Vercel config: disable body parsing so we can verify the raw webhook signature
export const config = {
  supportsResponseStreaming: false,
};

/**
 * Read raw body from the request stream (needed for Stripe signature verification).
 * Handles both Next.js-style (stream) and Vercel plain function (req.body buffer) cases.
 */
function getRawBody(req) {
  // If Vercel already parsed the body into a Buffer, use it directly
  if (req.body && Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  // If body is a string (Vercel may do this for JSON content-type)
  if (req.body && typeof req.body === "string") {
    return Promise.resolve(Buffer.from(req.body));
  }
  // If body is already parsed as an object, we need to re-stringify it
  // This happens when Vercel auto-parses JSON — we reconstruct it for signature verification
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  // Fallback: read from stream (Next.js with bodyParser: false)
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Compute the on-chain stripePaymentHash from a Stripe PaymentIntent ID.
 * This links the fiat payment to the on-chain settlement record.
 */
function computeStripePaymentHash(paymentIntentId) {
  return ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(paymentIntentId)
  );
}

/**
 * Execute the on-chain fiat settlement transaction.
 */
async function settleOnChain(purchaseType, metadata, paymentIntentId, amountCents) {
  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  const MARKETPLACE_ADDRESS = process.env.MARKETPLACE_ADDRESS || "0x16168B514144e0380610b78d904a4de51ba03Ca3";

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
        tokenId,
        buyerWallet,
        amountCents,
        stripePaymentHash
      );
      break;
    }

    case "shipping": {
      const tokenId = Number(metadata.tokenId);
      tx = await marketplace.purchaseShippingFiat(
        tokenId,
        buyerWallet,
        amountCents,
        stripePaymentHash
      );
      break;
    }

    case "batch": {
      const listingId = Number(metadata.listingId);
      const quantity = Number(metadata.quantity);
      tx = await marketplace.purchaseBatchFiat(
        listingId,
        quantity,
        buyerWallet,
        amountCents,
        stripePaymentHash
      );
      break;
    }

    case "multi": {
      const tokenIds = JSON.parse(metadata.tokenIds).map(Number);
      tx = await marketplace.purchaseMultipleFiat(
        tokenIds,
        buyerWallet,
        amountCents,
        stripePaymentHash
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!stripe) {
    console.error("[Stripe Webhook] Stripe SDK not initialized — STRIPE_SECRET_KEY missing");
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

  // ─── Handle the event ────────────────────────────────────────────────────
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata;
      const purchaseType = metadata?.purchaseType;
      const paymentIntentId = paymentIntent.id;
      const amountCents = paymentIntent.amount;

      if (!purchaseType || !metadata?.buyerWallet) {
        // Not an Aquadex purchase (might be from another integration)
        console.log("[Stripe Webhook] Ignoring non-Aquadex payment:", paymentIntentId);
        return res.status(200).json({ received: true, action: "ignored" });
      }

      console.log(`[Stripe Webhook] Processing ${purchaseType} purchase: ${paymentIntentId}`);

      try {
        // Execute the on-chain settlement
        const settlement = await settleOnChain(
          purchaseType,
          metadata,
          paymentIntentId,
          amountCents
        );

        // Record in Supabase for cross-device sync and order history
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

        // Record the failure for manual retry
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

        // Return 200 so Stripe doesn't retry (we handle retries ourselves)
        // If we returned 500, Stripe would keep retrying the webhook
        return res.status(200).json({
          received: true,
          action: "failed",
          error: err.message,
        });
      }
    }

    case "charge.dispute.created": {
      // A buyer disputed the charge — flag the order for curator review
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
      // A connected account's status changed (seller completed onboarding, etc.)
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
      // Unhandled event type — acknowledge receipt
      return res.status(200).json({ received: true, action: "unhandled" });
  }
}
