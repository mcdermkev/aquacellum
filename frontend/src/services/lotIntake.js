/**
 * lotIntake.js — a purchased lot arriving on the buyer's device.
 *
 * docs/BREEDER_STATE_MODEL.md §9.25 / §9.26 / §9.27, T3 §2.6. This is the buyer-side
 * half of the pedigree crossing an ownership boundary. `services/listingPedigree.js`
 * seals the document on the seller's device at listing time; this consumes it.
 *
 * ── WHAT A LOT IS ───────────────────────────────────────────────────────────
 *
 * §12.4: **a lot is a cohort that changed hands.** Ten eggs sold and four hatched
 * means the buyer has four fish, not ten certificates with six deceased. So the
 * inbound shape is not a list of certificates — it is one spawn-shaped row with a
 * count, exactly like a spawn the buyer bred themselves. After that,
 * `spawnGrowout` checkpoints and `cohortPromotion.promoteCohortToCertificates` work
 * unchanged, and §4.1 (a certificate is never destroyed) and §4.2 (eggs and fry are
 * counts) both stand without amendment.
 *
 * That is also why §9.26 — "a sale never decrements the cohort" — closes here rather
 * than as its own fix. A lot decrements because promotion decrements.
 *
 * Note "lot" is a TRANSACTION shape, not a life stage. A buyer who bought 5 of a
 * seller's 20 juveniles also received a count, not five certificates, so juvenile and
 * adult lots take this same path. Life stage decides one thing only: whether anything
 * is alive to count yet (see the checkpoint note below).
 *
 * ── THE TRAP THIS MODULE EXISTS TO AVOID ────────────────────────────────────
 *
 * A batch listing carries the seller's `sireId`/`damId`, copied off their spawn
 * (`BatchListingWizard`). **They are never copied onto the buyer's lot.** They are
 * device-scoped local serials (§3, §12.2): the seller's `sireId: 7` names whatever
 * fish is #7 in the BUYER's registry — a real fish, the wrong one, resolving with no
 * error. Promotion would then issue certificates with a false pedigree, silently and
 * permanently, since a certificate is never destroyed.
 *
 * So the lot's `sireId`/`damId` are **0**, and ancestry lives in the attached
 * document. A source guard asserts the listing's serials are not read here.
 *
 * ── AN ABSENT PEDIGREE IS RECORDED, NOT INVENTED ────────────────────────────
 *
 * A lot with no document is still recorded, with `pedigreeDocument: null` written
 * explicitly. The buyer bought real fish and needs to be able to raise and promote
 * them; refusing the lot would lose the fish to protect a claim nobody made. A lot
 * whose document is present but does NOT verify is refused, because that is a claim
 * that has been altered — worse than absent (§12.1, and the same bias as
 * `receiveTransferredCertificate`).
 */

import { db } from "../db";
import { SPAWN_STATUS } from "../utils/specimenIdentity";
import { LIFE_STAGE, normalizeLifeStage } from "../utils/lifeStage";
import { verifyPedigreeDocument } from "./pedigreeDocument";
import { syncSpawnToCloud, syncGrowoutCheckpointToCloud } from "./cloudSync";

/** The checkpoint type that establishes a living headcount. Mirrors GROWOUT_TYPES. */
export const LOT_HEADCOUNT_TYPE = "fry_count";

/** Marks a spawn row as bought rather than bred. Self-describing for later readers. */
export const LOT_ORIGIN = "purchasedLot";

export const LOT_INTAKE_FAILURE = Object.freeze({
  NO_BUYER: "noBuyer",
  NO_QUANTITY: "noQuantity",
  INVALID_DOCUMENT: "invalidDocument",
});

// ─── Copy ───────────────────────────────────────────────────────────────────
//
// Static strings, per convention 5: counts travel on the result object, never
// interpolated, so the PROHIBITED_TERMS invariant scan stays exhaustive.

