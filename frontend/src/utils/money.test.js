import { describe, it, expect } from "vitest";
import { formatUsdCents, parseUsdToCents, minimumNextBidCents, MAX_USD_CENTS } from "./money";

describe("parseUsdToCents", () => {
  it("parses the float-rounding trap correctly", () => {
    // parseFloat("19.99") * 100 === 1998.9999999999998, so a truncating
    // implementation silently charges $19.98. This is the whole reason the
    // helper exists.
    expect(parseUsdToCents("19.99").cents).toBe(1999);
    expect(parseUsdToCents("0.29").cents).toBe(29);
    expect(parseUsdToCents("1.005").error).toBeTruthy();
  });

  it("accepts the shapes people actually type", () => {
    expect(parseUsdToCents("20").cents).toBe(2000);
    expect(parseUsdToCents(" 20 ").cents).toBe(2000);
    expect(parseUsdToCents("$24.99").cents).toBe(2499);
    expect(parseUsdToCents("1,299").cents).toBe(129900);
    expect(parseUsdToCents("7.5").cents).toBe(750);
  });

  it("rejects junk, negatives and zero", () => {
    for (const bad of ["", "  ", "abc", "-5", "1e3", "0", "0.00", "$", "1.2.3", null, undefined]) {
      expect(parseUsdToCents(bad).cents, `input: ${bad}`).toBeNull();
      expect(parseUsdToCents(bad).error, `input: ${bad}`).toBeTruthy();
    }
  });

  it("rejects amounts over the sanity cap, matching the DB CHECK", () => {
    expect(parseUsdToCents("1000000").cents).toBe(MAX_USD_CENTS);
    expect(parseUsdToCents("1000000.01").cents).toBeNull();
  });

  it("never returns a fractional cent", () => {
    for (const v of ["0.01", "3.33", "19.99", "123.45", "999999.99"]) {
      expect(Number.isInteger(parseUsdToCents(v).cents), `input: ${v}`).toBe(true);
    }
  });
});

describe("formatUsdCents", () => {
  it("formats cents as dollars", () => {
    expect(formatUsdCents(1999)).toBe("$19.99");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(129900)).toBe("$1,299.00");
  });

  it("drops .00 only when asked and only when round", () => {
    expect(formatUsdCents(7500, { showCents: false })).toBe("$75");
    expect(formatUsdCents(7550, { showCents: false })).toBe("$75.50");
  });

  it("shows an em dash for a missing amount rather than $0.00", () => {
    // A lot with no reserve must not read as "free".
    expect(formatUsdCents(null)).toBe("—");
    expect(formatUsdCents(undefined)).toBe("—");
    expect(formatUsdCents("")).toBe("—");
    expect(formatUsdCents("abc")).toBe("—");
  });

  it("round-trips with the parser", () => {
    for (const v of ["0.01", "19.99", "75", "1299.50"]) {
      const { cents } = parseUsdToCents(v);
      expect(parseUsdToCents(formatUsdCents(cents)).cents).toBe(cents);
    }
  });
});

describe("minimumNextBidCents", () => {
  it("uses the reserve when there are no bids", () => {
    expect(minimumNextBidCents({ reserveCents: 5000 })).toBe(5000);
  });

  it("falls back to $1 when there is no reserve and no bid", () => {
    expect(minimumNextBidCents({})).toBe(100);
    expect(minimumNextBidCents({ reserveCents: 0 })).toBe(100);
  });

  it("adds 5% over a standing bid", () => {
    expect(minimumNextBidCents({ standingBidCents: 10000 })).toBe(10500);
  });

  it("always advances by at least a dollar on cheap lots", () => {
    // 5% of $5 is 25c; without the floor a lot could creep up in pennies.
    expect(minimumNextBidCents({ standingBidCents: 500 })).toBe(600);
  });

  it("always strictly exceeds the standing bid, which the DB requires", () => {
    for (const standing of [1, 50, 99, 100, 12345, 999999]) {
      expect(minimumNextBidCents({ standingBidCents: standing })).toBeGreaterThan(standing);
    }
  });

  it("returns whole cents", () => {
    for (const standing of [333, 1667, 99999]) {
      expect(Number.isInteger(minimumNextBidCents({ standingBidCents: standing }))).toBe(true);
    }
  });
});
