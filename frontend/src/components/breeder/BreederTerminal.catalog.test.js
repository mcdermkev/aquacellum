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
