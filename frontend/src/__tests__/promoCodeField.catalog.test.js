/**
 * Source-guard tests for the buyer-facing promo-code entry at checkout
 * (Task 21B UI). vitest runs in node here (no jsdom), so these assert the
 * source composition/wiring rather than rendering — matching the project's
 * other *.catalog.test.js guards.
 *
 * Run: npx vitest --run src/__tests__/promoCodeField.catalog.test.js
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FIELD = read("../components/PromoCodeField.jsx");
const STRIPE_PAY = read("../services/stripePayments.js");
const STRIPE_API = read("../../api/stripe.js");
const CHECKOUT = read("../components/CheckoutSummary.jsx");

describe("PromoCodeField — composition", () => {
  it("previews via the server (previewPromotion), never evaluating the promo client-side", () => {
    expect(FIELD).toContain('import { previewPromotion }');
    expect(FIELD).toContain("await previewPromotion(");
    // The promo table isn't publicly readable, so the client must not try to
    // resolve/evaluate a promo itself.
    expect(FIELD).not.toContain("evaluatePromotion");
  });

  it("renders a code input + an Apply action", () => {
    expect(FIELD).toMatch(/aria-label="Promo code"/);
    expect(FIELD).toMatch(/Apply/);
  });

  it("shows the applied discount when applicable and a reason when not", () => {
    expect(FIELD).toContain("preview?.applicable");
    expect(FIELD).toContain("formatUSD(preview.discountCents)");
    expect(FIELD).toContain("preview.reason");
  });

  it("reports the applied code (or null) upward via onApply", () => {
    expect(FIELD).toContain("onApply?.(");
    // Only surfaces a code when the preview actually discounts.
    expect(FIELD).toMatch(/result\?\.applicable \? trimmed : null/);
  });

  it("has a keyboard path (Enter applies) and a remove control", () => {
    expect(FIELD).toContain("handleKeyDown");
    expect(FIELD).toMatch(/Enter/);
    expect(FIELD).toMatch(/aria-label="Remove promo code"/);
  });
});

describe("stripePayments — promoCode forwarding + preview", () => {
  const src = stripComments(STRIPE_PAY);

  it("all four checkout wrappers accept and forward promoCode", () => {
    for (const fn of ["purchaseShippingSpecimen", "purchaseBatch", "purchaseMultiple", "purchasePickupSpecimen"]) {
      const idx = src.indexOf(`export async function ${fn}(`);
      expect(idx, `${fn} missing`).toBeGreaterThan(-1);
      const body = src.slice(idx, idx + 700);
      expect(body, `${fn} does not forward promoCode`).toContain("promoCode");
    }
  });

  it("previewPromotion posts to the read-only preview-promo action", () => {
    expect(src).toContain("export async function previewPromotion(");
    expect(src).toContain("action=preview-promo");
  });
});

describe("stripe.js — preview-promo is routed and money-safe (read-only)", () => {
  const src = stripComments(STRIPE_API);

  it("routes ?action=preview-promo to handlePreviewPromo", () => {
    expect(src).toContain('case "preview-promo":');
    expect(src).toContain("return handlePreviewPromo(req, res);");
  });

  it("handlePreviewPromo evaluates via the pure engine and moves no money", () => {
    const idx = src.indexOf("async function handlePreviewPromo(");
    expect(idx).toBeGreaterThan(-1);
    // Bound the block at the next handler (handleCreateCheckout) so the guard
    // only inspects the preview handler.
    const end = src.indexOf("async function handleCreateCheckout(", idx);
    const block = src.slice(idx, end > -1 ? end : idx + 3000);
    expect(block).toContain("evaluatePromotion(");
    // No charge, no coupon, no session, no usage increment in the preview path.
    expect(block).not.toMatch(/coupons\.create/);
    expect(block).not.toMatch(/checkout\.sessions\.create/);
    expect(block).not.toMatch(/redeem_promotion/);
  });
});

describe("CheckoutSummary — mounts the field and threads promoCode into checkout", () => {
  it("imports and mounts PromoCodeField in both checkout lanes", () => {
    expect(CHECKOUT).toContain('import { PromoCodeField }');
    // Two mounts: consolidated (purchaseType="multi") and batch (purchaseType="batch").
    expect(CHECKOUT).toMatch(/purchaseType="multi"/);
    expect(CHECKOUT).toMatch(/purchaseType="batch"/);
  });

  it("passes the applied promo code into every checkout wrapper call", () => {
    expect(CHECKOUT).toContain("promoCode: consolidatedPromo?.code");
    expect(CHECKOUT).toContain("promoCode: batchPromo?.code");
  });

  it("clears an applied promo when the cart changes (no stale discount display)", () => {
    expect(CHECKOUT).toContain("setConsolidatedPromo(null)");
    expect(CHECKOUT).toContain("setBatchPromo(null)");
  });
});
