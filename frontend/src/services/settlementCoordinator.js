/**
 * settlementCoordinator.js
 *
 * The atomic completion sequence (Task 5): certificate transfer is a
 * prerequisite for seller payout. This is the "settlement brain" that composes
 * the three cores — the state machine (Task 1, legal transitions), the
 * authorization boundary (Task 3, who may trigger them), and the payment ledger
 * (Task 4, where the money is) — into one ordered, idempotent, failure-aware
 * completion routine.
 *
 * Ordering and failure rules (MARKETPLACE_STATE_MODEL.md §8):
 *   1. Confirm the order is eligible for release.
 *   2. Confirm there is no open DOA claim or dispute.
 *   3. Transfer the birth certificate(s).
 *   4. Record the certificate-transfer confirmation.
 *   5. Initiate the Stripe Connect seller payout.
 *   6. Mark the order complete; enable receipts, XP, and reviews.
 *
 *   - If certificate transfer fails: do NOT pay the seller; leave the order in
 *     its pre-transfer state for retry.
 *   - If the certificate succeeds but the payout fails: retain the completed
 *     ownership transfer, mark the payout pending retry, and NEVER reverse the
 *     certificate.
 *   - Cash orders skip the payout entirely (no platform money).
 *   - Idempotent: re-running after a partial completion resumes from where it
 *     left off (certificate already transferred → go straight to payout).
 *
 * Pure orchestration: the side effects (certificate transfer, payout) are
 * injected so this module has no direct chain/Stripe dependency and is fully
 * unit-testable. It returns the resulting state and the ledger entries to
 * persist; it does not itself write to any store.
 */

import {
  ORDER_STATES as S,
  FULFILLMENT_METHODS,
} from "./marketplaceStateMachine.js";
import { authorizeTransition } from "./orderAuthorization.js";
import {
  LEDGER_ENTRY_TYPES as T,
  reduceLedger,
} from "./paymentLedger.js";

export const SETTLEMENT_ACTIONS = Object.freeze({
  COMPLETED: "completed", // certificate transferred + seller paid + complete
  COMPLETED_CASH: "completed_cash", // certificate transferred + complete (no payout)
  COMPLETED_NO_PAYOUT: "completed_no_payout", // nothing owed (e.g. fully refunded healthy set)
  ALREADY_COMPLETE: "already_complete", // idempotent no-op
  CERTIFICATE_FAILED: "certificate_failed", // aborted before payout
  PAYOUT_PENDING_RETRY: "payout_pending_retry", // cert done, payout to retry
  NOT_ELIGIBLE: "not_eligible",
  BLOCKED_CLAIM: "blocked_claim",
  UNAUTHORIZED: "unauthorized",
});

const A = SETTLEMENT_ACTIONS;

const ELIGIBLE_START_STATES = [S.HANDOFF_CONFIRMED, S.PARTIALLY_RESOLVED];

/**
 * Run the atomic completion sequence for a held order.
 *
 * @param {Object} params
 * @param {Object} params.order - canonical order: { id, state, method, buyerUserId,
 *   buyerWallet, sellerWallet, sellerProceedsCents, hasOpenClaim?, stripePaymentHash?, handoffChallengeId? }
 * @param {Object} params.actor - authenticated caller (the platform automation → { isSystem: true })
 * @param {Array} [params.ledgerEntries] - existing ledger events for this order
 * @param {Object} params.effects - injected side effects:
 *   @param {(order:Object)=>Promise<{ok:boolean, ref?:string, error?:string}>} params.effects.transferCertificate
 *   @param {(order:Object, amountCents:number)=>Promise<{ok:boolean, transferId?:string, error?:string}>} params.effects.initiatePayout
 * @returns {Promise<{
 *   ok:boolean, action:string, finalState:string, appendedEntries:Array,
 *   certificateRef?:string, transferId?:string, xpEligible:boolean, reviewEligible:boolean, error?:string
 * }>}
 */
