/**
 * Component-level guards for PromotionsManager.jsx (Task 21B).
 *
 * This project's vitest runs in a `node` environment (no jsdom) and this
 * component transitively imports browser-only dependencies, so — matching
 * the established source-guard convention (StorefrontMerchandising.catalog.
 * test.js, SellerAnalytics.catalog.test.js) — the behavioral contract is
 * verified via static source guards over the comment-stripped source,
 * complementing the exhaustive pure-module tests in promotionEngine.test.js
 * and customerSegments.test.js.
 *
 * Covers docs/TASK_21B_PROMOTIONS_SPEC.md §5 criteria 5 (money-safety) and 7
 * (entitlement boundaries: single-promo authoring never gated; only
 * automation gates on promotion_automation and segments on
 * customer_segmentation; tier_discount never referenced as a checkout
 * precondition).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RAW_SOURCE = readFileSync(fileURLToPath(new URL("./PromotionsManager.jsx", import.meta.url)), "utf8");
const SOURCE = stripComments(RAW_SOURCE);

const TERMINAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./BreederTerminal.jsx", import.meta.url)), "utf8")
);

describe("PromotionsManager — single-promo authoring is never XP-gated (§5.7)", () => {
  it("startCreate/handleSave/handleTogglePause/handleDelete are not wrapped in a hasEntitlement check", () => {
    for (const fn of ["startCreate", "handleSave", "handleTogglePause", "handleDelete"]) {
      const idx = SOURCE.indexOf(`const ${fn} = `);
      expect(idx, `${fn} should be defined`).toBeGreaterThan(-1);
      const block = SOURCE.slice(idx, idx + 400);
      expect(block).not.toContain("hasEntitlement(");
    }
  });

  it("the 'Add a promotion' button and the create form render unconditionally (not behind a gate)", () => {
    const idx = SOURCE.indexOf("PROMOTION_COPY.addPromotion");
    expect(idx).toBeGreaterThan(-1);
    // No hasEntitlement guard should wrap the create-form/add-button block.
    const before = SOURCE.slice(Math.max(0, idx - 300), idx);
    expect(before).not.toMatch(/hasEntitlement\([^)]*\)\s*&&\s*\($/);
  });
});

describe("PromotionsManager — only segments gate on customer_segmentation (Hadal); tier_discount never referenced", () => {
  it("calls hasEntitlement exactly once, for customer_segmentation", () => {
    const matches = SOURCE.match(/hasEntitlement\(\s*"([^"]+)"/g) || [];
    expect(matches).toEqual(['hasEntitlement("customer_segmentation"']);
  });

  it("never references tier_discount as any kind of gate or precondition", () => {
    expect(SOURCE).not.toContain("tier_discount");
  });

  it("never references promotion_automation (single-promo CRUD here is not automation)", () => {
    expect(SOURCE).not.toContain("promotion_automation");
  });

  it("the segments view shows a locked message rather than an error when ungated", () => {
    expect(SOURCE).toContain("canSeeSegments");
    expect(SOURCE).toContain("PROMOTION_COPY.segmentsLocked");
  });
});

describe("PromotionsManager — money-safety guard: preview only, no checkout wiring", () => {
  it("imports evaluatePromotion from promotionEngine.js for preview purposes only", () => {
    expect(SOURCE).toContain('from "../../services/promotionEngine.js"');
    expect(SOURCE).toContain("evaluatePromotion(payload, SAMPLE_CART)");
  });

  it("never imports stripePayments.js or any checkout-creation function", () => {
    expect(SOURCE).not.toMatch(/stripePayments/i);
    expect(SOURCE).not.toContain("handleCreateCheckout");
    expect(SOURCE).not.toContain("createCheckout");
  });

  it("the preview label explicitly says preview, not a purchase/charge action", () => {
    expect(SOURCE).toContain("PROMOTION_COPY.previewTitle");
  });
});

describe("PromotionsManager — funding is disclosed to the seller (no dark patterns)", () => {
  it("renders both funding options with their disclosure copy", () => {
    expect(SOURCE).toContain("PROMOTION_COPY.seller_funded");
    expect(SOURCE).toContain("PROMOTION_COPY.platform_funded");
  });
});

describe("BreederTerminal — mounts PromotionsManager as its own nav section", () => {
  it("imports and renders PromotionsManager under SECTIONS.PROMOTIONS", () => {
    expect(TERMINAL_SOURCE).toContain('import { PromotionsManager } from "./PromotionsManager";');
    const idx = TERMINAL_SOURCE.indexOf("activeSection === SECTIONS.PROMOTIONS");
    expect(idx).toBeGreaterThan(-1);
    const block = TERMINAL_SOURCE.slice(idx, idx + 200);
    expect(block).toContain("<PromotionsManager");
  });
});
