/**
 * Component-level guards for BreederTerminal.jsx (Task 9, Increment 1).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * BreederTerminal.jsx transitively imports ethers/@tanstack/react-query and
 * other browser-only dependencies. Following the established pattern for
 * component tests in this codebase (src/components/onboarding/*.test.js,
 * MarketplaceBoard.catalog.test.js), we verify the behavioral contract via
 * static source guards over the comment-stripped source, complementing the
 * exhaustive pure-module unit tests in breederDashboard.test.js.
 *
 * Covers docs/TASK_09_BREEDER_TERMINAL_SPEC.md §5's UI requirement: assert
 * the Terminal composes the existing components/data-access (doesn't
 * rebuild them) and gates only the convenience surfaces. Full
 * interaction/a11y needs manual testing with assistive technology — not
 * verified here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./BreederTerminal.jsx", import.meta.url)), "utf8")
);

describe("BreederTerminal — composes existing data access (no forked logic)", () => {
  it("uses fetchSellerOrders from ordersSync.js (does not query orders itself)", () => {
    expect(SOURCE).toContain('import { fetchSellerOrders } from "../../services/ordersSync"');
  });

  it("uses checkSellerStatus / startSellerOnboarding / getSellerDashboardLink from stripePayments.js", () => {
    expect(SOURCE).toContain(
      'import { checkSellerStatus, startSellerOnboarding, getSellerDashboardLink } from "../../services/stripePayments"'
    );
  });

  it("uses buildBreederDashboard (the pure, tested aggregation module) for the dashboard model", () => {
    expect(SOURCE).toContain('import { buildBreederDashboard } from "../../services/breederDashboard"');
    expect(SOURCE).toContain("buildBreederDashboard({ orders, listings: sellerListings, lastVisitAt })");
  });

  it("uses hasEntitlement for gating, not a bespoke XP check", () => {
    expect(SOURCE).toContain('import { hasEntitlement } from "../../services/entitlements"');
  });

  it("uses the shared price formatter, not an ad-hoc dollar string", () => {
    expect(SOURCE).toContain('import { formatPriceCents } from "../../services/catalogQuery"');
  });
});

describe("BreederTerminal — composes existing seller components (does not rebuild them)", () => {
  it("mounts SellerAnalytics", () => {
    expect(SOURCE).toContain('import { SellerAnalytics } from "../storefront/SellerAnalytics"');
    expect(SOURCE).toContain("<SellerAnalytics");
  });

  it("mounts StorefrontSetup", () => {
    expect(SOURCE).toContain('import { StorefrontSetup } from "../StorefrontSetup"');
    expect(SOURCE).toContain("<StorefrontSetup");
  });

  it("mounts ShipFromSetup", () => {
    expect(SOURCE).toContain('import { ShipFromSetup } from "../ShipFromSetup"');
    expect(SOURCE).toContain("<ShipFromSetup");
  });

  it("launches the existing ListSpecimenModal for new listings (no listing-write logic of its own)", () => {
    expect(SOURCE).toContain('import { ListSpecimenModal } from "../ListSpecimenModal"');
    expect(SOURCE).toContain("<ListSpecimenModal");
    expect(SOURCE).toContain("setIsListModalOpen(true)");
  });

  it("filters the shared useMarketplaceListings hook to the seller, rather than a bespoke fetch", () => {
    expect(SOURCE).toContain('import { useMarketplaceListings } from "../../hooks/useMarketplaceListings"');
  });
});

describe("BreederTerminal — dashboard home renders all six cards (§3/§4)", () => {
  it("renders New Orders, Pending Actions, Earnings, Low Stock, Open Claims, and Storefront cards", () => {
    expect(SOURCE).toContain('title="New Orders"');
    expect(SOURCE).toContain('title="Pending Actions"');
    expect(SOURCE).toContain('title="Earnings"');
    expect(SOURCE).toContain('title="Low Stock"');
    expect(SOURCE).toContain('title="Open Claims"');
    expect(SOURCE).toContain('title="Storefront"');
  });

  it("shows a Stripe-connect nudge when onboarding is incomplete", () => {
    expect(SOURCE).toContain("!onboardingComplete");
    expect(SOURCE).toMatch(/Connect payouts to get paid/);
  });

  it("persists lastVisitAt to localStorage under the spec's key", () => {
    expect(SOURCE).toContain('const LAST_VISIT_STORAGE_KEY = "aquadex_breeder_last_visit"');
    expect(SOURCE).toContain("localStorage.setItem(LAST_VISIT_STORAGE_KEY");
    expect(SOURCE).toContain("localStorage.getItem(LAST_VISIT_STORAGE_KEY)");
  });
});

describe("BreederTerminal — entitlement gating (only convenience surfaces, never the six cards)", () => {
  it("gates the advanced-analytics-export affordance behind hasEntitlement", () => {
    expect(SOURCE).toMatch(/hasEntitlement\("csv_export"/);
    expect(SOURCE).toContain("canExportAdvancedAnalytics &&");
  });

  it("the six DashboardCard renders are unconditional (not wrapped in an entitlement check)", () => {
    // None of the six card JSX blocks should be preceded by a hasEntitlement
    // guard — only the advanced-export block should reference the gate.
    const cardTitles = ["New Orders", "Pending Actions", "Earnings", "Low Stock", "Open Claims", "Storefront"];
    for (const title of cardTitles) {
      const idx = SOURCE.indexOf(`title="${title}"`);
      expect(idx).toBeGreaterThan(-1);
      const precedingWindow = SOURCE.slice(Math.max(0, idx - 300), idx);
      expect(precedingWindow).not.toMatch(/hasEntitlement/);
    }
  });
});

describe("BreederTerminal — mobile-first section nav", () => {
  it("uses large (>=44px) touch targets for nav buttons", () => {
    expect(SOURCE).toMatch(/minHeight:\s*"44px"/);
  });

  it("marks the active section via aria-current for accessibility", () => {
    expect(SOURCE).toContain('aria-current={isActive ? "page" : undefined}');
  });
});

// ─── Task 19: seller fulfillment queue (OrdersSection) ─────────────────────
// Covers docs/TASK_19_SELLER_OPS_SPEC.md §4 criteria 7 (composition),
// 8 (entitlement guard), 9 (handoff reuse), 10 (accessibility, partial).

describe("BreederTerminal — Orders queue composes sellerOrderView (no forked filter/decision logic)", () => {
  it("imports normalizeSellerOrders / filterSellerOrders from sellerOrderView.js", () => {
    expect(SOURCE).toContain(
      'import { normalizeSellerOrders, filterSellerOrders } from "../../services/sellerOrderView"'
    );
    expect(SOURCE).toContain("normalizeSellerOrders(localSellerOrders");
    expect(SOURCE).toContain("filterSellerOrders(sellerViews,");
  });

  it("sources the queue from relayGetOrders (local-first), not fetchSellerOrders (cloud dashboard-only)", () => {
    expect(SOURCE).toContain(
      'import { relayGetOrders, relayDispatchShipping } from "../../services/relayer"'
    );
    expect(SOURCE).toContain("relayGetOrders(account)");
    // fetchSellerOrders remains for the dashboard aggregation only — assert
    // both call sites still exist rather than one replacing the other.
    expect(SOURCE).toContain('import { fetchSellerOrders } from "../../services/ordersSync"');
    expect(SOURCE).toContain("fetchSellerOrders(walletAccount, { limit: 500 })");
  });
});

describe("BreederTerminal — Orders queue actions call existing verified services (§4.7)", () => {
  it("buy-label action calls buyShippingLabel (shipping.js), not a re-implemented label purchase", () => {
    expect(SOURCE).toContain('import { buyShippingLabel } from "../../services/shipping"');
    expect(SOURCE).toContain("await buyShippingLabel({");
  });

  it("manual-tracking fallback calls relayDispatchShipping, matching CheckoutSummary's seller path", () => {
    expect(SOURCE).toContain("await relayDispatchShipping(view.raw.tokenId, manualTrackingInput)");
  });

  it("does NOT expose a seller-initiated refund (refunds are curator/backend-only per api/stripe.js handleRefund)", () => {
    // A seller-side relayUpdateBatchOrder(state:2) would mark an order
    // "refunded" locally without returning any money or held asset and
    // without authorization. Guard that the queue never does this and never
    // wires a refund/cancel action to the seller.
    expect(SOURCE).not.toContain("relayUpdateBatchOrder");
    expect(SOURCE).not.toContain("handleSellerRefundBatch");
    expect(SOURCE).not.toContain("Cancel &amp; refund");
  });

  it("customer communication reuses getOrCreateConversation + the aquadex_open_conversation event, not a new messaging system", () => {
    expect(SOURCE).toContain('import { getOrCreateConversation } from "../../services/messagesApi"');
    expect(SOURCE).toContain('new CustomEvent("aquadex_open_conversation"');
  });
});

describe("BreederTerminal — pickup/cash handoff composes HandshakeVerification, not a new scanner (§4.9)", () => {
  it("imports and mounts HandshakeVerification", () => {
    expect(SOURCE).toContain('import { HandshakeVerification } from "../HandshakeVerification"');
    expect(SOURCE).toContain("<HandshakeVerification");
  });

  it("opens it on the breeder/scan role by default, not the buyer role", () => {
    expect(SOURCE).toContain('defaultRole="breeder"');
  });
});

// ─── Task 15: canonical cash-pickup confirm_cash routes to CashPickupConfirm ─

describe("BreederTerminal — cash-pickup confirm_cash routes to the new CashPickupConfirm (Task 15)", () => {
  it("imports and mounts CashPickupConfirm", () => {
    expect(SOURCE).toContain('import { CashPickupConfirm } from "./CashPickupConfirm"');
    expect(SOURCE).toContain("<CashPickupConfirm");
  });

  it("branches on the cash_pickup fulfillment method before choosing which modal to open", () => {
    expect(SOURCE).toContain('import { FULFILLMENT_METHODS } from "../../services/marketplaceStateMachine"');
    expect(SOURCE).toContain("handshakeModalView.method === FULFILLMENT_METHODS.CASH_PICKUP");
  });

  it("still mounts HandshakeVerification for every non-cash-pickup handoff (legacy callers unchanged)", () => {
    expect(SOURCE).toMatch(/handshakeModalView\.method === FULFILLMENT_METHODS\.CASH_PICKUP \? \(\s*<CashPickupConfirm/);
    expect(SOURCE).toContain("<HandshakeVerification");
  });

  it("CashPickupConfirm refreshes via the same handleHandoffSettled used by HandshakeVerification", () => {
    const idx = SOURCE.indexOf("<CashPickupConfirm");
    const block = SOURCE.slice(idx, idx + 300);
    expect(block).toContain("onSuccess={handleHandoffSettled}");
  });
});

describe("BreederTerminal — Orders queue entitlement guard (§4.8): only bulk actions are gated", () => {
  it("gates the bulk action bar behind hasEntitlement(\"bulk_management\", ...)", () => {
    expect(SOURCE).toMatch(/hasEntitlement\("bulk_management"/);
    expect(SOURCE).toContain("canBulkManage &&");
  });

  it("single-order fulfillment action handlers are never wrapped in a hasEntitlement check", () => {
    // Each single-order handler must exist and must not have a hasEntitlement
    // guard directly wrapping its body definition.
    const singleOrderHandlers = [
      "const handleBuyLabel = async (view) => {",
      "const handleMarkDispatchedManually = async (view) => {",
      "const handleRespondToClaim = async (view) => {",
      "const handleMessageCustomer = async (view) => {",
    ];
    for (const handler of singleOrderHandlers) {
      const idx = SOURCE.indexOf(handler);
      expect(idx, `expected to find handler: ${handler}`).toBeGreaterThan(-1);
      const precedingWindow = SOURCE.slice(Math.max(0, idx - 200), idx);
      expect(precedingWindow).not.toMatch(/hasEntitlement/);
    }
  });

  it("the bulk buy-labels action itself still calls the single-order handleBuyLabel per item (composition, not a forked bulk path)", () => {
    expect(SOURCE).toContain("await handleBuyLabel(view);");
  });
});

describe("BreederTerminal — Orders queue status is not color-only (§4.10, partial a11y)", () => {
  it("status chip renders both an icon and text label", () => {
    expect(SOURCE).toMatch(/aria-hidden="true">\{status\.icon\}/);
    expect(SOURCE).toContain("{status.label}");
  });

  it("local-courier request renders a disabled 'coming soon' affordance rather than a broken action (spec §3)", () => {
    expect(SOURCE).toContain("coming soon");
    expect(SOURCE).toMatch(/REQUEST_COURIER[\s\S]{0,300}disabled/);
  });
});

describe("BreederTerminal — dashboard cards deep-link into the Orders queue with a filter preset", () => {
  it("Pending Actions / New Orders cards navigate to needs_action", () => {
    expect(SOURCE).toMatch(/onNavigateToOrders\("needs_action"\)/);
  });

  it("Open Claims card navigates to the claims filter", () => {
    expect(SOURCE).toMatch(/onNavigateToOrders\("claims"\)/);
  });
});
