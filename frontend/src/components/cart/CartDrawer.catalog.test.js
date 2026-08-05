/**
 * Component-level guards for the Task 10 cart UI (CartDrawer.jsx,
 * CartButton.jsx) and its wiring into MarketplaceBoard.jsx /
 * ProductDetailModal.jsx.
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * these components transitively import ethers/@tanstack/react-query and
 * other browser-only dependencies. Following the established pattern for
 * component tests in this codebase (MarketplaceBoard.catalog.test.js,
 * CheckoutSummary.orders.test.js, BreederTerminal.catalog.test.js), we
 * verify the behavioral contract via static source guards over the
 * comment-stripped source, complementing the exhaustive pure-module unit
 * tests (cartModel.test.js, cartRevalidation.test.js).
 *
 * Covers docs/TASK_10_CART_SPEC.md §7 criteria 7 (composition), 8 (conflict
 * UX), 9 (persistence), 10 (accessibility, partial).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const DRAWER_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./CartDrawer.jsx", import.meta.url)), "utf8")
);
const BUTTON_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./CartButton.jsx", import.meta.url)), "utf8")
);
const CONTEXT_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../../contexts/CartContext.jsx", import.meta.url)), "utf8")
);
const STORE_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../../services/cartStore.js", import.meta.url)), "utf8")
);
const BOARD_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../MarketplaceBoard.jsx", import.meta.url)), "utf8")
);
const MODAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../ProductDetailModal.jsx", import.meta.url)), "utf8")
);

describe("CartDrawer / CartButton — composition (§7.7, no forked cart logic)", () => {
  it("CartButton reflects totals.itemCount from useCart(), not a bespoke counter", () => {
    expect(BUTTON_SOURCE).toContain('import { useCart } from "../../contexts/CartContext.jsx"');
    expect(BUTTON_SOURCE).toContain("totals.itemCount");
  });

  it("CartDrawer sources cart/totals/changes/conflict exclusively from useCart()", () => {
    expect(DRAWER_SOURCE).toContain('import { useCart } from "../../contexts/CartContext.jsx"');
    expect(DRAWER_SOURCE).toMatch(/const \{ cart, totals, changes, conflict,[\s\S]{0,80}\} = useCart\(\);/);
  });

  it("CartDrawer calls revalidateCart (via useCart().revalidate) before routing to checkout", () => {
    expect(DRAWER_SOURCE).toContain("const { changes: freshChanges } = revalidate();");
    expect(DRAWER_SOURCE).toMatch(/freshChanges\.length > 0/);
    expect(DRAWER_SOURCE).toContain("onProceedToCheckout?.(cart, totals);");
  });

  it("CartDrawer revalidates on open (useEffect keyed on isOpen)", () => {
    expect(DRAWER_SOURCE).toMatch(/useEffect\(\(\) => \{\s*if \(isOpen\) revalidate\(\);/);
  });

  it("composes the shared accessible Modal rather than reimplementing dialog semantics", () => {
    expect(DRAWER_SOURCE).toContain('import { Modal } from "../Modal.jsx"');
    expect(DRAWER_SOURCE).toContain("<Modal");
    expect(DRAWER_SOURCE).toContain('ariaLabel="Shopping cart"');
  });

  it("uses the existing sliding-drawer-content house pattern, not a new drawer implementation", () => {
    expect(DRAWER_SOURCE).toContain('className="sliding-drawer-content"');
  });

  it("CartContext revalidates via the pure cartRevalidation.revalidateCart core", () => {
    expect(CONTEXT_SOURCE).toContain('import { revalidateCart } from "../services/cartRevalidation.js"');
    // Matches the call rather than one exact argument list. The point of this
    // assertion is that CartContext DELEGATES to the pure core instead of forking
    // cart logic — not that the signature never grows. It gained a third argument
    // when vacation mode began passing `pausedSellers` through, which is the core
    // being extended as designed (its `opts` was reserved for exactly this).
    expect(CONTEXT_SOURCE).toMatch(/revalidateCart\(\s*cart,\s*listings\b/);
    // And the forked-logic guard the assertion actually exists to enforce.
    expect(CONTEXT_SOURCE).not.toMatch(/function\s+revalidateItem/);
  });

  it("CartContext passes seller vacation state into the revalidation core", () => {
    // Vacation mode is only safe because it is ENFORCED here. A "pause my store"
    // switch writing a flag nothing honours would leave the breeder believing the
    // store is closed while orders for live animals kept arriving, so this pins the
    // wiring rather than trusting it.
    expect(CONTEXT_SOURCE).toContain('import { getPausedSellers } from "../services/sellerVacation.js"');
    expect(CONTEXT_SOURCE).toMatch(/pausedSellers:\s*pausedSellersRef\.current/);
  });

  it("CartContext delegates every mutation to cartModel.js (no re-implemented single-seller/quantity logic)", () => {
    // Line endings are normalized before matching. This previously hard-coded `\n`
    // inside a multi-line import string, which passes on a LF checkout and fails on
    // a CRLF one — a false failure that says nothing about the property being
    // tested. The property is that every mutation is IMPORTED from cartModel rather
    // than reimplemented here, so assert the named imports and the absence of local
    // reimplementations instead of one exact block of text.
    const source = CONTEXT_SOURCE.replace(/\r\n/g, "\n");
    expect(source).toContain('from "../services/cartModel.js"');
    for (const named of [
      "emptyCart",
      "addToCart as addToCartModel",
      "replaceCart as replaceCartModel",
      "setQuantity as setQuantityModel",
      "removeItem as removeItemModel",
      "cartTotals",
    ]) {
      expect(source, `CartContext must import ${named} from cartModel`).toContain(named);
    }
    // The guard that actually matters: no forked single-seller/quantity logic here.
    expect(source).not.toMatch(/function\s+(addToCart|setQuantity|replaceCart)\s*\(/);
  });
});

describe("CartDrawer — seller-conflict UX (§7.8)", () => {
  it("renders a replace-cart confirm dialog when useCart().conflict is set", () => {
    expect(DRAWER_SOURCE).toContain("{conflict && (");
    expect(DRAWER_SOURCE).toMatch(/Replace cart\?/);
  });

  it("only calls resolveConflict(true) on explicit confirm, and resolveConflict(false) on cancel", () => {
    expect(DRAWER_SOURCE).toContain("onClick={() => resolveConflict(false)}");
    expect(DRAWER_SOURCE).toContain("onClick={() => resolveConflict(true)}");
  });
});

describe("cartStore.js — persistence (§7.9)", () => {
  it("always writes Dexie via the cart table, for both guest and authed accounts", () => {
    expect(STORE_SOURCE).toContain("await writeDexieCart(cart);");
    expect(STORE_SOURCE).toContain("db.cart");
  });

  it("a failed server sync is caught and logged, never thrown or surfaced to the caller", () => {
    expect(STORE_SOURCE).toMatch(/if \(!result\.ok\) \{\s*console\.warn\("\[CartStore\] Server cart sync failed \(non-fatal\):", result\.error\);\s*\}/);
  });

  it("saveCart does not clear the local cart when the server call fails", () => {
    // writeDexieCart(cart) runs unconditionally before the (best-effort)
    // server PUT — a failed PUT cannot have already wiped local data.
    const saveCartBody = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function saveCart"));
    const writeIdx = saveCartBody.indexOf("await writeDexieCart(cart);");
    const putIdx = saveCartBody.indexOf('authedFetch("PUT"');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(putIdx).toBeGreaterThan(writeIdx);
  });
});

describe("MarketplaceBoard / ProductDetailModal — Add to cart wiring", () => {
  it("MarketplaceBoard adds to cart via useCart().addItem, not a re-implemented cart write", () => {
    expect(BOARD_SOURCE).toContain('import { useCart } from "../contexts/CartContext"');
    expect(BOARD_SOURCE).toContain("const { addItem: addToCart } = useCart();");
    expect(BOARD_SOURCE).toMatch(/addToCart\(item, item\.isBatch/);
  });

  it("preserves the Buy Now one-tap purchase shortcut alongside Add to cart (never regressed)", () => {
    expect(BOARD_SOURCE).toContain("Buy Now");
    expect(BOARD_SOURCE).toContain("🛒 Add to Cart");
    // The buy-now path still calls the pre-existing checkout hand-off.
    expect(BOARD_SOURCE).toContain('onSelectCheckoutOrder("pending_purchase", item.tokenId);');
  });

  it("ProductDetailModal exposes distinct onBuyNow and onAddToCart actions", () => {
    expect(MODAL_SOURCE).toContain("onBuyNow,");
    expect(MODAL_SOURCE).toContain("onAddToCart,");
    expect(MODAL_SOURCE).toContain("onBuyNow && onBuyNow(listing)");
    expect(MODAL_SOURCE).toContain("onAddToCart && onAddToCart(listing)");
  });

  it("MarketplaceBoard's ProductDetailModal mount wires onBuyNow to the existing checkout hand-off and onAddToCart to the cart", () => {
    expect(BOARD_SOURCE).toContain("onBuyNow={(item) => {");
    expect(BOARD_SOURCE).toContain("onAddToCart={(item) => {");
    expect(BOARD_SOURCE).toMatch(/onAddToCart=\{\(item\) => \{\s*addToCart\(item, item\.isBatch/);
  });
});

describe("CartDrawer — accessibility (§7.10, partial — see note)", () => {
  it("status changes are announced via an aria-live region", () => {
    expect(DRAWER_SOURCE).toContain('aria-live="polite"');
  });

  it("the close button and quantity/remove controls have explicit aria-labels", () => {
    expect(DRAWER_SOURCE).toContain('aria-label="Close cart"');
    expect(DRAWER_SOURCE).toMatch(/aria-label=\{`Remove \$\{item\.commonName/);
    expect(DRAWER_SOURCE).toContain('aria-label="Decrease quantity"');
    expect(DRAWER_SOURCE).toContain('aria-label="Increase quantity"');
  });

  it("revalidation notes pair an icon with text (never color-only)", () => {
    expect(DRAWER_SOURCE).toContain("<Info size={12}");
    expect(DRAWER_SOURCE).toContain("<Warning size={12}");
    expect(DRAWER_SOURCE).toContain("{changeNote(change, casualModeActive)}");
  });

  it("the seller-conflict dialog uses alertdialog semantics", () => {
    expect(DRAWER_SOURCE).toContain('role="alertdialog"');
    expect(DRAWER_SOURCE).toContain('aria-modal="true"');
  });

  // NOTE: full a11y validation (keyboard nav, screen reader behavior, focus
  // order within the nested conflict overlay) requires manual testing with
  // assistive technology and is NOT verified here — this project's vitest
  // runs in node (no jsdom), so only static source-level guards are possible.
});
