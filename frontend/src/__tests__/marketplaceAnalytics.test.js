/**
 * Unit tests for marketplaceAnalytics.js — the pure reducers for Task 21C
 * (box utilization, local-delivery performance, cash-sale reporting,
 * conversion funnel). See docs/TASK_21C_ANALYTICS_SPEC.md §5.
 *
 * Run with: npx vitest --run src/__tests__/marketplaceAnalytics.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  boxUtilization,
  localDeliveryPerformance,
  cashSaleReport,
  conversionFunnel,
  ANALYTICS_COPY,
} from "../services/marketplaceAnalytics.js";
import { normalizeParcelPreset, PACKING_DEFAULTS } from "../services/packingEngine.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";

const preset = normalizeParcelPreset(PACKING_DEFAULTS); // 40oz / 4 bags / 720in3 / thermal 240 / 6 livestock

function orderWithUsage(usage, overrides = {}) {
  return {
    order_type: "shipping",
    status: "completed",
    subtotal_cents: 1000,
    platform_fee_cents: 40,
    total_paid_cents: 1000,
    metadata: { packingUsage: usage },
    ...overrides,
  };
}

// ─── 1. boxUtilization ───────────────────────────────────────────────────────

describe("boxUtilization", () => {
  it("computes the average fill percent across orders carrying packing usage", () => {
    const orders = [
      orderWithUsage({ weightOz: 20, bags: 1, volumeIn3: 100, thermalPacks: 1, livestock: 3 }), // livestock: 3/6 = 50%
      orderWithUsage({ weightOz: 40, bags: 1, volumeIn3: 100, thermalPacks: 1, livestock: 6 }), // livestock: 6/6 = 100%
    ];
    const result = boxUtilization(orders, { preset });
    expect(result.sampleSize).toBe(2);
    expect(result.avgFillPercent).toBe(75); // (50 + 100) / 2
  });

  it("counts orders that stayed within a single, fully-used box as avoidedExtraBoxes", () => {
    const single = orderWithUsage({ weightOz: 5, bags: 1, volumeIn3: 5, thermalPacks: 0, livestock: 6 }, {}); // 1 box, full livestock
    const result = boxUtilization([single], { preset });
    expect(result.avoidedExtraBoxes).toBe(1);
  });

  it("does not count a multi-box order as avoidedExtraBoxes", () => {
    const multi = orderWithUsage({ weightOz: 5, bags: 1, volumeIn3: 5, thermalPacks: 0, livestock: 12 }); // 2 boxes
    const result = boxUtilization([multi], { preset });
    expect(result.avoidedExtraBoxes).toBe(0);
  });

  it("degrades gracefully to sampleSize 0 / avgFillPercent null when no order carries packing usage data", () => {
    const result = boxUtilization([{ order_type: "shipping", status: "completed" }], { preset });
    expect(result.sampleSize).toBe(0);
    expect(result.avgFillPercent).toBeNull();
    expect(result.avoidedExtraBoxes).toBe(0);
  });

  it("excludes orders without packing usage from the aggregate rather than treating them as 0% fill", () => {
    const withUsage = orderWithUsage({ weightOz: 40, bags: 1, volumeIn3: 100, thermalPacks: 1, livestock: 6 });
    const withoutUsage = { order_type: "shipping", status: "completed" };
    const result = boxUtilization([withUsage, withoutUsage], { preset });
    expect(result.sampleSize).toBe(1);
    expect(result.avgFillPercent).toBe(100);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => boxUtilization([])).not.toThrow();
    expect(() => boxUtilization(undefined)).not.toThrow();
    expect(boxUtilization([]).sampleSize).toBe(0);
  });

  it("uses the caller-provided seller preset rather than always the global default", () => {
    const tinyPreset = normalizeParcelPreset({ max_livestock: 2, usable_weight_oz: 10, max_bags: 1, usable_volume_in3: 50, thermal_pack_space_in3: 10 });
    const order = orderWithUsage({ weightOz: 5, bags: 1, volumeIn3: 25, thermalPacks: 0, livestock: 2 });
    const result = boxUtilization([order], { preset: tinyPreset });
    expect(result.avgFillPercent).toBe(100); // 2/2 livestock against the tiny preset
  });
});

// ─── 2. localDeliveryPerformance ─────────────────────────────────────────────

describe("localDeliveryPerformance", () => {
  function courierOrder(delivery) {
    return { fulfillment_type: "courier", metadata: { delivery } };
  }

  it("computes quoteAcceptanceRate, successfulDeliveryRate, and delayRate from delivery metadata", () => {
    const orders = [
      courierOrder({ quoted: true, accepted: true, delivered: true, delayed: false }),
      courierOrder({ quoted: true, accepted: true, delivered: false, delayed: true }),
      courierOrder({ quoted: true, accepted: false, delivered: false, delayed: false }),
    ];
    const result = localDeliveryPerformance(orders);
    expect(result.sampleSize).toBe(3);
    expect(result.quoteAcceptanceRate).toBe(0.67); // 2/3 accepted of 3 quoted
    expect(result.successfulDeliveryRate).toBe(0.5); // 1/2 delivered of 2 accepted
    expect(result.delayRate).toBe(0.33); // 1/3 delayed
  });

  it("degrades gracefully to sampleSize 0 / all rates null when no courier order carries delivery metadata", () => {
    const result = localDeliveryPerformance([{ fulfillment_type: "courier" }]);
    expect(result.sampleSize).toBe(0);
    expect(result.quoteAcceptanceRate).toBeNull();
    expect(result.successfulDeliveryRate).toBeNull();
    expect(result.delayRate).toBeNull();
  });

  it("ignores non-courier orders even when they carry delivery-shaped metadata", () => {
    const shipping = { fulfillment_type: "shipping", metadata: { delivery: { quoted: true, accepted: true, delivered: true, delayed: false } } };
    const result = localDeliveryPerformance([shipping]);
    expect(result.sampleSize).toBe(0);
  });

  it("returns null quoteAcceptanceRate when no quotes were recorded (avoids divide-by-zero fabrication)", () => {
    const result = localDeliveryPerformance([courierOrder({ quoted: false, accepted: false, delivered: false, delayed: false })]);
    expect(result.quoteAcceptanceRate).toBeNull();
    expect(result.successfulDeliveryRate).toBeNull();
    expect(result.delayRate).toBe(0);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => localDeliveryPerformance([])).not.toThrow();
    expect(() => localDeliveryPerformance(undefined)).not.toThrow();
  });
});

// ─── 3. cashSaleReport ────────────────────────────────────────────────────────

describe("cashSaleReport", () => {
  it("counts cash-handshake orders and sums proceeds via sellerProceedsCents", () => {
    const orders = [
      { order_type: "cash_handshake", subtotal_cents: 1000, platform_fee_cents: 0, total_paid_cents: 1000 },
      { order_type: "cash_handshake", subtotal_cents: 500, platform_fee_cents: 0, total_paid_cents: 500 },
      { order_type: "shipping", subtotal_cents: 999, platform_fee_cents: 0, total_paid_cents: 999 },
    ];
    const result = cashSaleReport(orders);
    expect(result.count).toBe(2);
    expect(result.volumeCents).toBe(1500);
    expect(result.sampleSize).toBe(2);
  });

  it("reports zero, not fabricated data, when there are no cash orders", () => {
    const result = cashSaleReport([{ order_type: "shipping" }]);
    expect(result.count).toBe(0);
    expect(result.volumeCents).toBe(0);
    expect(result.sampleSize).toBe(0);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => cashSaleReport([])).not.toThrow();
    expect(() => cashSaleReport(undefined)).not.toThrow();
  });
});

// ─── 4. conversionFunnel ──────────────────────────────────────────────────────

describe("conversionFunnel", () => {
  it("derives checkout/completed from orders alone when no events are provided", () => {
    const orders = [{ status: "completed" }, { status: "locked" }, { status: "released" }];
    const result = conversionFunnel(undefined, orders);
    expect(result.checkout).toBe(3);
    expect(result.completed).toBe(2);
    expect(result.rates.checkoutToCompleted).toBe(0.67);
  });

  it("marks impressions/addToCart null with a note when events are absent", () => {
    const result = conversionFunnel(undefined, []);
    expect(result.impressions).toBeNull();
    expect(result.addToCart).toBeNull();
    expect(result.note).toMatch(/event instrumentation/i);
  });

  it("never fabricates impressions/addToCart from order counts alone", () => {
    const result = conversionFunnel([], [{ status: "completed" }]);
    // an empty (but present) events array still counts as "no instrumentation data"
    expect(result.impressions).toBeNull();
    expect(result.addToCart).toBeNull();
  });

  it("populates impressions/addToCart from events and clears the note when instrumentation exists", () => {
    const events = [
      { type: "impression" }, { type: "impression" }, { type: "impression" },
      { type: "add_to_cart" },
      { type: "checkout" },
    ];
    const orders = [{ status: "completed" }];
    const result = conversionFunnel(events, orders);
    expect(result.impressions).toBe(3);
    expect(result.addToCart).toBe(1);
    expect(result.note).toBeNull();
  });

  it("checkoutToCompleted rate is null (not 0/NaN) when there are no orders", () => {
    const result = conversionFunnel(undefined, []);
    expect(result.checkout).toBe(0);
    expect(result.rates.checkoutToCompleted).toBeNull();
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => conversionFunnel(undefined, undefined)).not.toThrow();
    expect(() => conversionFunnel(null, null)).not.toThrow();
  });
});

// ─── 5. Money-mapping guard ───────────────────────────────────────────────────

describe("marketplaceAnalytics.js — money-mapping guard (no forked revenue formula)", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../services/marketplaceAnalytics.js", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports sellerProceedsCents from breederDashboard.js", () => {
    expect(SOURCE).toContain('from "./breederDashboard.js"');
    expect(SOURCE).toContain("sellerProceedsCents");
  });

  it("contains no local subtotal-minus-platform-fee (or similarly forked) revenue formula", () => {
    expect(SOURCE).not.toMatch(/subtotal_cents\s*-\s*platform_fee_cents/);
    expect(SOURCE).not.toMatch(/subtotal\s*-\s*platformFee/);
  });

  it("cashSaleReport computes volumeCents via sellerProceedsCents, not total_paid_cents directly", () => {
    const idx = SOURCE.indexOf("export function cashSaleReport(");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 600);
    expect(block).toContain("sellerProceedsCents(o)");
    expect(block).not.toMatch(/total_paid_cents/);
  });
});

// ─── 6. Web2 language invariant ──────────────────────────────────────────────

describe("ANALYTICS_COPY — Web2 language invariant", () => {
  it("every copy string is free of PROHIBITED_TERMS", () => {
    for (const [key, value] of Object.entries(ANALYTICS_COPY)) {
      expect(containsProhibitedTerm(value), `ANALYTICS_COPY.${key} = "${value}"`).toBe(false);
    }
  });
});
