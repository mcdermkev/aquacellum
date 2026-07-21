/**
 * canonicalSettlement.js — bridge between the Stripe/chain edge and the canonical
 * settlement engine (src/services/*). Used only by the feature-flagged
 * `?action=release-v2` path in stripe.js; the legacy handleRelease is untouched.
 *
 * Responsibilities:
 *   - Map a Stripe PaymentIntent's metadata to a canonical order (mapPIToCanonicalOrder).
 *   - Build the injected settlement effects (buildSettlementEffects) that wrap the
 *     real on-chain certificate release and the Stripe seller payout, split so the
 *     settlement coordinator can enforce certificate-before-payout ordering.
 *   - Orchestrate ensure-order-then-settle (settleViaCanonical).
 *
 * The pure mappers and the effect builder are unit-tested (the on-chain/Stripe
 * primitives are injected). The end-to-end path against real Supabase/Stripe/
 * testnet must be verified in a live session — this path stays behind
 * CANONICAL_SETTLEMENT_ENABLED until then.
 */

import { runSettlement } from "../../src/services/orderService.js";
import { ORDER_STATES } from "../../src/services/marketplaceStateMachine.js";

/** Feature flag: the canonical settlement path is opt-in until verified live. */
export function isCanonicalSettlementEnabled() {
  return process.env.CANONICAL_SETTLEMENT_ENABLED === "true";
}

/**
 * Map a legacy checkout purchaseType to a canonical fulfillment method.
 * Legacy has no courier/cash fiat path; pickup → prepaid_pickup, else shipping.
 * @param {string} purchaseType
 * @returns {string}
 */
export function mapPurchaseTypeToMethod(purchaseType) {
  return purchaseType === "pickup" ? "prepaid_pickup" : "shipping";
}

/**
 * Build a canonical_orders insert row from a PaymentIntent's metadata.
 * The flagged bridge seeds the order at handoff_confirmed (the buyer is
 * confirming arrival at release time), so settlement can run immediately.
 *
 * @param {{ metadata:Object, paymentIntentId:string, paymentHash?:string, seedState?:string }} args
 * @returns {Object} row for canonical_orders
 */
export function mapPIToCanonicalOrder({ metadata, paymentIntentId, paymentHash = null, seedState = ORDER_STATES.HANDOFF_CONFIRMED }) {
  const md = metadata || {};
  return {
    buyer_user_id: md.buyerUserId || null,
    buyer_wallet: (md.buyerWallet || "").toLowerCase() || null,
    seller_wallet: (md.sellerWallet || "").toLowerCase(),
    method: mapPurchaseTypeToMethod(md.purchaseType),
    state: seedState,
    seller_proceeds_cents: Number(md.sellerPayoutCents || 0),
    gross_charged_cents: Number(md.grossChargedCents || 0),
    stripe_payment_intent: paymentIntentId,
    stripe_payment_hash: paymentHash,
    metadata: { purchaseType: md.purchaseType || null, tokenId: md.tokenId ?? null },
  };
}

/**
 * Build the settlement effects that wrap the real side effects, split so the
 * coordinator transfers the certificate BEFORE initiating payout.
 *
 * @param {Object} deps
 * @param {Object} deps.marketplace - ethers contract (getMarketplaceContract())
 * @param {Function} deps.transferToSeller - async ({sellerStripeAccountId, amountCents, transferGroup, reference}) => transfer
 * @param {Object} deps.metadata - PaymentIntent metadata
 * @param {(string|number|null)} deps.tokenId
 * @param {string} deps.paymentIntentId
 * @param {string} deps.paymentHash - keccak256(paymentIntentId)
 * @returns {{transferCertificate:Function, initiatePayout:Function}}
 */