export const LOT_INTAKE_COPY = Object.freeze({
  noBuyer: Object.freeze({
    pro: "No account is signed in, so this lot can't be attributed to an owner.",
    casual: "We don't know whose fish these are yet.",
  }),
  noQuantity: Object.freeze({
    pro: "This order records no quantity, so there is no cohort to open.",
    casual: "We don't know how many fish arrived.",
  }),
  invalidDocument: Object.freeze({
    pro: "The attached pedigree does not match its own record, so it was not accepted.",
    casual: "The family tree that came with these doesn't add up, so we left it out.",
  }),
  received: Object.freeze({
    pro: "Recorded as a cohort. Log survivors as they grow, and promote the ones you keep to their own certificates.",
    casual: "Added as a batch. Tell us how many make it, and give a record to each one you keep.",
  }),
  receivedEggs: Object.freeze({
    // Nothing is alive to count yet, and the buyer has to be told why the cohort
    // reads as empty rather than assuming it failed to save.
    pro: "Recorded as a cohort of eggs. Nothing is counted alive until you log what hatches.",
    casual: "Added as a batch of eggs. Once they hatch, tell us how many babies you have.",
  }),
  pedigreeCarried: Object.freeze({
    pro: "The seller's pedigree came with this lot and stays with the fish you raise from it.",
    casual: "The family tree came with these, and it stays with any you raise.",
  }),
  pedigreeAbsent: Object.freeze({
    // Honest absence. Never softened into something that reads like a pedigree.
    pro: "No pedigree was published with this lot, so its ancestry is unrecorded.",
    casual: "No family tree came with these, so we don't know their parents.",
  }),
  duplicate: Object.freeze({
    pro: "This lot is already recorded. Nothing was added a second time.",
    casual: "These are already saved, so we didn't add them twice.",
  }),
});

/** Every copy string, flattened — used by the language invariant test. */
export function allLotIntakeCopy() {
  const out = [];
  for (const entry of Object.values(LOT_INTAKE_COPY)) out.push(entry.pro, entry.casual);
  return out;
}

/** Resolve a copy key for the reader's mode. */
export function lotIntakeText(key, { casual = false } = {}) {
  const entry = LOT_INTAKE_COPY[key];
  if (!entry) return LOT_INTAKE_COPY.noQuantity[casual ? "casual" : "pro"];
  return entry[casual ? "casual" : "pro"];
}

function normalizeAddress(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function looksLikeDocument(value) {
  return !!value && typeof value === "object" && typeof value.hash === "string" && !!value.body;
}

/**
 * Find the pedigree document that came with a purchase.
 *
 * Precedence, and the order matters:
 *
 *   1. The order row itself. The in-person and local batch paths write it there
 *      directly at purchase time (`relayPurchaseBatch`).
 *   2. A SIBLING pending-purchase row for the same listing. The card path needs this:
 *      the buyer is redirected to Stripe and the settled `batch` order comes back
 *      from the cloud via `ordersSync`, matched on `on_chain_purchase_id` — so it is
 *      a different row from the `fiat_pending` one `purchaseBatch` wrote, and the
 *      document lives on the latter.
 *   3. A local listing row, for the same-device case (a seller confirming their own
 *      test purchase) and for orders that predate 1 and 2.
 *
 * There is deliberately **no cloud read**. `db.listings` is cleared and refilled from
 * on-chain data by `useMarketplaceListings`, so it carries no document, and
 * `pullCloudListings` is a live network call that must not sit between a buyer and
 * confirming their fish arrived. A document that cannot be found is an unrecorded
 * pedigree, which the trust ladder reports honestly — it is not an error.
 *
 * @param {object} order - a `marketOrders` row
 * @returns {Promise<object|null>}
 */
export async function resolvePurchasePedigree(order) {
  if (!order || typeof order !== "object") return null;

  if (looksLikeDocument(order.pedigreeDocument)) return order.pedigreeDocument;

  const listingId = order.listingId ?? order.tokenId ?? order.id;
  if (listingId == null) return null;

  try {
    const pending = await db.marketOrders
      .filter(
        (o) =>
          o?.pedigreeDocument &&
          Number(o.listingId) === Number(listingId) &&
          // Not this same row, and not another buyer's.
          (order.key == null || o.key !== order.key)
      )
      .first();
    if (looksLikeDocument(pending?.pedigreeDocument)) return pending.pedigreeDocument;
  } catch {
    // No table or no rows — "not found" is a valid answer here.
  }

  try {
    const byListingId = await db.localListings.where("listingId").equals(Number(listingId)).first();
    if (looksLikeDocument(byListingId?.pedigreeDocument)) return byListingId.pedigreeDocument;
  } catch {
    // No index, no rows, or no table — all mean "not found", which is a valid answer.
  }

  try {
    const byId = await db.localListings.get(Number(listingId));
    if (looksLikeDocument(byId?.pedigreeDocument)) return byId.pedigreeDocument;
  } catch {
    // Same.
  }

  return null;
}

/** A local spawn id no existing row is using. Matches `relaySpawn`'s `Date.now()`. */
async function nextFreeSpawnId() {
  let candidate = Date.now();
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const taken = await db.spawns.get(candidate).catch(() => null);
    if (!taken) return candidate;
    candidate += 1;
  }
  return candidate;
}

