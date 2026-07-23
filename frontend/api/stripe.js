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
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";
import * as shipengine from "./_lib/shipengine.js";
import { captureServerEvent } from "./_lib/posthogServer.js";
import { createSupabaseOrderStore } from "./_lib/supabaseOrderStore.js";
import { isCanonicalSettlementEnabled, settleViaCanonical, recordCanonicalOrderProtected } from "./_lib/canonicalSettlement.js";
import { reserveCheckoutStock, commitCheckoutReservations, releaseCheckoutReservations } from "./_lib/canonicalReservations.js";
import { recordDispatch, recordDelivery, autoAdvanceDeliveryOrders } from "./_lib/canonicalDelivery.js";
import { buildSettlementEffects } from "./_lib/canonicalSettlement.js";
import { openClaim as openDoaClaim, resolveClaim as resolveDoaClaim } from "../src/services/doaClaimService.js";
import { createSupabaseDoaClaimStore } from "./_lib/supabaseDoaClaimStore.js";
// Tier A checkout-discount wiring (Task 21B carve-out): the pure promotion
// evaluator is the SINGLE source of eligibility + discount amount. stripe.js
// consumes it — the engine never imports stripe.js (enforced by a source-guard
// in promotionsEndpoint.catalog.test.js). Applying that discount to the real
// charge (coupon + fee/payout split by funding) lives only here.
import { evaluatePromotion } from "../src/services/promotionEngine.js";
import { computeCheckoutCharge } from "../src/services/checkoutPricing.js";

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
  // Seller (relayer as custodian in the sponsored beta) records dispatch +
  // tracking on-chain, which starts the buyer-protection safety window. Called
  // by the ShipEngine label-purchase flow once a real label + tracking number
  // is bought in-app (see handleShipLabel).
  "function dispatchShipping(uint256 tokenId, string trackingNumber)",
  // Public listing getters — authoritative price source for server-side
  // checkout validation (price is stored as USD cents in v2). Used as a
  // fallback when the cloud aquadex_listings row is unavailable.
  "function listings(uint256) view returns (uint256 tokenId, address seller, uint256 price, uint256 shippingFee, bool active, bool isShipping)",
  "function batchListings(uint256) view returns (uint256 listingId, uint256 spawnId, uint256 quantity, uint256 pricePerFish, address seller, bool isActive)",
];

/**
 * Flat platform handling fee (USD cents) added on top of the carrier rate on
 * every shipping quote. The buyer pays (carrier rate + handling); the platform
 * keeps the handling as margin, on top of the postage it fronts. Configurable
 * via SHIPPING_HANDLING_FEE_CENTS (defaults to $2.00).
 */
function shippingHandlingFeeCents() {
  const v = Number(process.env.SHIPPING_HANDLING_FEE_CENTS);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 200;
}

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
 * Finalize a HELD order: perform the on-chain release (NFT → buyer, or the
 * escrow-marker flip for batch) and pay the held funds out to the seller via
 * Stripe. Shared by the buyer/seller release path (handleRelease) and the
 * scheduled auto-release job (handleAutoRelease).
 *
 * Ordering is provenance-first, money-second: if the payout fails after the
 * on-chain release, the settlement is flagged 'failed' for payout retry rather
 * than leaving the buyer without their specimens. Idempotent at the contract
 * level (a second release of an already-RELEASED escrow reverts and surfaces as
 * a handled release_failed).
 *
 * @returns {Promise<{ok:boolean, action:string, txHash?:string, transferId?:string, error?:string}>}
 */
