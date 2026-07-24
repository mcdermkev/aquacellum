/**
 * Component-level guards for the Task 18 buyer order consolidation in
 * CheckoutSummary.jsx and OrderTimeline.jsx.
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and both
 * components transitively import ethers/other browser-only dependencies. So,
 * following the established pattern for component tests in this codebase
 * (src/components/MarketplaceBoard.catalog.test.js,
 * src/components/onboarding/IdentityStep.test.js), we verify the behavioral
 * contract via static source guards over the comment-stripped source,
 * complementing the exhaustive pure-module unit tests (orderCopy.test.js,
 * buyerOrderView.test.js).
 *
 * Covers docs/TASK_18_BUYER_ORDERS_SPEC.md §4 criteria 8 (composition),
 * 9 (deep link / recovery), 10 (DOA wiring), and 12 (accessibility, partial).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SUMMARY_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./CheckoutSummary.jsx", import.meta.url)), "utf8")
);
const TIMELINE_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./OrderTimeline.jsx", import.meta.url)), "utf8")
);
const ARRIVAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./ArrivalModal.jsx", import.meta.url)), "utf8")
);

describe("CheckoutSummary — order list wiring (§4.8, composition)", () => {
  it("routes status/search/sort through filterBuyerOrders + normalizeBuyerOrders (no forked filter logic)", () => {
    expect(SUMMARY_SOURCE).toContain(
      'import { normalizeBuyerOrders, filterBuyerOrders, assembleBuyerOrderView } from "../services/buyerOrderView"'
    );
    expect(SUMMARY_SOURCE).toContain("filterBuyerOrders(normalizeBuyerOrders(shippingEscrows)");
    expect(SUMMARY_SOURCE).toContain("filterBuyerOrders(normalizeBuyerOrders(purchases)");
  });

  it("no longer contains the old inline filter/sort predicates (fully delegated)", () => {
    expect(SUMMARY_SOURCE).not.toMatch(/filteredShipping\s*=\s*filteredShipping\.filter/);
    expect(SUMMARY_SOURCE).not.toMatch(/const getPrice = \(o\) => parseFloat/);
  });

  it("gates advanced order features (analytics/watchlist) through hasEntitlement, not the legacy isFeatureUnlocked", () => {
    expect(SUMMARY_SOURCE).toContain('import { hasEntitlement } from "../services/entitlements"');
    expect(SUMMARY_SOURCE).toMatch(/hasEntitlement\("order_analytics"/);
    expect(SUMMARY_SOURCE).toMatch(/hasEntitlement\("species_watchlist"/);
    expect(SUMMARY_SOURCE).not.toContain("isFeatureUnlocked(userTier,");
  });
});

describe("CheckoutSummary — deep link / route recovery (§4.9)", () => {
  it("reads and writes a ?order= search param via useSearchParams", () => {
    expect(SUMMARY_SOURCE).toContain('import { useSearchParams } from "react-router-dom"');
    expect(SUMMARY_SOURCE).toContain('searchParams.get("order")');
    expect(SUMMARY_SOURCE).toContain('next.set("order"');
  });

  it("resolves the deep-linked order by the same key scheme buyerOrderView derives (ship-<tokenId> / batch-<purchaseId>)", () => {
    expect(SUMMARY_SOURCE).toContain("`ship-${o.tokenId}` === orderKeyParam");
    expect(SUMMARY_SOURCE).toContain("`batch-${o.purchaseId}` === orderKeyParam");
  });

  it("shows a not-found state instead of crashing when the id has no match", () => {
    expect(SUMMARY_SOURCE).toContain("setOrderNotFound(true)");
    expect(SUMMARY_SOURCE).toMatch(/Order not found/);
  });

  it("clears the ?order= param on every drawer-closing path so a refresh never re-opens a dismissed drawer", () => {
    // The close button and every action-completion handler must clear the
    // param alongside setSelectedOrder(null); count occurrences rather than
    // asserting a specific number so future handlers are still covered.
    const closeCalls = (SUMMARY_SOURCE.match(/setSelectedOrder\(null\);\s*clearOrderParam\(\);/g) || []).length;
    expect(closeCalls).toBeGreaterThanOrEqual(7);
  });
});

describe("OrderTimeline — composition (no re-derived status/timeline logic)", () => {
  it("delegates timeline construction to buyerOrderView.assembleBuyerOrderView", () => {
    expect(TIMELINE_SOURCE).toContain('import { assembleBuyerOrderView } from "../services/buyerOrderView"');
    expect(TIMELINE_SOURCE).toContain("assembleBuyerOrderView(order, { casual: casualModeActive })");
  });

  it("no longer contains its own inline buildSteps status-int switch (fully delegated)", () => {
    expect(TIMELINE_SOURCE).not.toMatch(/function buildSteps\(/);
  });
});

describe("CheckoutSummary — cash-pickup buyer code wiring (Task 15)", () => {
  it("derives the next action from assembleBuyerOrderView, not a bespoke check", () => {
    expect(SUMMARY_SOURCE).toContain(
      'import { normalizeBuyerOrders, filterBuyerOrders, assembleBuyerOrderView } from "../services/buyerOrderView"'
    );
    expect(SUMMARY_SOURCE).toContain("assembleBuyerOrderView(order, { casual: casualModeActive })");
  });

  it("opens PickupCode only for cash_pickup orders at the SHOW_PICKUP_CODE next action", () => {
    expect(SUMMARY_SOURCE).toContain('import { FULFILLMENT_METHODS } from "../services/marketplaceStateMachine"');
    expect(SUMMARY_SOURCE).toContain("view.method !== FULFILLMENT_METHODS.CASH_PICKUP");
    expect(SUMMARY_SOURCE).toContain("view.nextAction.kind !== NEXT_ACTION_KIND.SHOW_PICKUP_CODE");
    expect(SUMMARY_SOURCE).toContain("setPickupCodeOrder(order)");
  });

  it("mounts the buyer PickupCode component", () => {
    expect(SUMMARY_SOURCE).toContain('import { PickupCode } from "./marketplace/PickupCode"');
    expect(SUMMARY_SOURCE).toContain("<PickupCode");
  });
});

describe("ArrivalModal — DOA claim wiring (§4.10, review-gated)", () => {
  it("imports both the canonical claim caller and the active legacy dispute caller", () => {
    expect(ARRIVAL_SOURCE).toContain(
      'import { releaseFiatOrder, disputeFiatOrder, openDoaClaim } from "../services/stripePayments"'
    );
  });

  it("the canonical path is guarded behind canonicalLineItemIds and falls back to disputeFiatOrder", () => {
    expect(ARRIVAL_SOURCE).toContain("shippingOrder.canonicalLineItemIds");
    expect(ARRIVAL_SOURCE).toMatch(/Array\.isArray\(canonicalLineItemIds\) && canonicalLineItemIds\.length > 0/);
    // disputeFiatOrder must still run whenever the canonical attempt didn't
    // already produce a successful result — the active path is never removed.
    expect(ARRIVAL_SOURCE).toMatch(/if \(!result\) \{[\s\S]{0,200}disputeFiatOrder\(/);
  });
});
