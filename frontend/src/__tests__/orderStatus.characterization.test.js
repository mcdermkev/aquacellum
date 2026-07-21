/**
 * Characterization tests for the CURRENT (legacy) order-status logic.
 *
 * These pin the existing behavior of the status-mapping/advance helpers exactly
 * as they behave today — quirks included — so the Task 23 migration to the
 * canonical state machine (marketplaceStateMachine.js) can prove parity and
 * catch accidental drift. If a test here fails, the legacy behavior changed;
 * confirm that was intentional before updating the expectation.
 *
 * Run with: npx vitest --run src/__tests__/orderStatus.characterization.test.js
 */

import { describe, it, expect } from "vitest";
import {
  STATUS_ORDER,
  TERMINAL_CLOUD_STATUSES,
  isStatusAdvanced,
  getLocalStatusString,
  mapCloudStatusToShippingInt,
  mapCloudStatusToBatchInt,
} from "../services/orderStatus.js";

describe("STATUS_ORDER ranking (legacy)", () => {
  it("preserves the exact ordering that drives advance decisions", () => {
    expect(STATUS_ORDER).toEqual([
      "pending", "locked", "dispatched", "released", "completed",
      "settled", "disputed", "resolved_released", "refunded", "failed",
    ]);
  });

  it("treats the documented set as terminal", () => {
    expect(TERMINAL_CLOUD_STATUSES).toEqual([
      "released", "completed", "settled", "refunded", "failed", "resolved_released",
    ]);
  });
});

describe("isStatusAdvanced (legacy cloud-wins rules)", () => {
  it("advances along the normal happy path", () => {
    expect(isStatusAdvanced("locked", "pending")).toBe(true);
    expect(isStatusAdvanced("dispatched", "locked")).toBe(true);
    expect(isStatusAdvanced("released", "dispatched")).toBe(true);
  });

  it("does not regress", () => {
    expect(isStatusAdvanced("locked", "dispatched")).toBe(false);
    expect(isStatusAdvanced("pending", "locked")).toBe(false);
  });

  it("returns false when statuses are equal", () => {
    expect(isStatusAdvanced("dispatched", "dispatched")).toBe(false);
    expect(isStatusAdvanced("pending", "pending")).toBe(false);
  });

  it("lets any terminal cloud status win over a non-terminal local status", () => {
    expect(isStatusAdvanced("refunded", "locked")).toBe(true);
    expect(isStatusAdvanced("settled", "pending")).toBe(true);
    expect(isStatusAdvanced("resolved_released", "dispatched")).toBe(true);
    expect(isStatusAdvanced("completed", "disputed")).toBe(true);
  });

  it("accepts a disputed cloud status from any non-terminal local state (branch)", () => {
    expect(isStatusAdvanced("disputed", "locked")).toBe(true);
    expect(isStatusAdvanced("disputed", "dispatched")).toBe(true);
  });

  it("QUIRK: does not advance from one terminal to another (both terminal → index compare)", () => {
    // Both terminal → first branch is false; not equal; not 'disputed';
    // falls through to index comparison in STATUS_ORDER.
    // released(idx3) vs refunded(idx8): 3 > 8 is false.
    expect(isStatusAdvanced("released", "refunded")).toBe(false);
    // refunded(idx8) vs released(idx3): 8 > 3 is true.
    expect(isStatusAdvanced("refunded", "released")).toBe(true);
  });

  it("QUIRK: unknown statuses fall back to index -1 comparisons", () => {
    // unknown cloud (-1) vs known local → -1 > localIdx is false.
    expect(isStatusAdvanced("bogus", "locked")).toBe(false);
    // known non-terminal cloud vs unknown local (-1) → cloudIdx > -1 is true.
    expect(isStatusAdvanced("locked", "bogus")).toBe(true);
  });
});

describe("getLocalStatusString (legacy per-type derivation)", () => {
  it("maps shipping integer status to its string", () => {
    expect(getLocalStatusString({ orderType: "shipping", status: 0 })).toBe("locked");
    expect(getLocalStatusString({ orderType: "shipping", status: 1 })).toBe("dispatched");
    expect(getLocalStatusString({ orderType: "shipping", status: 2 })).toBe("released");
    expect(getLocalStatusString({ orderType: "shipping", status: 3 })).toBe("disputed");
    expect(getLocalStatusString({ orderType: "shipping", status: 4 })).toBe("refunded");
  });

  it("defaults shipping to 'locked' for out-of-range/undefined status", () => {
    expect(getLocalStatusString({ orderType: "shipping", status: 99 })).toBe("locked");
    expect(getLocalStatusString({ orderType: "shipping" })).toBe("locked");
  });

  it("maps batch integer state to its string", () => {
    expect(getLocalStatusString({ orderType: "batch", state: 0 })).toBe("pending");
    expect(getLocalStatusString({ orderType: "batch", state: 1 })).toBe("released");
    expect(getLocalStatusString({ orderType: "batch", state: 2 })).toBe("refunded");
  });

  it("defaults batch to 'pending' for out-of-range/undefined state", () => {
    expect(getLocalStatusString({ orderType: "batch", state: 99 })).toBe("pending");
    expect(getLocalStatusString({ orderType: "batch" })).toBe("pending");
  });

  it("uses the raw status string for other order types, defaulting to 'pending'", () => {
    expect(getLocalStatusString({ orderType: "fiat_pending", status: "settled" })).toBe("settled");
    expect(getLocalStatusString({ orderType: "instant" })).toBe("pending");
  });
});

describe("mapCloudStatusToShippingInt (legacy)", () => {
  it("maps each known status to its integer", () => {
    expect(mapCloudStatusToShippingInt("locked")).toBe(0);
    expect(mapCloudStatusToShippingInt("dispatched")).toBe(1);
    expect(mapCloudStatusToShippingInt("released")).toBe(2);
    expect(mapCloudStatusToShippingInt("disputed")).toBe(3);
    expect(mapCloudStatusToShippingInt("refunded")).toBe(4);
  });

  it("QUIRK: resolved_released collapses to the same int as released (2)", () => {
    expect(mapCloudStatusToShippingInt("resolved_released")).toBe(2);
  });

  it("defaults unknown statuses to 0", () => {
    expect(mapCloudStatusToShippingInt("completed")).toBe(0);
    expect(mapCloudStatusToShippingInt("bogus")).toBe(0);
    expect(mapCloudStatusToShippingInt(undefined)).toBe(0);
  });
});

describe("mapCloudStatusToBatchInt (legacy)", () => {
  it("maps each known status to its integer", () => {
    expect(mapCloudStatusToBatchInt("pending")).toBe(0);
    expect(mapCloudStatusToBatchInt("released")).toBe(1);
    expect(mapCloudStatusToBatchInt("refunded")).toBe(2);
  });

  it("defaults unknown statuses to 0", () => {
    expect(mapCloudStatusToBatchInt("dispatched")).toBe(0);
    expect(mapCloudStatusToBatchInt("bogus")).toBe(0);
    expect(mapCloudStatusToBatchInt(undefined)).toBe(0);
  });
});