async function finalizeReleaseAndPayout({ paymentIntentId, metadata, tokenId, purchaseType }) {
  // 1. On-chain release / settlement (NFT → buyer)
  let txHash = null;
  try {
    const marketplace = getMarketplaceContract();
    const stripePaymentHash = computeStripePaymentHash(paymentIntentId);
    let tx;
    if (purchaseType === "shipping") {
      // Escrow was created at purchase (purchaseShippingFiat); finalize it now
      // that arrival is confirmed (buyer, seller-after-window, or auto-release).
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
    return { ok: false, action: "release_failed", error: err.message };
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
    return { ok: true, action: "released", txHash, transferId: transfer.id };
  } catch (payoutErr) {
    console.error("[Stripe Release] Seller payout failed after NFT release:", payoutErr.message);
    await supabase
      .from("fiat_settlements")
      .update({ status: "failed", error_message: `release payout failed: ${payoutErr.message}` })
      .eq("stripe_payment_intent_id", paymentIntentId);
    return { ok: false, action: "released_payout_pending", txHash, error: payoutErr.message };
  }
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

      // Commit the inventory holds now that payment is protected (flagged,
      // best-effort). Done before the guest early-return below so guest and
      // account purchases both convert their bounded hold into a firm one; the
      // hold becomes 'committed' (no TTL) and is consumed at completion. Never
      // blocks the webhook — Stripe would otherwise keep retrying.
      if (isCanonicalSettlementEnabled() && metadata.reservationGroupId) {
        try {
          const committed = await commitCheckoutReservations({ supabase, metadata, now: Date.now() });
          console.log("[Canonical] reservations committed:", JSON.stringify(committed.results || committed));
        } catch (commitErr) {
          console.warn("[Canonical] reservation commit skipped:", commitErr.message);
        }
      }

      // Idempotent promotion redemption (Task 21B — Tier A). If a promo was
      // applied at checkout (metadata.promotionId stamped by handleCreateCheckout),
      // record its consumption and bump used_count EXACTLY ONCE. redeem_promotion
      // is keyed on the PaymentIntent (UNIQUE), so a replayed webhook re-runs it
      // as a no-op — the count can never double. Runs BEFORE the guest early-
      // return so guest and account orders both redeem. Not gated by the
      // canonical flag (promotions are independent). Best-effort: the discount was
      // already applied to the charge, so a redemption hiccup must never fail the
      // webhook (Stripe would otherwise retry indefinitely).
      if (metadata.promotionId) {
        try {
          const { data: counted, error: redeemErr } = await supabase.rpc("redeem_promotion", {
            p_promotion_id: metadata.promotionId,
            p_payment_intent: paymentIntentId,
            p_discount_cents: Number(metadata.promotionDiscountCents || 0),
            p_funding: metadata.promotionFunding || "seller_funded",
            p_seller_wallet: (metadata.sellerWallet || "").toLowerCase(),
            p_buyer_wallet: metadata.buyerWallet ? String(metadata.buyerWallet).toLowerCase() : null,
          });
          if (redeemErr) console.warn("[Promotion] redeem failed:", redeemErr.message);
          else console.log(`[Promotion] ${metadata.promotionId} redeem: ${counted ? "counted" : "already counted (replay)"}`);
        } catch (promoErr) {
          console.warn("[Promotion] redeem skipped:", promoErr.message);
        }
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

        // Also upsert into the orders table so the frontend's pullOrdersFromCloud
        // can discover this order. Without this, fiat orders only exist in
        // fiat_settlements and never surface in the buyer/seller order history.
        const orderTypeMap = { specimen: "instant", shipping: "shipping", batch: "batch", multi: "shipping", pickup: "shipping" };
        const orderStatusMap = { specimen: "completed", shipping: "locked", batch: "pending", multi: "locked", pickup: "pending" };
        const orderItems = metadata.items ? (typeof metadata.items === "string" ? JSON.parse(metadata.items) : metadata.items) : [{ tokenId: metadata.tokenId, commonName: metadata.commonName || "Specimen", priceCents: amountCents }];
        try {
          await supabase.from("orders").insert({
            order_type: orderTypeMap[purchaseType] || "fiat",
            buyer_wallet: (metadata.buyerWallet || "").toLowerCase(),
            seller_wallet: (metadata.sellerWallet || "").toLowerCase(),
            status: orderStatusMap[purchaseType] || "pending",
            subtotal_cents: amountCents,
            shipping_fee_cents: Number(metadata.shippingFeeCents || 0),
            platform_fee_cents: Number(metadata.platformFeeCents || 0),
            total_paid_cents: amountCents,
            items: orderItems,
            quantity: Number(metadata.quantity || 1),
            fulfillment_type: purchaseType === "pickup" ? "in_person" : "shipping",
            stripe_session_id: metadata.stripeSessionId || null,
            stripe_payment_intent: paymentIntentId,
            on_chain_token_id: metadata.tokenId ? Number(metadata.tokenId) : null,
            tx_hash: settlement.txHash,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "stripe_payment_intent", ignoreDuplicates: true });
        } catch (orderInsertErr) {
          // Non-critical: the order will still be discoverable via local sync
          console.warn("[Stripe Webhook] orders table insert failed:", orderInsertErr.message);
        }

        // Canonical order creation (feature-flagged, additive). For held orders,
        // record the canonical order at payment_protected + a charge_captured
        // ledger entry so the canonical lifecycle has a real order to advance
        // (replacing the release-time seeding shortcut). Never blocks the webhook.
        if (isCanonicalSettlementEnabled() && HELD_TYPES.includes(purchaseType)) {
          try {
            const store = createSupabaseOrderStore(supabase);
            const rec = await recordCanonicalOrderProtected({
              store,
              paymentIntentId,
              metadata,
              paymentHash: settlement.stripePaymentHash,
              capturedCents: amountCents,
            });
            console.log(`[Canonical] order ${rec.created ? "created" : "exists"}: ${rec.orderId}`);
            // Read-through: stamp the canonical order id + its line-item ids onto
            // the legacy orders row the buyer's client syncs, so the buyer-facing
            // "report a problem" flow can open a structured DOA claim against the
            // real canonical line items (ArrivalModal). Best-effort — the order
            // is still discoverable without it (falls back to the legacy dispute).
            try {
              await supabase
                .from("orders")
                .update({
                  canonical_order_id: rec.orderId,
                  canonical_line_item_ids: rec.lineItemIds || [],
                })
                .eq("stripe_payment_intent", paymentIntentId);
            } catch (idErr) {
              console.warn("[Canonical] orders canonical-id stamp skipped:", idErr.message);
            }
          } catch (canonErr) {
            console.warn("[Canonical] order creation skipped:", canonErr.message);
          }
        }

        console.log(`[Stripe Webhook] Settlement complete: ${settlement.txHash}`);

        captureServerEvent(metadata.buyerWallet, "marketplace_purchase", {
          purchase_type: purchaseType,
          amount_cents: amountCents,
          payment_method: "fiat",
          held: HELD_TYPES.includes(purchaseType),
        }).catch(() => {});

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

    case "payment_intent.payment_failed": {
      // Buyer's payment failed → release the inventory hold so the stock returns
      // to available immediately rather than waiting out the TTL (flagged path).
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};
      if (isCanonicalSettlementEnabled() && metadata.reservationGroupId) {
        try {
          const released = await releaseCheckoutReservations({ supabase, metadata, now: Date.now() });
          console.log("[Canonical] reservations released (payment_failed):", JSON.stringify(released.results || released));
        } catch (relErr) {
          console.warn("[Canonical] reservation release skipped:", relErr.message);
        }
      }
      return res.status(200).json({ received: true, action: "payment_failed_released" });
    }

    case "checkout.session.expired": {
      // Abandoned checkout → release the hold early (flagged path). Requires the
      // checkout.session.expired event to be enabled on the Stripe endpoint;
      // harmless if it never fires (the TTL is the backstop either way).
      const session = event.data.object;
      const metadata = session.metadata || {};
      if (isCanonicalSettlementEnabled() && metadata.reservationGroupId) {
        try {
          const released = await releaseCheckoutReservations({ supabase, metadata, now: Date.now() });
          console.log("[Canonical] reservations released (session_expired):", JSON.stringify(released.results || released));
        } catch (relErr) {
          console.warn("[Canonical] reservation release skipped:", relErr.message);
        }
      }
      return res.status(200).json({ received: true, action: "session_expired_released" });
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
 * Auth: the caller proves they're a party to THIS order via either (1) a
 * verified Privy session token whose user id matches the buyerUserId captured
 * at checkout (the primary, popup-free path), or (2) a wallet signature over
 * the canonical release message (fallback for self-custody buyers, seller
 * force-release, and legacy orders). Either way the caller resolves to the
 * order's buyer (allowed any time) or seller (shipping only, and only once the
 * on-chain dispatch safety window has elapsed). This stops a third party from
 * triggering release/payout.
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

  // ─── Authorization ───────────────────────────────────────────────────────
  // Two accepted proofs, checked in order:
  //
  //   1. Privy session token (web2-masked, NO wallet popup) — the primary path.
  //      The caller sends "Authorization: Bearer <privy access token>". We
  //      verify it against Privy's JWKS and match the verified Privy user id
  //      against metadata.buyerUserId (captured at checkout). If the verified
  //      token also carries a wallet claim, we accept a match against the
  //      order's buyer/seller wallet too — this covers in-flight orders created
  //      before buyerUserId was stamped.
  //
  //   2. Wallet signature (fallback) — self-custody / MetaMask buyers with no
  //      Privy session, seller force-release, and legacy orders. The caller
  //      signs the canonical release message; we recover the signer and match
  //      it against the order's buyer/seller wallet.
  //
  // Without one of these, tied to THIS order, release is refused.
  const buyerWallet = (metadata.buyerWallet || "").toLowerCase();
  const sellerWallet = (metadata.sellerWallet || "").toLowerCase();
  const buyerUserId = metadata.buyerUserId || null;

  let role = null;

  // Attempt 1: Privy session token (no wallet popup).
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (authHeader) {
    const { verified, userId, walletAddress } = await verifyPrivyToken(req);
    if (verified) {
      const tokenWallet = (walletAddress || "").toLowerCase();
      if (buyerUserId && userId === buyerUserId) {
        role = "buyer";
      } else if (tokenWallet && tokenWallet === buyerWallet) {
        role = "buyer";
      } else if (tokenWallet && tokenWallet === sellerWallet) {
        role = "seller";
      }
    }
  }

  // Attempt 2: wallet signature fallback (self-custody / seller / legacy).
  if (!role) {
    const { signature, issuedAt, paymentRef } = req.body || {};
    if (signature && issuedAt && paymentRef) {
      // Freshness: reject stale (replayed) or future-dated signatures. Allow a
      // small negative skew for client/server clock drift.
      const sigAgeMs = Date.now() - Number(issuedAt);
      if (!Number.isFinite(sigAgeMs) || sigAgeMs > RELEASE_SIG_MAX_AGE_MS || sigAgeMs < -60_000) {
        return res.status(401).json({ error: "Release authorization expired or has an invalid timestamp" });
      }
      // Bind the signature to THIS order: the signed ref must be the session id
      // or the payment intent we just resolved, so a signature for one order
      // can't release another.
      if (paymentRef !== sessionId && paymentRef !== paymentIntentId) {
        return res.status(401).json({ error: "Release authorization does not match this order" });
      }
      // Recover the signer. The message is rebuilt from the raw request values
      // the client signed (bodyTokenId, paymentRef, issuedAt).
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
      if (buyerWallet && signer === buyerWallet) {
        role = "buyer";
      } else if (sellerWallet && signer === sellerWallet) {
        role = "seller";
      } else {
        return res.status(403).json({ error: "Signer is not the buyer or seller for this order" });
      }
    }
  }

  if (!role) {
    return res.status(401).json({ error: "Missing or invalid release authorization" });
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

  // Finalize: on-chain release (NFT → buyer) + held funds → seller. Shared with
  // the scheduled auto-release job so the money/provenance movement lives in one
  // place.
  const result = await finalizeReleaseAndPayout({ paymentIntentId, metadata, tokenId, purchaseType });
  if (result.ok) {
    return res.status(200).json({
      success: true,
      action: result.action,
      txHash: result.txHash,
      transferId: result.transferId,
    });
  }
  // Recoverable payout failure after a successful on-chain release: the buyer
  // has their specimen; the payout is flagged for retry.
  if (result.action === "released_payout_pending") {
    return res.status(200).json({
      received: true,
      action: result.action,
      txHash: result.txHash,
      error: result.error,
    });
  }
  return res.status(200).json({ received: true, action: result.action, error: result.error });
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
/**
 * handleReleaseV2 — FEATURE-FLAGGED canonical settlement path.
 *
 * Runs the same release-on-arrival outcome as handleRelease, but through the
 * canonical settlement engine (state machine + authorization + ledger +
 * settlement coordinator) via the Supabase order store. It transfers the
 * certificate BEFORE paying the seller and never reverses a completed
 * certificate on payout failure (it parks the order at certificate_transferred
 * for retry).
 *
 * Gated by CANONICAL_SETTLEMENT_ENABLED so it can be exercised on testnet +
 * Stripe test mode alongside the untouched legacy handleRelease before cutover.
 * NOTE: this flagged bridge accepts the Privy session token as buyer/seller
 * proof (the wallet-signature fallback used by handleRelease is intentionally
 * out of scope for the flag). Do not enable the flag in production until the
 * end-to-end path has been verified in a live session.
 */
async function handleReleaseV2(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isCanonicalSettlementEnabled()) {
    return res.status(404).json({ error: "Canonical settlement path is not enabled" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const { paymentIntentId: bodyPI, sessionId } = req.body || {};
  if (!bodyPI && !sessionId) {
    return res.status(400).json({ error: "Missing paymentIntentId or sessionId" });
  }

  // Resolve the PaymentIntent + metadata (accept either the session or PI id).
  let paymentIntentId = bodyPI || null;
  let metadata = {};
  let capturedCents = 0;
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
      capturedCents = Number(pi.amount || 0);
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

  // ── Authorization: verified Privy buyer/seller for THIS order ──────────────
  const buyerWallet = (metadata.buyerWallet || "").toLowerCase();
  const sellerWallet = (metadata.sellerWallet || "").toLowerCase();
  const buyerUserId = metadata.buyerUserId || null;
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  let authorized = false;
  if (authHeader) {
    const { verified, userId, walletAddress } = await verifyPrivyToken(req);
    if (verified) {
      const tokenWallet = (walletAddress || "").toLowerCase();
      authorized =
        (buyerUserId && userId === buyerUserId) ||
        (tokenWallet && (tokenWallet === buyerWallet || tokenWallet === sellerWallet));
    }
  }
  if (!authorized) {
    return res.status(401).json({ error: "Missing or invalid release authorization" });
  }

  const tokenId = metadata.tokenId != null ? metadata.tokenId : null;
  if ((purchaseType === "shipping" || purchaseType === "pickup") && tokenId == null) {
    return res.status(400).json({ error: "Missing tokenId" });
  }

  // ── Run canonical settlement (certificate → payout, atomic + idempotent) ───
  try {
    const store = createSupabaseOrderStore(supabase);
    const result = await settleViaCanonical({
      store,
      marketplace: getMarketplaceContract(),
      transferToSeller,
      paymentIntentId,
      metadata,
      tokenId,
      paymentHash: computeStripePaymentHash(paymentIntentId),
      capturedCents,
    });
    // ok:true → completed; ok:false with payout_pending_retry is a recoverable
    // partial (certificate transferred, payout to retry) surfaced as 200 so the
    // caller sees the state without treating it as a hard failure.
    const status = result.ok || result.action === "payout_pending_retry" ? 200 : 400;
    return res.status(status).json({
      success: !!result.ok,
      action: result.action,
      state: result.finalState,
      certificateRef: result.certificateRef,
      transferId: result.transferId,
      error: result.error,
    });
  } catch (err) {
    console.error("[Stripe release-v2] Canonical settlement failed:", err);
    return res.status(500).json({ error: "Settlement failed", details: err.message });
  }
}

async function handleRefund(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  // Authorization: issuing money back to a buyer is an administrative action.
  // Only the trusted backend (CRON_SECRET) or the curator may call it directly.
  // Buyers don't hit this endpoint — they file a dispute (?action=dispute),
  // which a curator then resolves (refund here, or release via the on-chain
  // relayer path). This closes the previously-unauthenticated refund hole.
  const auth = await authorizeAdminOrCurator(req);
  if (!auth.ok) {
    return res.status(auth.status || 403).json({ error: auth.error || "Not authorized to issue refunds" });
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
// AUTHORIZATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Authorize a trusted-administrative request: either the backend/cron (a Bearer
 * token equal to CRON_SECRET) or the curator (a verified Privy token whose
 * wallet matches CURATOR_WALLET). Used to gate money-back refunds.
 *
 * @returns {Promise<{ok:boolean, via?:string, status?:number, error?:string}>}
 */
async function authorizeAdminOrCurator(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  const cronSecret = process.env.CRON_SECRET;

  // 1. Backend / cron secret.
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, via: "cron" };
  }

  // 2. Curator's Privy session token.
  const curatorWallet = (process.env.CURATOR_WALLET || "").toLowerCase();
  if (authHeader.startsWith("Bearer ") && curatorWallet) {
    try {
      const { verified, walletAddress } = await verifyPrivyToken(req);
      if (verified && walletAddress && walletAddress.toLowerCase() === curatorWallet) {
        return { ok: true, via: "curator" };
      }
    } catch (e) {
      // fall through to unauthorized
    }
  }

  return { ok: false, status: 403, error: "Not authorized" };
}

/**
 * Verify that a request came from Vercel Cron (or the trusted backend) by
 * matching the Bearer token to CRON_SECRET. Vercel automatically attaches this
 * header to scheduled cron invocations when CRON_SECRET is configured.
 */
function isCronRequest(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPUTE HANDLER — buyer reports a problem (e.g. dead/sick on arrival)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/stripe?action=dispute  { tokenId?, sessionId|paymentIntentId, reason?, note? }
 * Headers: Authorization: Bearer <privy access token>
 *
 * The buyer flags a problem with a HELD order (the DOA / "arrived dead or sick"
 * path). This does NOT move money — it opens a dispute so a curator can resolve
 * it (refund the buyer here, or release to the seller via the relayer). It:
 *   1. Verifies the caller is the order's buyer (Privy userId === buyerUserId,
 *      or the verified token wallet === buyerWallet).
 *   2. Marks the fiat settlement 'disputed'.
 *   3. For shipping orders still inside the on-chain safety window, opens the
 *      on-chain dispute (disputeShipping) via the relayer so the funds stay
 *      locked; best-effort (the window may have passed / order not dispatched).
 *
 * Money is only returned once a curator calls ?action=refund.
 */
async function handleDispute(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const { tokenId: bodyTokenId, paymentIntentId: bodyPI, sessionId, reason, note } = req.body || {};
  if (!bodyPI && !sessionId) {
    return res.status(400).json({ error: "Missing paymentIntentId or sessionId" });
  }

  // Resolve the PaymentIntent + metadata (callers usually only have sessionId).
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

  // ── Authorization: caller must be the order's buyer ──────────────────────
  const buyerWallet = (metadata.buyerWallet || "").toLowerCase();
  const buyerUserId = metadata.buyerUserId || null;
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  let isBuyer = false;
  if (authHeader) {
    const { verified, userId, walletAddress } = await verifyPrivyToken(req);
    if (verified) {
      const tokenWallet = (walletAddress || "").toLowerCase();
      if ((buyerUserId && userId === buyerUserId) || (tokenWallet && tokenWallet === buyerWallet)) {
        isBuyer = true;
      }
    }
  }
  if (!isBuyer) {
    return res.status(403).json({ error: "Only the buyer can report a problem with this order" });
  }

  const purchaseType = metadata.purchaseType;
  const tokenId = bodyTokenId != null ? bodyTokenId : metadata.tokenId;

  // ── Mark the settlement disputed (money stays held) ──────────────────────
  try {
    await supabase
      .from("fiat_settlements")
      .update({
        status: "disputed",
        disputed_at: new Date().toISOString(),
        dispute_reason: reason || "buyer_reported_problem",
      })
      .eq("stripe_payment_intent_id", paymentIntentId);
  } catch (err) {
    console.warn("[Stripe Dispute] Could not flag settlement disputed:", err.message);
  }

  // ── Open the on-chain dispute for shipping orders (best-effort) ──────────
  // Keeps the escrow locked while the curator reviews. Only valid inside the
  // dispatch safety window; failures (window passed / not dispatched / already
  // resolved) are non-fatal — the off-chain 'disputed' flag still stands.
  let onChain = { attempted: false };
  if (purchaseType === "shipping" && tokenId != null) {
    try {
      const marketplace = getMarketplaceContract();
      const tx = await marketplace.disputeShipping(Number(tokenId));
      const receipt = await tx.wait();
      onChain = { attempted: true, txHash: receipt.transactionHash };
    } catch (err) {
      onChain = { attempted: true, error: err.message };
    }
  }

  return res.status(200).json({
    success: true,
    action: "disputed",
    paymentIntentId,
    reason: reason || "buyer_reported_problem",
    note: note || null,
    onChain,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOA CLAIM HANDLERS — buyer opens / curator resolves a dead-on-arrival claim
// (Task 17). Canonical-only workflow, gated by CANONICAL_SETTLEMENT_ENABLED.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/stripe?action=doa-open
 * Headers: Authorization: Bearer <privy access token>
 * Body: { orderId? | paymentIntentId? | sessionId?, affectedLineItemIds:[...],
 *         evidence:{ photos:[...], description }, claimId? }
 *
 * The buyer opens a dead-on-arrival claim on a delivered order for one or more
 * affected line items. Opening freezes automatic release (order → claim_open,
 * has_open_claim) and marks the affected items doa_claimed; healthy siblings are
 * untouched. The doaClaimService enforces that the caller is THIS order's buyer,
 * the order is in a claim-eligible state, the claim window is still open, and the
 * evidence meets the platform minimum — this handler is thin transport.
 *
 * Money/state effects are on the canonical tables; this does NOT move Stripe
 * funds (a claim only freezes payout — resolution decides the money outcome).
 */
async function handleDoaOpen(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isCanonicalSettlementEnabled()) {
    return res.status(404).json({ error: "Canonical DOA workflow is not enabled" });
  }

  // Auth: verified Privy session. The service authorizes that this user is the
  // order's buyer (Privy DID or wallet match) before opening.
  const { verified, userId, walletAddress } = await verifyPrivyToken(req);
  if (!verified) {
    return res.status(401).json({ error: "Missing or invalid authentication" });
  }

  const { orderId, paymentIntentId, sessionId, affectedLineItemIds, evidence, claimId } = req.body || {};
  if (!Array.isArray(affectedLineItemIds) || affectedLineItemIds.length === 0) {
    return res.status(400).json({ error: "affectedLineItemIds must be a non-empty array" });
  }

  // Resolve the canonical order id: accept it directly, or map a Stripe
  // PaymentIntent / Checkout Session to the canonical order created at checkout.
  let canonicalOrderId = orderId || null;
  try {
    if (!canonicalOrderId) {
      let pi = paymentIntentId || null;
      if (!pi && sessionId && stripe) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        pi = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;
      }
      if (!pi) {
        return res.status(400).json({ error: "Provide orderId, paymentIntentId, or sessionId" });
      }
      const { data } = await supabase
        .from("canonical_orders")
        .select("id")
        .eq("stripe_payment_intent", pi)
        .maybeSingle();
      if (!data) {
        return res.status(404).json({ error: "No order found for this payment" });
      }
      canonicalOrderId = data.id;
    }
  } catch (err) {
    return res.status(400).json({ error: "Could not resolve order", details: err.message });
  }

  try {
    const store = createSupabaseDoaClaimStore(supabase);
    const result = await openDoaClaim({
      store,
      orderId: canonicalOrderId,
      affectedLineItemIds,
      evidence: evidence || {},
      actor: { userId, walletAddress },
      now: Date.now(),
      claimId,
    });
    if (!result.ok) {
      // Business-rule rejections (not the buyer, window closed, bad evidence,
      // unknown line items) are the caller's fault → 400.
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({ success: true, claim: result.claim });
  } catch (err) {
    console.error("[DOA open] failed:", err);
    return res.status(500).json({ error: "Could not open claim", details: err.message });
  }
}

/**
 * POST /api/stripe?action=doa-resolve
 * Headers: Authorization: Bearer <curator privy token | CRON_SECRET>
 * Body: { claimId, resolutions: { "<lineItemId>": { outcome:"refund"|"replace"|"deny",
 *         refundCents?, sellerPortionCents? }, ... } }
 *
 * A curator (or the trusted backend for auto full-refunds) resolves an open DOA
 * claim with a per-line-item outcome. The service applies each outcome
 * atomically across the canonical tables: a refund appends a REFUND ledger
 * entry, a replacement spawns a linked replacement sub-order, a denial passes
 * the item through; healthy siblings are promoted; the release freeze clears and
 * the order rolls up (refunded / partially_resolved / handoff_confirmed).
 *
 * IMPORTANT — accounting vs. money movement: a "refund" outcome records the
 * refund on the canonical ledger and updates state; it does NOT issue the
 * Stripe money-back. Returning funds to the buyer is the separate, separately-
 * authorized ?action=refund step (which also returns the on-chain escrow
 * asset). This mirrors the existing split between ledger accounting and Stripe
 * execution and keeps this endpoint free of card-refund side effects.
 */
async function handleDoaResolve(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isCanonicalSettlementEnabled()) {
    return res.status(404).json({ error: "Canonical DOA workflow is not enabled" });
  }

  // Auth: curator Privy session or trusted backend (CRON_SECRET). Buyers/sellers
  // cannot resolve their own claims.
  const auth = await authorizeAdminOrCurator(req);
  if (!auth.ok) {
    return res.status(auth.status || 403).json({ error: auth.error || "Not authorized to resolve claims" });
  }

  const { claimId, resolutions } = req.body || {};
  if (!claimId || !resolutions || typeof resolutions !== "object") {
    return res.status(400).json({ error: "claimId and resolutions are required" });
  }

  try {
    const store = createSupabaseDoaClaimStore(supabase);
    // A curator adjudicates; the cron/backend actor is 'system' (permitted only
    // for the auto full-refund / partial edges, never for denials).
    const actor = auth.via === "cron" ? { isSystem: true } : { isCurator: true };
    const result = await resolveDoaClaim({ store, claimId, resolutions, actor, now: Date.now() });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({
      success: true,
      claimStatus: result.claimStatus,
      orderState: result.orderState,
      replacementSubOrderIds: result.replacementSubOrderIds,
    });
  } catch (err) {
    console.error("[DOA resolve] failed:", err);
    return res.status(500).json({ error: "Could not resolve claim", details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-RELEASE HANDLER — scheduled release of shipping orders past the window
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET|POST /api/stripe?action=auto-release  (Vercel Cron)
 *
 * Releases HELD shipping orders whose on-chain safety window has elapsed with no
 * open dispute, so a silent buyer never traps the seller's payout. Idempotent:
 * scans fiat_settlements for shipping orders that are settled-but-not-paid-out
 * (settled_at IS NULL), verifies the on-chain escrow is DISPATCHED and past the
 * safety window, then runs the same release+payout as the manual path.
 *
 * Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
 * when CRON_SECRET is configured. Requests without it are rejected.
 */
async function handleAutoRelease(req, res) {
  if (!isCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const MAX_PER_RUN = 50;
  const results = { scanned: 0, released: 0, skipped: 0, failed: 0, details: [] };

  let candidates = [];
  try {
    const { data, error } = await supabase
      .from("fiat_settlements")
      .select("stripe_payment_intent_id, purchase_type, metadata, status, settled_at")
      .eq("purchase_type", "shipping")
      .eq("status", "settled")
      .is("settled_at", null)
      .limit(MAX_PER_RUN);
    if (error) {
      return res.status(500).json({ error: "Could not query settlements", details: error.message });
    }
    candidates = data || [];
  } catch (err) {
    return res.status(500).json({ error: "Settlement query failed", details: err.message });
  }

  const marketplace = getMarketplaceContract();
  const nowSec = Math.floor(Date.now() / 1000);

  for (const row of candidates) {
    results.scanned++;
    const paymentIntentId = row.stripe_payment_intent_id;
    let metadata = {};
    try {
      metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {});
    } catch (e) {
      metadata = {};
    }
    const tokenId = metadata.tokenId != null ? Number(metadata.tokenId) : null;
    if (tokenId == null) {
      results.skipped++;
      continue;
    }

    // Verify the on-chain escrow is DISPATCHED (status 1) and past the window.
    try {
      const escrow = await marketplace.shippingEscrows(tokenId);
      const status = Number(escrow.status); // 0 LOCKED,1 DISPATCHED,2 RELEASED,3 DISPUTED,4 REFUNDED
      const dispatchTs = Number(escrow.dispatchTimestamp);
      if (status !== 1 || !dispatchTs) {
        // Not dispatched yet, or already resolved/disputed → leave it alone.
        results.skipped++;
        continue;
      }
      if (nowSec < dispatchTs + SHIPPING_SAFETY_WINDOW_SECONDS) {
        results.skipped++; // still inside the buyer-protection window
        continue;
      }
    } catch (err) {
      results.skipped++;
      continue;
    }

    // Window elapsed, not disputed → release + pay out.
    const outcome = await finalizeReleaseAndPayout({
      paymentIntentId,
      metadata,
      tokenId,
      purchaseType: "shipping",
    });
    if (outcome.ok) {
      results.released++;
      results.details.push({ paymentIntentId, txHash: outcome.txHash });
    } else {
      results.failed++;
      results.details.push({ paymentIntentId, error: outcome.error, action: outcome.action });
    }
  }

  // ── Canonical delivery-gated pass (Task 16, flagged) ──────────────────────
  // Replaces the legacy "DISPATCHED + 3 days" heuristic above with the
  // delivery-anchored model: mark transit-window-elapsed orders `non_delivery`
  // (never auto-complete them), and auto-complete delivered orders whose claim
  // window elapsed with no open claim (certificate → payout). Runs alongside
  // the legacy pass during the flagged rollout; both are idempotent.
  let canonical = null;
  if (isCanonicalSettlementEnabled()) {
    try {
      const store = createSupabaseOrderStore(supabase);
      const marketplace = getMarketplaceContract();
      // Per-order effects: resolve the PaymentIntent for the seller-payout
      // metadata, then build the certificate-transfer + payout side effects the
      // settlement coordinator drives (certificate BEFORE payout).
      const buildEffectsForOrder = async (order) => {
        let md = {};
        if (order.stripePaymentIntent && stripe) {
          try {
            const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntent);
            md = pi.metadata || {};
          } catch (e) {
            console.warn("[Canonical auto-advance] PI retrieve failed:", e.message);
          }
        }
        return buildSettlementEffects({
          marketplace,
          transferToSeller,
          metadata: md,
          tokenId: md.tokenId ?? null,
          paymentIntentId: order.stripePaymentIntent,
          paymentHash: order.stripePaymentHash,
        });
      };
      canonical = await autoAdvanceDeliveryOrders({ store, now: Date.now(), buildEffectsForOrder });
      console.log("[Canonical] auto-advance:", JSON.stringify({ scanned: canonical.scanned, nonDelivery: canonical.nonDelivery, completed: canonical.completed, failed: canonical.failed }));
    } catch (canonErr) {
      console.warn("[Canonical] auto-advance pass skipped:", canonErr.message);
    }
  }

  return res.status(200).json({ success: true, action: "auto-release", ...results, canonical });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHIPENGINE — buyer-paid live rates + in-app label purchase (auto-dispatch)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Marketplace shipping has no single origin: every order ships seller→buyer.
// So shipping is rated at CHECKOUT from the seller's private origin to the
// buyer's destination (distance-fair, buyer-paid). The seller later buys the
// label in-app; the returned tracking number auto-populates the on-chain
// dispatch (starting the safety window) and the off-chain order row.
//
// Actions:
//   ?action=ship-from     GET/POST  seller's private origin address (CRUD)
//   ?action=ship-validate POST      validate an address via ShipEngine
//   ?action=ship-rates    POST      live expedited rates seller→buyer (public)
//   ?action=ship-label    POST      seller buys the label → tracking auto-fills
//   ?action=ship-webhook  POST      ShipEngine tracking callback → order status

/** Load a seller's stored ship-from origin (or null). Service-role read. */
async function loadShipFrom(sellerWallet) {
  const { data } = await supabase
    .from("seller_ship_from")
    .select("*")
    .eq("wallet_address", sellerWallet.toLowerCase())
    .single();
  return data || null;
}

/** Load a seller's default parcel preset (or a sensible fallback). */
async function loadDefaultParcel(sellerWallet, presetId) {
  let query = supabase
    .from("seller_parcel_presets")
    .select("*")
    .eq("wallet_address", sellerWallet.toLowerCase());
  query = presetId ? query.eq("id", presetId) : query.eq("is_default", true);
  const { data } = await query.limit(1).maybeSingle();
  // Fallback: ~3lb medium insulated box.
  return data || { label: "Default insulated", weight_oz: 48, length_in: 12, width_in: 10, height_in: 8 };
}

/**
 * ?action=parcel-preset — public read of a seller's default (or specified)
 * parcel preset row. GET ?sellerWallet=0x..&presetId=123 (presetId optional).
 *
 * Box dimensions/capacity are not sensitive (unlike the ship-from address,
 * which stays auth-gated) — the buyer-facing cart's box-capacity meter and
 * add-on recommender (Task 11 UI) need this to compute `canAddToParcel` /
 * `planParcels` client-side. No auth required; returns the same shape
 * `loadDefaultParcel` uses server-side (including its fallback), so the
 * client's `normalizeParcelPreset` sees a consistent row shape either way.
 */
async function handleParcelPreset(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, OPTIONS" })) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sellerWallet = req.query.sellerWallet;
  if (!sellerWallet) return res.status(400).json({ error: "Missing sellerWallet query parameter" });

  const presetId = req.query.presetId ? Number(req.query.presetId) : undefined;
  try {
    const preset = await loadDefaultParcel(sellerWallet, presetId);
    return res.status(200).json({ success: true, preset });
  } catch (err) {
    console.warn("[parcel-preset] lookup failed:", err.message);
    return res.status(200).json({ success: true, preset: { label: "Default insulated", weight_oz: 48, length_in: 12, width_in: 10, height_in: 8 } });
  }
}

/**
 * Resolve the caller's lowercased wallet address from a verified Privy
 * token ONLY — never from the request body. Mirrors api/cart.js's
 * requireWallet: a client cannot read/write another seller's parcel presets
 * by supplying a different wallet in the payload (Task 9 Increment 2 §2.4).
 * Sends the 401 response itself when unauthorized; returns null in that case.
 */
async function requireWalletFromSession(req, res) {
  const { verified, walletAddress, error } = await verifyPrivyToken(req);
  if (!verified) {
    res.status(401).json({ error: error || "Missing or invalid authentication" });
    return null;
  }
  if (!walletAddress) {
    res.status(401).json({ error: "Session has no linked account address" });
    return null;
  }
  return walletAddress.toLowerCase();
}

/**
 * Validate + coerce a parcel-preset payload's numeric fields to positive
 * numbers/integers. Returns { ok, value, error }. Bounds are sanity checks,
 * not business limits — the packing engine's own clampPos() is the last
 * line of defense against a garbage row either way.
 */
function validateParcelPresetBody(body = {}) {
  const label = String(body.label || "").trim();
  if (!label) return { ok: false, error: "label is required" };
  if (label.length > 60) return { ok: false, error: "label must be 60 characters or fewer" };

  const numFields = {
    usableWeightOz: body.usableWeightOz,
    maxBags: body.maxBags,
    usableVolumeIn3: body.usableVolumeIn3,
    thermalPackSpaceIn3: body.thermalPackSpaceIn3,
    maxLivestock: body.maxLivestock,
  };
  const value = { label };
  for (const [key, raw] of Object.entries(numFields)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: `${key} must be a positive number` };
    }
    if (n > 100000) {
      return { ok: false, error: `${key} is unreasonably large` };
    }
    value[key] = key === "maxBags" || key === "maxLivestock" ? Math.round(n) : n;
  }
  value.isDefault = !!body.isDefault;
  return { ok: true, value };
}

/** Map a seller_parcel_presets row (new capacity columns) to the client shape. */
function parcelPresetRowToClient(row) {
  return {
    id: row.id,
    label: row.label,
    usableWeightOz: row.usable_weight_oz,
    maxBags: row.max_bags,
    usableVolumeIn3: row.usable_volume_in3,
    thermalPackSpaceIn3: row.thermal_pack_space_in3,
    maxLivestock: row.max_livestock,
    isDefault: !!row.is_default,
    createdAt: row.created_at,
  };
}

/**
 * ?action=parcel-presets — seller's own parcel-preset CRUD (Task 9
 * Increment 2 §2.4). Distinct from the existing public, singular
 * ?action=parcel-preset (read-only, old dimension columns, used by the
 * buyer-facing box-capacity meter) — this is the authenticated editor
 * surface that reads/writes the NEWER capacity columns
 * (usable_weight_oz/max_bags/usable_volume_in3/thermal_pack_space_in3/
 * max_livestock) added by 20260720_packing_capacity.sql, so every value
 * round-trips through packingEngine.normalizeParcelPreset exactly as the
 * seller configured it.
 *
 *   GET    → list the caller's presets
 *   POST   → create a preset for the caller
 *   PUT    → update one of the caller's existing presets (?id=123)
 *   DELETE → remove one of the caller's presets (?id=123)
 *
 * Auth: verified Privy session required for every method. The wallet is
 * derived ONLY from the session token (requireWalletFromSession) — never
 * from the request body — and every mutation re-checks that the target row
 * belongs to that wallet before writing.
 */
async function handleParcelPresets(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, POST, PUT, DELETE, OPTIONS", headers: "Content-Type, Authorization" })) return;

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return; // response already sent

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("seller_parcel_presets")
      .select("*")
      .eq("wallet_address", wallet)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[parcel-presets] GET failed:", error.message);
      return res.status(500).json({ error: "Could not load parcel presets" });
    }
    return res.status(200).json({ success: true, presets: (data || []).map(parcelPresetRowToClient) });
  }

  if (req.method === "POST") {
    const validated = validateParcelPresetBody(req.body || {});
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const row = {
      wallet_address: wallet,
      label: validated.value.label,
      usable_weight_oz: validated.value.usableWeightOz,
      max_bags: validated.value.maxBags,
      usable_volume_in3: validated.value.usableVolumeIn3,
      thermal_pack_space_in3: validated.value.thermalPackSpaceIn3,
      max_livestock: validated.value.maxLivestock,
      is_default: validated.value.isDefault,
      // Legacy NOT NULL columns from the original migration — populate with
      // sane placeholders derived from the capacity fields so the insert
      // never fails on an older schema constraint. Not read by the new
      // editor/normalizeParcelPreset path.
      weight_oz: validated.value.usableWeightOz,
      length_in: 12,
      width_in: 10,
      height_in: 8,
    };

    try {
      const { data, error } = await supabase
        .from("seller_parcel_presets")
        .insert(row)
        .select("*")
        .single();
      if (error) {
        if (String(error.message || "").includes("duplicate")) {
          return res.status(409).json({ error: "A preset with this label already exists" });
        }
        console.error("[parcel-presets] POST failed:", error.message);
        return res.status(500).json({ error: "Could not create parcel preset" });
      }
      return res.status(201).json({ success: true, preset: parcelPresetRowToClient(data) });
    } catch (err) {
      console.error("[parcel-presets] POST error:", err.message);
      return res.status(500).json({ error: "Could not create parcel preset" });
    }
  }

  if (req.method === "PUT") {
    const id = Number(req.query.id ?? req.body?.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Missing or invalid id" });

    const validated = validateParcelPresetBody(req.body || {});
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    // Ownership check before writing — the wallet came from the session, but
    // the ROW must also belong to that wallet, not just the request.
    const { data: existing } = await supabase
      .from("seller_parcel_presets")
      .select("id, wallet_address")
      .eq("id", id)
      .maybeSingle();
    if (!existing || existing.wallet_address !== wallet) {
      return res.status(404).json({ error: "Preset not found" });
    }

    const { data, error } = await supabase
      .from("seller_parcel_presets")
      .update({
        label: validated.value.label,
        usable_weight_oz: validated.value.usableWeightOz,
        max_bags: validated.value.maxBags,
        usable_volume_in3: validated.value.usableVolumeIn3,
        thermal_pack_space_in3: validated.value.thermalPackSpaceIn3,
        max_livestock: validated.value.maxLivestock,
        is_default: validated.value.isDefault,
        weight_oz: validated.value.usableWeightOz,
      })
      .eq("id", id)
      .eq("wallet_address", wallet)
      .select("*")
      .single();
    if (error) {
      console.error("[parcel-presets] PUT failed:", error.message);
      return res.status(500).json({ error: "Could not update parcel preset" });
    }
    return res.status(200).json({ success: true, preset: parcelPresetRowToClient(data) });
  }

  if (req.method === "DELETE") {
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Missing or invalid id" });

    const { data: existing } = await supabase
      .from("seller_parcel_presets")
      .select("id, wallet_address")
      .eq("id", id)
      .maybeSingle();
    if (!existing || existing.wallet_address !== wallet) {
      return res.status(404).json({ error: "Preset not found" });
    }

    const { error } = await supabase
      .from("seller_parcel_presets")
      .delete()
      .eq("id", id)
      .eq("wallet_address", wallet);
    if (error) {
      console.error("[parcel-presets] DELETE failed:", error.message);
      return res.status(500).json({ error: "Could not delete parcel preset" });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/**
 * ?action=ship-from — seller manages their PRIVATE origin address.
 *   GET  ?wallet=0x..   → returns the stored address for the authenticated seller
 *   POST { walletAddress, ...address } → validates + upserts the origin
 *
 * Auth: a verified Privy session is required. The address is sensitive (real
 * pickup location) and never exposed to buyers — only used server-side to rate
 * shipments and buy labels.
 */
async function handleShipFrom(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, POST, OPTIONS", headers: "Content-Type, Authorization" })) return;

  const auth = await verifyPrivyToken(req);
  if (!auth.verified) {
    return res.status(401).json({ error: "Unauthorized", message: auth.error });
  }

  if (req.method === "GET") {
    const wallet = req.query.wallet;
    if (!wallet) return res.status(400).json({ error: "Missing wallet query parameter" });
    const row = await loadShipFrom(wallet);
    if (!row) return res.status(200).json({ configured: false });
    return res.status(200).json({
      configured: true,
      shipFrom: {
        name: row.name,
        phone: row.phone,
        companyName: row.company_name,
        addressLine1: row.address_line1,
        addressLine2: row.address_line2,
        city: row.city_locality,
        state: row.state_province,
        postalCode: row.postal_code,
        countryCode: row.country_code,
        residential: row.address_residential_indicator,
        isValidated: row.is_validated,
      },
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { walletAddress, name, phone, companyName, addressLine1, addressLine2, city, state, postalCode, countryCode, residential } = req.body || {};
  if (!walletAddress || !name || !addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ error: "Missing required fields: walletAddress, name, addressLine1, city, state, postalCode" });
  }

  // Validate deliverability with ShipEngine before saving so bad origins never
  // silently break every future rate quote.
  let validation = { status: "unverified", messages: [] };
  try {
    validation = await shipengine.validateAddress({
      name, phone, company_name: companyName,
      address_line1: addressLine1, address_line2: addressLine2,
      city_locality: city, state_province: state, postal_code: postalCode,
      country_code: countryCode || "US",
    });
  } catch (err) {
    console.warn("[ShipEngine ship-from] Validation call failed:", err.message);
  }

  const isValidated = validation.status === "verified";
  const row = {
    wallet_address: walletAddress.toLowerCase(),
    name,
    phone: phone || null,
    company_name: companyName || null,
    address_line1: addressLine1,
    address_line2: addressLine2 || null,
    city_locality: city,
    state_province: state,
    postal_code: postalCode,
    country_code: countryCode || "US",
    address_residential_indicator: residential || "unknown",
    is_validated: isValidated,
    validated_at: isValidated ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("seller_ship_from")
    .upsert(row, { onConflict: "wallet_address" });
  if (error) {
    return res.status(500).json({ error: "Could not save ship-from address", details: error.message });
  }

  return res.status(200).json({
    success: true,
    validation: { status: validation.status, messages: validation.messages, normalized: validation.normalized || null },
  });
}

/** ?action=ship-validate — validate an arbitrary address (buyer or seller). Public. */
async function handleShipValidate(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: "Missing address" });

  try {
    const result = await shipengine.validateAddress(address);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[ShipEngine validate] failed:", err.message);
    return res.status(502).json({ error: "Address validation failed", details: err.message });
  }
}

/**
 * ?action=ship-rates — live expedited rates from a seller's origin to a buyer's
 * destination. Buyer-facing (used at checkout), so no auth (guest checkout is
 * allowed); the seller's precise origin is NEVER returned — only the rates and
 * coarse heat-pack / ship-window advice derived from it.
 *
 * POST { sellerWallet, shipTo:{name?,addressLine1,city,state,postalCode,countryCode?,residential?}, parcelPresetId? }
 */
async function handleShipRates(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sellerWallet, shipTo, parcelPresetId } = req.body || {};
  if (!sellerWallet || !shipTo || !shipTo.postalCode) {
    return res.status(400).json({ error: "Missing sellerWallet or shipTo.postalCode" });
  }

  const shipFromRow = await loadShipFrom(sellerWallet);
  if (!shipFromRow) {
    return res.status(400).json({
      error: "Seller has not set a ship-from address",
      code: "SELLER_NO_SHIP_FROM",
    });
  }

  const parcel = await loadDefaultParcel(sellerWallet, parcelPresetId);

  try {
    const { rates, errors } = await shipengine.getRates({
      shipFrom: shipFromRow,
      shipTo,
      parcel,
    });

    if (!rates.length) {
      return res.status(200).json({
        success: true,
        rates: [],
        message: "No expedited services available for this route.",
        errors,
      });
    }

    // Add the flat platform handling fee on top of each carrier rate. The buyer
    // pays (carrier rate + handling); amountCents is what they're charged, while
    // carrierAmountCents preserves the raw postage for margin transparency.
    const handling = shippingHandlingFeeCents();
    const markedRates = rates.map((r) => ({
      ...r,
      carrierAmountCents: r.amountCents,
      handlingFeeCents: handling,
      amountCents: r.amountCents + handling,
    }));

    // Coarse, privacy-safe advice from the origin/destination states + season.
    const cheapest = markedRates[0];
    const windowAdvice = shipengine.shippingWindowAdvice(cheapest.deliveryDays);
    const thermalAdvice = shipengine.thermalPackAdvice(shipFromRow.state_province, shipTo.state);

    return res.status(200).json({
      success: true,
      rates: markedRates, // amountCents = carrier + handling (what the buyer pays)
      handlingFeeCents: handling,
      advice: {
        window: windowAdvice,
        thermal: thermalAdvice,
        originState: shipFromRow.state_province, // state only — not the address
      },
    });
  } catch (err) {
    console.error("[ShipEngine rates] failed:", err.message);
    return res.status(502).json({ error: "Could not fetch shipping rates", details: err.message });
  }
}

/**
 * ?action=ship-label — the seller buys a real label in-app. The returned
 * tracking number auto-populates the dispatch: it's written to the order row
 * AND recorded on-chain via dispatchShipping (which starts the safety window).
 *
 * POST {
 *   sellerWallet,                         // required, must be the order's seller
 *   orderId?  | paymentIntentId?,         // locate the order row (optional but recommended)
 *   tokenId,                              // specimen token (on-chain dispatch anchor)
 *   serviceCode, carrierId?,              // the service the buyer paid for at checkout
 *   shipTo,                               // buyer destination address
 *   parcelPresetId?,                      // which box; defaults to seller default
 *   shipDate?                             // ISO date; defaults to today
 * }
 *
 * Auth: verified Privy session. (In the sponsored beta the relayer is the
 * on-chain custodian/seller, so it can call dispatchShipping.)
 */
async function handleShipLabel(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyPrivyToken(req);
  if (!auth.verified) {
    return res.status(401).json({ error: "Unauthorized", message: auth.error });
  }

  const {
    sellerWallet, orderId, paymentIntentId, tokenId,
    serviceCode: bodyService, carrierId: bodyCarrier, shipTo: bodyShipTo,
    parcelPresetId, shipDate,
  } = req.body || {};

  if (!sellerWallet) return res.status(400).json({ error: "Missing sellerWallet" });
  if (tokenId == null) return res.status(400).json({ error: "Missing tokenId" });

  // Load the order row (source of truth for buyer address + paid service) if we
  // can find it. Falls back to values supplied in the request body.
  let orderRow = null;
  try {
    let q = supabase.from("orders").select("*");
    if (orderId) q = q.eq("id", orderId);
    else if (paymentIntentId) q = q.eq("stripe_payment_intent", paymentIntentId);
    else q = q.eq("on_chain_token_id", Number(tokenId));
    const { data } = await q.eq("seller_wallet", sellerWallet.toLowerCase()).limit(1).maybeSingle();
    orderRow = data || null;
  } catch (e) {
    orderRow = null;
  }

  const orderMeta = (() => {
    try { return typeof orderRow?.metadata === "string" ? JSON.parse(orderRow.metadata) : (orderRow?.metadata || {}); }
    catch { return {}; }
  })();

  const shipTo = bodyShipTo || orderMeta.ship_to || orderMeta.shipTo;
  const serviceCode = bodyService || orderRow?.ship_service_code || orderMeta.ship_service_code;
  const carrierId = bodyCarrier || orderRow?.ship_carrier_id || orderMeta.ship_carrier_id;

  if (!shipTo || !shipTo.postalCode) {
    return res.status(400).json({ error: "Missing buyer shipTo address (not on order and not provided)" });
  }
  if (!serviceCode) {
    return res.status(400).json({ error: "Missing serviceCode (the service the buyer paid for)" });
  }

  const shipFromRow = await loadShipFrom(sellerWallet);
  if (!shipFromRow) {
    return res.status(400).json({ error: "Seller has not set a ship-from address", code: "SELLER_NO_SHIP_FROM" });
  }
  const parcel = await loadDefaultParcel(sellerWallet, parcelPresetId);

  // 1. Buy the label from ShipEngine (re-rates the shipment for the paid
  //    service, since checkout rate_ids expire).
  let label;
  try {
    label = await shipengine.buyLabelFromShipment({
      shipFrom: shipFromRow,
      shipTo,
      parcel,
      serviceCode,
      carrierId,
      shipDate,
    });
  } catch (err) {
    console.error("[ShipEngine label] purchase failed:", err.message);
    return res.status(502).json({ error: "Label purchase failed", details: err.message });
  }

  if (!label.trackingNumber) {
    return res.status(502).json({ error: "Label purchased but no tracking number returned", label });
  }

  // 2. Record dispatch on-chain (starts the buyer-protection safety window).
  //    Best-effort: the off-chain order row is the display source of truth, but
  //    a failure here means the safety-window/auto-release won't fire, so we
  //    surface it. dispatchShipping requires the escrow to be LOCKED and the
  //    caller to be the escrow seller (the relayer custodian in beta).
  let onChain = { attempted: true };
  try {
    const marketplace = getMarketplaceContract();
    const tx = await marketplace.dispatchShipping(Number(tokenId), label.trackingNumber);
    const receipt = await tx.wait();
    onChain.txHash = receipt.transactionHash;
  } catch (err) {
    onChain.error = err.reason || err.message;
    console.warn("[ShipEngine label] on-chain dispatch failed (tracking still recorded off-chain):", onChain.error);
  }

  // 3. Compute the shipping margin. The buyer paid (carrier rate + handling) as
  //    their shipping fee at checkout; the platform just paid the real postage
  //    (label.costCents). Realized margin = what the buyer paid − postage. We
  //    resolve the buyer-paid shipping authoritatively from the Stripe
  //    PaymentIntent metadata (stamped at checkout), falling back to the order
  //    row. The intended handling fee is recorded alongside so intended-vs-
  //    realized drift (rate changes between quote and label buy) is visible.
  const handlingFee = shippingHandlingFeeCents();
  let buyerShippingCents = null;
  try {
    const piId = orderRow?.stripe_payment_intent || paymentIntentId;
    if (piId && stripe) {
      const intent = await stripe.paymentIntents.retrieve(piId);
      const v = Number(intent.metadata?.shippingFeeCents);
      if (Number.isFinite(v) && v > 0) buyerShippingCents = v;
    }
  } catch (e) {
    // non-fatal — fall back to the order row below
  }
  if (buyerShippingCents == null && orderRow?.shipping_fee_cents != null) {
    buyerShippingCents = Number(orderRow.shipping_fee_cents);
  }
  const marginCents =
    buyerShippingCents != null && label.costCents != null
      ? buyerShippingCents - label.costCents
      : null;

  // 4. Update the order row: tracking, carrier, dispatch time, ShipEngine refs.
  const nowIso = new Date().toISOString();
  const carrierCode = (label.carrierCode || "").toLowerCase();
  const normalizedCarrier =
    carrierCode.includes("usps") || carrierCode.includes("stamps") ? "usps"
    : carrierCode.includes("ups") ? "ups"
    : carrierCode.includes("fedex") ? "fedex"
    : "other";

  if (orderRow) {
    try {
      await supabase
        .from("orders")
        .update({
          status: "dispatched",
          tracking_number: label.trackingNumber,
          carrier: normalizedCarrier,
          dispatch_timestamp: nowIso,
          arrival_status: "transit",
          estimated_delivery: label.estimatedDeliveryDate || null,
          shipengine_shipment_id: label.shipmentId || null,
          shipengine_label_id: label.labelId || null,
          ship_service_code: label.serviceCode || serviceCode,
          ship_carrier_id: label.carrierId || carrierId || null,
          label_url: label.labelPdfUrl || null,
          label_cost_cents: label.costCents ?? null,
          shipping_quote_cents: buyerShippingCents ?? null,
          updated_at: nowIso,
        })
        .eq("id", orderRow.id);
    } catch (err) {
      console.warn("[ShipEngine label] order row update failed:", err.message);
    }
  }

  // 5. Append to the authoritative shipping-margin ledger (independent of the
  //    order-sync layer) so platform shipping P&L is always reconcilable.
  try {
    await supabase.from("shipping_label_purchases").insert({
      order_id: orderRow?.id || null,
      seller_wallet: sellerWallet.toLowerCase(),
      token_id: Number(tokenId),
      stripe_payment_intent: orderRow?.stripe_payment_intent || paymentIntentId || null,
      carrier: normalizedCarrier,
      service_code: label.serviceCode || serviceCode,
      shipengine_label_id: label.labelId || null,
      tracking_number: label.trackingNumber,
      buyer_shipping_cents: buyerShippingCents,
      label_cost_cents: label.costCents ?? null,
      handling_fee_cents: handlingFee,
      margin_cents: marginCents,
      created_at: nowIso,
    });
  } catch (err) {
    console.warn("[ShipEngine label] margin ledger insert failed:", err.message);
  }

  // Advance the canonical order into transit and stamp the tracking number +
  // dispatch time (Task 16). The tracking number is how the later delivery
  // webhook maps back to this order; dispatchedAtMs anchors the max-transit /
  // non-delivery window. Flagged + best-effort — never blocks the label buy.
  if (isCanonicalSettlementEnabled()) {
    try {
      const store = createSupabaseOrderStore(supabase);
      const rec = await recordDispatch({
        store,
        paymentIntentId: orderRow?.stripe_payment_intent || paymentIntentId || null,
        trackingNumber: label.trackingNumber,
        dispatchedAtMs: Date.now(),
      });
      console.log(`[Canonical] dispatch recorded: ${rec.skipped ? "skipped (no order)" : rec.state}`);
    } catch (dispatchErr) {
      console.warn("[Canonical] dispatch record skipped:", dispatchErr.message);
    }
  }

  return res.status(200).json({
    success: true,
    action: "label_purchased",
    trackingNumber: label.trackingNumber,
    carrier: normalizedCarrier,
    labelUrl: label.labelPdfUrl,
    labelCostCents: label.costCents,
    buyerShippingCents,
    handlingFeeCents: handlingFee,
    marginCents,
    estimatedDeliveryDate: label.estimatedDeliveryDate,
    shipmentId: label.shipmentId,
    labelId: label.labelId,
    onChain,
  });
}

/**
 * ?action=ship-webhook — ShipEngine tracking callback. Configure a ShipEngine
 * environment webhook (event "track") pointing at:
 *   {SITE}/api/stripe?action=ship-webhook&secret={SHIPENGINE_WEBHOOK_SECRET}
 *
 * We verify the shared secret, then advance the matching order's arrival_status
 * from the tracking status_code (DE=delivered → 'arrived'; IT/AT → 'transit').
 * Delivery is the signal that starts the buyer's live-arrival confirmation
 * clock — the escrow release itself still runs through ?action=release.
 */
async function handleShipWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expected = process.env.SHIPENGINE_WEBHOOK_SECRET;
  const provided = req.query.secret;
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "Invalid webhook secret" });
  }

  const body = req.body || {};
  // ShipEngine track webhook payload: { resource_type: 'API_TRACK', data: { tracking_number, status_code, status_description, carrier_code, ... } }
  const data = body.data || body;
  const trackingNumber = data.tracking_number || data.trackingNumber;
  const statusCode = (data.status_code || data.statusCode || "").toUpperCase();

  if (!trackingNumber) {
    return res.status(200).json({ received: true, action: "ignored_no_tracking" });
  }

  // Map ShipEngine status codes to our arrival_status.
  //   DE = Delivered, IT = In Transit, AT = Attempted, EX = Exception, UN = Unknown
  let arrivalStatus = null;
  let orderStatus = null;
  if (statusCode === "DE") {
    arrivalStatus = "arrived";
  } else if (statusCode === "IT" || statusCode === "AT" || statusCode === "AC") {
    arrivalStatus = "transit";
  }

  try {
    const patch = { updated_at: new Date().toISOString() };
    if (arrivalStatus) patch.arrival_status = arrivalStatus;
    if (arrivalStatus === "arrived") patch.arrived_at = new Date().toISOString();
    if (orderStatus) patch.status = orderStatus;
    await supabase.from("orders").update(patch).eq("tracking_number", trackingNumber);
  } catch (err) {
    console.warn("[ShipEngine webhook] order update failed:", err.message);
  }

  // A verified DELIVERED event advances the canonical order in_transit →
  // delivered and stamps deliveredAtMs — the anchor the DOA claim window and
  // the auto-complete deadline read (Task 16). This is what makes the buyer's
  // "report a problem" (DOA) path claim-eligible. Flagged + best-effort;
  // duplicate delivery webhooks are idempotent no-ops. Driver/carrier proof
  // alone never advances past `delivered` — buyer confirmation or claim-window
  // expiry is still required for release.
  if (statusCode === "DE" && isCanonicalSettlementEnabled()) {
    try {
      const store = createSupabaseOrderStore(supabase);
      const rec = await recordDelivery({ store, trackingNumber, deliveredAtMs: Date.now() });
      console.log(`[Canonical] delivery recorded: ${rec.skipped ? "skipped (no order)" : rec.state}`);
    } catch (deliveryErr) {
      console.warn("[Canonical] delivery record skipped:", deliveryErr.message);
    }
  }

  return res.status(200).json({ received: true, action: "tracking_updated", statusCode, arrivalStatus });
}

/**
 * ?action=ship-margin — platform shipping P&L (admin/curator only).
 * Returns all-time totals + recent monthly rollups from the margin ledger.
 * GET (no body). Auth: CRON_SECRET bearer or curator Privy session.
 */
async function handleShipMargin(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, OPTIONS", headers: "Content-Type, Authorization" })) return;

  const auth = await authorizeAdminOrCurator(req);
  if (!auth.ok) {
    return res.status(auth.status || 403).json({ error: auth.error || "Not authorized" });
  }

  try {
    const [{ data: totals }, { data: monthly }] = await Promise.all([
      supabase.from("shipping_margin_totals").select("*").maybeSingle(),
      supabase.from("shipping_margin_analytics").select("*").limit(12),
    ]);
    return res.status(200).json({
      success: true,
      totals: totals || {
        labels_bought: 0, shipping_collected_cents: 0, postage_paid_cents: 0,
        intended_margin_cents: 0, realized_margin_cents: 0, avg_margin_per_shipment_cents: 0,
      },
      monthly: monthly || [],
    });
  } catch (err) {
    console.error("[ShipEngine margin] query failed:", err.message);
    return res.status(500).json({ error: "Could not load shipping margin", details: err.message });
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
    case "create-checkout":
      return handleCreateCheckout(req, res);
    case "preview-promo":
      return handlePreviewPromo(req, res);
    case "connect-onboard":
      return handleConnectOnboard(req, res);
    case "release":
      return handleRelease(req, res);
    case "release-v2":
      return handleReleaseV2(req, res);
    case "refund":
      return handleRefund(req, res);
    case "dispute":
      return handleDispute(req, res);
    case "doa-open":
      return handleDoaOpen(req, res);
    case "doa-resolve":
      return handleDoaResolve(req, res);
    case "auto-release":
      return handleAutoRelease(req, res);
    // ── ShipEngine (buyer-paid live shipping) ──
    case "ship-from":
      return handleShipFrom(req, res);
    case "ship-validate":
      return handleShipValidate(req, res);
    case "ship-rates":
      return handleShipRates(req, res);
    case "ship-label":
      return handleShipLabel(req, res);
    case "ship-webhook":
      return handleShipWebhook(req, res);
    case "ship-margin":
      return handleShipMargin(req, res);
    case "parcel-preset":
      return handleParcelPreset(req, res);
    case "parcel-presets":
      return handleParcelPresets(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE-CHECKOUT HANDLER (previously /api/create-checkout)
// POST /api/stripe?action=create-checkout — build a Stripe Checkout Session.
//
// Funds are captured into the platform balance and HELD, then paid out to the
// seller via a later Stripe Transfer (see handleWebhook / handleRelease). The
// platform keeps the 4% goods fee and the full shipping fee (it buys the label
// centrally on ShipEngine); the seller receives 96% of the goods price.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the AUTHORITATIVE goods price (USD cents) for a listing, server-side.
 *
 * SECURITY: never trust the client-supplied priceCentsUSD in the checkout
 * request — a tampered request could otherwise buy a specimen for a penny. The
 * seller's own listing price is the source of truth. We read it from the synced
 * aquadex_listings row (data blob), falling back to the on-chain listing getter
 * (v2 stores price as USD cents). Returns null if the price can't be verified,
 * in which case checkout is rejected (fail-closed).
 *
 * @param {{ id: string|number, isBatch?: boolean }} ref
 * @returns {Promise<{ goodsCents:number, sellerAddress:(string|null), active:boolean }|null>}
 */
async function resolveAuthoritativeListing({ id, isBatch = false }) {
  const lookupId = String(id);

  // 1. Cloud source of truth — aquadex_listings.data holds the full listing.
  try {
    const { data: row } = await supabase
      .from("aquadex_listings")
      .select("data, seller_address, is_active")
      .eq("id", lookupId)
      .maybeSingle();
    if (row) {
      let parsed = {};
      try {
        parsed = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
      } catch { /* fall through to on-chain */ }
      const goodsCents =
        Number(parsed.priceCentsUSD) ||
        Math.round(parseFloat(parsed.priceUsd ?? parsed.price ?? "0") * 100);
      if (goodsCents > 0) {
        return {
          goodsCents,
          sellerAddress: (row.seller_address || parsed.seller || "").toLowerCase() || null,
          active: row.is_active !== false,
        };
      }
    }
  } catch (e) {
    console.warn("[Checkout] Supabase price lookup failed:", e.message);
  }

  // 2. On-chain fallback (price stored as USD cents in v2).
  try {
    const marketplace = getMarketplaceContract();
    if (isBatch) {
      const b = await marketplace.batchListings(Number(id));
      const cents = Number(b.pricePerFish.toString());
      if (cents > 0) {
        return { goodsCents: cents, sellerAddress: (b.seller || "").toLowerCase() || null, active: !!b.isActive };
      }
    } else {
      const l = await marketplace.listings(Number(id));
      const cents = Number(l.price.toString());
      if (cents > 0) {
        return { goodsCents: cents, sellerAddress: (l.seller || "").toLowerCase() || null, active: !!l.active };
      }
    }
  } catch (e) {
    console.warn("[Checkout] On-chain price lookup failed:", e.message);
  }

  return null;
}

/**
 * Resolve the reservation targets (sku + quantity + authoritative on-hand stock)
 * for a starting checkout, so the reserve_stock oversell guard has a real
 * denominator. Specimen/shipping/pickup/multi are unique NFTs (stock 1 each);
 * a batch's on-hand count is the authoritative on-chain batchListings.quantity.
 *
 * @param {string} purchaseType
 * @param {Array<Object>} items
 * @returns {Promise<Array<{ sku:string, quantity:number, totalStock:number }>>}
 */
async function resolveReservationTargets(purchaseType, items) {
  if (purchaseType === "batch") {
    const it = items[0];
    let stock = 0;
    try {
      const marketplace = getMarketplaceContract();
      const b = await marketplace.batchListings(Number(it.listingId));
      stock = Number(b.quantity.toString());
    } catch (e) {
      console.warn("[Checkout] Could not resolve batch stock on-chain:", e.message);
      stock = 0;
    }
    return [{ sku: String(it.listingId), quantity: Number(it.quantity) || 1, totalStock: stock }];
  }
  if (purchaseType === "multi") {
    return items.map((it) => ({ sku: String(it.tokenId), quantity: 1, totalStock: 1 }));
  }
  // specimen | shipping | pickup — a single unique specimen token.
  const it = items[0];
  return [{ sku: String(it.tokenId), quantity: 1, totalStock: 1 }];
}

// Platform fee: 4% of the goods price (matches on-chain TOTAL_FEE_BPS = 400).
const PLATFORM_FEE_PERCENT = 4;
// Buyer-paid Stripe processing fee (grossed up so the platform nets goods+shipping).
// US card default is 2.9% + $0.30; the 4% platform margin absorbs cross-border delta.
const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED_CENTS = 30;

/**
 * Resolve + evaluate a promotion for a starting checkout — server-side and
 * fail-open. Returns the applied discount descriptor, or null for "no discount".
 *
 * MONEY BOUNDARY (Task 21B): eligibility and the discount amount come ONLY from
 * the pure promotionEngine.evaluatePromotion, evaluated against the AUTHORITATIVE
 * cart (server-resolved goods prices — never the client-supplied price). This
 * function never re-derives the discount math itself. Any lookup/eval failure
 * resolves to null: a promo problem must never fail a checkout, and an
 * unverified discount must never be applied.
 *
 * Opt-in only: a discount is considered solely when the request carries a
 * `promoCode` or `promotionId`. Automatic (code-less) promotions are
 * intentionally NOT auto-applied here yet — doing so would discount every
 * checkout for a seller with an active auto-promo, a broader behavioral change
 * that gets its own review. Keeping this explicit preserves "no promo signal →
 * charge math unchanged".
 *
 * @param {{ sellerWallet:string, promoCode?:string, promotionId?:string, cart:Object, now:number }} args
 * @returns {Promise<{ promotionId:string, discountCents:number, funding:string, code:(string|null) }|null>}
 */
async function resolveCheckoutPromotion({ sellerWallet, promoCode, promotionId, cart, now }) {
  try {
    const seller = (sellerWallet || "").toLowerCase();
    if (!seller) return null;
    if (!promoCode && !promotionId) return null;

    let query = supabase
      .from("seller_promotions")
      .select("*")
      .eq("wallet_address", seller)
      .eq("active", true);
    if (promotionId) query = query.eq("id", promotionId);

    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) return null;

    // Select the target promo: by id (already filtered to this seller), or by a
    // case-insensitive code match done in JS (never interpolate a buyer-supplied
    // code into the query, so a code containing SQL/ILIKE metacharacters is inert).
    let promo = null;
    if (promotionId) {
      promo = rows[0];
    } else {
      const wanted = String(promoCode).trim().toUpperCase();
      promo = rows.find((r) => (r.code || "").toUpperCase() === wanted) || null;
    }
    if (!promo) return null;

    const evaluation = evaluatePromotion(promo, cart, { now });
    if (!evaluation.applicable || !(evaluation.discountCents > 0)) return null;

    return {
      promotionId: promo.id,
      discountCents: evaluation.discountCents,
      funding: evaluation.funding,
      code: promo.code || null,
    };
  } catch (e) {
    console.warn("[Checkout] Promotion resolution skipped:", e.message);
    return null;
  }
}

/**
 * ?action=preview-promo — read-only promo check for the buyer's checkout UI.
 * Resolves the seller's promo for a code and evaluates it (via the pure
 * promotionEngine) against a DISPLAY cart, returning the discount + a reason.
 *
 * Deliberately does nothing money-related: no Stripe session, no coupon, no
 * charge, no used_count. It lets the buyer see "code applied − $X" or "invalid
 * code" BEFORE paying — the AUTHORITATIVE re-validation (server-resolved prices
 * + the real coupon + fee/payout split) still happens only at create-checkout.
 * Because it's display-only, it evaluates against the client-supplied item
 * prices; a tampered preview only misleads the tamperer and never affects the
 * real charge.
 *
 * POST { sellerWallet, promoCode?|promotionId?, items:[...], purchaseType }
 */
async function handlePreviewPromo(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sellerWallet, promoCode, promotionId, items, purchaseType } = req.body || {};
  if (!sellerWallet || (!promoCode && !promotionId)) {
    return res.status(400).json({ error: "Missing sellerWallet and promoCode/promotionId" });
  }

  const cart = {
    items: (Array.isArray(items) ? items : []).map((it) => ({
      unitPriceCents:
        purchaseType === "batch"
          ? Number(it.pricePerFishCents || it.priceCentsUSD || 0)
          : Number(it.priceCentsUSD || 0),
      quantity: purchaseType === "batch" ? (Number(it.quantity) || 1) : 1,
      listingKey: purchaseType === "batch" ? `batch-${it.listingId}` : `single-${it.tokenId}`,
    })),
  };

  try {
    const seller = String(sellerWallet).toLowerCase();
    let query = supabase.from("seller_promotions").select("*").eq("wallet_address", seller).eq("active", true);
    if (promotionId) query = query.eq("id", promotionId);
    const { data: rows } = await query;

    // Match by id (already filtered) or a case-insensitive code compare in JS
    // (never interpolate a buyer-supplied code into the query).
    const wanted = promoCode ? String(promoCode).trim().toUpperCase() : null;
    const promo = promotionId
      ? (rows || [])[0]
      : (rows || []).find((r) => (r.code || "").toUpperCase() === wanted);

    if (!promo) {
      return res.status(200).json({ applicable: false, discountCents: 0, reason: "That code isn't valid for this seller." });
    }

    const evaluation = evaluatePromotion(promo, cart, { now: Date.now() });
    return res.status(200).json({
      applicable: evaluation.applicable,
      discountCents: evaluation.discountCents,
      reason: evaluation.reason,
      funding: evaluation.funding,
      promotion: evaluation.applicable
        ? { promotionId: promo.id, code: promo.code || null, funding: promo.funding }
        : null,
    });
  } catch (e) {
    console.warn("[Checkout] promo preview failed:", e.message);
    return res.status(200).json({ applicable: false, discountCents: 0, reason: "Could not check that code right now." });
  }
}

async function handleCreateCheckout(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const {
    purchaseType,   // "specimen" | "shipping" | "batch" | "multi" | "pickup"
    buyerWallet,
    sellerWallet,
    items,
    successUrl,
    cancelUrl,
  } = req.body;

  if (!purchaseType || !buyerWallet || !sellerWallet || !items || items.length === 0) {
    return res.status(400).json({
      error: "Missing required fields: purchaseType, buyerWallet, sellerWallet, items",
    });
  }

  // Guest purchases from the public marketplace page use 'guest' as a placeholder.
  // On-chain settlement is deferred until the buyer links an account.
  const isGuestPurchase = buyerWallet === 'guest' || buyerWallet === '0x0000000000000000000000000000000000000000';

  // Capture the buyer's VERIFIED Privy identity (DID) so the later release step
  // can authorize from the logged-in session instead of a wallet-signature popup.
  // Best-effort — guests / logged-out buyers fall back to the signature path.
  let buyerUserId = null;
  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader) {
      const { verified, userId } = await verifyPrivyToken(req);
      if (verified && userId) buyerUserId = userId;
    }
  } catch (e) {
    console.warn("[Stripe Checkout] Buyer identity capture skipped:", e.message);
  }

  const SUCCESS_URL = successUrl
    || process.env.CHECKOUT_SUCCESS_URL
    || "https://aquadex.fish/checkout/success?session_id={CHECKOUT_SESSION_ID}";
  const CANCEL_URL = cancelUrl
    || process.env.CHECKOUT_CANCEL_URL
    || "https://aquadex.fish/marketplace";

  // Hoisted so the catch block can release any inventory hold taken below if
  // session creation fails after we reserved (flagged reservation wiring).
  let metadata = {};

  try {
    // ─── Look up seller's Stripe Connected Account ─────────────────────────
    const { data: sellerAccount, error: sellerError } = await supabase
      .from("seller_stripe_accounts")
      .select("stripe_account_id, onboarding_complete")
      .eq("wallet_address", sellerWallet.toLowerCase())
      .single();

    if (sellerError || !sellerAccount) {
      return res.status(400).json({
        error: "Seller has not connected their Stripe account",
        code: "SELLER_NOT_CONNECTED",
      });
    }

    if (!sellerAccount.onboarding_complete) {
      return res.status(400).json({
        error: "Seller has not completed Stripe onboarding",
        code: "SELLER_ONBOARDING_INCOMPLETE",
      });
    }

    // ─── SECURITY: resolve authoritative goods prices server-side ──────────
    // Never trust the client-supplied price. Overwrite each item's price with
    // the seller's stored listing price (cloud → on-chain fallback) so a
    // tampered request can't buy a specimen for a penny. Fail closed: if a
    // price can't be verified, reject rather than charge an unverified amount.
    for (const item of items) {
      const isBatchItem = purchaseType === "batch";
      const refId = isBatchItem ? item.listingId : item.tokenId;
      if (refId == null) {
        return res.status(400).json({
          error: "Missing listing reference. Please refresh and try again.",
          code: "PRICE_VERIFICATION_FAILED",
        });
      }
      const authoritative = await resolveAuthoritativeListing({ id: refId, isBatch: isBatchItem });
      if (!authoritative || !(authoritative.goodsCents > 0)) {
        return res.status(400).json({
          error: "Could not verify the listing price. Please refresh and try again.",
          code: "PRICE_VERIFICATION_FAILED",
        });
      }
      // Seller must match the listing's seller so the payout routes correctly.
      if (authoritative.sellerAddress && authoritative.sellerAddress !== sellerWallet.toLowerCase()) {
        return res.status(400).json({
          error: "This listing's seller has changed. Please refresh and try again.",
          code: "SELLER_MISMATCH",
        });
      }
      // Overwrite the client-supplied price with the verified authoritative one.
      if (isBatchItem) {
        item.pricePerFishCents = authoritative.goodsCents;
      } else {
        item.priceCentsUSD = authoritative.goodsCents;
      }
    }

    // ─── Build line items based on purchase type ───────────────────────────
    let lineItems = [];
    let totalAmountCents = 0;
    metadata = {
      purchaseType,
      buyerWallet: buyerWallet.toLowerCase(),
      sellerWallet: sellerWallet.toLowerCase(),
      sellerStripeAccountId: sellerAccount.stripe_account_id,
      isGuestPurchase: isGuestPurchase ? "true" : "false",
      ...(buyerUserId ? { buyerUserId } : {}),
    };

    switch (purchaseType) {
      case "specimen":
      case "pickup": {
        // "specimen" is a no-handoff sale (paid through); "pickup" is local/
        // in-person and HELD until the handshake at handoff.
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.commonName || `Live Specimen`,
              description: item.scientificName
                ? `${item.scientificName} — Verified breeder specimen`
                : `Live specimen from verified breeder`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.priceCentsUSD,
          },
          quantity: 1,
        });
        totalAmountCents = item.priceCentsUSD;
        metadata.tokenId = String(item.tokenId);
        break;
      }

      case "shipping": {
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.commonName || `Live Specimen`,
              description: item.scientificName
                ? `${item.scientificName} — Live Arrival Guaranteed`
                : `Live specimen — Live Arrival Guaranteed`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.priceCentsUSD,
          },
          quantity: 1,
        });
        if (item.shippingFeeCents && item.shippingFeeCents > 0) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: "Shipping & handling",
                description: "Expedited live-fish shipping with heat/cold pack, breather bag, and handling",
              },
              unit_amount: item.shippingFeeCents,
            },
            quantity: 1,
          });
        }
        totalAmountCents = item.priceCentsUSD + (item.shippingFeeCents || 0);
        metadata.tokenId = String(item.tokenId);
        metadata.shippingFeeCents = String(item.shippingFeeCents || 0);
        // Live-rate context for the seller's in-app label purchase (ShipEngine).
        if (item.shipServiceCode) metadata.ship_service_code = String(item.shipServiceCode);
        if (item.shipCarrierId) metadata.ship_carrier_id = String(item.shipCarrierId);
        if (req.body.shipTo) {
          metadata.ship_to = JSON.stringify(req.body.shipTo).slice(0, 480);
        }
        break;
      }

      case "batch": {
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: `${item.commonName || "Juvenile Fish"} (x${item.quantity})`,
              description: `Batch of ${item.quantity} tank-raised juveniles from verified breeder`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.pricePerFishCents,
          },
          quantity: item.quantity,
        });
        totalAmountCents = item.pricePerFishCents * item.quantity;
        metadata.listingId = String(item.listingId);
        metadata.quantity = String(item.quantity);
        break;
      }

      case "multi": {
        const tokenIds = [];
        for (const item of items) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: item.commonName || `Live Specimen`,
                description: `Live specimen from verified breeder`,
                images: item.imageUrl ? [item.imageUrl] : [],
              },
              unit_amount: item.priceCentsUSD,
            },
            quantity: 1,
          });
          totalAmountCents += item.priceCentsUSD;
          tokenIds.push(String(item.tokenId));
        }
        const shippingFee = items[0]?.shippingFeeCents || 0;
        if (shippingFee > 0) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: "Consolidated Live Fish Shipping",
                description: `Priority overnight shipping for ${items.length} specimens`,
              },
              unit_amount: shippingFee,
            },
            quantity: 1,
          });
          totalAmountCents += shippingFee;
        }
        metadata.tokenIds = JSON.stringify(tokenIds);
        metadata.shippingFeeCents = String(shippingFee);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown purchaseType: ${purchaseType}` });
    }

    // ─── Escrow money model: separate charges + transfers ─────────────────
    // Funds are captured into the PLATFORM balance and HELD; the seller is paid
    // later via a Stripe Transfer (shipping → on live-arrival release; instant/
    // batch/multi → on settlement). Platform keeps 4% of goods + full shipping;
    // seller gets 96% of the GOODS price only.
    const shippingCents = Number(metadata.shippingFeeCents || 0);
    const goodsPriceCents = totalAmountCents - shippingCents;

    // ─── Promotion discount (Task 21B — Tier A checkout wiring) ────────────
    // Opt-in ONLY: nothing here runs unless the request carries a promoCode or
    // promotionId, so a request without one is byte-for-byte the legacy charge.
    // Eligibility + amount come solely from the pure promotionEngine, evaluated
    // against the AUTHORITATIVE cart (server-resolved goods, never client
    // prices). A discount applies to GOODS only — never shipping or processing.
    //
    // Ordering matters for money-safety: we resolve the candidate discount, then
    // create the Stripe coupon FIRST. Only if the coupon is actually created do
    // we apply the discount to the fee/payout math. That guarantees the buyer's
    // charge reduction and the seller-payout metadata can never desync — a
    // coupon failure drops the promo entirely (buyer pays full, seller paid on
    // full) rather than shorting either party.
    let discountCents = 0;
    let appliedPromotion = null;
    let discounts;
    if (req.body.promoCode || req.body.promotionId) {
      const promoCart = {
        items: items.map((it) => ({
          unitPriceCents: purchaseType === "batch" ? it.pricePerFishCents : it.priceCentsUSD,
          quantity: purchaseType === "batch" ? (Number(it.quantity) || 1) : 1,
          listingKey: purchaseType === "batch" ? `batch-${it.listingId}` : `single-${it.tokenId}`,
        })),
      };
      const resolved = await resolveCheckoutPromotion({
        sellerWallet,
        promoCode: req.body.promoCode,
        promotionId: req.body.promotionId,
        cart: promoCart,
        now: Date.now(),
      });
      // Defense-in-depth over the engine's own clamp: a discount can never touch
      // shipping and can never exceed the goods subtotal.
      const candidate = resolved ? Math.max(0, Math.min(resolved.discountCents, goodsPriceCents)) : 0;
      if (resolved && candidate > 0) {
        try {
          const coupon = await stripe.coupons.create({
            amount_off: candidate,
            currency: "usd",
            duration: "once",
            // Stripe caps the coupon name at 40 chars; a promo code can itself be
            // up to 40, so slice to stay within the limit (otherwise coupons.create
            // throws and the fail-open path would silently drop a valid discount).
            name: (resolved.code ? `Promo ${resolved.code}` : "Discount").slice(0, 40),
            metadata: { promotionId: String(resolved.promotionId), funding: resolved.funding },
          });
          discounts = [{ coupon: coupon.id }];
          discountCents = candidate;
          appliedPromotion = resolved;
        } catch (couponErr) {
          // Fail-open: drop the promo, charge + pay out at full price.
          console.warn("[Checkout] Coupon creation failed, dropping promo:", couponErr.message);
        }
      }
    }

    // Fee + payout + gross-up split, computed by the pure checkoutPricing module
    // (Tier A, independently unit-tested). seller_funded reduces the goods base so
    // the 4% fee base AND the seller's 96% both drop; platform_funded leaves the
    // seller whole and the platform absorbs the discount. The processing fee is
    // grossed up on the DISCOUNTED chargeable amount so it stays exact after the
    // coupon reduces the total.
    const charge = computeCheckoutCharge({
      goodsPriceCents,
      shippingCents,
      discountCents,
      funding: appliedPromotion ? appliedPromotion.funding : "seller_funded",
      feePercent: PLATFORM_FEE_PERCENT,
      stripeRate: STRIPE_FEE_RATE,
      stripeFixedCents: STRIPE_FEE_FIXED_CENTS,
    });
    const { platformFeeCents, sellerPayoutCents, processingFeeCents, buyerTotalCents, platformGoodsMarginCents } = charge;

    // Surface the processing fee as its own line item so the buyer sees it. It is
    // computed on the post-discount total; the coupon (amount_off = discountCents)
    // then reduces the goods+shipping+processing line-item sum by exactly the
    // discount, so the buyer pays (goods − discount) + shipping + processing.
    if (processingFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Service & processing fee",
            description: "Secure checkout, buyer protection, and card processing",
          },
          unit_amount: processingFeeCents,
        },
        quantity: 1,
      });
    }

    // transfer_group links the charge to the later Transfer(s) to the seller.
    const transferGroup = `aqx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    metadata.goodsTotalCents = String(totalAmountCents);
    metadata.platformFeeCents = String(platformFeeCents);
    metadata.sellerPayoutCents = String(sellerPayoutCents);
    metadata.processingFeeCents = String(processingFeeCents);
    metadata.transferGroup = transferGroup;
    if (appliedPromotion) {
      // Stamped for the webhook's idempotent used_count redemption + receipts.
      metadata.promotionId = String(appliedPromotion.promotionId);
      metadata.promotionDiscountCents = String(discountCents);
      metadata.promotionFunding = appliedPromotion.funding;
      if (appliedPromotion.code) metadata.promotionCode = String(appliedPromotion.code).slice(0, 40);
      // What the platform keeps on goods after the discount and the seller payout
      // (from the pure charge calc). Negative ⇒ a platform_funded promo whose
      // discount exceeds the 4% margin, i.e. the platform is funding the perk out
      // of pocket (by design). Recorded for reconciliation; flagged so it's never
      // silent.
      metadata.platformGoodsMarginCents = String(platformGoodsMarginCents);
      if (platformGoodsMarginCents < 0) {
        console.warn(
          `[Checkout] Promo ${appliedPromotion.promotionId} (${appliedPromotion.funding}) makes this order net-negative on goods: platform margin ${platformGoodsMarginCents}¢.`
        );
      }
    }

    // ─── Reserve inventory (flagged): a bounded, oversell-guarded hold ─────
    // Checkout beginning is when the hold is taken (MARKETPLACE_STATE_MODEL §7).
    // The reserve_stock advisory-lock RPC serializes concurrent checkouts of the
    // same unit, so two buyers cannot both hold the last specimen. The hold is
    // committed at payment_protected (webhook) and released on abandonment/expiry.
    // Gated by CANONICAL_SETTLEMENT_ENABLED so the legacy path is unchanged.
    //   • oversell → reject the checkout (409); the item is gone.
    //   • infra error → log and proceed; the on-chain settlement (purchase*Fiat
    //     reverts on an already-sold token) remains the ultimate double-sale guard.
    if (isCanonicalSettlementEnabled()) {
      const reservationGroupId = `rsv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      metadata.reservationGroupId = reservationGroupId;
      try {
        const targets = await resolveReservationTargets(purchaseType, items);
        const held = await reserveCheckoutStock({ supabase, reservationGroupId, targets, now: Date.now() });
        if (!held.ok && held.error === "oversell") {
          return res.status(409).json({
            error: "One or more items are no longer available. Please refresh your cart.",
            code: "OUT_OF_STOCK",
            unavailable: held.unavailableSku,
          });
        }
        if (!held.ok) {
          console.warn("[Checkout] Reservation failed, proceeding (on-chain guard remains):", held.error);
        }
      } catch (e) {
        console.warn("[Checkout] Reservation error, proceeding:", e.message);
      }
    }

    // ─── Create Stripe Checkout Session (capture-and-hold) ─────────────────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      // Applied promotion (Task 21B) — a one-time coupon whose amount_off equals
      // the goods discount. Present only when a promo was resolved AND its coupon
      // was created above; the fee/payout metadata already reflects the same
      // discount, so charge and payout stay in lockstep.
      ...(discounts ? { discounts } : {}),
      payment_intent_data: {
        // No transfer_data / application_fee: funds land in the platform balance
        // and are held. The seller is paid via a later Transfer within transfer_group.
        transfer_group: transferGroup,
        metadata,
      },
      metadata,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          setup_future_usage: undefined,
        },
      },
    });

    return res.status(200).json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      goodsTotalCents: totalAmountCents,
      processingFeeCents,
      buyerTotalCents,
      platformFeeCents,
      sellerReceivesCents: sellerPayoutCents,
      // Applied promotion (null when none) — lets the client show the deal.
      discountCents,
      promotion: appliedPromotion
        ? { promotionId: appliedPromotion.promotionId, code: appliedPromotion.code, funding: appliedPromotion.funding }
        : null,
    });
  } catch (err) {
    console.error("[Stripe Checkout] Session creation failed:", err);
    // If we reserved stock before the session blew up, release it now so the
    // failed attempt doesn't strand inventory until TTL expiry (flagged path).
    if (isCanonicalSettlementEnabled() && metadata?.reservationGroupId) {
      try {
        await releaseCheckoutReservations({ supabase, metadata, now: Date.now() });
      } catch (relErr) {
        console.warn("[Checkout] Reservation release after failure skipped:", relErr.message);
      }
    }
    return res.status(500).json({
      error: "Failed to create checkout session",
      details: err.message,
    });
  }
}
