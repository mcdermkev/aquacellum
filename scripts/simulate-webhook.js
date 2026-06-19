/**
 * simulate-webhook.js
 *
 * Simulates a Stripe `payment_intent.succeeded` webhook event against the
 * deployed endpoint at https://aquacellum.com/api/stripe-webhook.
 *
 * This crafts a valid webhook payload with a correct signature using the
 * STRIPE_WEBHOOK_SECRET, so the endpoint accepts it as if Stripe sent it.
 *
 * Targets: Token #5 (active listing, seller = deployer wallet)
 * Buyer: a second test wallet address
 *
 * Run: node scripts/simulate-webhook.js
 */

import crypto from "crypto";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("frontend/.env") });

// ─── Config ────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WEBHOOK_URL = "https://aquacellum.com/api/stripe-webhook";

if (!WEBHOOK_SECRET) {
  console.error("❌ STRIPE_WEBHOOK_SECRET not found in frontend/.env");
  process.exit(1);
}

// Test buyer wallet — using a different address than the seller
const BUYER_WALLET = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0"; // steve's wallet
const SELLER_WALLET = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";
const TOKEN_ID = "5";
const PRICE_CENTS = 2500; // $25.00

// Generate a fake but realistic PaymentIntent ID
const PAYMENT_INTENT_ID = `pi_test_${crypto.randomBytes(16).toString("hex")}`;

// ─── Build the webhook event payload ───────────────────────────────────────────

const event = {
  id: `evt_test_${crypto.randomBytes(16).toString("hex")}`,
  object: "event",
  api_version: "2024-06-20",
  created: Math.floor(Date.now() / 1000),
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: PAYMENT_INTENT_ID,
      object: "payment_intent",
      amount: PRICE_CENTS,
      currency: "usd",
      status: "succeeded",
      metadata: {
        purchaseType: "specimen",
        buyerWallet: BUYER_WALLET.toLowerCase(),
        sellerWallet: SELLER_WALLET.toLowerCase(),
        tokenId: TOKEN_ID,
      },
      created: Math.floor(Date.now() / 1000),
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: `req_test_${crypto.randomBytes(8).toString("hex")}`,
    idempotency_key: null,
  },
};

// ─── Sign the payload (Stripe signature format) ────────────────────────────────

function generateStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

// ─── Send the webhook ──────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Simulate Stripe Webhook (E2E Test)              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("  Event: payment_intent.succeeded");
  console.log(`  Payment Intent: ${PAYMENT_INTENT_ID}`);
  console.log(`  Token ID: ${TOKEN_ID}`);
  console.log(`  Buyer: ${BUYER_WALLET}`);
  console.log(`  Seller: ${SELLER_WALLET}`);
  console.log(`  Amount: $${(PRICE_CENTS / 100).toFixed(2)}`);
  console.log("");

  const payload = JSON.stringify(event);
  const signature = generateStripeSignature(payload, WEBHOOK_SECRET);

  console.log("  Sending webhook to:", WEBHOOK_URL);
  console.log("  Signature:", signature.substring(0, 40) + "...");
  console.log("");

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });

    const statusCode = response.status;
    const responseText = await response.text();
    let responseBody;
    
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }

    console.log(`  Response Status: ${statusCode}`);
    console.log(`  Response Body:`, JSON.stringify(responseBody, null, 2));
    console.log("");

    if (statusCode === 200 && responseBody?.action === "settled") {
      console.log("  ✅ SETTLEMENT SUCCESSFUL!");
      console.log(`     TX Hash: ${responseBody.txHash}`);
      console.log(`     BaseScan: https://sepolia.basescan.org/tx/${responseBody.txHash}`);
      console.log("");
      console.log("  Next: verify on-chain that ownerOf(5) == buyer wallet");
    } else if (statusCode === 200 && responseBody?.action === "failed") {
      console.log("  ⚠️  Webhook received but on-chain settlement FAILED:");
      console.log(`     Error: ${responseBody.error}`);
      console.log("");
      console.log("  Common causes:");
      console.log("  - FIAT_RELAYER_ROLE not granted (we fixed this)");
      console.log("  - Listing not active");
      console.log("  - Insufficient gas");
    } else if (statusCode === 400) {
      console.log("  ❌ Signature verification failed");
      console.log("  Check that STRIPE_WEBHOOK_SECRET matches between local and Vercel");
    } else if (statusCode === 500) {
      console.log("  ❌ Server error — check Vercel function logs");
      console.log("  https://vercel.com/mcdermkev81-4787s-projects/aquacellum/logs");
    } else {
      console.log("  ⚠️  Unexpected response — check Vercel logs for details");
    }
  } catch (err) {
    console.error("  ❌ Network error:", err.message);
  }

  console.log("\n═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
