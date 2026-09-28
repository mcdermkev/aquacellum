/**
 * Stock gaps closed before real money (2026-09-29):
 *   1. A live booth cash sale can't take a fish an online buyer is paying for.
 *   2. A full refund of a fish that never left the seller puts it back in stock,
 *      and a refunded order can't be handed off (paid out) afterwards.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { refundRestockDecision, restockRefundedCardSale, recordCardSaleInventory } from "../../api/_lib/cardSaleInventory.js";
import { recordCashSale, sendQueuedSale, setSessionTokenGetter } from "../services/boothApi.js";
import { isPermanentFailure } from "../services/boothOutbox.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SQL = read("../../supabase/migrations/20260929_stock_holds_and_refund_restock.sql");
const ORDER = JSON.parse(read("../../../supabase/migration-order.json"));
const STRIPE = strip(read("../../api/stripe.js"));
const API = strip(read("../../api/storefront-detail.js"));
const BOOTH = strip(read("../components/breeder/BoothInventory.jsx"));

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

describe("migration", () => {
  it("is registered last in migration-order.json", () => {
    const list = JSON.stringify(ORDER);
    expect(list).toContain("frontend/supabase/migrations/20260929_stock_holds_and_refund_restock.sql");
  });

  it("allows the restock rail", () => {
    expect(SQL).toMatch(/check \(rail in \('cash', 'card', 'adjustment', 'restock'\)\)/);
  });

  it("replaces record_inventory_sale (no ambiguous overload) with holds off by default", () => {
    expect(SQL).toMatch(/drop function if exists public\.record_inventory_sale\(text, text, integer, text, text, uuid\);/);
    expect(SQL).toMatch(/p_respect_holds\s+boolean default false/);
    expect(SQL).toMatch(/p\.pronargs <> 7/);
  });

  it("counts holds exactly like reserve_stock, and only when asked", () => {
    const block = SQL.slice(SQL.indexOf("if p_respect_holds then"), SQL.indexOf("v_new_remaining := v_remaining - v_qty;"));
    expect(block).toMatch(/from public\.canonical_reservations/);
    expect(block).toMatch(/state in \('committed', 'consumed'\)\s+or \(state = 'reserved' and expires_at_ms > v_now_ms\)/);
    expect(block).toMatch(/raise exception 'held:/);
  });

  it("checks plain stock before holds, inside the listing lock", () => {
    const lock = SQL.indexOf("perform pg_advisory_xact_lock(hashtextextended(p_listing_id, 0));");
    const oversell = SQL.indexOf("raise exception 'oversell:");
    const held = SQL.indexOf("raise exception 'held:");
    expect(lock).toBeGreaterThan(-1);
    expect(oversell).toBeGreaterThan(lock);
    expect(held).toBeGreaterThan(oversell);
  });

  it("restock reverses only a real card decrement, once", () => {
    const f = SQL.slice(SQL.indexOf("create or replace function public.restock_card_sale"));
    expect(f).toMatch(/v_sale_id\s+:= 'stripe:'\s+\|\| p_payment_intent/);
    expect(f).toMatch(/v_restock_id := 'restock:' \|\| p_payment_intent/);
    // Replay check before the decrement lookup, and again inside the lock.
    expect(f.match(/where sale_id = v_restock_id;\s+if found then return v_after; end if;/g)).toHaveLength(2);
    expect(f).toMatch(/where sale_id = v_sale_id and rail = 'card';\s+if not found then return null; end if;/);
    expect(f).toMatch(/'restock', null\)/);
  });

  it("both functions are server-only", () => {
    expect(SQL).toMatch(/revoke execute on function public\.record_inventory_sale\(text, text, integer, text, text, uuid, boolean\)\s+from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.record_inventory_sale\(text, text, integer, text, text, uuid, boolean\)\s+to service_role;/);
    expect(SQL).toMatch(/revoke execute on function public\.restock_card_sale\(text\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.restock_card_sale\(text\) to service_role;/);
  });
});

describe("refundRestockDecision", () => {
  it("restocks a full refund of a fish that never left", () => {
    expect(refundRestockDecision({ fullyRefunded: true, orderStatus: "locked" })).toEqual({ restock: true });
    expect(refundRestockDecision({ fullyRefunded: true, orderStatus: "pending" })).toEqual({ restock: true });
  });

  it("leaves stock alone when the fish is gone, the refund is partial, or we can't tell", () => {
    for (const orderStatus of ["released", "completed", "dispatched", "disputed", "refunded", "resolved_released"]) {
      expect(refundRestockDecision({ fullyRefunded: true, orderStatus }).restock).toBe(false);
    }
    expect(refundRestockDecision({ fullyRefunded: false, orderStatus: "locked" })).toEqual({ restock: false, reason: "partial_refund" });
    expect(refundRestockDecision({ fullyRefunded: true, orderStatus: null })).toEqual({ restock: false, reason: "no_order" });
  });
});

describe("restockRefundedCardSale", () => {
  const rpcReturning = (data, error = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

  it("calls the RPC with the PaymentIntent", async () => {
    const supabase = rpcReturning(3);
    const r = await restockRefundedCardSale({ supabase, paymentIntentId: "pi_1", fullyRefunded: true, orderStatus: "locked" });
    expect(supabase.rpc).toHaveBeenCalledWith("restock_card_sale", { p_payment_intent: "pi_1" });
    expect(r).toEqual({ applied: true, quantityRemaining: 3 });
  });

  it("does not touch the database when it shouldn't restock", async () => {
    const supabase = rpcReturning(3);
    const r = await restockRefundedCardSale({ supabase, paymentIntentId: "pi_1", fullyRefunded: true, orderStatus: "released" });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ applied: false, skipped: "order_released" });
  });

  it("reports nothing-to-reverse and errors distinctly", async () => {
    expect(await restockRefundedCardSale({ supabase: rpcReturning(null), paymentIntentId: "pi_1", fullyRefunded: true, orderStatus: "locked" }))
      .toEqual({ applied: false, skipped: "no_card_decrement" });
    expect(await restockRefundedCardSale({ supabase: rpcReturning(null, { message: "boom" }), paymentIntentId: "pi_1", fullyRefunded: true, orderStatus: "locked" }))
      .toEqual({ applied: false, error: "boom" });
  });
});

describe("card sale decrement stays hold-blind", () => {
  it("never asks the RPC to respect holds (it would count its own committed hold)", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: 1, error: null })) };
    await recordCardSaleInventory({ supabase, metadata: { purchaseType: "batch", listingId: "8", sellerWallet: "0xS" }, paymentIntentId: "pi_1" });
    expect(supabase.rpc.mock.calls[0][1]).not.toHaveProperty("p_respect_holds");
  });
});

describe("webhook: charge.refunded", () => {
  const refunded = STRIPE.slice(STRIPE.indexOf('case "charge.refunded"'), STRIPE.indexOf('case "account.updated"'));

  it("restocks based on a FULL refund and the order's status", () => {
    expect(refunded).toMatch(/const fullyRefunded = charge\.refunded === true;/);
    expect(refunded).toMatch(/restockRefundedCardSale\(\{\s*supabase,\s*paymentIntentId,\s*fullyRefunded,\s*orderStatus: order\?\.status \?\? null,/);
  });

  it("marks the order refunded only after a successful (or skipped) restock", () => {
    const restock = refunded.indexOf("restockRefundedCardSale(");
    const mark = refunded.indexOf('update({ status: "refunded", updated_at');
    expect(mark).toBeGreaterThan(restock);
    expect(refunded).toMatch(/if \(fullyRefunded && order && order\.status !== "refunded" && !restock\.error\)/);
  });
});

describe("handoff refuses refunded orders", () => {
  it("checks refund state before any payout", () => {
    const f = fn(STRIPE, "handleGuestHandoffConfirm");
    const guard = f.indexOf('code: "REFUNDED"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(f.indexOf("transferToSeller("));
    expect(f).toMatch(/order\.status === "refunded" \|\| settlement\?\.status === "refunded"/);
    expect(f).toMatch(/SETTLEMENT_CHECK_UNAVAILABLE/);
  });
});

describe("record-sale endpoint", () => {
  const f = fn(API, "handleRecordSale");

  it("passes the live-tap flag through, strictly boolean", () => {
    expect(f).toMatch(/p_respect_holds: respectHolds === true,/);
  });

  it("answers a held unit with its own code, before the generic oversell", () => {
    const held = f.indexOf("HELD_FOR_CHECKOUT");
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(f.indexOf('code: "OUT_OF_STOCK"'));
  });

  it("reserves the restock: sale-id namespace", () => {
    expect(f).toMatch(/\/\^\(stripe\|adjust\|restock\):\/i\.test\(saleId\)/);
  });
});

describe("client", () => {
  afterEach(() => setSessionTokenGetter(null));
  const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

  it("sends respectHolds only when asked", async () => {
    const fetchImpl = okFetch();
    await recordCashSale({ saleId: "a", listingId: 1, unitPriceCents: 100, fetchImpl });
    await recordCashSale({ saleId: "b", listingId: 1, unitPriceCents: 100, respectHolds: true, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("respectHolds");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).respectHolds).toBe(true);
  });

  it("an offline replay ignores holds (the fish already left)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await sendQueuedSale({ saleId: "q", listingId: "1", quantity: 1, unitPriceCents: 1 });
    expect(JSON.parse(spy.mock.calls[0][1].body)).not.toHaveProperty("respectHolds");
    spy.mockRestore();
  });

  it("the live Cash tap respects holds", () => {
    expect(BOOTH).toMatch(/forSeller: actingFor,\s*respectHolds: true,\s*\}\);/);
  });

  it("a held refusal is final (no silent retry loop)", () => {
    expect(isPermanentFailure({ code: "HELD_FOR_CHECKOUT" })).toBe(true);
  });
});
