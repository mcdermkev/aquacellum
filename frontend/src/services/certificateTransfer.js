/**
 * certificateTransfer.js — a birth certificate changing hands.
 *
 * docs/BREEDER_STATE_MODEL.md §9.25, T3 §2.5.
 *
 * ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `relayPurchaseSpecimen` transferred ownership with
 * `db.specimens.get(tokenId)` → update **"if it exists"**. On the buyer's device
 * that row does not exist, which is the normal cross-device case, so the transfer
 * silently no-opped and the buyer ended up with an order and no certificate.
 *
 * ── WHY NOT relayMintSpecimen ───────────────────────────────────────────────
 *
 * Tempting, because it already writes a specimen row. It is wrong twice over:
 *
 *   1. It ENQUEUES AN ON-CHAIN MINT. Receiving an existing certificate is not a
 *      birth; minting again would create a second token for one fish.
 *   2. It sets `breeder` from the owner. The breeder is a provenance fact about who
 *      bred the fish (§5) and it must survive every resale — it is the entire thing
 *      a premium price rests on. A buyer is not the breeder.
 *
 * So this module owns the inbound write, and it is the only place outside
 * `relayMintSpecimen` and the cloud pull that creates a `specimens` row.
 *
 * ── THE SERIALS ARE DELIBERATELY DROPPED ────────────────────────────────────
 *
 * The buyer's row gets a NEW local serial (their device's max + 1) and
 * `sireId`/`damId` are set to **0**, not copied from the seller.
 *
 * That looks like data loss and is the opposite. A serial is device-scoped: the
 * seller's `sireId: 7` points at whatever fish is #7 in the BUYER's registry — a
 * real fish, the wrong one, resolving silently (§3, §12.2). Copying those refs would
 * manufacture a false pedigree. Ancestry travels in the attached document instead,
 * which is what "lineage crosses as a document, not a reference" means in practice.
 * `serialAtIssue` inside the document preserves what the number was.
 */

import { db } from "../db";
import { SERIAL_CEILING } from "../utils/specimenIdentity";
import { LIFE_STAGE, canBeCertificated } from "../utils/lifeStage";
import { fetchPedigreeTree } from "./pedigree";
import {
  ATTESTATION_PURPOSE,
  attachAttestation,
  sealPedigreeDocument,
  verifyPedigreeDocument,
} from "./pedigreeDocument";

/** Where a platform attestation is requested (T3 §2.4). */
export const ATTEST_URL = "/api/attest-pedigree";

export const TRANSFER_FAILURE = Object.freeze({
  NO_SPECIMEN: "noSpecimen",
  NO_ISSUER: "noIssuer",
  NO_BUYER: "noBuyer",
  NO_DOCUMENT: "noDocument",
  INVALID_DOCUMENT: "invalidDocument",
  COHORT_STAGE: "cohortStage",
});

function normalizeAddress(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/**
 * Ask the server to attest a pedigree hash.
 *
 * Returns `null` on any failure, and that is deliberate: an unattested document is a
 * *lower trust level*, not an error. `pedigreeTrustLevel` reports it honestly as
 * `unattested`, so a sale must never fail because attestation was unavailable —
 * losing the pedigree entirely would be strictly worse than recording one nobody has
 * signed.
 *
 * @param {string} pedigreeHash
 * @param {{ authToken?: string|null, fetchImpl?: Function, url?: string }} [options]
 * @returns {Promise<object|null>}
 */
export async function requestPlatformAttestation(
  pedigreeHash,
  { authToken = null, fetchImpl, url = ATTEST_URL } = {}
) {
  // No Privy token means no trust root to attest against. Skip rather than send an
  // unauthenticated request that can only 401.
  if (!authToken || !pedigreeHash) return null;

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return null;

  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ pedigreeHash }),
    });
    if (!response?.ok) return null;
    const body = await response.json();
    const attestation = body?.attestation;
    if (!attestation || attestation.purpose !== ATTESTATION_PURPOSE) return null;
    if (attestation.subjectHash !== pedigreeHash) return null;
    return attestation;
  } catch {
    return null;
  }
}

