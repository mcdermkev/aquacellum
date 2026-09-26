/**
 * boothOutbox.test.js — the booth cash-sale outbox lifecycle
 * (BOOTH_BUILD_SPEC.md §4 C2 / §6, decision D6).
 *
 * Runs against a REAL Dexie backed by fake-indexeddb, matching the convention in
 * __tests__/migrationV23.test.js and services/tankGroups.test.js, because the
 * v27 `boothSaleQueue` store and its `status` index are exactly what is under
 * test — a hand-rolled table fake would let a bad index definition pass.
 *
 * The load-bearing assertion is the saleId one: a replay MUST reuse the id the
 * sale was queued under. `record_inventory_sale` is idempotent on that id, and
 * that idempotency is the only reason replaying an offline queue is safe. If a
 * retry ever minted a fresh id, one cash sale at a booth would decrement stock
 * and write an orders row once per retry.
 */
import "fake-indexeddb/auto";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";

import { db } from "../db";
import {
  BOOTH_SALE_STATUS,
  buildQueuedSale,
  countQueuedSales,
  isPermanentFailure,
  listQueuedSales,
  listRejectedSales,
  markSaleRejected,
  markSaleSent,
  newSaleId,
  pruneSentSales,
  queueSale,
  replayQueue,
} from "../services/boothOutbox";

const SELLER = "0x41E562EE88825AD8D79B48311A30742AC276C9EB";
const LISTING = "8000001";

const table = () => db.boothSaleQueue;

async function seedSale(overrides = {}) {
  return queueSale({
    saleId: overrides.saleId || newSaleId(),
    listingId: overrides.listingId ?? LISTING,
    quantity: overrides.quantity ?? 1,
    unitPriceCents: overrides.unitPriceCents ?? 2500,
    sellerAddress: overrides.sellerAddress ?? SELLER,
    createdAt: overrides.createdAt,
    note: overrides.note,
  });
}

beforeEach(async () => {
  db.close();
  await Dexie.delete("AquadexDB");
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await Dexie.delete("AquadexDB");
});

describe("boothSaleQueue store (Dexie v27)", () => {
  it("is reachable and keyed by saleId", async () => {
    expect(db.verno).toBeGreaterThanOrEqual(27);
    expect(table()).toBeTruthy();
    expect(table().schema.primKey.keyPath).toBe("saleId");
  });
});

describe("buildQueuedSale", () => {
  it("normalizes the row and starts it queued", () => {
    const row = buildQueuedSale({
      saleId: "sale-1",
      listingId: 8000001,
      quantity: "3",
      unitPriceCents: "2500",
      sellerAddress: SELLER,
      createdAt: 1000,
    });

    expect(row).toMatchObject({
      saleId: "sale-1",
      listingId: "8000001",
      sellerAddress: SELLER.toLowerCase(),
      quantity: 3,
      unitPriceCents: 2500,
      rail: "cash",
      status: BOOTH_SALE_STATUS.QUEUED,
      attempts: 0,
      createdAt: 1000,
    });
  });

  it("refuses a row with no saleId, because replay safety depends on it", () => {
    expect(() => buildQueuedSale({ listingId: LISTING })).toThrow(/saleId/);
  });

  it("refuses a row with no listingId", () => {
    expect(() => buildQueuedSale({ saleId: "sale-1" })).toThrow(/listingId/);
  });

  it("never lets a sale be recorded for zero fish", () => {
    expect(buildQueuedSale({ saleId: "s", listingId: LISTING, quantity: 0 }).quantity).toBe(1);
  });
});

