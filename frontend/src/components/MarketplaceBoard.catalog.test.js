/**
 * Component-level guards for the Task 8 catalog/product-detail wiring in
 * MarketplaceBoard.jsx and ProductDetailModal.jsx.
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and both
 * components transitively import ethers/@tanstack/react-virtual and other
 * browser-only dependencies. So, following the established pattern for
 * component tests in this codebase (CheckoutSummary.orders.test.js,
 * src/__tests__/settingsPrivacyOwnership.test.js), we
 * verify the behavioral contract via static source guards over the
 * comment-stripped source, complementing the exhaustive pure-module unit
 * tests (catalogQuery.test.js, compatibilityExplanation.test.js,
 * productDetailView.test.js).
 *
 * Covers docs/TASK_08_CATALOG_SPEC.md §4 criteria 6 (deep link / route
 * recovery), 7 (offline state), and 8 (accessibility — labeled controls,
 * non-color-only compatibility status). Full a11y validation (keyboard nav,
 * screen reader behavior, focus order) requires manual testing with
 * assistive technology and is NOT verified here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const BOARD_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./MarketplaceBoard.jsx", import.meta.url)), "utf8")
);
const MODAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./ProductDetailModal.jsx", import.meta.url)), "utf8")
);
const WANTED_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./WantedBoard.jsx", import.meta.url)), "utf8")
);

describe("MarketplaceBoard — catalog query wiring", () => {
  it("routes search/filter/sort through applyCatalogQuery (no forked filter logic)", () => {
    expect(BOARD_SOURCE).toContain('import { applyCatalogQuery, SORT_OPTIONS, FULFILLMENT_TYPES, getListingKey } from "../services/catalogQuery"');
    expect(BOARD_SOURCE).toContain("applyCatalogQuery(listings");
  });

  it("keeps the existing compatibility glow sourced from evaluateTankFit", () => {
    expect(BOARD_SOURCE).toContain('import { evaluateTankFit } from "../services/addOnRecommender"');
    expect(BOARD_SOURCE).toContain("evaluateTankFit(itemToSpeciesProfile(item), displayTank).score");
  });

  it("gates the saved-search affordance behind hasEntitlement, not a bespoke check", () => {
    expect(BOARD_SOURCE).toContain('import { hasEntitlement } from "../services/entitlements"');
    expect(BOARD_SOURCE).toMatch(/hasEntitlement\("saved_search"/);
  });
});

describe("MarketplaceBoard — deep link / route recovery (§4.6)", () => {
  it("reads and writes a ?listing= search param via useSearchParams", () => {
    expect(BOARD_SOURCE).toContain('import { useSearchParams } from "react-router-dom"');
    expect(BOARD_SOURCE).toContain('searchParams.get("listing")');
    expect(BOARD_SOURCE).toContain('next.set("listing"');
  });

  it("resolves the deep-linked listing by the same key used for card identity", () => {
    expect(BOARD_SOURCE).toContain("getListingKey(item) === listingKeyParam");
  });

  it("shows a not-found state instead of crashing when the id has no match", () => {
    expect(BOARD_SOURCE).toContain("setProductNotFound(true)");
    expect(MODAL_SOURCE).toContain("notFound");
    expect(MODAL_SOURCE).toMatch(/Listing not found/);
  });
});

describe("MarketplaceBoard — offline state (§4.7)", () => {
  it("tracks online/offline via the browser online/offline events", () => {
    expect(BOARD_SOURCE).toContain('window.addEventListener("online"');
    expect(BOARD_SOURCE).toContain('window.addEventListener("offline"');
  });

  it("renders a visible offline indicator without altering the cached listing render path", () => {
    expect(BOARD_SOURCE).toMatch(/!isOnline/);
    expect(BOARD_SOURCE).toMatch(/You're offline/);
  });
});

describe("MarketplaceBoard / ProductDetailModal — accessibility (§4.8, partial — see note)", () => {
  it("search and sort controls have explicit labels (not placeholder-only)", () => {
    expect(BOARD_SOURCE).toContain('aria-label="Search by species common or scientific name"');
    expect(BOARD_SOURCE).toContain('aria-label="Sort listings"');
  });

  it("filter panel inputs have associated <label> elements", () => {
    expect(BOARD_SOURCE).toContain('htmlFor="marketplace-family-filter"');
    expect(BOARD_SOURCE).toContain('htmlFor="marketplace-care-filter"');
    expect(BOARD_SOURCE).toContain('htmlFor="marketplace-fulfillment-filter"');
    expect(BOARD_SOURCE).toContain('htmlFor="marketplace-price-min"');
  });

  it("the filter toggle exposes its expanded state via aria-expanded/aria-controls", () => {
    expect(BOARD_SOURCE).toContain("aria-expanded={showFilterPanel}");
    expect(BOARD_SOURCE).toContain('aria-controls="marketplace-filter-panel"');
  });

  it("compatibility status is never color-only — every badge pairs a color with an icon and/or text", () => {
    // Grid-card compat badge: swatch dot (color) + bracketed percentage text.
    expect(BOARD_SOURCE).toMatch(/\[\$\{compatScore\}%/);
    // Product detail: verdict icon (compatIcon) alongside the headline text.
    expect(MODAL_SOURCE).toContain("compatIcon");
    expect(MODAL_SOURCE).toContain("view.compatibility.headline");
  });

  it("the product detail close button has an accessible label", () => {
    expect(MODAL_SOURCE).toContain('aria-label="Close product detail"');
  });

  it("uses the shared accessible Modal (dialog role, focus trap, Escape-to-close)", () => {
    expect(MODAL_SOURCE).toContain('import { Modal } from "./Modal"');
    expect(MODAL_SOURCE).toContain("<Modal");
  });
});

describe("ProductDetailModal — composition (no re-derived compatibility/pricing/delivery logic)", () => {
  it("renders exclusively through assembleProductDetailView", () => {
    expect(MODAL_SOURCE).toContain('import { assembleProductDetailView } from "../services/productDetailView"');
    expect(MODAL_SOURCE).toContain("assembleProductDetailView(listing, speciesRecord, { displayTank })");
  });

  it("Add to cart calls the provided handler rather than reimplementing checkout", () => {
    expect(MODAL_SOURCE).toContain("onAddToCart && onAddToCart(listing)");
  });
});

describe("Marketplace protected writes — verified Privy boundary", () => {
  it("requires account plus authenticated before conversation creation", () => {
    expect(BOARD_SOURCE).toContain('const { authenticated } = useAuth();');
    expect(BOARD_SOURCE).toContain("const canProtectedWrite = !!walletAccount && !!authenticated;");
    const handler = BOARD_SOURCE.slice(
      BOARD_SOURCE.indexOf("const openListingConversation"),
      BOARD_SOURCE.indexOf("// Local XP"),
    );
    expect(handler.indexOf("if (!canProtectedWrite)")).toBeGreaterThan(-1);
    expect(handler.indexOf("getOrCreateConversation(seller)")).toBeGreaterThan(handler.indexOf("if (!canProtectedWrite)"));
    expect(BOARD_SOURCE).toContain('messageIntent={canProtectedWrite && searchParams.get("action") === "message"}');
  });

  it("guards every wanted mutation before its first write and narrows fulfillment by owner", () => {
    expect(WANTED_SOURCE).toContain('const { authenticated } = useAuth();');
    expect(WANTED_SOURCE).toContain("const canProtectedWrite = !!walletAccount && !!authenticated;");

    const submit = WANTED_SOURCE.slice(WANTED_SOURCE.indexOf("const handleSubmit"), WANTED_SOURCE.indexOf("const handleFulfill"));
    expect(submit.indexOf("if (!canProtectedWrite)")).toBeGreaterThan(-1);
    expect(submit.indexOf('.from("wanted_listings").insert')).toBeGreaterThan(submit.indexOf("if (!canProtectedWrite)"));

    const fulfill = WANTED_SOURCE.slice(WANTED_SOURCE.indexOf("const handleFulfill"), WANTED_SOURCE.indexOf("// Open the inline responder"));
    expect(fulfill.indexOf("if (!canProtectedWrite)")).toBeGreaterThan(-1);
    expect(fulfill.indexOf('.update({ is_active: false')).toBeGreaterThan(fulfill.indexOf("if (!canProtectedWrite)"));
    expect(fulfill).toContain('.eq("wallet_address", owner)');

    const respond = WANTED_SOURCE.slice(WANTED_SOURCE.indexOf("const handleRespond"), WANTED_SOURCE.indexOf("// Demand aggregation"));
    expect(respond.indexOf("if (!canProtectedWrite)")).toBeGreaterThan(-1);
    expect(respond.indexOf("getOrCreateConversation(item.wallet_address)")).toBeGreaterThan(respond.indexOf("if (!canProtectedWrite)"));
    expect(respond.indexOf("sendMessage(convo.id")).toBeGreaterThan(respond.indexOf("if (!canProtectedWrite)"));
  });

  it("resumes only confirmation/composer presentation after verified login", () => {
    expect(MODAL_SOURCE).toContain("!isOwner && messageIntent");
    expect(MODAL_SOURCE).toContain("onClick={() => onMessage?.(listing)}");
    expect(WANTED_SOURCE).toMatch(/if \(!canProtectedWrite \|\| !initialCompose\) return;/);
    expect(WANTED_SOURCE).toContain("setShowForm(true)");
  });
});