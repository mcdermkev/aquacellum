/**
 * listingPedigree.js — sealing the pedigree at LISTING time.
 *
 * docs/BREEDER_STATE_MODEL.md §9.30, T3 §2.5. This is the transport decision, made:
 * the document is sealed by the seller when they create the listing, and it rides on
 * the listing to the buyer.
 *
 * ── WHY LISTING TIME AND NOT FULFILLMENT ────────────────────────────────────
 *
 * The spec originally said "seal at fulfillment". That is not implementable here.
 * Settlement runs in the Stripe webhook (`api/stripe.js`), **server-side**, and the
 * pedigree lives in the **seller's browser** — §3 makes Dexie authoritative for
 * serial → specimen resolution precisely because the contract cannot be trusted for
 * it. A Vercel function cannot read that IndexedDB, so at fulfillment the pedigree is
 * unreadable.
 *
 * Listing time is the moment the seller's device has everything: the specimen, its
 * parents, its grandparents, and an authenticated wallet to attest with.
 *
 * ── WHY THIS NEEDS NO MIGRATION ─────────────────────────────────────────────
 *
 * `aquadex_listings.data` is a jsonb column holding the **full listing object**
 * ("same shape as Dexie localListings" — 20260618_cloud_listings_table.sql). So a
 * document added to the listing syncs to the cloud and reaches other users with no
 * schema change and no new table.
 *
 * ── THE COHORT CASE IS NOT A SPECIMEN ───────────────────────────────────────
 *
 * A batch listing sells fry that have no individual records — §4.2, they are counts.
 * So `sealLotPedigree` builds the tree with the SPAWN as the subject and the real
 * resolved sire/dam/grandparents as its ancestors. The claim is "this cohort came from
 * these parents", which is exactly what a buyer of eggs is paying for, and it is true
 * without inventing a certificate for anything unhatched.
 */

import { db } from "../db";
import { fetchSpecimenNode, fetchPedigreeTree } from "./pedigree";
import { sealPedigreeDocument, attachAttestation } from "./pedigreeDocument";
import { requestPlatformAttestation } from "./certificateTransfer";
import { LIFE_STAGE, normalizeLifeStage, requiresCohort } from "../utils/lifeStage";

export const LISTING_PEDIGREE_FAILURE = Object.freeze({
  NO_SPAWN: "noSpawn",
  NO_SPECIMEN: "noSpecimen",
  NO_ISSUER: "noIssuer",
  NO_PARENTS: "noParents",
});

// ─── The attestation token bridge ───────────────────────────────────────────
//
// Listing time was chosen partly BECAUSE the seller has an authenticated session
// here (see the header). The first version of this module never used it: both seal
// functions took an optional `authToken` and every caller omitted it, so
// `requestPlatformAttestation` returned null and **every document this app issued
// was unattested** — not because the keypair is unset, but because nothing ever
// asked for an attestation. That would have stayed invisible after the keypair
// landed, since `unattested` is a legitimate state the trust ladder reports
// honestly rather than an error.
//
// So the token is resolved here by default. Same bridge pattern as
// `services/parcelPresets.js` / `shipping.js` / `reviewsApi.js`, registered from
// `contexts/AuthContext.jsx`: a Privy `getAccessToken`, which is the trust root
// `/api/attest-pedigree` verifies. Cleared when the user is not Privy-authenticated,
// in which case sealing still succeeds and the document is honestly unattested.

let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    // An unavailable token is a lower trust level, never a failed listing.
    console.warn("[ListingPedigree] Could not resolve session token:", err.message);
    return null;
  }
}