describe("queue → replay → mark sent", () => {
  it("persists the sale before any network call and counts it as queued", async () => {
    const row = await seedSale({ saleId: "sale-offline" });

    expect(row.status).toBe(BOOTH_SALE_STATUS.QUEUED);
    // Durable: readable straight back off disk, which is what survives a dead
    // tab mid-POST at a booth.
    const stored = await table().get("sale-offline");
    expect(stored.status).toBe(BOOTH_SALE_STATUS.QUEUED);
    expect(await countQueuedSales({})).toBe(1);
  });

  it("drains the queue oldest-first and marks each sale sent", async () => {
    await seedSale({ saleId: "sale-a", createdAt: 100 });
    await seedSale({ saleId: "sale-c", createdAt: 300 });
    await seedSale({ saleId: "sale-b", createdAt: 200 });

    const seen = [];
    const send = vi.fn(async (r) => {
      seen.push(r.saleId);
      return { ok: true, quantityRemaining: 7, orderId: `order-${r.saleId}` };
    });

    const summary = await replayQueue({ send });

    expect(seen).toEqual(["sale-a", "sale-b", "sale-c"]);
    expect(summary).toEqual({ attempted: 3, sent: 3, rejected: 0, deferred: 0 });
    expect(await countQueuedSales({})).toBe(0);

    const sent = await table().get("sale-b");
    expect(sent.status).toBe(BOOTH_SALE_STATUS.SENT);
    expect(sent.quantityRemaining).toBe(7);
    expect(sent.orderId).toBe("order-sale-b");
  });

  it("REUSES the queued saleId on replay instead of minting a new one", async () => {
    // The whole reason offline replay is safe: the server is idempotent on this
    // id. A fresh id per retry would turn one cash sale into N sales.
    const queued = await seedSale({ saleId: "sale-stable" });

    const idsSent = [];
    const flaky = vi.fn(async (r) => {
      idsSent.push(r.saleId);
      // Fail the first two attempts the way bad expo wifi does.
      if (idsSent.length < 3) return { success: false, error: "offline", permanent: false };
      return { ok: true, quantityRemaining: 2 };
    });

    await replayQueue({ send: flaky });
    await replayQueue({ send: flaky });
    await replayQueue({ send: flaky });

    expect(idsSent).toEqual(["sale-stable", "sale-stable", "sale-stable"]);
    expect(new Set(idsSent).size).toBe(1);
    expect(idsSent[0]).toBe(queued.saleId);

    const finalRow = await table().get("sale-stable");
    expect(finalRow.status).toBe(BOOTH_SALE_STATUS.SENT);
    // Two transient failures were recorded as attempts, not as extra sales.
    expect(finalRow.attempts).toBe(2);
    expect(await table().count()).toBe(1);
  });

  it("leaves a sale queued when the network is gone, and sends it on reconnect", async () => {
    await seedSale({ saleId: "sale-airplane" });

    const offline = vi.fn(async () => ({ success: false, offline: true, permanent: false, error: "offline" }));
    const offlineSummary = await replayQueue({ send: offline });

    expect(offlineSummary).toEqual({ attempted: 1, sent: 0, rejected: 0, deferred: 1 });
    // Still on disk and still replayable — never dropped like cloudSync.js does.
    expect(await countQueuedSales({})).toBe(1);
    expect((await table().get("sale-airplane")).lastError).toBe("offline");

    const back = vi.fn(async () => ({ ok: true, quantityRemaining: 4 }));
    const onlineSummary = await replayQueue({ send: back });

    expect(onlineSummary.sent).toBe(1);
    expect(await countQueuedSales({})).toBe(0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does not re-send an already-sent sale on a later replay", async () => {
    await seedSale({ saleId: "sale-once" });
    const send = vi.fn(async () => ({ ok: true, quantityRemaining: 1 }));

    await replayQueue({ send });
    await replayQueue({ send });
    await replayQueue({ send });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("scopes replay to the signed-in seller", async () => {
    await seedSale({ saleId: "sale-mine", sellerAddress: SELLER });
    await seedSale({ saleId: "sale-theirs", sellerAddress: "0xdeadbeef" });

    const send = vi.fn(async () => ({ ok: true, quantityRemaining: 0 }));
    const summary = await replayQueue({ send, sellerAddress: SELLER });

    expect(summary.attempted).toBe(1);
    expect(send.mock.calls[0][0].saleId).toBe("sale-mine");
    expect((await table().get("sale-theirs")).status).toBe(BOOTH_SALE_STATUS.QUEUED);
  });
});

describe("permanent refusals", () => {
  it("classifies server rulings as permanent and connectivity as not", () => {
    expect(isPermanentFailure({ code: "OUT_OF_STOCK" })).toBe(true);
    expect(isPermanentFailure({ code: "NOT_YOUR_LISTING" })).toBe(true);
    expect(isPermanentFailure({ code: "LISTING_NOT_FOUND" })).toBe(true);
    expect(isPermanentFailure({ status: 409 })).toBe(true);
    expect(isPermanentFailure({ status: 403 })).toBe(true);

    expect(isPermanentFailure({ offline: true })).toBe(false);
    expect(isPermanentFailure({ status: 500 })).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });

  it("stops retrying a refused sale but keeps it visible to the seller", async () => {
    await seedSale({ saleId: "sale-oversold" });

    const send = vi.fn(async () => ({ success: false, status: 409, code: "OUT_OF_STOCK", error: "Not enough stock left." }));
    const summary = await replayQueue({ send });

    expect(summary).toEqual({ attempted: 1, sent: 0, rejected: 1, deferred: 0 });
    expect(await countQueuedSales({})).toBe(0);

    // Kept, not deleted: the seller handed over a fish and needs to know it was
    // refused. Silently dropping it recreates the vanishing-sale problem.
    const rejected = await listRejectedSales({});
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejectedReason).toBe("OUT_OF_STOCK");

    await replayQueue({ send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("defers rather than rejects when send throws", async () => {
    await seedSale({ saleId: "sale-throws" });
    const send = vi.fn(async () => { throw new Error("Failed to fetch"); });

    const summary = await replayQueue({ send });

    expect(summary.deferred).toBe(1);
    expect((await table().get("sale-throws")).status).toBe(BOOTH_SALE_STATUS.QUEUED);
  });
});

describe("bookkeeping", () => {
  it("markSaleSent is a no-op for an unknown saleId", async () => {
    expect(await markSaleSent("nope", { quantityRemaining: 1 }, {})).toBeNull();
    expect(await markSaleRejected("nope", "gone", {})).toBeNull();
  });

  it("prunes only sent rows past the retention window", async () => {
    const now = 10_000_000;
    const old = now - 30 * 24 * 60 * 60 * 1000;

    await seedSale({ saleId: "sent-old", createdAt: old });
    await seedSale({ saleId: "sent-new", createdAt: now });
    await seedSale({ saleId: "queued-old", createdAt: old });
    await seedSale({ saleId: "rejected-old", createdAt: old });
    await markSaleSent("sent-old", { quantityRemaining: 0 }, {});
    await markSaleSent("sent-new", { quantityRemaining: 0 }, {});
    await markSaleRejected("rejected-old", "OUT_OF_STOCK", {});

    const pruned = await pruneSentSales({ now });

    expect(pruned).toBe(1);
    expect(await table().get("sent-old")).toBeUndefined();
    expect(await table().get("sent-new")).toBeTruthy();
    // A pending sale is never pruned, however stale — it is still money owed.
    expect(await table().get("queued-old")).toBeTruthy();
    expect(await table().get("rejected-old")).toBeTruthy();
  });

  it("lists queued sales oldest-first", async () => {
    await seedSale({ saleId: "s3", createdAt: 300 });
    await seedSale({ saleId: "s1", createdAt: 100 });
    await seedSale({ saleId: "s2", createdAt: 200 });

    expect((await listQueuedSales({})).map((r) => r.saleId)).toEqual(["s1", "s2", "s3"]);
  });

  it("newSaleId produces distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSaleId()));
    expect(ids.size).toBe(200);
  });
});

describe("no money logic in the booth layer", () => {
  it("keeps fee math out of the outbox and the UI", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    // Comments are stripped first: these files DESCRIBE the money boundary
    // ("the server pins platform_fee_cents = 0"), and prose about a rule is not
    // a violation of it. Only executable code is asserted on.
    const codeOnly = (rel) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\/[^\n"'`]*$/gm, "");

    for (const rel of [
      "../services/boothOutbox.js",
      "../services/boothApi.js",
      "../services/boothInventory.js",
      "../components/breeder/BoothInventory.jsx",
    ]) {
      const src = codeOnly(rel);
      // No fee rate, no platform-fee constant, no bps, no fee resolution.
      expect(src).not.toMatch(/PROTOCOL_FEE|platformFee|platform_fee_cents|FEE_BPS|feePercent/);
      expect(src).not.toMatch(/resolveFeePolicy|computeCheckoutCharge|FEE_RAIL/);
      expect(src).not.toMatch(/\bfeeCents\b|\btotalCents\b|\bsubtotalCents\b/);
    }
  });

  it("records cash only — the card rail cannot be sent from here", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../services/boothApi.js", import.meta.url)),
      "utf8"
    );
    // rail is hardcoded, not a parameter, so this module cannot record a card
    // sale at 0% and skip the payment rail.
    expect(src).toContain('rail: "cash"');
    expect(src).not.toMatch(/rail\s*=\s*[^"']/);
  });
});
