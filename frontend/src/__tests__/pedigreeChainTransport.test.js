/**
 * The chain has to travel with the fish (docs/BREEDER_STATE_MODEL.md §9.31, T3 §2.6).
 *
 * THE GAP THIS CLOSES. A document references its parents BY HASH, which is what lets
 * generation three reach the original breeder without reading anyone's registry. But a
 * hash is only worth something to a reader who can OBTAIN the document it names, and
 * only the root document rode on the listing. So a third-generation buyer calling
 * `verifyPedigreeChain` got `brokenAt: <parentHash>`, `reason: "missing document for
 * hash"` — correctly reported as a gap rather than a forgery, and still a gap.
 *
 * The scenario these tests walk is §12.3's, one generation further on, because that is
 * where it used to break:
 *
 *   1. A master breeder sells a lot of eggs.  (boundary one)
 *   2. The buyer raises four, promotes a keeper, and lists it.
 *   3. A second buyer buys that keeper.        (boundary two)
 *   4. That buyer must be able to VERIFY the line back to the master breeder,
 *      not merely read a claim about it.
 *
 * What must not happen, and is asserted: the chain must never enter the hashed body.
 * §4.1's immutability rule applies there, and a body that grew each time an ancestor
 * was added would change its own hash and break every child at once.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

const MASTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RAISER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECOND = "0xdddddddddddddddddddddddddddddddddddddddd";
const GRANDBREEDER = "0xcccccccccccccccccccccccccccccccccccccccc";

let specimenRows = [];
let spawnRows = [];

vi.mock("../db", () => ({
  db: {
    specimens: {
      get: async (id) => specimenRows.find((s) => Number(s.id) === Number(id)),
      toArray: async () => specimenRows,
      put: async (row) => { specimenRows.push(row); return row.id; },
      update: async (id, patch) => {
        const row = specimenRows.find((s) => Number(s.id) === Number(id));
        if (row) Object.assign(row, patch);
        return 1;
      },
      filter: (fn) => ({ first: async () => specimenRows.find(fn) }),
      where: () => ({ equals: () => ({ first: async () => undefined }) }),
    },
    spawns: {
      get: async (id) => spawnRows.find((s) => Number(s.spawnId) === Number(id)),
      toArray: async () => spawnRows,
      put: async (row) => { spawnRows.push(row); return row.spawnId; },
      update: async (id, patch) => {
        const row = spawnRows.find((s) => Number(s.spawnId) === Number(id));
        if (row) Object.assign(row, patch);
      },
      filter: (fn) => ({ first: async () => spawnRows.find(fn) }),
    },
    spawnGrowout: {
      add: async () => 1,
      where: () => ({ equals: () => ({ toArray: async () => growoutRows }) }),
    },
    localListings: {
      get: async () => undefined,
      where: () => ({ equals: () => ({ first: async () => undefined }) }),
    },
    marketOrders: { filter: () => ({ first: async () => undefined }) },
  },
}));

let growoutRows = [];

vi.mock("../services/cloudSync", () => ({
  syncSpawnToCloud: async () => {},
  syncGrowoutCheckpointToCloud: async () => {},
}));

// The raiser's device resolves nothing through the contract — every serial here is
// device-scoped (§3), which is the whole reason the chain is documents and not refs.
vi.mock("../services/pedigree", () => ({
  PEDIGREE_DEPTH: 3,
  fetchSpecimenNode: async (_c, id) => {
    const row = specimenRows.find((s) => Number(s.id) === Number(id));
    if (!row) return null;
    return {
      id: row.id, speciesId: row.speciesId ?? 7, scientificName: "Paracheirodon innesi",
      birthTimestamp: row.birthTimestamp ?? 1700000000, breeder: row.breeder || null,
      sireId: row.sireId || 0, damId: row.damId || 0, onChainId: null,
      pedigreeHash: row.pedigreeHash || null,
    };
  },
  fetchPedigreeTree: async (_c, id) => {
    const row = specimenRows.find((s) => Number(s.id) === Number(id));
    if (!row) return null;
    const node = (r) => r && ({
      id: r.id, speciesId: r.speciesId ?? 7, scientificName: "Paracheirodon innesi",
      birthTimestamp: r.birthTimestamp ?? 1700000000, breeder: r.breeder || null,
      sireId: r.sireId || 0, damId: r.damId || 0, onChainId: null,
      pedigreeHash: r.pedigreeHash || null,
    });
    const find = (sid) => specimenRows.find((s) => Number(s.id) === Number(sid));
    return {
      target: node(row),
      parents: { sire: node(find(row.sireId)), dam: node(find(row.damId)) },
      grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
    };
  },
}));

// No minting over RPC; promotion's certificates are recorded straight into the fake.
let nextSerial = 500;
vi.mock("../services/relayer", () => ({
  relayMintSpecimen: async (args) => {
    nextSerial += 1;
    specimenRows.push({
      id: nextSerial,
      speciesId: args.speciesId,
      breeder: args.breeder,
      ownerAddress: args.ownerAddress,
      sireId: args.sireId,
      damId: args.damId,
      birthTimestamp: args.birthTimestamp,
    });
    return { success: true, specimenId: nextSerial };
  },
}));

vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => false,
  supabase: { storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } },
}));

vi.mock("../utils/xp", () => ({
  awardXp: () => {},
  XP_ACTIONS: { MINT_SPECIMEN: { points: 1, label: "x" } },
}));

const { sealLotPedigree, sealSpecimenPedigree, collectPedigreeChain, attachPedigreeToListing } =
  await import("../services/listingPedigree");
const { receivePurchasedLot } = await import("../services/lotIntake");
const { promoteCohortToCertificates } = await import("../services/cohortPromotion");
const { receiveTransferredCertificate } = await import("../services/certificateTransfer");
const { verifyPedigreeChain, traceBreeders, FORBIDDEN_BODY_FIELDS } =
  await import("../services/pedigreeDocument");

beforeEach(() => {
  nextSerial = 500;
  growoutRows = [{ spawnId: 0, timestamp: 1, type: "fry_count", count: 10 }];
  // The MASTER breeder's registry: grandparents 1,2 → parents 10,11 → spawn 900.
  specimenRows = [
    { id: 1, breeder: GRANDBREEDER, ownerAddress: MASTER },
    { id: 2, breeder: GRANDBREEDER, ownerAddress: MASTER },
    { id: 10, breeder: MASTER, ownerAddress: MASTER, sireId: 1, damId: 2 },
    { id: 11, breeder: MASTER, ownerAddress: MASTER, sireId: 0, damId: 0 },
  ];
  spawnRows = [{
    spawnId: 900, sireId: 10, damId: 11, tankId: 1, speciesId: 7,
    ownerAddress: MASTER, timestamp: 1730000000, offspringIds: [],
  }];
});

describe("collectPedigreeChain", () => {
  it("returns nothing for a first-generation document, which is not a failure", async () => {
    // A root with no parent documents is "one generation, fully verifiable" — a real
    // and common state. Reporting it as broken would make every new breeder's fish
    // look defective.
    const { document, chain } = await sealLotPedigree({ spawnId: 900, issuer: MASTER, authToken: null });
    expect(document.body.parentDocuments).toEqual({ sire: null, dam: null });
    expect(chain).toEqual([]);
    await expect(verifyPedigreeChain([document], document.hash))
      .resolves.toMatchObject({ ok: true, checked: 1 });
  });

  it("skips a hash that resolves nowhere rather than inventing a document", async () => {
    specimenRows.push({
      id: 60, breeder: MASTER, ownerAddress: MASTER,
      pedigreeParentDocuments: { sire: "f".repeat(64), dam: null },
    });
    const { document, chain } = await sealSpecimenPedigree({ specimenId: 60, issuer: MASTER, authToken: null });
    expect(document.body.parentDocuments.sire).toBe("f".repeat(64));
    expect(chain).toEqual([]);
    // And the verifier names the specific missing link — a gap, not a forgery.
    const result = await verifyPedigreeChain([document], document.hash);
    expect(result).toMatchObject({ ok: false, brokenAt: "f".repeat(64), reason: "missing document for hash" });
  });
});

describe("two ownership boundaries, and the line still verifies", () => {
  it("walks eggs → lot → promoted keeper → resale and verifies the whole chain", async () => {
    // ── 1. The master breeder lists a lot of eggs ──────────────────────────
    const lot = await sealLotPedigree({ spawnId: 900, issuer: MASTER, authToken: null });
    expect(lot.ok).toBe(true);
    const listing = attachPedigreeToListing({ id: 1, isBatch: true }, lot.document, lot.chain);
    expect(listing.pedigreeDocument.hash).toBe(lot.document.hash);

    // ── 2. Boundary one: the raiser takes delivery ─────────────────────────
    const received = await receivePurchasedLot({
      buyerAddress: RAISER,
      quantity: 10,
      document: listing.pedigreeDocument,
      chain: listing.pedigreeChain,
      lifeStage: "Fry",
    });
    expect(received.ok).toBe(true);
    growoutRows = [{ spawnId: received.spawnId, timestamp: 1, type: "fry_count", count: 4 }];

    // ── 3. The raiser promotes a keeper ───────────────────────────────────
    const promoted = await promoteCohortToCertificates({ spawnId: received.spawnId, count: 1 });
    expect(promoted.success).toBe(true);
    const keeperId = promoted.specimenIds[0];
    const keeper = specimenRows.find((s) => Number(s.id) === keeperId);

    // The breeder survived the boundary (§12.8 decision 1)...
    expect(keeper.breeder).toBe(MASTER);
    // ...and so did the material needed to CHECK it (§9.31).
    expect(keeper.pedigreeParentDocuments).toEqual({ sire: lot.document.hash, dam: null });
    expect(keeper.pedigreeChain.map((d) => d.hash)).toContain(lot.document.hash);

    // ── 4. The raiser lists the keeper on ─────────────────────────────────
    const resale = await sealSpecimenPedigree({ specimenId: keeperId, issuer: RAISER, authToken: null });
    expect(resale.ok).toBe(true);
    expect(resale.document.body.parentDocuments.sire).toBe(lot.document.hash);
    // The lot document is republished by the raiser, who could not possibly have
    // reconstructed it — it was sealed on somebody else's device.
    expect(resale.chain.map((d) => d.hash)).toContain(lot.document.hash);

    // ── 5. THE CRITERION: the second buyer can verify the line ────────────
    const published = attachPedigreeToListing({ id: 2 }, resale.document, resale.chain);
    const verification = await verifyPedigreeChain(
      [published.pedigreeDocument, ...published.pedigreeChain],
      published.pedigreeHash
    );
    expect(verification.ok).toBe(true);
    expect(verification.brokenAt).toBeNull();
    // Two generations of documents actually checked, not one plus a claim.
    expect(verification.checked).toBeGreaterThanOrEqual(2);

    // And the master breeder is reachable from what the buyer holds.
    expect(traceBreeders(published.pedigreeDocument)).toContain(MASTER);

    // ── 6. Boundary two: and the second buyer can pass it on again ────────
    const inherited = await receiveTransferredCertificate({
      document: published.pedigreeDocument,
      buyerAddress: SECOND,
      chain: published.pedigreeChain,
      lifeStage: "Adult",
    });
    expect(inherited.ok).toBe(true);
    const row = specimenRows.find((s) => Number(s.id) === inherited.specimenId);
    expect(row.pedigreeChain.map((d) => d.hash)).toContain(lot.document.hash);
    expect(row.breeder).toBe(MASTER);
  });

  it("would have failed before this: the root alone cannot verify its own chain", async () => {
    // The regression guard. Verifying with ONLY the root — which is what a listing
    // used to publish — must report the specific broken link.
    const lot = await sealLotPedigree({ spawnId: 900, issuer: MASTER, authToken: null });
    const received = await receivePurchasedLot({
      buyerAddress: RAISER, quantity: 4, document: lot.document, chain: lot.chain, lifeStage: "Fry",
    });
    growoutRows = [{ spawnId: received.spawnId, timestamp: 1, type: "fry_count", count: 4 }];
    const promoted = await promoteCohortToCertificates({ spawnId: received.spawnId, count: 1 });
    const resale = await sealSpecimenPedigree({
      specimenId: promoted.specimenIds[0], issuer: RAISER, authToken: null,
    });

    const rootOnly = await verifyPedigreeChain([resale.document], resale.document.hash);
    expect(rootOnly.ok).toBe(false);
    expect(rootOnly.brokenAt).toBe(lot.document.hash);

    const withChain = await verifyPedigreeChain([resale.document, ...resale.chain], resale.document.hash);
    expect(withChain.ok).toBe(true);
  });
});

describe("the chain rides ALONGSIDE, never inside the hashed body", () => {
  it("no sealed body contains a chain, so adding an ancestor cannot change a hash", async () => {
    const { document, chain } = await sealLotPedigree({ spawnId: 900, issuer: MASTER, authToken: null });
    const body = JSON.stringify(document.body);
    expect(body).not.toContain("pedigreeChain");
    expect(body).not.toContain("pedigreeChains");
    expect(document.body).not.toHaveProperty("pedigreeChain");
    // The chain is a sibling of the body, and the body's own hash is unaffected by it.
    expect(Array.isArray(chain)).toBe(true);
  });

  it("still holds none of the mutable fields the body has always banned", async () => {
    // §4.1: a body carrying `status` or `ownerAddress` stops verifying the first time
    // the fish moves. Re-asserted here because §9.31 was the change most likely to
    // smuggle one in.
    const { document } = await sealLotPedigree({ spawnId: 900, issuer: MASTER, authToken: null });
    const body = JSON.stringify(document.body);
    for (const field of FORBIDDEN_BODY_FIELDS) {
      expect(body, field).not.toContain(`"${field}"`);
    }
  });

  it("does not put a chain on a listing that has no pedigree", async () => {
    const bare = attachPedigreeToListing({ id: 9 }, null);
    expect(bare.pedigreeDocument).toBeNull();
    expect(bare.pedigreeChain).toEqual([]);
  });

  it("terminates on a cycle in stored data rather than hanging", async () => {
    // Defensive: two documents naming each other cannot arise from sealing, but they
    // could arise from hand-edited or corrupted local rows.
    const a = { hash: "a".repeat(64), body: { parentDocuments: { sire: "b".repeat(64), dam: null } } };
    const b = { hash: "b".repeat(64), body: { parentDocuments: { sire: "a".repeat(64), dam: null } } };
    specimenRows.push({ id: 70, pedigreeDocument: a, pedigreeChain: [b] });
    const chain = await collectPedigreeChain({
      hash: "c".repeat(64),
      body: { parentDocuments: { sire: a.hash, dam: null } },
    });
    expect(chain.map((d) => d.hash).sort()).toEqual([a.hash, b.hash].sort());
  });
});

describe("source guards", () => {
  const code = (p) =>
    readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("both listing writers publish the chain, not just the root", () => {
    for (const path of ["../components/BatchListingWizard.jsx", "../services/relayer.js"]) {
      expect(code(path), path).toMatch(/attachPedigreeToListing\([\s\S]{0,120}sealed\.chain/);
    }
  });

  it("both intake paths store the chain so it survives the next boundary", () => {
    expect(code("../services/certificateTransfer.js")).toMatch(/pedigreeChain:\s*Array\.isArray\(chain\)/);
    expect(code("../services/lotIntake.js")).toMatch(/pedigreeChain:\s*carried && Array\.isArray\(chain\)/);
  });

  it("promotion hands the lot document down to every keeper", () => {
    const src = code("../services/cohortPromotion.js");
    expect(src).toMatch(/chain:\s*lotDocument\s*\?\s*\[lotDocument,\s*\.\.\.inherited\]/);
    expect(src).toContain("updates.pedigreeChain = lot.chain");
  });

  it("the chain collector stays off the network", () => {
    const src = code("../services/listingPedigree.js");
    expect(src).not.toContain("pullCloudListings");
    expect(src).not.toContain("supabase");
  });
});
