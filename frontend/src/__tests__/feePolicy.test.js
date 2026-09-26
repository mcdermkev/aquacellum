/**
 * feePolicy.test.js
 *
 * The fee policy decides real money, so its failure directions matter more than
 * its happy path. Every "unknown / missing / malformed" case must land on the
 * STANDARD rate — a fee policy that fails toward a discount silently gives away
 * revenue, and one that fails toward an overcharge breaks a promise we made.
 */

import { describe, it, expect } from "vitest";
import {
  resolveFeePolicy,
  describeFeePolicy,
  FEE_RAIL,
  FEE_REASON,
  DEFAULT_STANDARD_FEE_PERCENT,
  DEFAULT_EVENT_FEE_PERCENT,
} from "../services/feePolicy";

describe("resolveFeePolicy — cash", () => {
  it("charges nothing for a recorded cash sale", () => {
    const p = resolveFeePolicy({ rail: FEE_RAIL.CASH });
    expect(p.feePercent).toBe(0);
    expect(p.reason).toBe(FEE_REASON.CASH);
  });

  it("ignores an eventId on the cash rail", () => {
    expect(resolveFeePolicy({ rail: FEE_RAIL.CASH, eventId: "abc" }).feePercent).toBe(0);
  });
});

describe("resolveFeePolicy — standard card", () => {
  it("charges the standard rate", () => {
    const p = resolveFeePolicy({ rail: FEE_RAIL.CARD });
    expect(p.feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
    expect(p.reason).toBe(FEE_REASON.STANDARD);
  });

  it("honours an explicit standardPercent", () => {
    expect(resolveFeePolicy({ rail: FEE_RAIL.CARD, standardPercent: 6 }).feePercent).toBe(6);
  });
});

describe("resolveFeePolicy — event card", () => {
  it("applies the reduced rate with a verified event and records which one", () => {
    const p = resolveFeePolicy({ rail: FEE_RAIL.CARD_EVENT, eventId: "tide-123" });
    expect(p.feePercent).toBe(DEFAULT_EVENT_FEE_PERCENT);
    expect(p.reason).toBe("event:tide-123");
  });

  it("falls back to standard when no event id is supplied", () => {
    const p = resolveFeePolicy({ rail: FEE_RAIL.CARD_EVENT, eventId: null });
    expect(p.feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
    expect(p.reason).toBe(FEE_REASON.STANDARD);
  });

  it("treats an empty/whitespace event id as no event", () => {
    expect(resolveFeePolicy({ rail: FEE_RAIL.CARD_EVENT, eventId: "   " }).feePercent)
      .toBe(DEFAULT_STANDARD_FEE_PERCENT);
  });

  it("never charges MORE than standard even if misconfigured above it", () => {
    const p = resolveFeePolicy({
      rail: FEE_RAIL.CARD_EVENT,
      eventId: "t1",
      standardPercent: 4,
      eventPercent: 9,
    });
    expect(p.feePercent).toBe(4);
  });
});

describe("resolveFeePolicy — fails to standard, never to a discount", () => {
  it("rejects an unknown rail", () => {
    expect(resolveFeePolicy({ rail: "free_please" }).feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
  });

  it("rejects a missing rail", () => {
    expect(resolveFeePolicy({}).feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
    expect(resolveFeePolicy().feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
  });

  it("sanitises nonsense percentages rather than propagating NaN into a charge", () => {
    // `null` and `false` are the dangerous ones: a JS default parameter only fills
    // in for `undefined`, and Number(null) === Number(false) === 0, so a naive
    // coercion turns a missing rate into a FREE sale.
    for (const bad of [NaN, undefined, null, false, true, -5, 101, "abc", "", Infinity, {}, []]) {
      const p = resolveFeePolicy({ rail: FEE_RAIL.CARD, standardPercent: bad });
      expect(Number.isFinite(p.feePercent)).toBe(true);
      expect(p.feePercent).toBe(DEFAULT_STANDARD_FEE_PERCENT);
    }
  });

  it("sanitises a nonsense event percentage", () => {
    const p = resolveFeePolicy({ rail: FEE_RAIL.CARD_EVENT, eventId: "t", eventPercent: NaN });
    expect(p.feePercent).toBe(DEFAULT_EVENT_FEE_PERCENT);
  });

  it("always returns a finite percent in [0,100] for any input", () => {
    const inputs = [
      { rail: FEE_RAIL.CASH },
      { rail: FEE_RAIL.CARD },
      { rail: FEE_RAIL.CARD_EVENT, eventId: "x" },
      { rail: "nope" },
      {},
    ];
    for (const args of inputs) {
      const { feePercent } = resolveFeePolicy(args);
      expect(Number.isFinite(feePercent)).toBe(true);
      expect(feePercent).toBeGreaterThanOrEqual(0);
      expect(feePercent).toBeLessThanOrEqual(100);
    }
  });
});

describe("describeFeePolicy", () => {
  it("says there is no fee for cash", () => {
    expect(describeFeePolicy(resolveFeePolicy({ rail: FEE_RAIL.CASH }))).toMatch(/no platform fee/i);
  });

  it("calls out the reduced event rate", () => {
    const copy = describeFeePolicy(resolveFeePolicy({ rail: FEE_RAIL.CARD_EVENT, eventId: "t" }));
    expect(copy).toMatch(/event/i);
  });

  it("degrades safely on a missing policy object", () => {
    expect(typeof describeFeePolicy(undefined)).toBe("string");
  });
});
