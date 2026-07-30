/**
 * Breeder achievement statistics (docs/BREEDER_STATE_MODEL.md §9.11).
 *
 * THE BUG: the `first_sale` and `sales_50` badges read the grow-out `sold`
 * CHECKPOINT count — a number the breeder types into a text field. So
 * "Established Seller — Sold 50+ bred fish" was earnable by typing 50 and
 * pressing save, and every badge carries a share button, putting that
 * self-assessment one tap from being published as a claim about someone's
 * commercial history.
 *
 * The fix is a distinction, not a deletion: the self-reported tally is still
 * shown (a fish rehomed at a club is a real event that never touches an order)
 * and still drives the funnel math. It just can't back a badge.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

let spawnRows = [];
let checkpointRows = [];
let orderRows = [];

vi.mock("../db", () => ({
  db: {
    spawns: { toArray: async () => spawnRows },
    spawnGrowout: { toArray: async () => checkpointRows },
    marketOrders: { toArray: async () => orderRows },
  },
}));

const { loadBreederStats, countVerifiedSales, isSettledSale, SETTLED_SELLER_STATES } =
  await import("../services/breederStats");
const { ORDER_STATES } = await import("../services/marketplaceStateMachine");

const ME = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  spawnRows = [];
  checkpointRows = [];
  orderRows = [];
});

describe("isSettledSale", () => {
  it("accepts only states where the sale genuinely happened", () => {
    for (const state of SETTLED_SELLER_STATES) {
      expect(isSettledSale({ state }), state).toBe(true);
    }
  });

  it("rejects refunded and cancelled — those are not sales", () => {
    expect(isSettledSale({ state: ORDER_STATES.REFUNDED })).toBe(false);
    expect(isSettledSale({ state: ORDER_STATES.CANCELLED })).toBe(false);
  });

  it("rejects every in-flight state", () => {
    for (const state of [
      ORDER_STATES.CREATED,
      ORDER_STATES.PAYMENT_PENDING,
      ORDER_STATES.PAYMENT_PROTECTED,
      ORDER_STATES.PREPARING,
      ORDER_STATES.IN_TRANSIT,
      ORDER_STATES.DELIVERED,
      ORDER_STATES.REVIEW_WINDOW,
      ORDER_STATES.CLAIM_OPEN,
    ]) {
      expect(isSettledSale({ state }), state).toBe(false);
    }
  });

  it("still honours the legacy numeric status on pre-canonical local rows", () => {
    // Those rows exist in users' IndexedDB; dropping them would erase real history.
    expect(isSettledSale({ status: 2 })).toBe(true);
    expect(isSettledSale({ status: 0 })).toBe(false);
    expect(isSettledSale({ status: 1 })).toBe(false);
  });

  it("prefers the canonical state when both are present", () => {
    expect(isSettledSale({ state: ORDER_STATES.REFUNDED, status: 2 })).toBe(false);
  });

  it("handles junk", () => {
    for (const junk of [null, undefined, {}, "order"]) {
      expect(isSettledSale(junk)).toBe(false);
    }
  });
});

describe("countVerifiedSales", () => {
  it("counts only orders where this account was the SELLER", () => {
    const orders = [
      { seller: ME, buyer: OTHER, state: ORDER_STATES.COMPLETED, createdAt: 100 },
      { seller: OTHER, buyer: ME, state: ORDER_STATES.COMPLETED, createdAt: 200 },
    ];
    expect(countVerifiedSales(orders, ME).count).toBe(1);
  });

  it("does not count a purchase as a sale", () => {
    const orders = [{ seller: OTHER, buyer: ME, state: ORDER_STATES.COMPLETED }];
    expect(countVerifiedSales(orders, ME).count).toBe(0);
  });

  it("matches the seller case-insensitively", () => {
    const orders = [{ seller: ME.toUpperCase(), state: ORDER_STATES.COMPLETED }];
    expect(countVerifiedSales(orders, ME).count).toBe(1);
  });

  it("reports the earliest sale timestamp", () => {
    const orders = [
      { seller: ME, state: ORDER_STATES.COMPLETED, createdAt: 500 },
      { seller: ME, state: ORDER_STATES.SELLER_PAID, createdAt: 200 },
    ];
    const res = countVerifiedSales(orders, ME);
    expect(res.count).toBe(2);
    expect(res.firstAt).toBe(200);
  });

  it("returns zero for no wallet or no orders", () => {
    expect(countVerifiedSales([], ME).count).toBe(0);
    expect(countVerifiedSales(null, ME).count).toBe(0);
    expect(countVerifiedSales([{ seller: ME, state: ORDER_STATES.COMPLETED }], "").count).toBe(0);
  });
});

describe("loadBreederStats — provenance is separated", () => {
  function seedSelfReportedSales(count) {
    spawnRows = [{ spawnId: 1, ownerAddress: ME, speciesId: 10, offspringIds: [1, 2, 3] }];
    checkpointRows = [
      { spawnId: 1, type: "fry_count", count: 100, timestamp: 10 },
      { spawnId: 1, type: "sold", count, timestamp: 20 },
    ];
  }

  it("a typed 'sold' checkpoint produces ZERO verified sales", async () => {
    // The exact exploit: type 50 into the grow-out form, earn "Established Seller".
    seedSelfReportedSales(50);
    const stats = await loadBreederStats(ME);
    expect(stats.frySoldSelfReported).toBe(50);
    expect(stats.verifiedSales).toBe(0);
  });

  it("a completed order produces a verified sale", async () => {
    seedSelfReportedSales(0);
    orderRows = [{ seller: ME, state: ORDER_STATES.COMPLETED, createdAt: 999 }];
    const stats = await loadBreederStats(ME);
    expect(stats.verifiedSales).toBe(1);
    expect(stats.firstVerifiedSaleAt).toBe(999);
  });

  it("exposes no bare `totalSold` that a future badge could grab by mistake", async () => {
    seedSelfReportedSales(50);
    const stats = await loadBreederStats(ME);
    expect(stats.totalSold).toBeUndefined();
    expect("frySoldSelfReported" in stats).toBe(true);
    expect("verifiedSales" in stats).toBe(true);
  });

  it("still uses the self-reported count for the funnel — it isn't discarded", async () => {
    seedSelfReportedSales(30);
    const stats = await loadBreederStats(ME);
    // 100 fry − 30 sold = 70 still alive.
    expect(stats.totalFrySurvived).toBe(70);
  });

  it("scopes spawns to this owner", async () => {
    spawnRows = [
      { spawnId: 1, ownerAddress: ME, speciesId: 10, offspringIds: [] },
      { spawnId: 2, ownerAddress: OTHER, speciesId: 20, offspringIds: [] },
    ];
    const stats = await loadBreederStats(ME);
    expect(stats.totalSpawns).toBe(1);
    expect(stats.uniqueSpeciesBred).toBe(1);
  });

  it("returns an empty stat set with no wallet", async () => {
    const stats = await loadBreederStats("");
    expect(stats.totalSpawns).toBe(0);
    expect(stats.verifiedSales).toBe(0);
  });
});

describe("the Achievements tab reads the verified figure", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../components/BreederAchievements.jsx", import.meta.url)),
    "utf8"
  );

  it("both sales badges check verifiedSales", () => {
    const salesBadges = SOURCE.split("\n").filter((l) => /id: "(first_sale|sales_50)"/.test(l));
    expect(salesBadges).toHaveLength(2);
    for (const line of salesBadges) {
      expect(line).toContain("d.verifiedSales");
      expect(line).not.toContain("d.totalSold");
    }
  });

  it("no badge predicate reads the self-reported tally", () => {
    expect(SOURCE).not.toMatch(/check:.*frySoldSelfReported/);
  });

  it("stats come from the shared service, not an inline Dexie scan", () => {
    expect(SOURCE).toContain('from "../services/breederStats"');
    expect(SOURCE).not.toContain("db.spawnGrowout.toArray()");
  });

  it("labels the two numbers distinctly so the tiles don't imply one figure", () => {
    expect(SOURCE).toContain('label: "Sales"');
    expect(SOURCE).toContain('label: "Rehomed"');
  });
});
