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

// ABI fragments for the fiat settlement + release functions
const MARKETPLACE_ABI = [
  "function purchaseSpecimenFiat(uint256 tokenId, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function purchaseShippingFiat(uint256 tokenId, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function purchaseBatchFiat(uint256 listingId, uint256 quantity, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  // HELD multi-specimen escrow: lock at purchase, release/refund by Stripe hash.
  "function lockMultipleFiat(uint256[] tokenIds, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function releaseFiatMultiEscrow(bytes32 stripePaymentHash)",
  "function refundFiatMultiEscrow(bytes32 stripePaymentHash)",
  // HELD batch escrow: release/refund by Stripe hash (payout deferred to release).
  "function releaseFiatBatchEscrow(bytes32 stripePaymentHash)",
  "function refundFiatBatchEscrow(bytes32 stripePaymentHash)",
  "function releaseFiatShippingEscrow(uint256 tokenId)",
  // v2 fiat refund/dispute (relayer-authorized NFT return; no ETH moves — the
  // USD side is settled via Stripe). Requires the redeployed marketplace.
  "function refundFiatShippingEscrow(uint256 tokenId)",
  "function resolveFiatShippingDispute(uint256 tokenId, bool refundBuyer)",
  // Public getter for the on-chain shipping escrow (authoritative dispatch time
  // + status), used to enforce the seller's post-dispatch safety window.
  "function shippingEscrows(uint256) view returns (uint256 tokenId, address buyer, address seller, uint256 price, uint256 shippingFee, uint256 amountLocked, string trackingNumber, uint256 dispatchTimestamp, uint8 status)",
];

// Mirror of the contract's SHIPPING_SAFETY_WINDOW (3 days). The seller can only
// force a release once this window has elapsed since dispatch; the buyer can
// release any time.
const SHIPPING_SAFETY_WINDOW_SECONDS = 3 * 24 * 60 * 60;

// How long a signed release authorization stays valid. Keeps a captured
// signature from being replayed indefinitely (the on-chain payment hash +
// escrow status already prevent double-release of the same order).
const RELEASE_SIG_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Canonical release-authorization message. MUST match the client builder in
 * frontend/src/services/stripePayments.js byte-for-byte, otherwise the
 * recovered signer won't match and release is rejected.
 */
function buildReleaseAuthMessage({ tokenId, paymentRef, issuedAt }) {
  return [
    "Aquacellum: authorize order release",
    `token:${tokenId ?? ""}`,
    `ref:${paymentRef}`,
    `issued:${issuedAt}`,
  ].join("\n");
}

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
 * Build a marketplace contract bound to the FIAT_RELAYER_ROLE relayer wallet.
 * Shared by settlement and release so the wallet/provider setup lives in one place.
 */
function getMarketplaceContract() {
  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY not configured");
  }
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  const MARKETPLACE_ADDRESS =
    process.env.MARKETPLACE_ADDRESS || "0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF";
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  return new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, wallet);
}

/**
 * Create a Stripe Transfer paying the seller's connected account out of the
 * platform balance. Used for immediate (non-shipping) payouts and for the
 * release-on-arrival payout of held shipping funds.
 */
async function transferToSeller({ sellerStripeAccountId, amountCents, transferGroup, reference }) {
  if (!sellerStripeAccountId) throw new Error("Missing seller Stripe account");
  if (!amountCents || amountCents <= 0) throw new Error("Invalid seller payout amount");
  return await stripe.transfers.create({
    amount: amountCents,
    currency: "usd",
    destination: sellerStripeAccountId,
    ...(transferGroup ? { transfer_group: transferGroup } : {}),
    metadata: { reference: reference || "" },
  });
}

