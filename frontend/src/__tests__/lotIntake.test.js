/**
 * A purchased lot arriving on the buyer's device
 * (docs/BREEDER_STATE_MODEL.md §9.25 / §9.26 / §9.27, T3 §2.6).
 *
 * THE GAP: a batch arrival wrote an order row and nothing else. `db.specimens.add`
 * appears nowhere in `frontend/src`, so the buyer got an order and some fish — no
 * cohort to track, no way to promote keepers, and no lineage. The lineage tracker's
 * entire purpose is that a pedigree survives a sale, and it did not.
 *
 * The things worth failing a build over, all of which corrupt provenance silently
 * rather than crashing:
 *
 *   1. The seller's `sireId`/`damId` must NEVER land on the buyer's lot. They name
 *      different fish on this device (§3, §12.2), so promotion would issue
 *      certificates with a false pedigree that resolves and renders — and §4.1 means
 *      those could never be deleted.
 *   2. An egg lot must NOT be counted alive. Not every egg hatches, so a purchased
 *      count written as a living headcount lets ten certificates come out of a clutch
 *      where four hatched.
 *   3. Intake must be idempotent. Same reason as 1: a duplicate cohort is
 *      uncorrectable once anything is promoted out of it.
 *   4. A document that does not verify must be refused, and an ABSENT one must not be.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

const BUYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MASTER = "0xcccccccccccccccccccccccccccccccccccccccc";

/** Buyer-side stores. */
let spawnRows = [];
let growoutRows = [];
let localListingRows = [];
let orderRows = [];
/** Cloud mirror calls, so the lot is aggregable like any other spawn. */
const cloudSpawns = [];
const cloudCheckpoints = [];

vi.mock("../db", () => ({
  db: {
    spawns: {
      get: async (id) => spawnRows.find((s) => Number(s.spawnId) === Number(id)),
      put: async (row) => {
        spawnRows.push(row);
        return row.spawnId;
      },
      filter: (fn) => ({ first: async () => spawnRows.find(fn) }),
    },
    spawnGrowout: {
      add: async (row) => {
        growoutRows.push(row);
        return growoutRows.length;
      },
      where: () => ({ equals: (id) => ({ toArray: async () => growoutRows.filter((r) => r.spawnId === Number(id)) }) }),
    },
    localListings: {
      get: async (id) => localListingRows.find((l) => Number(l.id) === Number(id)),
      where: () => ({
        equals: (listingId) => ({
          first: async () => localListingRows.find((l) => Number(l.listingId) === Number(listingId)),
        }),
      }),
    },
    marketOrders: {
      filter: (fn) => ({ first: async () => orderRows.find(fn) }),
    },
  },
}));

vi.mock("../services/cloudSync", () => ({
  syncSpawnToCloud: async (spawn) => { cloudSpawns.push(spawn); },
  syncGrowoutCheckpointToCloud: async (checkpoint, owner) => { cloudCheckpoints.push({ checkpoint, owner }); },
}));

// `promotableCount` is imported below to assert the real coupling between an intake
// and a promotion. Its module reaches the relayer, which reads `window.ethers` at
// load (trap: services/pedigreeDocument.js documents the same hazard), so the mint
// path is stubbed out — nothing here promotes anything.
vi.mock("../services/relayer", () => ({
  relayMintSpecimen: async () => ({ success: false, error: "not exercised here" }),
}));
vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => false,
  supabase: { storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } },
}));

const {
  LOT_INTAKE_FAILURE,
  LOT_ORIGIN,
  LOT_HEADCOUNT_TYPE,
  LOT_INTAKE_COPY,
  allLotIntakeCopy,
  lotIntakeText,
  receivePurchasedLot,
  resolvePurchasePedigree,
} = await import("../services/lotIntake");
const { sealPedigreeDocument } = await import("../services/pedigreeDocument");
const { summarizeGrowout } = await import("../utils/growoutFunnel");
const { promotableCount } = await import("../services/cohortPromotion");
const { LIFE_STAGE } = await import("../utils/lifeStage");
const { containsProhibitedTerm } = await import("../services/orderCopy");

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SPAWN_TIMESTAMP = 1730000000;

function node(id, breeder = MASTER) {
  return {
    id,
    speciesId: 42,
    scientificName: "Paracheirodon innesi",
    birthTimestamp: SPAWN_TIMESTAMP,
    breeder,
    sireId: 0,
    damId: 0,
    onChainId: null,
  };
}

