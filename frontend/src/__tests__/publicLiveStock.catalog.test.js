/**
 * Booth build follow-up — public pages show LIVE stock, not the original count.
 *
 * aquadex_listings_public exposes `data.quantityRemaining` (and a top-level
 * `quantity_remaining` column), which booth cash sales and card sales
 * decrement. `data.quantity` is the ORIGINAL listing count. marketplace.html
 * and store.html used to display `data.quantity`, so a sold-out batch kept
 * advertising fish that were already gone.
 *
 * These pages are plain <script> HTML, so (per this project's source-guard
 * convention) the contract is asserted over the file text. The `liveStock`
 * helper is also lifted out of each page and run, so the precedence rules are
 * checked behaviourally rather than by string shape alone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function readFrontendFile(relative) {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

/** Pull `function <name>(...) { ... }` out of a page by brace matching. */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function loadLiveStock(src) {
  const fnSrc = extractFunction(src, "liveStock");
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSrc}; return liveStock;`)();
}

const PAGES = {
  "marketplace.html": readFrontendFile("marketplace.html"),
  "store.html": readFrontendFile("store.html"),
};

for (const [page, src] of Object.entries(PAGES)) {
  describe(`${page} — live stock`, () => {
    it("defines exactly one liveStock(row, data) helper", () => {
      expect(src.match(/function liveStock\(row, data\)/g) || []).toHaveLength(1);
    });

    it("the helper checks quantityRemaining, then quantity_remaining, then quantity", () => {
      const fn = extractFunction(src, "liveStock");
      const qr = fn.indexOf("d.quantityRemaining");
      const col = fn.indexOf("row.quantity_remaining");
      const legacy = fn.indexOf("d.quantity;");
      expect(qr).toBeGreaterThan(-1);
      expect(col).toBeGreaterThan(qr);
      expect(legacy).toBeGreaterThan(col);
    });

    describe("liveStock behaviour", () => {
      const liveStock = loadLiveStock(src);

      it("prefers data.quantityRemaining over the original quantity", () => {
        expect(liveStock({ quantity_remaining: 9 }, { quantity: 12, quantityRemaining: 5 })).toBe(5);
      });

      it("treats a live 0 as 0 (sold out), not as missing", () => {
        expect(liveStock({ quantity_remaining: 0 }, { quantity: 12, quantityRemaining: 0 })).toBe(0);
        expect(liveStock({ quantity_remaining: 0 }, { quantity: 12, quantityRemaining: null })).toBe(0);
      });

      it("falls back to the row's quantity_remaining when the blob value is null", () => {
        expect(liveStock({ quantity_remaining: 3 }, { quantity: 12, quantityRemaining: null })).toBe(3);
      });

      it("falls back to legacy data.quantity when no live value exists", () => {
        expect(liveStock({}, { quantity: 12 })).toBe(12);
        expect(liveStock(null, { quantity: 4, quantityRemaining: null })).toBe(4);
      });

      it("returns null (unknown, not sold out) when nothing is known", () => {
        expect(liveStock({}, {})).toBeNull();
        expect(liveStock(null, null)).toBeNull();
      });
    });

    it("shows visible 'Sold out' text when live stock is 0", () => {
      expect(src).toContain("Sold out");
      expect(src).toMatch(/stock === 0/);
    });
  });
}

describe("marketplace.html uses live stock everywhere a count is shown", () => {
  const src = PAGES["marketplace.html"];

  it("resolves stock once, via the helper, when mapping listing rows", () => {
    expect(src).toContain("stock: liveStock(row, data)");
  });

  it("no longer displays the original quantity directly", () => {
    expect(src).not.toContain("Number(item.quantity || 0)");
    expect(src).not.toMatch(/`\$\{Number\(item\.quantity/);
    expect(src).toContain('["Available", availableLabel(item)]');
  });

  it("caps the pack a buyer checks out at live stock", () => {
    const pack = extractFunction(src, "packSize");
    expect(pack).toContain("Math.min(pack, item.stock)");
    expect(src).toContain("guestForm.dataset.qty = String(packSize(item) || 1)");
    expect(src).not.toContain("guestForm.dataset.qty = String(item.quantity || 1)");
  });

  it("disables the card buy action and hides guest checkout when sold out", () => {
    expect(src).toMatch(/"Sold out"\); continueLink\.type = "button"; continueLink\.disabled = true;/);
    expect(src).toContain("const guestEligible = !soldOut &&");
    expect(src).toMatch(/if \(soldOut\) \{\s*guestForm\.style\.display = "none";\s*buy\.textContent = "Sold out";/);
    expect(src).toMatch(/if \(soldOut\) \{ buy\.removeAttribute\("href"\); buy\.setAttribute\("aria-disabled", "true"\); \}/);
  });

  it("keeps sold-out listings on the page (no stock filter on the listing set)", () => {
    const filtered = extractFunction(src, "filteredListings");
    expect(filtered).not.toMatch(/stock/);
  });

  it("does not change the create-checkout payload shape", () => {
    expect(src).toContain(
      '? { listingId: Number(form.dataset.listingId), quantity: Number(form.dataset.qty) || 1, commonName: form.dataset.name, imageUrl: form.dataset.image || undefined }'
    );
    expect(src).toContain('purchaseType: isBatch ? "batch" : "pickup"');
    expect(src).toContain("items: [item],");
  });
});

describe("store.html uses live stock on listing cards", () => {
  const src = PAGES["store.html"];

  it("resolves stock via the helper when normalizing listings", () => {
    expect(src).toContain("stock: liveStock(listing, normalized)");
    expect(src).not.toContain("quantity: normalized.quantity");
  });

  it("renders the card CTA from live stock, including 'Sold out'", () => {
    const cta = extractFunction(src, "listingCta");
    expect(cta).toContain("item.stock === 0) return 'Sold out'");
    expect(cta).toContain("${item.stock} available");
    expect(src).toContain("element('div', 'card-cta', listingCta(item))");
  });

  it("keeps the sold-out CTA visible (the default CTA only appears on hover)", () => {
    expect(src).toContain(".listing-card--sold-out .card-cta { opacity: 1;");
  });
});
