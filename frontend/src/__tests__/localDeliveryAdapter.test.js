/**
 * Unit tests for the local-delivery adapter contract (Task 12, Tier A).
 *
 * Verifies the adapter validator, quote validity, the status→order-state map,
 * and the delivery status transition guard.
 *
 * Run with: npx vitest --run src/__tests__/localDeliveryAdapter.test.js
 */

import { describe, it, expect } from "vitest";
import {
  DELIVERY_STATUS,
  REQUIRED_ADAPTER_METHODS,
  assertValidDeliveryAdapter,
  isQuoteValid,
  isValidDeliveryTransition,
  deliveryStatusToOrderState,
} from "../services/localDeliveryAdapter.js";

function completeAdapter() {
  const noop = async () => ({});
  return Object.fromEntries(REQUIRED_ADAPTER_METHODS.map((m) => [m, noop]));
}

describe("assertValidDeliveryAdapter", () => {
  it("accepts an adapter implementing every required method", () => {
    expect(assertValidDeliveryAdapter(completeAdapter())).toBe(true);
  });

  it("rejects an adapter missing a method, naming it", () => {
    const partial = completeAdapter();
    delete partial.getProofOfDelivery;
    expect(() => assertValidDeliveryAdapter(partial)).toThrow(/getProofOfDelivery/);
  });

  it("rejects non-objects", () => {
    expect(() => assertValidDeliveryAdapter(null)).toThrow();
  });
});

describe("isQuoteValid", () => {
  it("is valid before expiry and invalid after", () => {
    expect(isQuoteValid({ expiresAt: 2000 }, 1000)).toBe(true);
    expect(isQuoteValid({ expiresAt: 1000 }, 2000)).toBe(false);
  });
});

describe("deliveryStatusToOrderState", () => {
  it("maps courier statuses onto canonical order states", () => {
    expect(deliveryStatusToOrderState(DELIVERY_STATUS.PICKED_UP)).toBe("in_transit");
    expect(deliveryStatusToOrderState(DELIVERY_STATUS.IN_TRANSIT)).toBe("in_transit");
    expect(deliveryStatusToOrderState(DELIVERY_STATUS.DELIVERED)).toBe("delivered");
    expect(deliveryStatusToOrderState(DELIVERY_STATUS.SCHEDULED)).toBeNull();
  });
});

describe("isValidDeliveryTransition", () => {
  it("allows the normal progression", () => {
    expect(isValidDeliveryTransition(DELIVERY_STATUS.REQUESTED, DELIVERY_STATUS.QUOTED)).toBe(true);
    expect(isValidDeliveryTransition(DELIVERY_STATUS.SCHEDULED, DELIVERY_STATUS.DRIVER_ASSIGNED)).toBe(true);
    expect(isValidDeliveryTransition(DELIVERY_STATUS.IN_TRANSIT, DELIVERY_STATUS.DELIVERED)).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(isValidDeliveryTransition(DELIVERY_STATUS.REQUESTED, DELIVERY_STATUS.DELIVERED)).toBe(false);
    expect(isValidDeliveryTransition(DELIVERY_STATUS.QUOTED, DELIVERY_STATUS.IN_TRANSIT)).toBe(false);
  });

  it("rejects transitions out of a terminal status", () => {
    expect(isValidDeliveryTransition(DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.IN_TRANSIT)).toBe(false);
    expect(isValidDeliveryTransition(DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.SCHEDULED)).toBe(false);
  });

  it("allows cancellation/failure from active states", () => {
    expect(isValidDeliveryTransition(DELIVERY_STATUS.SCHEDULED, DELIVERY_STATUS.CANCELLED)).toBe(true);
    expect(isValidDeliveryTransition(DELIVERY_STATUS.IN_TRANSIT, DELIVERY_STATUS.FAILED)).toBe(true);
  });
});
