/**
 * Unit tests for the DOA claim workflow (Task 17, Tier A).
 *
 * Covers evidence gating, claim-window/state gating, per-line-item resolution
 * (refund/replace/deny), replacement sub-orders, the resulting order-state
 * rollup, and the ledger refund entries (with seller-portion allocation).
 *
 * Run with: npx vitest --run src/__tests__/doaClaims.test.js
 */

import { describe, it, expect } from "vitest";
import { ORDER_STATES as S, LINE_ITEM_STATES as LI } from "../services/marketplaceStateMachine.js";
import { LEDGER_ENTRY_TYPES as T } from "../services/paymentLedger.js";
import {
  DEFAULT_CLAIM_WINDOW_MS,
  CLAIM_STATUS,
  RESOLUTION_OUTCOME as OUT,
  validateEvidence,
  effectiveClaimWindowMs,
  canOpenClaim,
  openClaim,
  resolveClaim,
} from "../services/doaClaims.js";

const T0 = 1_000_000_000_000;
const goodEvidence = { photos: ["a.jpg", "b.jpg"], description: "Two tetras arrived deceased." };

const order = { id: "ord_1", state: S.DELIVERED, method: "shipping", buyerWallet: "0xbuyer", sellerWallet: "0xseller", deliveredAt: T0 };
const lineItems = [
  { lineItemId: "li_1", priceCents: 3000, sellerProceedsCents: 2880 },
  { lineItemId: "li_2", priceCents: 3000, sellerProceedsCents: 2880 },
  { lineItemId: "li_3", priceCents: 4000, sellerProceedsCents: 3840 },
];
const allIds = lineItems.map((l) => l.lineItemId);

describe("validateEvidence", () => {
  it("requires the minimum photos and a description", () => {
    expect(validateEvidence(goodEvidence).ok).toBe(true);
    expect(validateEvidence({ photos: ["a.jpg"], description: "x" }).ok).toBe(false);
    expect(validateEvidence({ photos: ["a.jpg", "b.jpg"] }).ok).toBe(false);
    expect(validateEvidence({}).missing.length).toBe(2);
  });
});

describe("effectiveClaimWindowMs", () => {
  it("takes the larger of platform minimum and seller policy", () => {
    expect(effectiveClaimWindowMs(undefined)).toBe(DEFAULT_CLAIM_WINDOW_MS);
    expect(effectiveClaimWindowMs(1000)).toBe(DEFAULT_CLAIM_WINDOW_MS); // seller can't shorten
    expect(effectiveClaimWindowMs(DEFAULT_CLAIM_WINDOW_MS * 2)).toBe(DEFAULT_CLAIM_WINDOW_MS * 2); // can extend
  });
});