/**
 * A lot document as `sealLotPedigree` produces it: the SPAWN is the subject, and the
 * real resolved parents are its ancestors. The parents' ids are the SELLER's serials —
 * 7 and 12 — which is precisely what must not reach the buyer's registry.
 */
async function lotDocument(overrides = {}) {
  return sealPedigreeDocument({
    tree: {
      target: { ...node(9001), id: 9001 },
      parents: { sire: node(7), dam: node(12) },
      grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
    },
    issuer: MASTER,
    issuedAt: SPAWN_TIMESTAMP + 100,
    spawnId: 9001,
    ...overrides,
  });
}

beforeEach(() => {
  spawnRows = [];
  growoutRows = [];
  localListingRows = [];
  orderRows = [];
  cloudSpawns.length = 0;
  cloudCheckpoints.length = 0;
});

// ─── The trap ───────────────────────────────────────────────────────────────

describe("the seller's serials never reach the buyer's lot", () => {
  it("writes sireId and damId as 0 even though the document names serials 7 and 12", async () => {
    const document = await lotDocument();
    // Confirm the fixture really does carry them, so this test can't pass vacuously.
    expect(document.body.ancestors.sire.serialAtIssue).toBe(7);
    expect(document.body.ancestors.dam.serialAtIssue).toBe(12);

    const result = await receivePurchasedLot({
      buyerAddress: BUYER,
      quantity: 10,
      document,
      lifeStage: LIFE_STAGE.FRY,
    });

    expect(result.ok).toBe(true);
    const lot = spawnRows[0];
    expect(lot.sireId).toBe(0);
    expect(lot.damId).toBe(0);
  });

  it("keeps ancestry as the document and its hash, which is the same string in every wallet", async () => {
    const document = await lotDocument();
    await receivePurchasedLot({ buyerAddress: BUYER, quantity: 5, document, lifeStage: LIFE_STAGE.FRY });
    const lot = spawnRows[0];
    expect(lot.lotDocumentHash).toBe(document.hash);
    expect(lot.pedigreeDocument).toBe(document);
  });

  it("takes the breeder's species and hatch date off the document, not off the clock", async () => {
    // A lot bought three weeks after the spawn is three weeks old. `Date.now()` here
    // would ride a false hatch date onto every certificate promoted out of it.
    const document = await lotDocument();
    await receivePurchasedLot({ buyerAddress: BUYER, quantity: 5, document, lifeStage: LIFE_STAGE.FRY });
    expect(spawnRows[0].timestamp).toBe(SPAWN_TIMESTAMP);
    expect(spawnRows[0].speciesId).toBe(42);
    expect(spawnRows[0].scientificName).toBe("Paracheirodon innesi");
  });

  it("marks the row as bought, not bred, and attributes it to the buyer", async () => {
    await receivePurchasedLot({
      buyerAddress: BUYER.toUpperCase(),
      quantity: 5,
      document: await lotDocument(),
      lifeStage: LIFE_STAGE.FRY,
      purchaseOrderKey: 77,
    });
    const lot = spawnRows[0];
    expect(lot.origin).toBe(LOT_ORIGIN);
    expect(lot.ownerAddress).toBe(BUYER);
    expect(lot.purchaseOrderKey).toBe(77);
    // Empty until keepers are promoted out — that is what makes the count and the
    // certificates add up (§4.2).
    expect(lot.offspringIds).toEqual([]);
    expect(lot.offspringCount).toBe(5);
  });
});

// ─── The cohort is promotable, which is the point ───────────────────────────