/**
 * Has this lot already been taken in?
 *
 * Checked on the document hash first — the same string in every wallet, which is the
 * whole point of the document — and on the purchase order key otherwise. §4.1 makes
 * a duplicate uncorrectable once anything is promoted out of it, so this is not an
 * optimization.
 */
async function findExistingLot({ documentHash, purchaseOrderKey }) {
  try {
    if (documentHash) {
      const byHash = await db.spawns.filter((s) => s?.lotDocumentHash === documentHash).first();
      if (byHash) return byHash;
    }
    if (purchaseOrderKey != null) {
      const byOrder = await db.spawns
        .filter((s) => s?.purchaseOrderKey != null && String(s.purchaseOrderKey) === String(purchaseOrderKey))
        .first();
      if (byOrder) return byOrder;
    }
  } catch {
    // A failed scan must not become a second lot. Fall through to "not found" only
    // because the caller's alternative is losing the fish entirely; the order-key
    // check above is the cheap guard against the common double-submit.
  }
  return null;
}

/**
 * Record a purchased lot on the buyer's device.
 *
 * @param {object} args
 * @param {string} args.buyerAddress
 * @param {number} args.quantity - how many were bought
 * @param {object|null} [args.document] - the sealed pedigree that rode on the listing
 * @param {string|null} [args.lifeStage] - what stage arrived; `null` is unrecorded
 * @param {number} [args.tankId] - grow-out tank, 0 when unassigned
 * @param {number|string|null} [args.purchaseOrderKey] - the `marketOrders.key`
 * @param {number|null} [args.speciesId] - fallback when no document is attached
 * @param {string} [args.scientificName] - fallback when no document is attached
 * @returns {Promise<{
 *   ok: boolean, spawnId: number|null, duplicate: boolean, quantity: number,
 *   pedigreeCarried: boolean, countedAlive: boolean, copyKey: string, reason: string|null
 * }>}
 */
