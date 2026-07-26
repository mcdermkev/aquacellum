/**
 * dexService.test.js — integration tests against a REAL Dexie instance backed
 * by fake-indexeddb (mirrors the convention in __tests__/migrationV23.test.js),
 * since dexService's whole job is Dexie transactions over the v24 tables.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db.js";
import {
  getDexEntries,
  reconcileDexFromTanks,
  isWishlisted,
  getWishlist,
  toggleWishlist,
  computeDexCompletion,
} from "./dexService.js";

const WALLET = "0xAbC1230000000000000000000000000000dEaD";

function tank(specimens) {
  return { id: 1, specimens };
}

function specimen(scientificName, commonName) {
  return { speciesId: 1, scientificName, commonName, status: 0 };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  await db.dexEntries.clear();
  await db.wishlist.clear();
  delete globalThis.triggerXpTracking;
});

describe("reconcileDexFromTanks", () => {
  it("adds a Dex entry for a resident species not yet in the Dex", async () => {
    const tanks = [tank([specimen("Paracheirodon innesi", "Neon Tetra")])];
    const added = await reconcileDexFromTanks(WALLET, tanks);
    expect(added).toHaveLength(1);
    expect(added[0].speciesKey).toBe("paracheirodon innesi");

    const entries = await getDexEntries(WALLET);
    expect(entries).toHaveLength(1);
    expect(entries[0].commonName).toBe("Neon Tetra");
    expect(entries[0].firstKeptAt).toBeTypeOf("number");
  });

  it("is idempotent — running it again for the same species adds nothing new", async () => {
    const tanks = [tank([specimen("Paracheirodon innesi", "Neon Tetra")])];
    await reconcileDexFromTanks(WALLET, tanks);
    const secondRun = await reconcileDexFromTanks(WALLET, tanks);
    expect(secondRun).toHaveLength(0);

    const entries = await getDexEntries(WALLET);
    expect(entries).toHaveLength(1); // still exactly one row, not duplicated
  });

  it("dedupes multiple specimens of the same species within one reconcile call", async () => {
    const tanks = [tank([
      specimen("Paracheirodon innesi", "Neon Tetra"),
      specimen("Paracheirodon innesi", "Neon Tetra"),
      specimen("Paracheirodon innesi", "Neon Tetra"),
    ])];
    const added = await reconcileDexFromTanks(WALLET, tanks);
    expect(added).toHaveLength(1);
  });

  it("covers species across multiple tanks in one call", async () => {
    const tanks = [
      tank([specimen("Paracheirodon innesi", "Neon Tetra")]),
      tank([specimen("Betta splendens", "Betta")]),
    ];
    const added = await reconcileDexFromTanks(WALLET, tanks);
    expect(added.map((a) => a.speciesKey).sort()).toEqual(["betta splendens", "paracheirodon innesi"]);
  });

  it("skips batch placeholders (no scientificName) — never records an unidentified fry count", async () => {
    const tanks = [tank([{ isBatchPlaceholder: true, quantity: 12, commonName: "Juvenile Fry", speciesId: 0, status: 0 }])];
    const added = await reconcileDexFromTanks(WALLET, tanks);
    expect(added).toHaveLength(0);
    expect(await getDexEntries(WALLET)).toHaveLength(0);
  });

  it("skips unidentified specimens (useUserTanks' \"Unknown\" sentinel) and awards no XP for them", async () => {
    // useUserTanks sets scientificName to the literal "Unknown" when the
    // on-chain speciesCatalog lookup fails — that's a lookup failure, not a
    // species, so it must never become a Dex entry or earn ADD_SPECIES XP.
    const triggerSpy = vi.fn();
    globalThis.triggerXpTracking = triggerSpy;

    const tanks = [tank([
      { speciesId: 7, scientificName: "Unknown", commonName: "Species ID 7", status: 0 },
      { speciesId: 8, scientificName: "unknown", commonName: "Species ID 8", status: 0 },
      specimen("Betta splendens", "Betta"),
    ])];
    const added = await reconcileDexFromTanks(WALLET, tanks);

    expect(added.map((a) => a.speciesKey)).toEqual(["betta splendens"]);
    expect(await getDexEntries(WALLET)).toHaveLength(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a Dex entry even after the species is no longer resident in any tank (Dex is a ledger, not a live mirror)", async () => {
    await reconcileDexFromTanks(WALLET, [tank([specimen("Paracheirodon innesi", "Neon Tetra")])]);
    // Simulate the fish being sold — reconcile again with an empty tank.
    const added = await reconcileDexFromTanks(WALLET, [tank([])]);
    expect(added).toHaveLength(0);
    expect(await getDexEntries(WALLET)).toHaveLength(1); // still there
  });

  it("returns [] and does nothing for no wallet / no tanks", async () => {
    expect(await reconcileDexFromTanks(null, [tank([specimen("X", "X")])])).toEqual([]);
    expect(await reconcileDexFromTanks(WALLET, [])).toEqual([]);
    expect(await reconcileDexFromTanks(WALLET, null)).toEqual([]);
  });

  it("fires the one-time ADD_SPECIES XP award via triggerXpTracking for each new species, and never again on rerun", async () => {
    const triggerSpy = vi.fn();
    globalThis.triggerXpTracking = triggerSpy;

    const tanks = [tank([specimen("Paracheirodon innesi", "Neon Tetra")])];
    await reconcileDexFromTanks(WALLET, tanks);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(15, "Species Added to Collection", expect.objectContaining({ speciesKey: "paracheirodon innesi" }));

    triggerSpy.mockClear();
    await reconcileDexFromTanks(WALLET, tanks); // rerun — same species, already in Dex
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("does not throw when triggerXpTracking is unavailable", async () => {
    delete globalThis.triggerXpTracking;
    const tanks = [tank([specimen("Paracheirodon innesi", "Neon Tetra")])];
    await expect(reconcileDexFromTanks(WALLET, tanks)).resolves.toHaveLength(1);
  });
});

describe("wishlist", () => {
  const entry = { scientificName: "Corydoras aeneus", commonName: "Bronze Cory" };

  it("toggles a species onto the wishlist, then off", async () => {
    expect(await isWishlisted(WALLET, entry.scientificName)).toBe(false);

    const nowOn = await toggleWishlist(WALLET, entry);
    expect(nowOn).toBe(true);
    expect(await isWishlisted(WALLET, entry.scientificName)).toBe(true);

    const nowOff = await toggleWishlist(WALLET, entry);
    expect(nowOff).toBe(false);
    expect(await isWishlisted(WALLET, entry.scientificName)).toBe(false);
  });

  it("lists all wishlisted species for a wallet", async () => {
    await toggleWishlist(WALLET, { scientificName: "Corydoras aeneus", commonName: "Bronze Cory" });
    await toggleWishlist(WALLET, { scientificName: "Betta splendens", commonName: "Betta" });
    const list = await getWishlist(WALLET);
    expect(list).toHaveLength(2);
    expect(list.map((w) => w.speciesKey).sort()).toEqual(["betta splendens", "corydoras aeneus"]);
  });

  it("wishlisting does not award XP (only real keeping does)", async () => {
    const triggerSpy = vi.fn();
    globalThis.triggerXpTracking = triggerSpy;
    await toggleWishlist(WALLET, entry);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("returns false/[] for missing wallet or entry", async () => {
    expect(await toggleWishlist(null, entry)).toBe(false);
    expect(await toggleWishlist(WALLET, null)).toBe(false);
    expect(await isWishlisted(null, "x")).toBe(false);
    expect(await getWishlist(null)).toEqual([]);
  });

  it("is scoped per-wallet — one wallet's wishlist doesn't leak into another's", async () => {
    const otherWallet = "0x00000000000000000000000000000000000BEEF";
    await toggleWishlist(WALLET, entry);
    expect(await getWishlist(otherWallet)).toEqual([]);
    expect(await isWishlisted(otherWallet, entry.scientificName)).toBe(false);
  });
});

describe("computeDexCompletion", () => {
  const catalog4 = [
    { scientificName: "Paracheirodon innesi" },
    { scientificName: "Betta splendens" },
    { scientificName: "Corydoras aeneus" },
    { scientificName: "Danio rerio" },
  ];

  it("computes keptCount/totalCount/percent from the catalog intersection", () => {
    const result = computeDexCompletion(
      [{ speciesKey: "paracheirodon innesi" }, { speciesKey: "betta splendens" }],
      catalog4
    );
    expect(result).toEqual({ keptCount: 2, inCatalogCount: 2, totalCount: 4, percent: 50 });
  });

  it("matches case-insensitively on scientific name", () => {
    const result = computeDexCompletion(
      [{ speciesKey: "paracheirodon innesi" }],
      [{ scientificName: "PARACHEIRODON INNESI" }, { scientificName: "Betta splendens" }]
    );
    expect(result.inCatalogCount).toBe(1);
    expect(result.percent).toBe(50);
  });

  it("does NOT let species outside the catalog inflate the percentage", () => {
    // Three kept species, only one of which is in this catalog. The percentage
    // must reflect 1-of-4, not 3-of-4 — while still reporting all 3 as kept.
    const result = computeDexCompletion(
      [
        { speciesKey: "paracheirodon innesi" },
        { speciesKey: "pterophyllum scalare" }, // not in catalog4
        { speciesKey: "poecilia reticulata" },  // not in catalog4
      ],
      catalog4
    );
    expect(result.keptCount).toBe(3);
    expect(result.inCatalogCount).toBe(1);
    expect(result.percent).toBe(25);
  });

  it("can never exceed 100%", () => {
    const result = computeDexCompletion(
      [{ speciesKey: "paracheirodon innesi" }, { speciesKey: "betta splendens" }, { speciesKey: "danio rerio" }],
      [{ scientificName: "Paracheirodon innesi" }]
    );
    expect(result.percent).toBe(100);
  });

  it("ignores catalog entries with no scientific name (can't be matched honestly)", () => {
    const result = computeDexCompletion([{ speciesKey: "betta splendens" }], [
      { scientificName: "Betta splendens" },
      { speciesId: 7 },
      { scientificName: "" },
    ]);
    expect(result.totalCount).toBe(1);
    expect(result.percent).toBe(100);
  });

  it("never divides by zero for an empty catalog", () => {
    expect(computeDexCompletion([{ speciesKey: "a" }], [])).toEqual({
      keptCount: 1, inCatalogCount: 0, totalCount: 0, percent: 0,
    });
  });

  it("handles empty/missing inputs gracefully", () => {
    expect(computeDexCompletion(null, null)).toEqual({
      keptCount: 0, inCatalogCount: 0, totalCount: 0, percent: 0,
    });
  });
});
