/**
 * Component-level guards for the Task 11 UI (box-capacity meter + safe
 * add-on recommendation strip): BoxCapacityMeter.jsx,
 * AddOnRecommendationStrip.jsx, useAddOnRecommendations.js, their wiring
 * into CartDrawer.jsx, and the secondary packing hint in
 * ProductDetailModal.jsx.
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * these components transitively import ethers/@tanstack/react-query and
 * other browser-only dependencies. Following the established pattern for
 * component tests in this codebase (CartDrawer.catalog.test.js,
 * MarketplaceBoard.catalog.test.js), we verify the behavioral contract via
 * static source guards over the comment-stripped source, complementing the
 * exhaustive pure-module unit tests (addOnPresenter.test.js,
 * addOnRecommender.test.js, packingEngine.test.js, parcelPlanner.test.js).
 *
 * Covers docs/TASK_11_RECOMMENDATION_UI_SPEC.md §5 criteria 6 (composition),
 * 7 (filtered blocks / no fabricated tank-fit), 8 (honest cost disclosure),
 * 9 (accessibility, partial).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const METER_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./BoxCapacityMeter.jsx", import.meta.url)), "utf8")
);
const STRIP_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./AddOnRecommendationStrip.jsx", import.meta.url)), "utf8")
);
const HOOK_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../../hooks/useAddOnRecommendations.js", import.meta.url)), "utf8")
);
const DRAWER_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./CartDrawer.jsx", import.meta.url)), "utf8")
);
const MODAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../ProductDetailModal.jsx", import.meta.url)), "utf8")
);

describe("useAddOnRecommendations — composition (§5.6, no forked engine logic)", () => {
  it("calls recommendAddOns (the reviewed ranker), not a bespoke scoring pass", () => {
    expect(HOOK_SOURCE).toContain('import { recommendAddOns } from "../services/addOnRecommender.js"');
    expect(HOOK_SOURCE).toContain("recommendAddOns(candidates,");
  });

  it("delegates candidate/box-status shaping to addOnPresenter.js", () => {
    expect(HOOK_SOURCE).toContain("buildCandidatesFromListings");
    expect(HOOK_SOURCE).toContain("buildBoxStatus");
    expect(HOOK_SOURCE).toContain("presentRecommendation");
    expect(HOOK_SOURCE).toContain('from "../services/addOnPresenter.js"');
  });

  it("resolves the seller's parcel preset via the public endpoint, falling back to defaults without blocking", () => {
    expect(HOOK_SOURCE).toContain('import { getSellerParcelPreset } from "../services/shipping.js"');
    expect(HOOK_SOURCE).toContain("normalizeParcelPreset({})");
  });

  it("scopes candidates to the cart's single seller (never a multi-seller pool)", () => {
    expect(HOOK_SOURCE).toContain("cart?.seller");
    expect(HOOK_SOURCE).toMatch(/l\.seller\.toLowerCase\(\) === sellerWallet/);
  });
});

describe("BoxCapacityMeter — composition (§5.6) + accessibility (§5.9)", () => {
  it("renders exclusively from a boxStatus prop (no capacity math of its own)", () => {
    expect(METER_SOURCE).toContain("BoxCapacityMeter({ boxStatus");
    expect(METER_SOURCE).toContain('import { capacityCopy } from "../../services/addOnPresenter.js"');
    expect(METER_SOURCE).not.toMatch(/function\s+boxesRequired|function\s+computeUsage/);
  });

  it("exposes progressbar semantics with a text label (never a bare visual bar)", () => {
    expect(METER_SOURCE).toContain('role="progressbar"');
    expect(METER_SOURCE).toContain("aria-valuenow={fillPercent}");
    expect(METER_SOURCE).toContain("aria-valuemin={0}");
    expect(METER_SOURCE).toContain("aria-valuemax={100}");
    expect(METER_SOURCE).toContain("aria-label={casualModeActive");
  });
});

describe("AddOnRecommendationStrip — filtered blocks + honest cost (§5.7, §5.8)", () => {
  it("renders nothing when there are no recommendations (quiet empty state, no fabrication)", () => {
    expect(STRIP_SOURCE).toContain("if (!recommendations || recommendations.length === 0) return null;");
  });

  it("maps rows straight from useAddOnRecommendations output — no local filtering/sorting of the ranked list", () => {
    expect(STRIP_SOURCE).toContain("recommendations.map((row) =>");
    expect(STRIP_SOURCE).not.toMatch(/\.sort\(|\.filter\(/);
  });

  it("an addedBox===true row renders the '+shipping' cost chip rather than hiding it (§5.8 honest cost)", () => {
    // addOnCopy's boxLabel string always mentions shipping for addedBox=true,
    // and the card renders whatever addOnCopy returns unconditionally (no
    // gate hiding the chip based on addedBox).
    expect(STRIP_SOURCE).toContain("const { boxLabel, tankFitLabel } = addOnCopy(row,");
    expect(STRIP_SOURCE).toMatch(/\{boxLabel\}/);
    // No conditional suppressing the box chip when addedBox is true.
    expect(STRIP_SOURCE).not.toMatch(/row\.addedBox\s*&&\s*null/);
    expect(STRIP_SOURCE).not.toMatch(/!row\.addedBox\s*&&\s*\(/); // chip isn't only-rendered-when-free
  });

  it("the tank-fit signal is only rendered when addOnCopy produced a label — no fabricated verdict without a buyer tank", () => {
    expect(STRIP_SOURCE).toContain("{tankFitLabel && (");
  });

  it("the Add button calls the provided onAdd handler (composes the cart's addItem, doesn't reimplement it)", () => {
    expect(STRIP_SOURCE).toContain("onClick={onAdd}");
    expect(STRIP_SOURCE).toContain("aria-label={`Add ${row.commonName");
  });
});

describe("CartDrawer — Task 11 UI wiring (§5.6)", () => {
  it("mounts BoxCapacityMeter and AddOnRecommendationStrip, both driven by useAddOnRecommendations", () => {
    expect(DRAWER_SOURCE).toContain('import { useAddOnRecommendations } from "../../hooks/useAddOnRecommendations.js"');
    expect(DRAWER_SOURCE).toContain("const { boxStatus, recommendations } = useAddOnRecommendations({ cart, buyerTank });");
    expect(DRAWER_SOURCE).toContain("<BoxCapacityMeter boxStatus={boxStatus}");
    expect(DRAWER_SOURCE).toContain("<AddOnRecommendationStrip");
  });

  it("the strip's Add action routes through the cart's own addItem (useCart()), not a new write path", () => {
    expect(DRAWER_SOURCE).toContain("addItem");
    expect(DRAWER_SOURCE).toContain("onAdd={(row) => addItem(row.raw, 1)}");
  });
});

describe("ProductDetailModal — secondary packing hint (§3.C, optional, no cart required)", () => {
  it("derives the hint via deriveDefaultPackingProfile + normalizeParcelPreset + canAddToParcel (the same engines)", () => {
    expect(MODAL_SOURCE).toContain('import { deriveDefaultPackingProfile, normalizeParcelPreset, canAddToParcel } from "../services/packingEngine"');
    expect(MODAL_SOURCE).toContain("deriveDefaultPackingProfile(speciesProfile, 1)");
    expect(MODAL_SOURCE).toContain("canAddToParcel(preset, [], profile)");
  });

  it("renders the hint only for shipping-eligible, non-plant listings that fit a standard box", () => {
    expect(MODAL_SOURCE).toContain("view.fulfillment.shipping && packingHint?.fitsStandardBox");
    expect(MODAL_SOURCE).toContain("Ships in a standard box");
  });
});
