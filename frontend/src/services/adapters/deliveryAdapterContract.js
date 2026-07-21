/**
 * deliveryAdapterContract.js
 *
 * Reusable provider-contract test suite for local-delivery adapters (Task 12,
 * Tier B). Any adapter that implements the interface in
 * `../localDeliveryAdapter.js` — the sandbox mock today, a real provider
 * (DoorDash Drive, etc.) later — must pass this suite unmodified. That is
 * what guarantees the marketplace stays provider-agnostic.
 *
 * Usage:
 *   import { runDeliveryAdapterContract } from "./deliveryAdapterContract.js";
 *   runDeliveryAdapterContract(() => createMockDeliveryAdapter({ now: () => clock }));
 *
 * `makeAdapter()` is called fresh for each test so adapters with internal
 * state (like the in-memory Map in the mock) don't leak between cases.
 *
 * Assumes the adapter under test also exposes the same test-only lifecycle
 * helpers as the mock adapter (`advance`, `emit`) — real provider adapters
 * that don't have a test-only driver should supply an equivalent shim when
 * reusing this suite (out of scope for this task; see the spec).
 */

import { describe, it, expect } from "vitest";
import {
  DELIVERY_STATUS,
  assertValidDeliveryAdapter,
} from "../localDeliveryAdapter.js";

const ELIGIBLE_CTX = Object.freeze({
  seller: { radiusMiles: 20, prepLeadTimeMinutes: 30 },
  distanceMiles: 5,
  etaMinutes: 30,
  provider: { maxTravelMinutes: 120, allowsLivestock: true },
  packaging: { sealed: true, insulated: true, leakProof: true, thermalPack: true },
  conditions: { originTempF: 70, destTempF: 70 },
});

/**
 * Run the full provider contract suite against an adapter factory.
 * @param {() => Object} makeAdapter - returns a fresh adapter instance
 */