/**
 * Seal (and where possible attest) the pedigree of a certificate being sold.
 *
 * Called on the SELLER's side, where the ancestor records actually live — this is the
 * only moment the full pedigree is readable, which is why the document is captured
 * at fulfillment rather than reconstructed later.
 *
 * @param {object} args
 * @param {number|string} args.specimenId - the seller's local serial
 * @param {string} args.issuer - the selling wallet
 * @param {object|null} [args.contract]
 * @param {string|null} [args.authToken] - Privy access token, for attestation
 * @param {Function} [args.fetchImpl]
 * @returns {Promise<{ok: boolean, document: object|null, attested: boolean, reason: string|null}>}
 */
export async function issueTransferDocument({
  specimenId,
  issuer,
  contract = null,
  authToken = null,
  fetchImpl,
} = {}) {
  const issuerAddress = normalizeAddress(issuer);
  if (!issuerAddress) {
    return { ok: false, document: null, attested: false, reason: TRANSFER_FAILURE.NO_ISSUER };
  }

  const tree = await fetchPedigreeTree(contract, specimenId);
  if (!tree?.target) {
    return { ok: false, document: null, attested: false, reason: TRANSFER_FAILURE.NO_SPECIMEN };
  }

  const local = await db.specimens.get(Number(specimenId)).catch(() => null);

  let document = await sealPedigreeDocument({
    tree,
    issuer: issuerAddress,
    sex: local?.gender || null,
    // The parent documents this fish inherited, when it has any — this is what makes
    // the chain reach back past the seller.
    parentDocuments: {
      sire: local?.pedigreeParentDocuments?.sire || null,
      dam: local?.pedigreeParentDocuments?.dam || null,
    },
    spawnId: local?.spawnId ?? null,
    lotDocumentHash: local?.lotDocumentHash || null,
  });

  const attestation = await requestPlatformAttestation(document.hash, { authToken, fetchImpl });
  if (attestation) {
    try {
      document = attachAttestation(document, attestation);
    } catch {
      // A rejected attestation (credential-shaped, or covering another hash) leaves
      // the document unattested rather than discarding it.
    }
  }

  return { ok: true, document, attested: Boolean(document.attestation), reason: null };
}

/** Next free local serial on THIS device. Mirrors relayMintSpecimen's rule. */
async function nextLocalSerial() {
  const existing = await db.specimens.toArray();
  const maxSerial = existing.reduce((max, s) => {
    const n = Number(s.id);
    return Number.isFinite(n) && n < SERIAL_CEILING && n > max ? n : max;
  }, 0);
  return maxSerial + 1;
}

/**
 * Create the buyer's local record of a certificate they now own.
 *
 * **Idempotent on the document hash.** A purchase webhook firing twice, or a cloud
 * pull racing the local write, must not produce two certificates for one fish — and
 * §4.1 means a duplicate could never be deleted afterwards.
 *
 * @param {object} args
 * @param {object} args.document - a sealed pedigree document
 * @param {string} args.buyerAddress
 * @param {number} [args.tankId] - 0 until the buyer assigns one on arrival
 * @param {string|null} [args.lifeStage]
 * @param {Array<object>} [args.chain] - the ancestor documents that rode along with it
 *   (§9.31). Stored so this buyer can republish them when they sell the fish on;
 *   without that the chain dies at each ownership boundary it crosses.
 * @returns {Promise<{ok: boolean, specimenId: number|null, duplicate: boolean, reason: string|null}>}
 */