describe("the cohort is immediately countable and promotable", () => {
  it("records a headcount so the funnel reads the purchased quantity as alive", async () => {
    const result = await receivePurchasedLot({
      buyerAddress: BUYER,
      quantity: 8,
      document: await lotDocument(),
      lifeStage: LIFE_STAGE.FRY,
    });
    expect(result.countedAlive).toBe(true);

    const checkpoint = growoutRows.find((r) => r.type === LOT_HEADCOUNT_TYPE);
    expect(checkpoint.count).toBe(8);
    expect(checkpoint.spawnId).toBe(result.spawnId);

    const funnel = summarizeGrowout(growoutRows);
    expect(funnel.alive).toBe(8);
    // The real criterion: `cohortPromotion` will let keepers out of it.
    expect(promotableCount(funnel)).toBeGreaterThan(0);
  });

  it("does NOT count an egg lot alive — not every egg hatches", async () => {
    // The failure this prevents: ten eggs recorded as ten living heads lets a buyer
    // promote ten certificates out of a clutch where four hatched. §4.1 means those
    // six could never be deleted.
    const result = await receivePurchasedLot({
      buyerAddress: BUYER,
      quantity: 10,
      document: await lotDocument(),
      lifeStage: LIFE_STAGE.EGG,
    });

    expect(result.ok).toBe(true);
    expect(result.countedAlive).toBe(false);
    expect(growoutRows).toHaveLength(0);
    expect(summarizeGrowout(growoutRows).alive).toBe(0);
    expect(promotableCount(summarizeGrowout(growoutRows))).toBe(0);
    // And the cohort size is still recorded, so the buyer can see what they bought.
    expect(spawnRows[0].offspringCount).toBe(10);
    expect(result.copyKey).toBe("receivedEggs");
  });

  it("seeds the stored status from the stage rather than defaulting eggs to fry", async () => {
    await receivePurchasedLot({ buyerAddress: BUYER, quantity: 4, lifeStage: LIFE_STAGE.EGG });
    await receivePurchasedLot({ buyerAddress: BUYER, quantity: 4, lifeStage: LIFE_STAGE.FRY });
    expect(spawnRows[0].status).toBe(0); // SPAWN_STATUS.EGG
    expect(spawnRows[1].status).toBe(1); // SPAWN_STATUS.FRY
  });

  it("counts a juvenile lot alive — a lot is a transaction shape, not a life stage", async () => {
    const result = await receivePurchasedLot({
      buyerAddress: BUYER,
      quantity: 5,
      lifeStage: LIFE_STAGE.JUVENILE,
    });
    expect(result.countedAlive).toBe(true);
    expect(summarizeGrowout(growoutRows).alive).toBe(5);
  });

  it("mirrors the lot and its headcount to the cloud, like any other spawn", async () => {
    await receivePurchasedLot({ buyerAddress: BUYER, quantity: 3, lifeStage: LIFE_STAGE.FRY });
    expect(cloudSpawns).toHaveLength(1);
    expect(cloudCheckpoints).toHaveLength(1);
    expect(cloudCheckpoints[0].owner).toBe(BUYER);
  });
});

// ─── Idempotency ────────────────────────────────────────────────────────────

describe("intake is idempotent", () => {
  it("does not open a second cohort for the same document", async () => {
    const document = await lotDocument();
    const first = await receivePurchasedLot({ buyerAddress: BUYER, quantity: 6, document, lifeStage: LIFE_STAGE.FRY });
    const second = await receivePurchasedLot({ buyerAddress: BUYER, quantity: 6, document, lifeStage: LIFE_STAGE.FRY });

    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.spawnId).toBe(first.spawnId);
    expect(spawnRows).toHaveLength(1);
    // And no second headcount, which would have doubled the cohort.
    expect(growoutRows).toHaveLength(1);
    expect(summarizeGrowout(growoutRows).alive).toBe(6);
  });

  it("falls back to the purchase order key when no document came with the lot", async () => {
    const args = { buyerAddress: BUYER, quantity: 4, lifeStage: LIFE_STAGE.FRY, purchaseOrderKey: 31 };
    const first = await receivePurchasedLot(args);
    const second = await receivePurchasedLot(args);
    expect(second.duplicate).toBe(true);
    expect(second.spawnId).toBe(first.spawnId);
    expect(spawnRows).toHaveLength(1);
  });

  it("treats two different lots from the same seller as two cohorts", async () => {
    await receivePurchasedLot({
      buyerAddress: BUYER, quantity: 4, lifeStage: LIFE_STAGE.FRY, purchaseOrderKey: 1,
      document: await lotDocument({ issuedAt: SPAWN_TIMESTAMP + 100 }),
    });
    await receivePurchasedLot({
      buyerAddress: BUYER, quantity: 4, lifeStage: LIFE_STAGE.FRY, purchaseOrderKey: 2,
      document: await lotDocument({ issuedAt: SPAWN_TIMESTAMP + 999 }),
    });
    expect(spawnRows).toHaveLength(2);
    expect(spawnRows[0].spawnId).not.toBe(spawnRows[1].spawnId);
  });
});

// ─── The document: absent is fine, altered is not ──────────────────────────