export function runDeliveryAdapterContract(makeAdapter) {
  describe("delivery adapter contract", () => {
    it("1. satisfies assertValidDeliveryAdapter (implements all REQUIRED_ADAPTER_METHODS)", () => {
      const adapter = makeAdapter();
      expect(() => assertValidDeliveryAdapter(adapter)).not.toThrow();
    });

    it("2. happy path: quote -> create -> schedule -> driver_assigned -> picked_up -> in_transit -> delivered", async () => {
      const adapter = makeAdapter();

      const eligibility = await adapter.checkEligibility({ ctx: ELIGIBLE_CTX });
      expect(eligibility.eligible).toBe(true);

      const quote = await adapter.getQuote({ distanceMiles: 5 });
      expect(quote.quoteId).toBeTruthy();
      expect(quote.currency).toBe("usd");
      expect(typeof quote.amountCents).toBe("number");
      expect(typeof quote.etaMinutes).toBe("number");
      expect(typeof quote.expiresAt).toBe("number");

      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
      expect(delivery.status).toBe(DELIVERY_STATUS.REQUESTED);
      expect(delivery.quoteId).toBe(quote.quoteId);

      const scheduled = await adapter.schedule(delivery.deliveryId, { startAt: 1000, endAt: 2000 });
      expect(scheduled.status).toBe(DELIVERY_STATUS.SCHEDULED);

      const assigned = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);
      expect(assigned.status).toBe(DELIVERY_STATUS.DRIVER_ASSIGNED);
      expect(assigned.driver).toBeTruthy();

      const pickedUp = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.PICKED_UP);
      expect(pickedUp.status).toBe(DELIVERY_STATUS.PICKED_UP);

      const inTransit = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.IN_TRANSIT);
      expect(inTransit.status).toBe(DELIVERY_STATUS.IN_TRANSIT);

      const delivered = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DELIVERED);
      expect(delivered.status).toBe(DELIVERY_STATUS.DELIVERED);

      const finalStatus = await adapter.getStatus(delivery.deliveryId);
      expect(finalStatus.status).toBe(DELIVERY_STATUS.DELIVERED);
    });

    it("3. quote expiry: createDelivery with an expired quote is rejected", async () => {
      let clock = 0;
      const adapter = makeAdapter({ now: () => clock, quoteTtlMs: 1000 });

      const quote = await adapter.getQuote({ distanceMiles: 3 });
      clock = 5000; // well past expiry

      await expect(adapter.createDelivery({ quoteId: quote.quoteId })).rejects.toThrow();
    });

    it("4. cancellation: succeeds from an active state; throws from a terminal state", async () => {
      const adapter = makeAdapter();
      const quote = await adapter.getQuote({ distanceMiles: 2 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });

      const cancelled = await adapter.cancel(delivery.deliveryId, "buyer changed mind");
      expect(cancelled.status).toBe(DELIVERY_STATUS.CANCELLED);

      await expect(adapter.cancel(delivery.deliveryId, "again")).rejects.toThrow();
    });

    it("5. unavailable drivers: scheduling yields a FAILED delivery with a clear reason", async () => {
      const adapter = makeAdapter({ unavailableDrivers: true });
      const quote = await adapter.getQuote({ distanceMiles: 4 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });

      const scheduled = await adapter.schedule(delivery.deliveryId, { startAt: 1000, endAt: 2000 });
      expect(scheduled.status).toBe(DELIVERY_STATUS.FAILED);
      expect(scheduled.failureReason).toBeTruthy();

      // A terminal FAILED delivery cannot then be advanced.
      expect(() => adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED)).toThrow();
    });

    it("6. delayed delivery: a delivery stalled in IN_TRANSIT is reported, not silently completed", async () => {
      const adapter = makeAdapter(); // forceDelivered defaults to false
      const quote = await adapter.getQuote({ distanceMiles: 6 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
      await adapter.schedule(delivery.deliveryId, { startAt: 1000, endAt: 2000 });
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.PICKED_UP);
      const inTransit = adapter.advance(delivery.deliveryId, DELIVERY_STATUS.IN_TRANSIT);

      // Stalled: still IN_TRANSIT, not auto-flipped to DELIVERED.
      const status = await adapter.getStatus(delivery.deliveryId);
      expect(status.status).toBe(DELIVERY_STATUS.IN_TRANSIT);
      expect(inTransit.status).toBe(DELIVERY_STATUS.IN_TRANSIT);

      // Proof of delivery must not exist for a stalled, undelivered parcel.
      const pod = await adapter.getProofOfDelivery(delivery.deliveryId);
      expect(pod).toBeNull();
    });

    it("7. proof of delivery: null before DELIVERED, present after", async () => {
      const adapter = makeAdapter();
      const quote = await adapter.getQuote({ distanceMiles: 1 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });

      expect(await adapter.getProofOfDelivery(delivery.deliveryId)).toBeNull();

      await adapter.schedule(delivery.deliveryId, { startAt: 1000, endAt: 2000 });
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.PICKED_UP);
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.IN_TRANSIT);

      expect(await adapter.getProofOfDelivery(delivery.deliveryId)).toBeNull();

      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DELIVERED);
      const pod = await adapter.getProofOfDelivery(delivery.deliveryId);
      expect(pod).toBeTruthy();
      expect(pod.type).toBeTruthy();
      expect(pod.ref).toBeTruthy();
      expect(pod.capturedAt).toBeTruthy();
    });

    it("8. webhook replay: applying the same normalized event twice is idempotent", async () => {
      const adapter = makeAdapter();
      const quote = await adapter.getQuote({ distanceMiles: 4 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });
      await adapter.schedule(delivery.deliveryId, { startAt: 1000, endAt: 2000 });
      adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DRIVER_ASSIGNED);

      const event = await adapter.normalizeWebhook({
        eventId: "evt-picked-up-1",
        deliveryId: delivery.deliveryId,
        status: DELIVERY_STATUS.PICKED_UP,
        at: 12345,
      });
      expect(event.eventId).toBe("evt-picked-up-1");

      const first = adapter.emit(event);
      expect(first.status).toBe(DELIVERY_STATUS.PICKED_UP);
      const firstUpdatedAt = first.updatedAt;

      // Replay the identical event — must not throw, must not change state again.
      const replay = adapter.emit(event);
      expect(replay.status).toBe(DELIVERY_STATUS.PICKED_UP);
      expect(replay.updatedAt).toBe(firstUpdatedAt);

      const status = await adapter.getStatus(delivery.deliveryId);
      expect(status.status).toBe(DELIVERY_STATUS.PICKED_UP);
    });

    it("9. illegal transitions are rejected via isValidDeliveryTransition", async () => {
      const adapter = makeAdapter();
      const quote = await adapter.getQuote({ distanceMiles: 2 });
      const delivery = await adapter.createDelivery({ quoteId: quote.quoteId });

      // REQUESTED -> DELIVERED is not a legal one-hop transition.
      expect(() => adapter.advance(delivery.deliveryId, DELIVERY_STATUS.DELIVERED)).toThrow();

      // Advancing to a real terminal state, then attempting any further
      // transition, must also throw (terminal is final).
      await adapter.cancel(delivery.deliveryId, "test");
      expect(() => adapter.advance(delivery.deliveryId, DELIVERY_STATUS.SCHEDULED)).toThrow();
    });
  });
}
