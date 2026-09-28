/**
 * Fixes from the independent review of 11f0f42..adc731e (2026-09-28), plus live
 * stock on public pages. Each block names the finding it closes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { recordCardSaleInventory } from "../../api/_lib/cardSaleInventory.js";
import { isPermanentFailure } from "../services/boothOutbox.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const API = strip(read("../../api/storefront-detail.js"));
const STRIPE = strip(read("../../api/stripe.js"));
const SQL = read("../../supabase/migrations/20260927_inventory_ledger_hardening.sql");
const CARD = read("../components/storefront/ListingCard.jsx");

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

describe("#1 card and cash sale ids can't collide", () => {
  const f = fn(API, "handleRecordSale");
  it("record-sale refuses reserved stripe:/adjust: ids before touching stock", () => {
    const guard = f.indexOf("SALE_ID_RESERVED");
    expect(f).toMatch(/\/\^\(stripe\|adjust\):\/i\.test\(saleId\)/);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(f.indexOf('rpc("record_inventory_sale"'));
  });
  it("the database refuses a replayed id that belongs to a different sale", () => {
    expect(SQL).toMatch(/v_existing_listing <> p_listing_id or lower\(v_existing_seller\) <> lower\(p_seller\)/);
    expect((SQL.match(/already used for a different sale/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(f).toMatch(/SALE_ID_CONFLICT/);
  });
  it("those refusals don't retry forever", () => {
    for (const code of ["SALE_ID_RESERVED", "SALE_ID_CONFLICT"]) expect(isPermanentFailure({ code })).toBe(true);
  });
});

describe("#2 a helper's cash sale is a sale, not stock control", () => {
  const f = fn(API, "handleRecordSale");
  const helper = f.slice(f.indexOf("isActiveBoothStaff(target, sessionWallet)"), f.indexOf("sellerWallet = target;"));
  it("caps quantity and requires a price, before switching to the seller's stock", () => {
    expect(helper).toMatch(/helperQty > MAX_HELPER_SALE_QUANTITY/);
    expect(helper).toMatch(/HELPER_PRICE_REQUIRED/);
    expect(API).toMatch(/const MAX_HELPER_SALE_QUANTITY = 10;/);
  });
  it("the seller's own sales are not limited", () => {
    const before = f.slice(0, f.indexOf("if (forSeller &&"));
    expect(before).not.toMatch(/MAX_HELPER_SALE_QUANTITY|HELPER_PRICE_REQUIRED/);
  });
});

describe("#3/#4 an oversold card sale can't be paid out", () => {
  const f = fn(STRIPE, "handleGuestHandoffConfirm");
  it("handoff re-checks stock (idempotently) before any transfer", () => {
    const check = f.indexOf("recordCardSaleInventory(");
    const pay = f.indexOf("transferToSeller(");
    expect(check).toBeGreaterThan(-1);
    expect(pay).toBeGreaterThan(check);
  });
  it("refuses release when oversold, and waits on a failed check", () => {
    expect(f).toMatch(/if \(inv\.oversold\)[\s\S]*status\(409\)[\s\S]*code: "OVERSOLD"/);
    expect(f).toMatch(/STOCK_CHECK_UNAVAILABLE/);
  });
});

describe("#5 a transient helper-check failure keeps the sale", () => {
  it("membership lookup errors are 'unknown', never a grant or a hard 403", () => {
    const check = fn(API, "isActiveBoothStaff");
    expect(check).toMatch(/if \(error\) \{[\s\S]*return null;/);
    const f = fn(API, "handleRecordSale");
    expect(f).toMatch(/if \(member === null\)[\s\S]*status\(503\)/);
  });
  it("the outbox retries a 503 instead of rejecting it", () => {
    expect(isPermanentFailure({ status: 503, code: "STAFF_CHECK_UNAVAILABLE" })).toBe(false);
  });
});

describe("#8 hold release is reported truthfully", () => {
  const md = { purchaseType: "batch", listingId: "1", quantity: "1", sellerWallet: "0xabc", reservationGroupId: "g" };
  const supabase = { rpc: vi.fn(async () => ({ data: 3, error: null })) };
  it("{ ok:false } from the release is not counted as released", async () => {
    const out = await recordCardSaleInventory({ supabase, metadata: md, paymentIntentId: "pi_1", releaseHolds: async () => ({ ok: false }) });
    expect(out).toMatchObject({ applied: true, holdsReleased: false });
  });
  it("a successful release is", async () => {
    const out = await recordCardSaleInventory({ supabase, metadata: md, paymentIntentId: "pi_2", releaseHolds: async () => ({ ok: true }) });
    expect(out.holdsReleased).toBe(true);
  });
});

describe("#9 stock adjustments leave an audit trail", () => {
  it("adjust_inventory_by writes an 'adjustment' ledger row with a namespaced id", () => {
    const adj = SQL.slice(SQL.indexOf("create or replace function public.adjust_inventory_by"), SQL.indexOf("-- ── 3."));
    expect(adj).toMatch(/insert into public\.inventory_sale_events/);
    expect(adj).toMatch(/'adjust:'/);
    expect(adj).toMatch(/'adjustment'/);
  });
});

describe("browser-role privileges are read-only where needed, none elsewhere", () => {
  it("public view keeps SELECT only", () => {
    expect(SQL).toMatch(/revoke insert, update, delete, truncate, references, trigger\s+on public\.aquadex_listings_public from anon, authenticated;/);
    expect(SQL).toMatch(/grant select on public\.aquadex_listings_public to anon, authenticated;/);
  });
  it("server-only tables and reserve_stock are revoked, with post-conditions", () => {
    for (const t of ["published_tanks", "inventory_sale_events", "canonical_reservations", "promotion_redemptions"]) {
      expect(SQL).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated;`));
    }
    expect(SQL).toMatch(/revoke execute on function public\.reserve_stock\(/);
    expect(SQL).toMatch(/raise exception 'anon lost SELECT on aquadex_listings_public'/);
    expect(SQL).toMatch(/raise exception 'browser roles still have write privileges/);
  });
});

describe("public tank page shows live stock", () => {
  it("overlays live stock/availability/price from the owner's listings onto the snapshot", () => {
    const live = fn(API, "withLiveCommerce");
    expect(live).toMatch(/\.select\("id, seller_address, is_active, quantity_remaining, price, data"\)/);
    expect(live).toMatch(/!== owner\) continue/);
    expect(live).toMatch(/available: r\.is_active !== false && \(remaining == null \|\| remaining > 0\)/);
    expect(live).toMatch(/if \(!r\) return \{ \.\.\.line, quantityRemaining: 0, available: false \}/);
    const handler = fn(API, "handlePublicTank");
    expect(handler).toMatch(/const tank = await withLiveCommerce\(row\.snapshot, row\.owner_wallet\);/);
    expect(handler).toMatch(/json\(\{ token: row\.token, tank, updatedAt/);
  });
});

describe("store API and in-app storefront keep a sold-out 0", () => {
  it("uses the live column and ?? (not ||)", () => {
    expect(API).toMatch(/quantity_remaining: row\.quantity_remaining \?\? d\.quantityRemaining \?\? d\.quantity \?\? 0,/);
    expect(API).toMatch(/quantity: listing\.is_batch \? Number\(listing\.quantity_remaining \?\? listing\.quantity \?\? 0\) : 1,/);
    expect(API).not.toMatch(/quantity_remaining: d\.quantityRemaining \|\| d\.quantity \|\| 0/);
    expect(CARD).toMatch(/listing\.quantityRemaining \?\? listing\.quantity \?\? 1/);
  });
});