describe("an absent pedigree is recorded, an altered one is refused", () => {
  it("records the lot with an explicit null when the seller published none", async () => {
    // The buyer bought real fish. Refusing the lot would lose the fish to protect a
    // claim nobody made — and `null` written explicitly lets a reader tell "none
    // published" from "this row predates the feature".
    const result = await receivePurchasedLot({
      buyerAddress: BUYER,
      quantity: 5,
      lifeStage: LIFE_STAGE.FRY,
      speciesId: 42,
      scientificName: "Paracheirodon innesi",
    });
    expect(result.ok).toBe(true);
    expect(result.pedigreeCarried).toBe(false);
    expect(spawnRows[0].pedigreeDocument).toBeNull();
    expect(spawnRows[0].lotDocumentHash).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(spawnRows[0], "pedigreeDocument")).toBe(true);
    // Falls back to what the order knew, rather than leaving the species blank.
    expect(spawnRows[0].speciesId).toBe(42);
  });

  it("refuses a document whose body was edited after sealing, and writes nothing", async () => {
    const document = await lotDocument();
    document.body.ancestors.sire.breeder = BUYER; // claim the master breeder's stock
    const result = await receivePurchasedLot({
      buyerAddress: BUYER, quantity: 5, document, lifeStage: LIFE_STAGE.FRY,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(LOT_INTAKE_FAILURE.INVALID_DOCUMENT);
    expect(spawnRows).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("rejects a missing buyer or an unusable quantity without writing", async () => {
    for (const [args, reason] of [
      [{ buyerAddress: "", quantity: 5 }, LOT_INTAKE_FAILURE.NO_BUYER],
      [{ buyerAddress: BUYER, quantity: 0 }, LOT_INTAKE_FAILURE.NO_QUANTITY],
      [{ buyerAddress: BUYER, quantity: -3 }, LOT_INTAKE_FAILURE.NO_QUANTITY],
      [{ buyerAddress: BUYER, quantity: 2.5 }, LOT_INTAKE_FAILURE.NO_QUANTITY],
      [{ buyerAddress: BUYER }, LOT_INTAKE_FAILURE.NO_QUANTITY],
    ]) {
      const result = await receivePurchasedLot(args);
      expect(result.ok, reason).toBe(false);
      expect(result.reason).toBe(reason);
    }
    expect(spawnRows).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });
});

// ─── Finding the document a purchase arrived with ──────────────────────────

describe("resolvePurchasePedigree", () => {
  it("prefers the copy stashed on the order at purchase time", async () => {
    const document = await lotDocument();
    const found = await resolvePurchasePedigree({ listingId: 5, pedigreeDocument: document });
    expect(found).toBe(document);
  });

  it("finds it on the sibling pending row the card path leaves behind", async () => {
    // The settled `batch` order comes back from the cloud matched on purchase id, so
    // it is a DIFFERENT row from the `fiat_pending` one checkout wrote. Without this
    // step every card purchase would arrive with no pedigree.
    const document = await lotDocument();
    orderRows = [
      { key: 1, orderType: "fiat_pending", listingId: 5, pedigreeDocument: document },
      { key: 2, orderType: "batch", listingId: 5 },
    ];
    expect(await resolvePurchasePedigree(orderRows[1])).toBe(document);
  });

  it("does not hand a row its own document back as if it came from elsewhere", async () => {
    orderRows = [{ key: 2, orderType: "batch", listingId: 5, pedigreeDocument: { hash: "x" } }];
    expect(await resolvePurchasePedigree({ key: 2, listingId: 5 })).toBeNull();
  });

  it("falls back to a local listing row, for the same-device case", async () => {
    const document = await lotDocument();
    localListingRows = [{ id: 5, listingId: 5, pedigreeDocument: document }];
    expect(await resolvePurchasePedigree({ listingId: 5 })).toBe(document);
  });

  it("returns null rather than throwing when there is nothing to find", async () => {
    // An unrecorded pedigree is not an error — the trust ladder reports it honestly,
    // and a buyer must never be blocked from confirming their fish arrived.
    expect(await resolvePurchasePedigree(null)).toBeNull();
    expect(await resolvePurchasePedigree({})).toBeNull();
    expect(await resolvePurchasePedigree({ listingId: 404 })).toBeNull();
    expect(await resolvePurchasePedigree({ listingId: 5, pedigreeDocument: { hash: "x" } })).toBeNull();
  });
});

// ─── Copy ───────────────────────────────────────────────────────────────────

describe("LOT_INTAKE_COPY", () => {
  it("is free of PROHIBITED_TERMS in both modes", () => {
    for (const text of allLotIntakeCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("covers every failure key and every returned copy key", () => {
    for (const key of Object.values(LOT_INTAKE_FAILURE)) {
      expect(LOT_INTAKE_COPY[key], key).toBeTruthy();
    }
    for (const key of ["received", "receivedEggs", "duplicate", "pedigreeCarried", "pedigreeAbsent"]) {
      expect(LOT_INTAKE_COPY[key], key).toBeTruthy();
    }
  });

  it("says plainly that an absent pedigree is absent", () => {
    // §9.28's lesson: a claim rendered from data existing rather than from a trust
    // level is how "verified" got attached to nothing. Assert positively on the
    // denial, per trap 6.9.
    expect(LOT_INTAKE_COPY.pedigreeAbsent.pro).toMatch(/ancestry is unrecorded/);
    expect(LOT_INTAKE_COPY.pedigreeAbsent.casual).toMatch(/don't know their parents/);
  });

  it("interpolates no counts, so the invariant scan stays exhaustive", () => {
    for (const text of allLotIntakeCopy()) {
      expect(text, text).not.toMatch(/\$\{|\bundefined\b|\bNaN\b/);
    }
  });

  it("resolves by mode and falls back rather than rendering a blank", () => {
    expect(lotIntakeText("received")).toBe(LOT_INTAKE_COPY.received.pro);
    expect(lotIntakeText("received", { casual: true })).toBe(LOT_INTAKE_COPY.received.casual);
    expect(lotIntakeText("no-such-key")).toBeTruthy();
  });
});

// ─── Source guards ─────────────────────────────────────────────────────────

describe("source guards", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const INTAKE = code("../services/lotIntake.js");
  const ARRIVAL = code("../components/ArrivalModal.jsx");
  const RELAYER = code("../services/relayer.js");
  const STRIPE = code("../services/stripePayments.js");

  it("never assigns a sireId or damId anything but 0", () => {
    // The single most dangerous line this module could grow. A listing, an order, and
    // a document all carry the seller's serials; none of them may be copied.
    // Asserted on every assignment's VALUE, not on the absence of a pattern, so
    // `sireId: order.sireId` fails loudly the day somebody adds it.
    const assignments = INTAKE.match(/\b(?:sireId|damId)\s*:\s*[^\s,}]+/g) || [];
    expect(assignments).toHaveLength(2);
    for (const assignment of assignments) {
      expect(assignment).toMatch(/:\s*0$/);
    }
  });

  it("verifies the document before storing it", () => {
    expect(INTAKE).toContain("verifyPedigreeDocument(document)");
  });

  it("does not reach the network to find a pedigree", () => {
    // `pullCloudListings` between a buyer and confirming their fish arrived would
    // make an arrival fail when they are offline in a fish room.
    expect(INTAKE).not.toContain("pullCloudListings");
    expect(INTAKE).not.toContain("supabase");
  });

  it("wires the batch arrival to the cohort, and the specimen arrival to the certificate", () => {
    expect(ARRIVAL).toContain("receivePurchasedLot(");
    expect(ARRIVAL).toContain("receiveTransferredCertificate(");
    // The received serial is used for the move, NOT the seller's `item.id`.
    expect(ARRIVAL).toMatch(/specimenId\s*=\s*received\.specimenId/);
    expect(ARRIVAL).toMatch(/specimenId:\s*Number\(specimenId\)/);
  });

  it("captures the pedigree onto the order at purchase, which is the only moment it can", () => {
    expect(RELAYER).toMatch(/pedigreeDocument:\s*pedigreeDocument\s*\|\|\s*null/);
    expect(STRIPE).toMatch(/pedigreeDocument:\s*pedigreeDocument\s*\|\|\s*null/);
  });

  it("keeps the pedigree OUT of the payment request", () => {
    // A provenance document has no business on a checkout payload, and the server
    // does nothing with it. It goes on the local pending row only, via the
    // third argument — so the `items` array must not mention it.
    const items = STRIPE.match(/items:\s*\[\{[\s\S]*?\}\]/g) || [];
    expect(items.length).toBeGreaterThan(0);
    for (const block of items) {
      expect(block).not.toContain("pedigree");
    }
    expect(STRIPE).toMatch(/_recordPendingPurchase\(payload,\s*data\.sessionId,\s*localOnly\)/);
  });
});