export function buildSettlementEffects({ marketplace, transferToSeller, metadata, tokenId, paymentIntentId, paymentHash }) {
  const purchaseType = metadata?.purchaseType;

  async function transferCertificate() {
    try {
      let tx;
      if (purchaseType === "shipping") {
        tx = await marketplace.releaseFiatShippingEscrow(Number(tokenId));
      } else if (purchaseType === "pickup") {
        tx = await marketplace.purchaseSpecimenFiat(
          Number(tokenId),
          metadata.buyerWallet,
          Number(metadata.goodsTotalCents || 0),
          paymentHash
        );
      } else if (purchaseType === "multi") {
        tx = await marketplace.releaseFiatMultiEscrow(paymentHash);
      } else {
        tx = await marketplace.releaseFiatBatchEscrow(paymentHash);
      }
      const receipt = await tx.wait();
      return { ok: true, ref: receipt.transactionHash };
    } catch (err) {
      return { ok: false, error: err?.message || "certificate transfer failed" };
    }
  }

  async function initiatePayout(_order, amountCents) {
    try {
      const transfer = await transferToSeller({
        sellerStripeAccountId: metadata.sellerStripeAccountId,
        amountCents,
        transferGroup: metadata.transferGroup,
        reference: paymentIntentId,
      });
      return { ok: true, transferId: transfer.id };
    } catch (err) {
      return { ok: false, error: err?.message || "payout failed" };
    }
  }

  return { transferCertificate, initiatePayout };
}

/**
 * Ensure a canonical order exists for this PaymentIntent, then run the atomic
 * settlement sequence through the injected store. Returns the settlement result.
 *
 * @param {Object} args
 * @param {Object} args.store - orderService store port (Supabase adapter in prod)
 * @param {Object} args.marketplace
 * @param {Function} args.transferToSeller
 * @param {string} args.paymentIntentId
 * @param {Object} args.metadata
 * @param {(string|number|null)} args.tokenId
 * @param {string} args.paymentHash
 * @param {number} [args.capturedCents] - seeds a charge_captured ledger entry
 * @returns {Promise<Object>} settlement result
 */
/**
 * Record the canonical order for a held payment at the moment funds are
 * protected (Stripe webhook, payment_intent.succeeded). Idempotent: if an order
 * already exists for this PaymentIntent it is a no-op. Seeds a charge_captured
 * ledger entry. This is the real order-creation step that replaces the
 * release-time seeding shortcut used by the flagged release path.
 *
 * @returns {Promise<{ok:boolean, orderId:string, created:boolean}>}
 */
export async function recordCanonicalOrderProtected({ store, paymentIntentId, metadata, paymentHash, capturedCents = 0 }) {
  const existing = await store.getOrderByPaymentIntent(paymentIntentId);
  if (existing) return { ok: true, orderId: existing.id, created: false };

  const row = mapPIToCanonicalOrder({
    metadata,
    paymentIntentId,
    paymentHash,
    seedState: ORDER_STATES.PAYMENT_PROTECTED,
  });
  const orderId = await store.createOrder(row);
  if (capturedCents > 0) {
    await store.appendLedgerEntries(orderId, [
      { type: "charge_captured", id: paymentIntentId, amountCents: capturedCents },
    ]);
  }
  return { ok: true, orderId, created: true };
}

export async function settleViaCanonical({ store, marketplace, transferToSeller, paymentIntentId, metadata, tokenId, paymentHash, capturedCents = 0 }) {
  let orderId;
  const existing = await store.getOrderByPaymentIntent(paymentIntentId);
  if (existing) {
    orderId = existing.id;
  } else {
    const row = mapPIToCanonicalOrder({ metadata, paymentIntentId, paymentHash });
    orderId = await store.createOrder(row);
    if (capturedCents > 0) {
      await store.appendLedgerEntries(orderId, [
        { type: "charge_captured", id: paymentIntentId, amountCents: capturedCents },
      ]);
    }
  }

  const effects = buildSettlementEffects({ marketplace, transferToSeller, metadata, tokenId, paymentIntentId, paymentHash });
  return runSettlement({ store, orderId, actor: { isSystem: true }, effects });
}