describe("canOpenClaim", () => {
  it("allows within the window from an eligible state", () => {
    expect(canOpenClaim({ orderState: S.DELIVERED, deliveredAt: T0, now: T0 + 3600000 }).ok).toBe(true);
    expect(canOpenClaim({ orderState: S.NON_DELIVERY, deliveredAt: T0, now: T0 }).ok).toBe(true);
  });

  it("rejects after the window closes", () => {
    const r = canOpenClaim({ orderState: S.DELIVERED, deliveredAt: T0, now: T0 + DEFAULT_CLAIM_WINDOW_MS + 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/window/);
  });

  it("rejects from an ineligible state (e.g. already completed)", () => {
    expect(canOpenClaim({ orderState: S.COMPLETED, deliveredAt: T0, now: T0 }).ok).toBe(false);
  });
});

describe("openClaim", () => {
  it("opens a claim, marks affected items doa_claimed, moves the order to claim_open", () => {
    const r = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1", "li_2"], evidence: goodEvidence, now: T0 + 1000 });
    expect(r.ok).toBe(true);
    expect(r.orderState).toBe(S.CLAIM_OPEN);
    expect(r.claim.status).toBe(CLAIM_STATUS.OPEN);
    expect(r.lineItemUpdates).toEqual([
      { lineItemId: "li_1", state: LI.DOA_CLAIMED },
      { lineItemId: "li_2", state: LI.DOA_CLAIMED },
    ]);
    expect(r.claim.sellerResponseDeadlineAt).toBeGreaterThan(r.claim.openedAt);
  });

  it("rejects incomplete evidence", () => {
    const r = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1"], evidence: { photos: [] }, now: T0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/evidence/);
  });

  it("rejects unknown line items", () => {
    const r = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_99"], evidence: goodEvidence, now: T0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/);
  });

  it("rejects when the window has closed", () => {
    const r = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1"], evidence: goodEvidence, now: T0 + DEFAULT_CLAIM_WINDOW_MS + 1 });
    expect(r.ok).toBe(false);
  });
});

function openTwo() {
  return openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1", "li_2"], evidence: goodEvidence, now: T0 }).claim;
}

describe("resolveClaim", () => {
  it("full refund of all affected items with no healthy remainder → order refunded", () => {
    const claim = openClaim({ order, orderLineItemIds: ["li_1", "li_2", "li_3"], affectedLineItemIds: ["li_1", "li_2", "li_3"], evidence: goodEvidence, now: T0 }).claim;
    const r = resolveClaim({
      claim, order, orderLineItems: lineItems, now: T0 + 5000,
      resolutions: { li_1: { outcome: OUT.REFUND }, li_2: { outcome: OUT.REFUND }, li_3: { outcome: OUT.REFUND } },
    });
    expect(r.ok).toBe(true);
    expect(r.orderState).toBe(S.REFUNDED);
    expect(r.claimStatus).toBe(CLAIM_STATUS.RESOLVED);
    const refunds = r.ledgerEntries.filter((e) => e.type === T.REFUND);
    expect(refunds).toHaveLength(3);
    expect(refunds[0]).toMatchObject({ amountCents: 3000, sellerPortionCents: 2880 });
  });

  it("partial refund (one affected, others healthy) → partially_resolved", () => {
    const claim = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1"], evidence: goodEvidence, now: T0 }).claim;
    const r = resolveClaim({ claim, order, orderLineItems: lineItems, now: T0 + 5000, resolutions: { li_1: { outcome: OUT.REFUND } } });
    expect(r.orderState).toBe(S.PARTIALLY_RESOLVED);
    expect(r.lineItemUpdates).toContainEqual({ lineItemId: "li_1", state: LI.REFUNDED });
  });

  it("replacement creates a linked sub-order and marks the item replacement_pending", () => {
    const claim = openTwo();
    const r = resolveClaim({
      claim, order, orderLineItems: lineItems, now: T0 + 5000,
      resolutions: { li_1: { outcome: OUT.REPLACE }, li_2: { outcome: OUT.REFUND } },
    });
    expect(r.orderState).toBe(S.PARTIALLY_RESOLVED);
    expect(r.replacementSubOrders).toHaveLength(1);
    expect(r.replacementSubOrders[0]).toMatchObject({ originalOrderId: "ord_1", replacesLineItemId: "li_1", chargeCents: 0, method: "shipping" });
    expect(r.lineItemUpdates).toContainEqual({ lineItemId: "li_1", state: LI.REPLACEMENT_PENDING });
  });

  it("all affected denied → claim denied and order returns to handoff_confirmed", () => {
    const claim = openTwo();
    const r = resolveClaim({
      claim, order, orderLineItems: lineItems, now: T0 + 5000,
      resolutions: { li_1: { outcome: OUT.DENY }, li_2: { outcome: OUT.DENY } },
    });
    expect(r.claimStatus).toBe(CLAIM_STATUS.DENIED);
    expect(r.orderState).toBe(S.HANDOFF_CONFIRMED);
    expect(r.ledgerEntries).toHaveLength(0);
    expect(r.replacementSubOrders).toHaveLength(0);
  });

  it("mixed refund + replace + deny → partially_resolved, resolved status", () => {
    const claim = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1", "li_2", "li_3"], evidence: goodEvidence, now: T0 }).claim;
    const r = resolveClaim({
      claim, order, orderLineItems: lineItems, now: T0 + 5000,
      resolutions: { li_1: { outcome: OUT.REFUND }, li_2: { outcome: OUT.REPLACE }, li_3: { outcome: OUT.DENY } },
    });
    expect(r.orderState).toBe(S.PARTIALLY_RESOLVED);
    expect(r.claimStatus).toBe(CLAIM_STATUS.RESOLVED);
    expect(r.ledgerEntries.filter((e) => e.type === T.REFUND)).toHaveLength(1);
    expect(r.replacementSubOrders).toHaveLength(1);
  });

  it("uses explicit refund/sellerPortion overrides when provided", () => {
    const claim = openClaim({ order, orderLineItemIds: allIds, affectedLineItemIds: ["li_1"], evidence: goodEvidence, now: T0 }).claim;
    const r = resolveClaim({
      claim, order, orderLineItems: lineItems, now: T0 + 5000,
      resolutions: { li_1: { outcome: OUT.REFUND, refundCents: 1500, sellerPortionCents: 1440 } },
    });
    expect(r.ledgerEntries[0]).toMatchObject({ amountCents: 1500, sellerPortionCents: 1440 });
  });

  it("rejects when an affected item has no resolution", () => {
    const claim = openTwo();
    const r = resolveClaim({ claim, order, orderLineItems: lineItems, now: T0, resolutions: { li_1: { outcome: OUT.REFUND } } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing resolutions/);
  });

  it("rejects resolving a non-open claim", () => {
    const claim = { ...openTwo(), status: CLAIM_STATUS.RESOLVED };
    const r = resolveClaim({ claim, order, orderLineItems: lineItems, now: T0, resolutions: {} });
    expect(r.ok).toBe(false);
  });
});