/**
 * Best-effort on-chain asset return for a refunded HELD fiat order.
 *
 * When a fiat order is refunded, the escrowed asset must go back to the seller.
 * The v2 contract exposes relayer-authorized refunds (the pre-v2 crypto-path
 * refund/dispute functions revert for fiat escrows and aren't relayer-callable):
 *   • shipping → refundFiatShippingEscrow(tokenId)  — returns the specimen NFT
 *   • multi    → refundFiatMultiEscrow(hash)         — returns all held NFTs
 *   • batch    → refundFiatBatchEscrow(hash)         — restores juvenile quantity
 *
 * Pickup orders defer settlement, so their NFT never left the listing escrow —
 * nothing to return here; that's handled in-app. Plain "specimen" sales settle
 * immediately (not held). Best-effort: failures (e.g. the contract hasn't been
 * redeployed yet, or a dispute already moved the escrow) are logged, not thrown,
 * so the refund itself still succeeds.
 */
async function returnFiatEscrowAssets(paymentIntentId) {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const md = pi.metadata || {};
    const marketplace = getMarketplaceContract();
    const stripePaymentHash = computeStripePaymentHash(paymentIntentId);

    let tx;
    switch (md.purchaseType) {
      case "shipping":
        if (md.tokenId == null) return { attempted: false, reason: "missing tokenId" };
        tx = await marketplace.refundFiatShippingEscrow(Number(md.tokenId));
        break;
      case "multi":
        tx = await marketplace.refundFiatMultiEscrow(stripePaymentHash);
        break;
      case "batch":
        tx = await marketplace.refundFiatBatchEscrow(stripePaymentHash);
        break;
      default:
        // pickup (NFT still in listing escrow) / specimen (already settled).
        return { attempted: false, reason: `no on-chain return for ${md.purchaseType}` };
    }

    const receipt = await tx.wait();
    console.log(`[Stripe Refund] On-chain assets returned to seller: ${receipt.transactionHash}`);
    return { attempted: true, txHash: receipt.transactionHash };
  } catch (err) {
    console.error(
      "[Stripe Refund] On-chain asset return failed (v2 contract required?):",
      err.message
    );
    return { attempted: true, error: err.message };
  }
}

/**
 * Execute the on-chain fiat settlement transaction.
 */