function normalizeAddress(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/**
 * Build a pedigree tree whose subject is a SPAWN rather than a specimen.
 *
 * The cohort has no individual record to be the target, so the spawn stands in: its
 * `sireId`/`damId` are the real parents, and their parents are the grandparents. The
 * shape matches `fetchPedigreeTree`'s so `buildPedigreeBody` can consume it unchanged.
 */
async function lotTreeFromSpawn(contract, spawn) {
  const [sire, dam] = await Promise.all([
    spawn.sireId ? fetchSpecimenNode(contract, spawn.sireId) : null,
    spawn.damId ? fetchSpecimenNode(contract, spawn.damId) : null,
  ]);

  const [sireSire, sireDam, damSire, damDam] = await Promise.all([
    sire?.sireId ? fetchSpecimenNode(contract, sire.sireId) : null,
    sire?.damId ? fetchSpecimenNode(contract, sire.damId) : null,
    dam?.sireId ? fetchSpecimenNode(contract, dam.sireId) : null,
    dam?.damId ? fetchSpecimenNode(contract, dam.damId) : null,
  ]);

  return {
    // The cohort as subject. `id` is the spawn id, so `serialAtIssue` records which
    // spawn this lot came out of rather than pretending to be a certificate serial.
    target: {
      id: spawn.spawnId,
      speciesId: spawn.speciesId,
      scientificName: spawn.scientificName || "",
      birthTimestamp: spawn.timestamp || 0,
      breeder: spawn.ownerAddress,
      sireId: spawn.sireId,
      damId: spawn.damId,
      onChainId: null,
    },
    parents: { sire, dam },
    grandparents: { sireSire, sireDam, damSire, damDam },
  };
}

/**
 * Seal the pedigree of a cohort being listed (eggs or fry).
 *
 * @param {object} args
 * @param {number|string} args.spawnId
 * @param {string} args.issuer - the selling wallet
 * @param {object|null} [args.contract]
 * @param {string|null} [args.authToken]
 * @param {Function} [args.fetchImpl]
 * @returns {Promise<{ok: boolean, document: object|null, attested: boolean, reason: string|null}>}
 */
export async function sealLotPedigree({
  spawnId,
  issuer,
  contract = null,
  // `undefined` means "resolve it from the registered session". An explicit `null`
  // still means "do not attest", so tests and offline paths keep that control.
  authToken,
  fetchImpl,
} = {}) {
  const token = authToken === undefined ? await getSessionToken() : authToken;
  const issuerAddress = normalizeAddress(issuer);
  if (!issuerAddress) {
    return { ok: false, document: null, chain: [], attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_ISSUER };
  }

  const spawn = await db.spawns.get(Number(spawnId)).catch(() => null);
  if (!spawn) {
    return { ok: false, document: null, chain: [], attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_SPAWN };
  }

  const tree = await lotTreeFromSpawn(contract, spawn);

  // A cohort with no resolvable parents has no pedigree to sell. Returning a document
  // with six null ancestors would be technically valid and commercially misleading —
  // it would render as "pedigree attached" while proving nothing. An honest absence is
  // better than an empty claim (the §12.1 rule).
  if (!tree.parents.sire && !tree.parents.dam) {
    return { ok: false, document: null, chain: [], attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_PARENTS };
  }

  let document = await sealPedigreeDocument({
    tree,
    issuer: issuerAddress,
    spawnId: spawn.spawnId,
    // A cohort's parents may themselves carry documents, which is what lets a lot
    // bought from a buyer who bought a lot still chain back.
    parentDocuments: {
      sire: tree.parents.sire?.pedigreeHash || null,
      dam: tree.parents.dam?.pedigreeHash || null,
    },
  });

  const attestation = await requestPlatformAttestation(document.hash, { authToken: token, fetchImpl });
  if (attestation) {
    try {
      document = attachAttestation(document, attestation);
    } catch {
      // Leaves it unattested rather than discarding the pedigree.
    }
  }

  return {
    ok: true,
    document,
    // The ancestors this document's hashes name, so the buyer can verify the chain
    // and not merely read the root (§9.31).
    chain: await collectPedigreeChain(document),
    attested: Boolean(document.attestation),
    reason: null,
  };
}

/**
 * Seal the pedigree of an individual certificate being listed.
 *
 * Thin wrapper over the transfer path — the document is identical, because "what this
 * fish's ancestry is" does not depend on why it was sealed.
 */
export async function sealSpecimenPedigree({ specimenId, issuer, contract = null, authToken, fetchImpl } = {}) {
  const token = authToken === undefined ? await getSessionToken() : authToken;
  const { issueTransferDocument } = await import("./certificateTransfer");
  const result = await issueTransferDocument({ specimenId, issuer, contract, authToken: token, fetchImpl });
  return {
    ...result,
    chain: result.ok ? await collectPedigreeChain(result.document) : [],
    reason: result.reason === "noSpecimen" ? LISTING_PEDIGREE_FAILURE.NO_SPECIMEN : result.reason,
  };
}

// ─── The chain has to travel too (§9.31) ────────────────────────────────────
//
// A document references its parents BY HASH, which is what lets generation three
// reach the original breeder. But a hash is only useful to a reader who can obtain
// the document it names, and until now only the ROOT document rode on the listing.
// So a third-generation buyer calling `verifyPedigreeChain` got
// `brokenAt: <parentHash>`, `reason: "missing document for hash"` — correctly
// reported as a gap rather than a forgery, and still a gap.
//
// The fix is to publish the ancestor documents ALONGSIDE the root. Deliberately not
// inside the hashed body: §4.1's immutability rule and `FORBIDDEN_BODY_FIELDS` both
// apply there, and a body that grew every time an ancestor was added would change its
// own hash and break every child. A guard test asserts `pedigreeChain` never appears
// in a sealed body.
//
// The alternative — a fetch by hash from a public bucket — was NOT taken. It needs a
// publicly readable pedigree store, and a pedigree names ancestor breeders' wallet
// addresses, so exposing one to unauthenticated readers reveals other breeders' stock
// relationships rather than just the seller's. That is a privacy decision, and this
// approach does not force it: the chain inherits whatever visibility the listing
// already has.

/** How deep to walk when collecting a chain. Guards against a cycle in stored data. */
const MAX_CHAIN_DEPTH = 32;

/**
 * Every locally-known document a root document's chain references.
 *
 * Walks `body.parentDocuments` hash by hash and resolves each from the stores that
 * actually hold them on this device:
 *
 *   - `specimens.pedigreeDocument`  — a certificate received by transfer
 *   - `spawns.pedigreeDocument`     — a purchased lot
 *   - either row's `pedigreeChain`  — ancestors that arrived with an earlier purchase,
 *                                     which is what makes this compose past generation two
 *
 * A hash that resolves nowhere is skipped, not faked. The reader then gets the same
 * honest gap as before for that link, which is strictly better than a fabricated
 * document and is why `verifyPedigreeChain` reports the specific hash.
 *
 * @param {object|null} rootDocument
 * @returns {Promise<Array<object>>} ancestors only; the root is NOT included
 */
export async function collectPedigreeChain(rootDocument) {
  if (!rootDocument?.body) return [];

  const known = new Map();
  try {
    const [specimens, spawns] = await Promise.all([
      db.specimens.toArray().catch(() => []),
      db.spawns.toArray().catch(() => []),
    ]);
    for (const row of [...specimens, ...spawns]) {
      if (row?.pedigreeDocument?.hash) known.set(row.pedigreeDocument.hash, row.pedigreeDocument);
      for (const doc of Array.isArray(row?.pedigreeChain) ? row.pedigreeChain : []) {
        if (doc?.hash) known.set(doc.hash, doc);
      }
    }
  } catch {
    // No stores readable means no ancestors publishable. The root still ships.
    return [];
  }

  const out = [];
  const seen = new Set([rootDocument.hash]);
  let frontier = parentHashesOf(rootDocument);

  for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.length > 0; depth += 1) {
    const next = [];
    for (const hash of frontier) {
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const doc = known.get(hash);
      if (!doc) continue; // an honest gap, reported by the verifier
      out.push(doc);
      next.push(...parentHashesOf(doc));
    }
    frontier = next;
  }

  return out;
}