export async function receiveTransferredCertificate({
  document,
  buyerAddress,
  tankId = 0,
  lifeStage = LIFE_STAGE.ADULT,
  chain = [],
} = {}) {
  const buyer = normalizeAddress(buyerAddress);
  if (!buyer) {
    return { ok: false, specimenId: null, duplicate: false, reason: TRANSFER_FAILURE.NO_BUYER };
  }
  if (!document?.hash || !document?.body) {
    return { ok: false, specimenId: null, duplicate: false, reason: TRANSFER_FAILURE.NO_DOCUMENT };
  }

  // A document whose hash doesn't match its body is worse than none — it would put a
  // certificate on the buyer's device carrying a pedigree that was edited in transit.
  const { ok: intact } = await verifyPedigreeDocument(document);
  if (!intact) {
    return { ok: false, specimenId: null, duplicate: false, reason: TRANSFER_FAILURE.INVALID_DOCUMENT };
  }

  // §4.2: eggs and fry are counts. A certificate at a cohort-only stage is exactly
  // the confusion the lot model exists to prevent, and `canBeCertificated` fails
  // closed on an unrecorded stage for the same reason.
  if (!canBeCertificated(lifeStage)) {
    return { ok: false, specimenId: null, duplicate: false, reason: TRANSFER_FAILURE.COHORT_STAGE };
  }

  // Full scan rather than an index. `pedigreeHash` is not in the Dexie schema, and
  // adding it means a version bump that runs against every user's local database —
  // too much blast radius for a lookup that happens once per purchase. The same
  // tradeoff `spawns.ownerAddress` already makes (and §9.17 tracks for `archived`).
  // Revisit with the next schema change, not for this.
  const already = await db.specimens
    .filter((s) => s?.pedigreeHash === document.hash)
    .first()
    .catch(() => null);
  if (already) {
    return { ok: true, specimenId: Number(already.id), duplicate: true, reason: null };
  }

  const subject = document.body.subject || {};
  const specimenId = await nextLocalSerial();

  const specimen = {
    id: specimenId,
    speciesId: Number(subject.speciesId) || 0,
    // Provenance facts, carried verbatim from the document. Not re-derived, not
    // refreshed — this is what the buyer bought.
    birthTimestamp: Number(subject.birthTimestamp) || 0,
    breeder: subject.breeder || null,
    commonName: "",
    scientificName: subject.scientificName || "",
    gender: subject.sex || "Unsexed",
    // DROPPED ON PURPOSE — see the module header. The seller's serials name different
    // fish on this device; ancestry lives in `pedigreeDocument` instead.
    sireId: 0,
    damId: 0,
    ownerAddress: buyer,
    currentTankId: Number(tankId) || 0,
    status: 0, // Active
    breederStockTag: "",
    createdAt: Math.floor(Date.now() / 1000),
    lifeStage,
    // Not a mint. There is no on-chain write to wait on here, and claiming
    // `chainStatus: "pending"` would leave a transfer looking like an unconfirmed
    // mint forever.
    onChainId: Number(subject.onChainId) || null,
    chainStatus: "transferred",
    txHash: null,
    ipfsMetadataUri: "",
    metadataStatus: "none",
    // The pedigree, and the portable identity that makes it checkable.
    pedigreeHash: document.hash,
    pedigreeDocument: document,
    // The generations ABOVE this document, kept so they can be republished on resale
    // (§9.31). A hash is only worth anything to a reader who can obtain the document
    // it names, so dropping these would break the chain one boundary later — and the
    // seller would have no way to repair it, since those ancestors were never theirs.
    pedigreeChain: Array.isArray(chain) ? chain : [],
    // So a certificate bred FROM this fish chains to its parents' documents.
    pedigreeParentDocuments: { sire: document.hash, dam: null },
    receivedAt: Math.floor(Date.now() / 1000),
    arrivalStatus: "transit",
  };

  await db.specimens.put(specimen);
  return { ok: true, specimenId, duplicate: false, reason: null };
}

/**
 * Seller → buyer in one call, for a purchase flow.
 *
 * Both halves are reported separately, because they fail independently and a caller
 * needs to know which happened: the document may seal while the buyer-side write is
 * unavailable, and that is recoverable — the document is the durable part.
 */
export async function transferCertificate({
  specimenId,
  seller,
  buyerAddress,
  contract = null,
  authToken = null,
  fetchImpl,
  lifeStage = LIFE_STAGE.ADULT,
} = {}) {
  const issued = await issueTransferDocument({ specimenId, issuer: seller, contract, authToken, fetchImpl });
  if (!issued.ok) {
    return { ok: false, document: null, attested: false, received: null, reason: issued.reason };
  }

  const received = await receiveTransferredCertificate({
    document: issued.document,
    buyerAddress,
    lifeStage,
  });

  return {
    ok: received.ok,
    document: issued.document,
    attested: issued.attested,
    received,
    reason: received.reason,
  };
}
