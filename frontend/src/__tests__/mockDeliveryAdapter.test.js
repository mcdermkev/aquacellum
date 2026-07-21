/**
 * Tests for the sandbox mock local-delivery adapter (Task 12, Tier B).
 *
 * Runs the shared provider contract suite (deliveryAdapterContract.js)
 * against createMockDeliveryAdapter, then adds a few mock-specific tests:
 * deterministic pricing and the unavailableDrivers/forceDelivered option
 * flags.
 *
 * Run with: npx vitest --run src/__tests__/mockDeliveryAdapter.test.js
 */

import { describe, it, expect } from "vitest";
import { createMockDeliveryAdapter } from "../services/adapters/mockDeliveryAdapter.js";
import { runDeliveryAdapterContract } from "../services/adapters/deliveryAdapterContract.js";
import { DELIVERY_STATUS } from "../services/localDeliveryAdapter.js";

// The contract suite calls makeAdapter() for the default cases and
// makeAdapter(overrides) for the cases that need a specific clock, quote
// TTL, or the unavailableDrivers/forceDelivered flags — forward whatever
// is passed straight into the factory.
runDeliveryAdapterContract((overrides) => createMockDeliveryAdapter(overrides));

describe("createMockDeliveryAdapter — mock-specific behavior", () => {
  it("deterministic pricing: identical distance always yields the identical quote amount/eta", async () => {
    const adapterA = createMockDeliveryAdapter({ now: () => 0 });
    const adapterB = createMockDeliveryAdapter({ now: () => 0 });

    const quoteA = await adapterA.getQuote({ distanceMiles: 8 });
    const quoteB = await adapterB.getQuote({ distanceMiles: 8 });

    expect(quoteA.amountCents).toBe(quoteB.amountCents);
    expect(quoteA.etaMinutes).toBe(quoteB.etaMinutes);
  });

  it("pricing scales with distance (base + per-mile)", async () => {
    const adapter = createMockDeliveryAdapter({ now: () => 0 });
    const near = await adapter.getQuote({ distanceMiles: 1 });
    const far = await adapter.getQuote({ distanceMiles: 10 });

    expect(far.amountCents).toBeGreaterThan(near.amountCents);
    expect(far.etaMinutes).toBeGreaterThan(near.etaMinutes);
  });

  it("quote expiresAt respects the injected clock and quoteTtlMs option", async () => {
    let clock = 1000;
    const adapter = createMockDeliveryAdapter({ now: () => clock, quoteTtlMs: 60000 });
    const quote = await adapter.getQuote({ distanceMiles: 2 });
    expect(quote.expiresAt).toBe(1000 + 60000);
  });

  it("unavailableDrivers option: schedule fails every delivery with a FAILED status", async () => {
    const adapter = createMockDeliveryAdapter({ unavailableDrivers: true });
    const quote = await adapter.getQuote({ distanceMiles: 3 });
    const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
    const scheduled = await adapter.schedule(delivery.deliveryId, { startAt: 0, endAt: 100 });

    expect(scheduled.status).toBe(DELIVERY_STATUS.FAILED);
    expect(scheduled.failureReason).toBe("no_drivers_available");
  });

  it("without unavailableDrivers, schedule succeeds normally", async () => {
    const adapter = createMockDeliveryAdapter();
    const quote = await adapter.getQuote({ distanceMiles: 3 });
    const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
    const scheduled = await adapter.schedule(delivery.deliveryId, { startAt: 0, endAt: 100 });

    expect(scheduled.status).toBe(DELIVERY_STATUS.SCHEDULED);
  });

  it("forceDelivered option: advancing to IN_TRANSIT auto-completes to DELIVERED", async () => {
    const adapter = createMockDeliveryAdapter({ forceDelivered: true });
    const quote = await adapter.getQuote({ distanceMiles: 3 });
    const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
    await adapter.schedule(delivery.deliveryId, { startAt: 0, endAt: 100 });
    adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);
    adapter.advance(delivery.deliveryId, DELIVERY_STATUS.PICKED_UP);

    const result = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.IN_TRANSIT);
    expect(result.status).toBe(DELIVERY_STATUS.DELIVERED);

    const pod = await adapter.getProofOfDelivery(delivery.deliveryId);
    expect(pod).toBeTruthy();
  });

  it("without forceDelivered, advancing to IN_TRANSIT stays IN_TRANSIT", async () => {
    const adapter = createMockDeliveryAdapter();
    const quote = await adapter.getQuote({ distanceMiles: 3 });
    const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
    await adapter.schedule(delivery.deliveryId, { startAt: 0, endAt: 100 });
    adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);
    adapter.advance(delivery.deliveryId, DELIVERY_STATUS.PICKED_UP);

    const result = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.IN_TRANSIT);
    expect(result.status).toBe(DELIVERY_STATUS.IN_TRANSIT);
  });

  it("checkEligibility delegates to evaluateDeliveryEligibility (no local rules)", async () => {
    const adapter = createMockDeliveryAdapter();
    const blockedCtx = {
      seller: { radiusMiles: 5 },
      distanceMiles: 50, // way out of radius
      packaging: { sealed: true, insulated: true, leakProof: true },
    };
    const result = await adapter.checkEligibility({ ctx: blockedCtx });
    expect(result.eligible).toBe(false);
    expect(result.verdict).toBe("pickup_fallback");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