function parentHashesOf(document) {
  const parents = document?.body?.parentDocuments || {};
  return [parents.sire, parents.dam].filter((h) => typeof h === "string" && h);
}

/**
 * Put a sealed document onto a listing object.
 *
 * Returns a NEW listing; the input is not mutated. Both the hash and the document go
 * on: the hash so a reader can index and compare without parsing, the document so the
 * pedigree travels even to a client that cannot reach our storage.
 *
 * @param {object} listing
 * @param {object|null} document
 * @param {Array<object>} [chain] - ancestor documents, so the buyer can VERIFY the
 *   chain rather than just read the root's claims (§9.31)
 */
export function attachPedigreeToListing(listing, document, chain = []) {
  if (!listing || typeof listing !== "object") return listing;
  if (!document?.hash) {
    // Explicitly recorded as absent rather than left undefined, so a reader can tell
    // "this seller published no pedigree" from "this field predates the feature".
    return { ...listing, pedigreeHash: null, pedigreeDocument: null, pedigreeChain: [] };
  }
  return {
    ...listing,
    pedigreeHash: document.hash,
    pedigreeDocument: document,
    pedigreeChain: Array.isArray(chain) ? chain : [],
  };
}

/**
 * Seal whatever kind of pedigree this listing needs, chosen by life stage.
 *
 * Eggs and fry are cohorts (§4.2) and take the spawn path; anything individually
 * tracked takes the specimen path. `requiresCohort` fails OPEN on an unrecorded
 * stage, so a legacy listing with no stage is treated by whichever id it actually
 * carries rather than being forced down the cohort route.
 *
 * @param {object} args
 * @param {object} args.listing - must carry `spawnId` or `id`/`tokenId`
 * @param {string} args.issuer
 */
export async function sealListingPedigree({
  listing,
  issuer,
  contract = null,
  authToken,
  fetchImpl,
} = {}) {
  const stage = normalizeLifeStage(listing?.lifeStage);
  const isCohort = requiresCohort(stage) || (listing?.isBatch && listing?.spawnId != null);

  if (isCohort) {
    return sealLotPedigree({ spawnId: listing.spawnId, issuer, contract, authToken, fetchImpl });
  }
  const specimenId = listing?.tokenId ?? listing?.specimenId ?? listing?.id;
  return sealSpecimenPedigree({ specimenId, issuer, contract, authToken, fetchImpl });
}

/** The stage a lot's contents are at, defaulting to fry for a legacy batch listing. */
export function lotStage(listing) {
  return normalizeLifeStage(listing?.lifeStage) || LIFE_STAGE.FRY;
}
