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
  authToken = null,
  fetchImpl,
} = {}) {
  const issuerAddress = normalizeAddress(issuer);
  if (!issuerAddress) {
    return { ok: false, document: null, attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_ISSUER };
  }

  const spawn = await db.spawns.get(Number(spawnId)).catch(() => null);
  if (!spawn) {
    return { ok: false, document: null, attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_SPAWN };
  }

  const tree = await lotTreeFromSpawn(contract, spawn);

  // A cohort with no resolvable parents has no pedigree to sell. Returning a document
  // with six null ancestors would be technically valid and commercially misleading —
  // it would render as "pedigree attached" while proving nothing. An honest absence is
  // better than an empty claim (the §12.1 rule).
  if (!tree.parents.sire && !tree.parents.dam) {
    return { ok: false, document: null, attested: false, reason: LISTING_PEDIGREE_FAILURE.NO_PARENTS };
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

  const attestation = await requestPlatformAttestation(document.hash, { authToken, fetchImpl });
  if (attestation) {
    try {
      document = attachAttestation(document, attestation);
    } catch {
      // Leaves it unattested rather than discarding the pedigree.
    }
  }

  return { ok: true, document, attested: Boolean(document.attestation), reason: null };
}

/**
 * Seal the pedigree of an individual certificate being listed.
 *
 * Thin wrapper over the transfer path — the document is identical, because "what this
 * fish's ancestry is" does not depend on why it was sealed.
 */
export async function sealSpecimenPedigree({ specimenId, issuer, contract = null, authToken = null, fetchImpl } = {}) {
  const { issueTransferDocument } = await import("./certificateTransfer");
  const result = await issueTransferDocument({ specimenId, issuer, contract, authToken, fetchImpl });
  return {
    ...result,
    reason: result.reason === "noSpecimen" ? LISTING_PEDIGREE_FAILURE.NO_SPECIMEN : result.reason,
  };
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
 */
export function attachPedigreeToListing(listing, document) {
  if (!listing || typeof listing !== "object") return listing;
  if (!document?.hash) {
    // Explicitly recorded as absent rather than left undefined, so a reader can tell
    // "this seller published no pedigree" from "this field predates the feature".
    return { ...listing, pedigreeHash: null, pedigreeDocument: null };
  }
  return { ...listing, pedigreeHash: document.hash, pedigreeDocument: document };
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
  authToken = null,
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