async function settleOnChain(purchaseType, metadata, paymentIntentId, amountCents) {
  const marketplace = getMarketplaceContract();

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
      // HELD: lock the specimens in escrow (NFTs stay in custody) until the
      // buyer confirms arrival; release transfers them and pays the seller.
      const tokenIds = JSON.parse(metadata.tokenIds).map(Number);
      tx = await marketplace.lockMultipleFiat(
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
          // Valid enum value (CHECK allows pending/settled/failed/disputed/refunded).
          // An unclaimed guest settlement is identified by buyer_wallet IS NULL.
          status: "pending",
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
        // "pickup" (local/in-person) defers its on-chain settlement to release
        // time (the handshake), so the specimen NFT stays escrowed in the
        // marketplace contract until handoff. Shipping and no-handoff sales
        // settle ownership now.
        let settlement;
        if (purchaseType === "pickup") {
          settlement = {
            txHash: null,
            blockNumber: null,
            stripePaymentHash: computeStripePaymentHash(paymentIntentId),
          };
        } else {
          settlement = await settleOnChain(
            purchaseType, metadata, paymentIntentId, amountCents
          );
        }

        // Held types keep the funds in the platform balance until the buyer
        // confirms the handoff/arrival: shipping → live-arrival release; pickup →
        // handshake release; batch/multi → arrival-confirmation release. The
        // on-chain side is already locked at settlement (shipping escrow, batch
        // LOCKED escrow, multi custody); the payout waits for ?action=release.
        // Only immediate no-handoff sales ("specimen") pay the seller here.
        const HELD_TYPES = ["shipping", "pickup", "batch", "multi"];
        let sellerTransferId = null;
        if (!HELD_TYPES.includes(purchaseType)) {
          const sellerPayoutCents = Number(metadata.sellerPayoutCents || 0);
          try {
            const transfer = await transferToSeller({
              sellerStripeAccountId: metadata.sellerStripeAccountId,
              amountCents: sellerPayoutCents,
              transferGroup: metadata.transferGroup,
              reference: paymentIntentId,
            });
            sellerTransferId = transfer.id;
          } catch (payoutErr) {
            // Ownership already settled on-chain; flag the payout for retry
            // rather than failing the whole webhook (Stripe would keep retrying).
            console.error("[Stripe Webhook] Immediate seller payout failed:", payoutErr.message);
          }
        }

        await supabase.from("fiat_settlements").insert({
          stripe_payment_intent_id: paymentIntentId,
          stripe_payment_hash: settlement.stripePaymentHash,
          purchase_type: purchaseType,
          buyer_wallet: metadata.buyerWallet,
          seller_wallet: metadata.sellerWallet,
          amount_cents_usd: amountCents,
          tx_hash: settlement.txHash,
          block_number: settlement.blockNumber,
          // Shipping stays "settled" (paid into escrow/held); the release step
          // records the payout. Non-shipping is fully settled + paid out here.
          status: "settled",
          metadata: JSON.stringify({ ...metadata, sellerTransferId }),
          created_at: new Date().toISOString(),
        });

        console.log(`[Stripe Webhook] Settlement complete: ${settlement.txHash}`);
        return res.status(200).json({
          received: true,
          action: "settled",
          txHash: settlement.txHash,
          sellerTransferId,
          held: HELD_TYPES.includes(purchaseType),
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

    case "charge.refunded": {
      // Stripe-side refund (issued from the dashboard, the refunds API, or a
      // won/lost dispute). Record it so the order history reflects the money
      // movement, then return the escrowed NFT to the seller for HELD shipping
      // orders via the v2 relayer-authorized refundFiatShippingEscrow (see
      // returnFiatShippingNft). Best-effort: on the pre-v2 deployment the return
      // no-ops and the NFT is recovered via the in-app curator flow.
      const charge = event.data.object;
      const paymentIntentId = charge.payment_intent;

      console.warn(`[Stripe Webhook] Refund processed for: ${paymentIntentId}`);

      await supabase
        .from("fiat_settlements")
        .update({ status: "refunded" })
        .eq("stripe_payment_intent_id", paymentIntentId);

      const nftReturn = await returnFiatEscrowAssets(paymentIntentId);

      return res.status(200).json({ received: true, action: "refund_recorded", nftReturn });
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
// RELEASE HANDLER — pay the held shipping funds + release the NFT on arrival
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/stripe?action=release  { tokenId?, sessionId|paymentIntentId, signature, issuedAt, paymentRef }
 *
 * Finalizes a HELD order at handoff:
 *   • shipping → buyer confirms live arrival (or seller after the safety window)
 *   • pickup   → the in-person handshake is verified at the meetup
 *   • batch    → buyer confirms arrival of the juveniles
 *   • multi    → buyer confirms arrival of the specimen set
 * It does two things:
 *   1. On-chain: settle provenance —
 *        shipping → releaseFiatShippingEscrow(tokenId)
 *        pickup   → deferred purchaseSpecimenFiat(tokenId)
 *        batch    → releaseFiatBatchEscrow(hash)   (payout marker; no NFT)
 *        multi    → releaseFiatMultiEscrow(hash)   (transfers all held NFTs)
 *   2. Stripe:   Transfer the held sellerPayoutCents to the seller's account.
 *
 * Ordering: provenance first, money second. If the payout fails after the
 * on-chain release, the order is flagged 'failed' for payout retry (recoverable),
 * rather than leaving the buyer without their specimens.
 *
 * Auth: the caller must supply a wallet signature (personal_sign) over the
 * canonical release message. The recovered signer must be the order's buyer
 * (allowed any time) or seller (allowed only for shipping orders, and only once
 * the on-chain dispatch safety window has elapsed). This stops a third party
 * from triggering release/payout.
 */
async function handleRelease(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const { tokenId: bodyTokenId, paymentIntentId: bodyPI, sessionId } = req.body || {};
  if (!bodyPI && !sessionId) {
    return res.status(400).json({ error: "Missing paymentIntentId or sessionId" });
  }

  // Resolve the PaymentIntent + its metadata. Callers usually only have the
  // Checkout Session id, so accept either.
  let paymentIntentId = bodyPI || null;
  let metadata = {};
  try {
    if (!paymentIntentId && sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
      metadata = session.metadata || {};
    }
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      metadata = pi.metadata || metadata;
    }
  } catch (err) {
    return res.status(400).json({ error: "Could not resolve payment", details: err.message });
  }
  if (!paymentIntentId) {
    return res.status(400).json({ error: "No payment intent found for session" });
  }

  const purchaseType = metadata.purchaseType;
  const HELD_TYPES = ["shipping", "pickup", "batch", "multi"];
  if (!HELD_TYPES.includes(purchaseType)) {
    return res.status(400).json({ error: "Not a held (shipping/pickup/batch/multi) order" });
  }

  // tokenId is only meaningful for the single-specimen held types; batch and
  // multi are released by the Stripe payment hash.
  const tokenId = bodyTokenId != null ? bodyTokenId : metadata.tokenId;
  if ((purchaseType === "shipping" || purchaseType === "pickup") && tokenId == null) {
    return res.status(400).json({ error: "Missing tokenId" });
  }

  // ─── Authorization: verify a buyer/seller wallet signature ───────────────
  // The caller signs the canonical release message with their Privy EOA. We
  // recover the signer and match it against the order's buyer/seller wallet
  // (both stored lowercase in Stripe metadata). No trusted caller: without a
  // valid signature from a party to THIS order, release is refused.
  const { signature, issuedAt, paymentRef } = req.body || {};
  if (!signature || !issuedAt || !paymentRef) {
    return res.status(401).json({ error: "Missing release authorization signature" });
  }

  // Freshness: reject stale (replayed) or future-dated signatures. Allow a
  // small negative skew for client/server clock drift.
  const sigAgeMs = Date.now() - Number(issuedAt);
  if (!Number.isFinite(sigAgeMs) || sigAgeMs > RELEASE_SIG_MAX_AGE_MS || sigAgeMs < -60_000) {
    return res.status(401).json({ error: "Release authorization expired or has an invalid timestamp" });
  }

  // Bind the signature to THIS order: the signed ref must be the session id or
  // the payment intent we just resolved, so a signature for one order can't
  // release another.
  if (paymentRef !== sessionId && paymentRef !== paymentIntentId) {
    return res.status(401).json({ error: "Release authorization does not match this order" });
  }

  // Recover the signer. The message is rebuilt from the raw request values the
  // client signed (bodyTokenId, paymentRef, issuedAt).
  let signer;
  try {
    const message = buildReleaseAuthMessage({
      tokenId: bodyTokenId != null ? bodyTokenId : tokenId,
      paymentRef,
      issuedAt,
    });
    signer = ethers.utils.verifyMessage(message, signature).toLowerCase();
  } catch (err) {
    return res.status(401).json({ error: "Invalid release signature" });
  }

  const buyerWallet = (metadata.buyerWallet || "").toLowerCase();
  const sellerWallet = (metadata.sellerWallet || "").toLowerCase();

  let role;
  if (buyerWallet && signer === buyerWallet) {
    role = "buyer";
  } else if (sellerWallet && signer === sellerWallet) {
    role = "seller";
  } else {
    return res.status(403).json({ error: "Signer is not the buyer or seller for this order" });
  }

  // Seller-initiated release is only allowed for shipping orders (pickup has no
  // dispatch anchor for a safety window — only the buyer confirms the
  // handshake), and only once the on-chain dispatch safety window has elapsed.
  if (role === "seller") {
    if (purchaseType !== "shipping") {
      // pickup/batch/multi have no dispatch anchor for a safety window — only
      // the buyer can confirm the handoff/arrival (or the curator via dispute).
      return res.status(403).json({
        error: "Seller can only force-release a shipping order after its safety window; the buyer confirms other held orders",
      });
    }
    try {
      const marketplace = getMarketplaceContract();
      const escrow = await marketplace.shippingEscrows(Number(tokenId));
      const dispatchTs = Number(escrow.dispatchTimestamp);
      if (!dispatchTs) {
        return res.status(403).json({ error: "Order not dispatched yet; seller cannot release" });
      }
      const windowEndSec = dispatchTs + SHIPPING_SAFETY_WINDOW_SECONDS;
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < windowEndSec) {
        return res.status(403).json({
          error: "Safety window has not elapsed; seller cannot release yet",
          secondsRemaining: windowEndSec - nowSec,
        });
      }
    } catch (err) {
      return res.status(502).json({ error: "Could not verify safety window", details: err.message });
    }
  }

  // 1. On-chain release / settlement (NFT → buyer)
  let txHash = null;
  try {
    const marketplace = getMarketplaceContract();
    const stripePaymentHash = computeStripePaymentHash(paymentIntentId);
    let tx;
    if (purchaseType === "shipping") {
      // Escrow was created at purchase (purchaseShippingFiat); finalize it now
      // that the buyer confirmed live arrival.
      tx = await marketplace.releaseFiatShippingEscrow(Number(tokenId));
    } else if (purchaseType === "pickup") {
      // pickup: settlement was deferred until the in-person handshake. Transfer
      // the NFT now. Idempotent via the Stripe payment hash.
      tx = await marketplace.purchaseSpecimenFiat(
        Number(tokenId),
        metadata.buyerWallet,
        Number(metadata.goodsTotalCents || 0),
        stripePaymentHash
      );
    } else if (purchaseType === "multi") {
      // multi: transfer all held specimen NFTs to the buyer.
      tx = await marketplace.releaseFiatMultiEscrow(stripePaymentHash);
    } else {
      // batch: flip the held escrow marker to RELEASED (no per-unit NFT).
      tx = await marketplace.releaseFiatBatchEscrow(stripePaymentHash);
    }
    const receipt = await tx.wait();
    txHash = receipt.transactionHash;
  } catch (err) {
    console.error("[Stripe Release] On-chain release failed:", err);
    return res.status(200).json({ received: true, action: "release_failed", error: err.message });
  }

  // 2. Stripe payout (held funds → seller)
  try {
    const transfer = await transferToSeller({
      sellerStripeAccountId: metadata.sellerStripeAccountId,
      amountCents: Number(metadata.sellerPayoutCents || 0),
      transferGroup: metadata.transferGroup,
      reference: paymentIntentId,
    });

    await supabase
      .from("fiat_settlements")
      .update({ settled_at: new Date().toISOString() })
      .eq("stripe_payment_intent_id", paymentIntentId);

    return res.status(200).json({
      success: true,
      action: "released",
      txHash,
      transferId: transfer.id,
    });
  } catch (payoutErr) {
    console.error("[Stripe Release] Seller payout failed after NFT release:", payoutErr.message);
    await supabase
      .from("fiat_settlements")
      .update({ status: "failed", error_message: `release payout failed: ${payoutErr.message}` })
      .eq("stripe_payment_intent_id", paymentIntentId);
    return res.status(200).json({
      received: true,
      action: "released_payout_pending",
      txHash,
      error: payoutErr.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFUND HANDLER — refund the buyer when a dispute resolves in their favor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/stripe?action=refund  { paymentIntentId, amountCents? }
 *
 * Refunds the buyer's card. Since shipping funds are HELD in the platform
 * balance (never transferred to the seller until release), a pre-release refund
 * is clean — there's nothing to claw back from the seller.
 *
 * On-chain: for HELD orders the escrowed assets are returned to the seller via
 * the v2 relayer-authorized refunds (best-effort — see returnFiatEscrowAssets):
 * shipping/multi return the NFT(s); batch restores the juvenile quantity. Pickup
 * orders defer settlement, so their NFT never left the listing escrow.
 */
async function handleRefund(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const { paymentIntentId, amountCents } = req.body || {};
  if (!paymentIntentId) {
    return res.status(400).json({ error: "Missing paymentIntentId" });
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amountCents ? { amount: Number(amountCents) } : {}),
    });

    await supabase
      .from("fiat_settlements")
      .update({ status: "refunded" })
      .eq("stripe_payment_intent_id", paymentIntentId);

    // Return the escrowed assets to the seller for HELD orders (best-effort).
    const nftReturn = await returnFiatEscrowAssets(paymentIntentId);

    return res.status(200).json({ success: true, action: "refunded", refundId: refund.id, nftReturn });
  } catch (err) {
    console.error("[Stripe Refund] Refund failed:", err);
    return res.status(500).json({ error: "Refund failed", details: err.message });
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
    case "release":
      return handleRelease(req, res);
    case "refund":
      return handleRefund(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}