export async function receivePurchasedLot({
  buyerAddress,
  quantity,
  document = null,
  lifeStage = null,
  tankId = 0,
  purchaseOrderKey = null,
  speciesId = null,
  scientificName = "",
} = {}) {
  const buyer = normalizeAddress(buyerAddress);
  const count = Number(quantity);

  const failure = (reason) => ({
    ok: false,
    spawnId: null,
    duplicate: false,
    quantity: Number.isFinite(count) ? count : 0,
    pedigreeCarried: false,
    countedAlive: false,
    copyKey: reason,
    reason,
  });

  if (!buyer) return failure(LOT_INTAKE_FAILURE.NO_BUYER);
  if (!Number.isInteger(count) || count < 1) return failure(LOT_INTAKE_FAILURE.NO_QUANTITY);

  // A document that does not verify has been altered since it was sealed. Refuse it
  // rather than storing a pedigree the buyer would later show to somebody else.
  let carried = null;
  if (document) {
    const { ok } = await verifyPedigreeDocument(document);
    if (!ok) return failure(LOT_INTAKE_FAILURE.INVALID_DOCUMENT);
    carried = document;
  }

  const documentHash = carried?.hash || null;
  const existing = await findExistingLot({ documentHash, purchaseOrderKey });
  if (existing) {
    return {
      ok: true,
      spawnId: Number(existing.spawnId),
      duplicate: true,
      quantity: count,
      pedigreeCarried: !!existing.lotDocumentHash,
      countedAlive: false,
      copyKey: "duplicate",
      reason: null,
    };
  }

  const subject = carried?.body?.subject || {};
  const stage = normalizeLifeStage(lifeStage);
  const spawnId = await nextFreeSpawnId();
  const now = Math.floor(Date.now() / 1000);

  const lot = {
    spawnId,
    // ⚠️ ZERO, NEVER THE LISTING'S SERIALS. See the module header — copying them
    // names different fish on this device and forges a pedigree that resolves.
    sireId: 0,
    damId: 0,
    tankId: Number(tankId) || 0,
    speciesId: Number(subject.speciesId ?? speciesId) || 0,
    scientificName: subject.scientificName || scientificName || "",
    // Eggs have not hatched, so the stored status says so. `deriveSpawnStatus` still
    // derives the live reading from checkpoints (§9.6); this is only the seed.
    status: stage === LIFE_STAGE.EGG ? SPAWN_STATUS.EGG : SPAWN_STATUS.FRY,
    offspringIds: [],
    // The cohort's size as bought. `offspringIds` stays empty until the buyer
    // promotes keepers out of it, which is what makes the count and the
    // certificates add up (§4.2).
    offspringCount: count,
    ownerAddress: buyer,
    // When the cohort came into being, off the document — not `now`. A lot bought
    // three weeks after the spawn is three weeks old, and a false hatch date would
    // ride onto every certificate promoted out of it.
    timestamp: Number(subject.birthTimestamp) || now,
    receivedAt: now,
    origin: LOT_ORIGIN,
    lifeStage: stage,
    purchaseOrderKey: purchaseOrderKey == null ? null : purchaseOrderKey,
    // The pedigree, and `null` written EXPLICITLY when there is none, so a reader can
    // tell "this seller published none" from "this row predates the feature".
    lotDocumentHash: documentHash,
    pedigreeDocument: carried,
    metadata: null,
  };

  await db.spawns.put(lot);
  syncSpawnToCloud(lot).catch(() => {});

  // ── The headcount ────────────────────────────────────────────────────────
  //
  // `summarizeGrowout` derives `alive` from the highest `fry_count` minus
  // departures, and `promotableCount` reads `alive` — so without a checkpoint the
  // cohort reads as empty and nothing can be promoted out of it.
  //
  // Eggs get NO checkpoint, deliberately. Not every egg hatches
  // (`LIFE_STAGE_COPY.hatchRisk`), so writing the purchased count as a living
  // headcount would let a buyer promote ten certificates out of a clutch where four
  // hatched. The buyer logs a real `fry_count` at hatch. An egg cohort reading as
  // 0 alive is correct, and `receivedEggs` copy exists to say so.
  const countedAlive = stage !== LIFE_STAGE.EGG;
  if (countedAlive) {
    const checkpoint = {
      spawnId,
      timestamp: now,
      type: LOT_HEADCOUNT_TYPE,
      count,
      note: "Arrived from a purchased lot",
      photo: null,
    };
    await db.spawnGrowout.add(checkpoint);
    syncGrowoutCheckpointToCloud(checkpoint, buyer).catch(() => {});
  }

  return {
    ok: true,
    spawnId,
    duplicate: false,
    quantity: count,
    pedigreeCarried: !!documentHash,
    countedAlive,
    copyKey: countedAlive ? "received" : "receivedEggs",
    reason: null,
  };
}