export async function completeSettlement({ order, actor, ledgerEntries = [], effects }) {
  if (!effects || typeof effects.transferCertificate !== "function" || typeof effects.initiatePayout !== "function") {
    throw new Error("completeSettlement requires effects.transferCertificate and effects.initiatePayout");
  }

  const method = order.method;
  const isCash = method === FULFILLMENT_METHODS.CASH_PICKUP;
  const startState = order.state;
  const appendedEntries = [];
  const fail = (action, extra = {}) => ({
    ok: false, action, finalState: startState, appendedEntries, xpEligible: false, reviewEligible: false, ...extra,
  });

  // ── Idempotent short-circuits ──────────────────────────────────────────────
  if (startState === S.COMPLETED || startState === S.SELLER_PAID) {
    return { ok: true, action: A.ALREADY_COMPLETE, finalState: S.COMPLETED, appendedEntries, xpEligible: true, reviewEligible: true };
  }

  // Resume point: certificate already transferred, only the payout remains.
  const certificateAlreadyDone = startState === S.CERTIFICATE_TRANSFERRED;

  // ── Step 1: eligibility ────────────────────────────────────────────────────
  if (!certificateAlreadyDone && !ELIGIBLE_START_STATES.includes(startState)) {
    return fail(A.NOT_ELIGIBLE, { error: `state ${startState} is not eligible for settlement` });
  }

  // ── Step 2: no open claim or dispute ───────────────────────────────────────
  const balances = reduceLedger(order, ledgerEntries);
  if (order.hasOpenClaim || balances.disputeStatus === "open") {
    return fail(A.BLOCKED_CLAIM, { error: "an open claim or dispute blocks release" });
  }

  // ── Authorization: the actor must be permitted for the next edge ───────────
  const firstEdgeTo = certificateAlreadyDone
    ? (isCash ? S.COMPLETED : S.SELLER_PAID)
    : S.CERTIFICATE_TRANSFERRED;
  const authz = authorizeTransition(order, startState, firstEdgeTo, actor);
  if (!authz.allowed) {
    return fail(A.UNAUTHORIZED, { error: authz.reason });
  }

  // ── Steps 3–4: certificate transfer (unless resuming) ──────────────────────
  let certificateRef;
  if (!certificateAlreadyDone) {
    let certResult;
    try {
      certResult = await effects.transferCertificate(order);
    } catch (err) {
      certResult = { ok: false, error: err?.message || "certificate transfer threw" };
    }
    if (!certResult || !certResult.ok) {
      // Do NOT pay the seller. Leave the order in its pre-transfer state to retry.
      return fail(A.CERTIFICATE_FAILED, { error: certResult?.error || "certificate transfer failed" });
    }
    certificateRef = certResult.ref;
    appendedEntries.push({ type: "certificate_transferred", id: `${order.id}:cert`, ref: certificateRef });
  }

  // ── Cash: no platform payout — complete directly ───────────────────────────
  if (isCash) {
    return {
      ok: true, action: A.COMPLETED_CASH, finalState: S.COMPLETED, appendedEntries,
      certificateRef, xpEligible: true, reviewEligible: true,
    };
  }

  // ── Determine the payout amount from the ledger (healthy proceeds owed) ─────
  const payoutAmountCents = balances.sellerOwedCents;
  if (!(payoutAmountCents > 0)) {
    // Nothing owed (e.g. the healthy set was fully refunded): complete without payout.
    return {
      ok: true, action: A.COMPLETED_NO_PAYOUT, finalState: S.COMPLETED, appendedEntries,
      certificateRef, xpEligible: true, reviewEligible: true,
    };
  }

  // ── Step 5: initiate the seller payout ─────────────────────────────────────
  const transferId = `${order.id}:payout`;
  appendedEntries.push({ type: T.TRANSFER_INITIATED, transferId, amountCents: payoutAmountCents });

  let payoutResult;
  try {
    payoutResult = await effects.initiatePayout(order, payoutAmountCents);
  } catch (err) {
    payoutResult = { ok: false, error: err?.message || "payout threw" };
  }

  if (!payoutResult || !payoutResult.ok) {
    // Certificate is already transferred to the buyer — never reverse it.
    // Record the failed transfer and leave the order at certificate_transferred
    // for a payout retry (surfaces to reconciliation, Task 22).
    appendedEntries.push({ type: T.TRANSFER_FAILED, id: `${transferId}:fail`, transferId, amountCents: payoutAmountCents });
    return {
      ok: false, action: A.PAYOUT_PENDING_RETRY, finalState: S.CERTIFICATE_TRANSFERRED, appendedEntries,
      certificateRef, xpEligible: false, reviewEligible: false, error: payoutResult?.error || "payout failed",
    };
  }

  // ── Step 6: payout succeeded → seller_paid → completed ─────────────────────
  const confirmedTransferId = payoutResult.transferId || transferId;
  appendedEntries.push({ type: T.TRANSFER_SUCCEEDED, id: `${confirmedTransferId}:ok`, transferId: confirmedTransferId, amountCents: payoutAmountCents });

  return {
    ok: true, action: A.COMPLETED, finalState: S.COMPLETED, appendedEntries,
    certificateRef, transferId: confirmedTransferId, xpEligible: true, reviewEligible: true,
  };
}
