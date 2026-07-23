/**
 * Unit tests for customerSegments.js (Task 21B). See
 * docs/TASK_21B_PROMOTIONS_SPEC.md §3/§5.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildCustomerSegments } from "../services/customerSegments.js";
import { generateAlias } from "../utils/generateAlias.js";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WALLET_C = "0xcccccccccccccccccccccccccccccccccccccccc";

function order(overrides = {}) {
  return {
    buyer_wallet: WALLET_A,
    status: "completed",
    total_paid_cents: 1000,
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildCustomerSegments — privacy (alias-only output)", () => {
  it("never includes a raw wallet address anywhere in the output", () => {
    const result = buildCustomerSegments([order()]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(WALLET_A);
  });

  it("uses generateAlias for the buyer identifier", () => {
    const result = buildCustomerSegments([order(), order(), order()]); // 3 completed -> repeat buyer
    expect(result.repeatBuyers[0].alias).toBe(generateAlias(WALLET_A));
  });
});

describe("buildCustomerSegments — repeatBuyers", () => {
  it("includes only buyers with 2+ completed orders", () => {
    const orders = [
      order({ buyer_wallet: WALLET_A }),
      order({ buyer_wallet: WALLET_A }),
      order({ buyer_wallet: WALLET_B }), // only 1 completed order
    ];
    const result = buildCustomerSegments(orders);
    expect(result.repeatBuyers.map((b) => b.alias)).toEqual([generateAlias(WALLET_A)]);
  });

  it("does not count non-completed orders toward the repeat-buyer threshold", () => {
    const orders = [
      order({ buyer_wallet: WALLET_A, status: "completed" }),
      order({ buyer_wallet: WALLET_A, status: "pending" }),
      order({ buyer_wallet: WALLET_A, status: "disputed" }),
    ];
    const result = buildCustomerSegments(orders);
    expect(result.repeatBuyers).toEqual([]);
  });

  it("orders repeat buyers by completedCount descending", () => {
    const orders = [
      order({ buyer_wallet: WALLET_A }), order({ buyer_wallet: WALLET_A }),
      order({ buyer_wallet: WALLET_B }), order({ buyer_wallet: WALLET_B }), order({ buyer_wallet: WALLET_B }),
    ];
    const result = buildCustomerSegments(orders);
    expect(result.repeatBuyers[0].alias).toBe(generateAlias(WALLET_B));
    expect(result.repeatBuyers[1].alias).toBe(generateAlias(WALLET_A));
  });
});

describe("buildCustomerSegments — highValueBuyers", () => {
  it("ranks buyers by totalSpentCents (completed orders only), capped to topN", () => {
    const orders = [
      order({ buyer_wallet: WALLET_A, total_paid_cents: 500 }),
      order({ buyer_wallet: WALLET_B, total_paid_cents: 5000 }),
      order({ buyer_wallet: WALLET_C, total_paid_cents: 100 }),
    ];
    const result = buildCustomerSegments(orders, { highValueTopN: 2 });
    expect(result.highValueBuyers.map((b) => b.alias)).toEqual([generateAlias(WALLET_B), generateAlias(WALLET_A)]);
  });

  it("excludes a buyer with zero completed-order spend", () => {
    const orders = [order({ buyer_wallet: WALLET_A, status: "pending", total_paid_cents: 5000 })];
    const result = buildCustomerSegments(orders);
    expect(result.highValueBuyers).toEqual([]);
  });
});

describe("buildCustomerSegments — atRiskBuyers", () => {
  it("flags a former buyer whose last order is older than atRiskDays", () => {
    const now = Date.parse("2026-08-01T00:00:00Z");
    const orders = [order({ buyer_wallet: WALLET_A, created_at: "2026-01-01T00:00:00Z" })];
    const result = buildCustomerSegments(orders, { now, atRiskDays: 60 });
    expect(result.atRiskBuyers.map((b) => b.alias)).toEqual([generateAlias(WALLET_A)]);
  });

  it("does not flag a recently active buyer", () => {
    const now = Date.parse("2026-08-01T00:00:00Z");
    const orders = [order({ buyer_wallet: WALLET_A, created_at: "2026-07-25T00:00:00Z" })];
    const result = buildCustomerSegments(orders, { now, atRiskDays: 60 });
    expect(result.atRiskBuyers).toEqual([]);
  });

  it("never flags a buyer with zero completed orders (no signal to judge by)", () => {
    const now = Date.parse("2026-08-01T00:00:00Z");
    const orders = [order({ buyer_wallet: WALLET_A, status: "pending", created_at: "2026-01-01T00:00:00Z" })];
    const result = buildCustomerSegments(orders, { now, atRiskDays: 60 });
    expect(result.atRiskBuyers).toEqual([]);
  });
});

describe("buildCustomerSegments — purity + edge cases", () => {
  it("never mutates the input orders array", () => {
    const orders = [order()];
    const copy = JSON.parse(JSON.stringify(orders));
    buildCustomerSegments(orders);
    expect(orders).toEqual(copy);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => buildCustomerSegments([])).not.toThrow();
    expect(() => buildCustomerSegments(undefined)).not.toThrow();
    expect(() => buildCustomerSegments([null, undefined, order()])).not.toThrow();
  });

  it("reports sampleSize as the number of distinct buyers", () => {
    const orders = [order({ buyer_wallet: WALLET_A }), order({ buyer_wallet: WALLET_A }), order({ buyer_wallet: WALLET_B })];
    const result = buildCustomerSegments(orders);
    expect(result.sampleSize).toBe(2);
  });
});

// ─── Money-mapping note (this module deliberately does NOT use sellerProceedsCents) ─

describe("customerSegments.js — deliberate money-mapping note", () => {
  it("does not import sellerProceedsCents (buyer-value reporting, not seller earnings)", () => {
    const SOURCE = readFileSync(fileURLToPath(new URL("../services/customerSegments.js", import.meta.url)), "utf8");
    expect(SOURCE).not.toMatch(/import\s*\{[^}]*sellerProceedsCents/);
    expect(SOURCE).not.toContain('from "./breederDashboard.js"');
    expect(SOURCE).toContain("total_paid_cents");
  });
});
