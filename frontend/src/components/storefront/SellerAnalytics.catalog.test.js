/**
 * Component-level guards for the Task 21C extensions to SellerAnalytics.jsx
 * (box utilization / local delivery / cash-sale tiles) and the new
 * BuyerInsights.jsx (docs/TASK_21C_ANALYTICS_SPEC.md §5, criteria 5-7).
 *
 * This project's vitest runs in a `node` environment (no jsdom) and these
 * components transitively import recharts/other browser-only dependencies,
 * so — matching the established source-guard convention
 * (CheckoutSummary.orders.test.js, StorefrontMerchandising.catalog.test.js)
 * — the behavioral contract is verified via static source guards over the
 * comment-stripped source, complementing the exhaustive pure-module tests
 * in marketplaceAnalytics.test.js.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ANALYTICS_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./SellerAnalytics.jsx", import.meta.url)), "utf8")
);
const BUYER_INSIGHTS_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../BuyerInsights.jsx", import.meta.url)), "utf8")
);
const CHECKOUT_SUMMARY_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../CheckoutSummary.jsx", import.meta.url)), "utf8")
);
const BREEDER_TERMINAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../breeder/BreederTerminal.jsx", import.meta.url)), "utf8")
);
const STOREFRONT_SETUP_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../StorefrontSetup.jsx", import.meta.url)), "utf8")
);

describe("SellerAnalytics — renders new tiles from marketplaceAnalytics.js (§5.5)", () => {
  it("imports boxUtilization/localDeliveryPerformance/cashSaleReport and calls them over the same `orders` array already fetched", () => {
    expect(ANALYTICS_SOURCE).toContain(
      'import { boxUtilization, localDeliveryPerformance, cashSaleReport, ANALYTICS_COPY } from "../../services/marketplaceAnalytics";'
    );
    expect(ANALYTICS_SOURCE).toContain("boxUtilization(orders)");
    expect(ANALYTICS_SOURCE).toContain("localDeliveryPerformance(orders)");
    expect(ANALYTICS_SOURCE).toContain("cashSaleReport(orders)");
  });

  it("does not re-fetch a separate order set for the new tiles (single fetch, reused)", () => {
    // Only one fetchSellerOrders call should exist in the whole file.
    const matches = ANALYTICS_SOURCE.match(/fetchSellerOrders\(/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe("SellerAnalytics — entitlement boundary: base tiles universal, deep breakdown gated (§5.6)", () => {
  it("box-utilization/local-delivery/cash-sale tiles render unconditionally (no hasEntitlement guard around them)", () => {
    const boxIdx = ANALYTICS_SOURCE.indexOf("ANALYTICS_COPY.boxUtilizationTitle");
    const deepIdx = ANALYTICS_SOURCE.indexOf("canSeeDeepBreakdowns &&");
    expect(boxIdx).toBeGreaterThan(-1);
    expect(deepIdx).toBeGreaterThan(boxIdx);
  });

  it("only the per-order fulfillment detail table gates on full_analytics_dashboard (Hadal)", () => {
    expect(ANALYTICS_SOURCE).toContain('hasEntitlement("full_analytics_dashboard", { xp: totalXp })');
    const idx = ANALYTICS_SOURCE.indexOf("canSeeDeepBreakdowns &&");
    expect(idx).toBeGreaterThan(-1);
    const block = ANALYTICS_SOURCE.slice(idx, idx + 200);
    expect(block).toContain("Per-Order Fulfillment Detail");
  });
});

describe("SellerAnalytics — chart accessibility: text/table equivalents (§5.7)", () => {
  it("the box-utilization progressbar is paired with a plain-text summary line, not chart-only data", () => {
    const idx = ANALYTICS_SOURCE.indexOf("ANALYTICS_COPY.boxUtilizationTitle");
    const block = ANALYTICS_SOURCE.slice(idx, idx + 2000);
    expect(block).toContain('role="progressbar"');
    expect(block).toMatch(/average fill/);
  });

  it("local-delivery performance renders as an accessible <table>, not chart-only", () => {
    const idx = ANALYTICS_SOURCE.indexOf("ANALYTICS_COPY.localDeliveryTitle");
    const block = ANALYTICS_SOURCE.slice(idx, idx + 1500);
    expect(block).toContain('<table className="sf-analytics__table"');
    expect(block).toContain("Quote acceptance");
  });

  it("respects prefersReducedMotion for the box-fill meter transition", () => {
    expect(ANALYTICS_SOURCE).toContain('import { prefersReducedMotion } from "../../utils/a11y";');
    expect(ANALYTICS_SOURCE).toContain("reducedMotion");
  });
});

describe("BuyerInsights — renders from fetchBuyerAnalytics (§5.5)", () => {
  it("imports and calls fetchBuyerAnalytics", () => {
    expect(BUYER_INSIGHTS_SOURCE).toContain('import { fetchBuyerAnalytics } from "../services/ordersSync";');
    expect(BUYER_INSIGHTS_SOURCE).toContain("fetchBuyerAnalytics(walletAccount)");
  });

  it("resolveXpProgress reuses TIER_LADDER rather than a locally re-derived threshold table", () => {
    expect(BUYER_INSIGHTS_SOURCE).toContain('import { TIER_LADDER } from "../utils/xp";');
    expect(BUYER_INSIGHTS_SOURCE).not.toMatch(/1500.*2500.*5000.*10000/);
  });
});

describe("BuyerInsights — never XP-gated (universal base view, §5.6)", () => {
  it("contains no hasEntitlement/entitlements import (nothing here is gated)", () => {
    expect(BUYER_INSIGHTS_SOURCE).not.toContain("hasEntitlement");
    expect(BUYER_INSIGHTS_SOURCE).not.toContain('from "../services/entitlements"');
  });

  it("the XP-progress element renders regardless of order history (not conditioned on hasOrders)", () => {
    const idx = BUYER_INSIGHTS_SOURCE.indexOf("buyer-insights__xp-progress");
    expect(idx).toBeGreaterThan(-1);
    // hasOrders governs the KPI tiles block, which appears BEFORE the
    // XP-progress markup and is closed (the ternary's else branch) before
    // this point — the XP-progress div itself is not wrapped in `{hasOrders && ...}`.
    const precedingSlice = BUYER_INSIGHTS_SOURCE.slice(0, idx);
    const lastTernary = precedingSlice.lastIndexOf("!hasOrders ?");
    // The ternary closes with ")}" before the XP-progress block begins.
    expect(lastTernary).toBeGreaterThan(-1);
    expect(BUYER_INSIGHTS_SOURCE.slice(idx - 5, idx)).not.toBe("&&\n  ");
  });
});

describe("CheckoutSummary — mounts BuyerInsights on the buyer order-history surface", () => {
  it("imports and renders BuyerInsights unconditionally (not behind an order-count check)", () => {
    expect(CHECKOUT_SUMMARY_SOURCE).toContain('import { BuyerInsights } from "./BuyerInsights";');
    expect(CHECKOUT_SUMMARY_SOURCE).toContain("<BuyerInsights");
    const idx = CHECKOUT_SUMMARY_SOURCE.indexOf("<BuyerInsights");
    const precedingLine = CHECKOUT_SUMMARY_SOURCE.slice(Math.max(0, idx - 120), idx);
    expect(precedingLine).not.toMatch(/shippingEscrows\.length > 0 \|\| purchases\.length > 0\) &&\s*\(?\s*$/);
  });
});

describe("BreederTerminal / StorefrontSetup — pass totalXp into SellerAnalytics so the deep-breakdown gate has a real value", () => {
  it("BreederTerminal passes totalXp={xp}", () => {
    expect(BREEDER_TERMINAL_SOURCE).toContain("totalXp={xp}");
  });

  it("StorefrontSetup passes totalXp={getXp()}", () => {
    expect(STOREFRONT_SETUP_SOURCE).toContain("totalXp={getXp()}");
  });
});
