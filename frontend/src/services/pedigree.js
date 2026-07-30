/**
 * pedigree.js — the single pedigree resolver.
 *
 * Walks a birth certificate's ancestry three generations deep (target →
 * sire/dam → four grandparents) and returns the tree shape every pedigree
 * consumer already expects:
 *
 *   { target, parents: { sire, dam },
 *     grandparents: { sireSire, sireDam, damSire, damDam } }
 *
 * WHY THIS EXISTS: `SpecimenLineage` and `COICalculator` each had their own copy
 * of this walk, and they disagreed on the one thing that matters — resolution
 * PRECEDENCE. SpecimenLineage read Dexie first (correct, with a long comment
 * explaining why); COICalculator called the contract first, which is the exact
 * bug that comment warns against. So the same pairing could produce a correct
 * family tree and an inbreeding coefficient computed against unrelated fish.
 *
 * THE PRECEDENCE RULE (docs/BREEDER_STATE_MODEL.md §3): `sireId` and `damId`
 * hold LOCAL SERIALS, not ERC-721 token ids. The contract assigns token ids from
 * a global `++totalSpecimensMinted` counter with no relationship to the local
 * serial, so calling `contract.specimens(serial)` silently returns whichever
 * token happens to share that number — a real specimen, just the wrong one, with
 * no error. Dexie is therefore authoritative for serial → specimen resolution,
 * and the contract is consulted ONLY when no local record exists (e.g. a
 * cross-account lookup of a certificate this browser has never mirrored).
 */

import { db } from "../db";
import { SPECIMEN_STATUS } from "../utils/specimenIdentity";

/**
 * Resolve one specimen by local serial.
 *
 * @param {object|null} contract - AquadexManager contract, or null for local-only
 * @param {number|string} id - local serial (NOT a token id)
 * @returns {Promise<object|null>}
 */
export async function fetchSpecimenNode(contract, id) {
  if (!id || Number(id) === 0) return null;

  // 1. Local Dexie FIRST — authoritative for serial → specimen (see header).
  try {
    let local = await db.specimens.get(Number(id));
    if (!local) {
      local = await db.specimens.get(id.toString());
    }
    if (!local) {
      local = await db.specimens
        .filter((s) => Number(s.id) === Number(id) || Number(s.specimenId) === Number(id))
        .first();
    }
    if (local) {
      return {
        id: Number(local.id ?? local.specimenId),
        speciesId: local.speciesId,
        speciesName: local.commonName || `Species ID ${local.speciesId}`,
        scientificName: local.scientificName || "",
        birthTimestamp: local.birthTimestamp || local.createdAt || 0,
        breeder: local.breeder || "Local Breeder",
        sireId: Number(local.sireId || 0),
        damId: Number(local.damId || 0),
        ipfsMetadataUri: local.ipfsMetadataUri || "",
        status: local.status ?? SPECIMEN_STATUS.ACTIVE,
        breederStockTag: local.breederStockTag || "",
        // On-chain reconciliation state. Traversal still follows local sire/dam
        // refs (authoritative on-chain parent refs only exist after a full
        // on-chain cutover), but the node carries its confirmed token id and sync
        // status so the UI can surface provenance. Prefer onChainId for display.
        onChainId: local.onChainId ?? null,
        chainStatus: local.chainStatus || "local",
        source: "local",
      };
    }
  } catch (localErr) {
    console.warn(`[Pedigree] Local lookup failed for specimen ${id}:`, localErr);
  }

  // 2. No local record — it may be a raw on-chain token id for a certificate
  // this browser has never mirrored. Only now is the contract safe to ask.
  if (!contract) return null;
  try {
    const data = await contract.specimens(id);
    if (Number(data.specimenId) !== 0) {
      const speciesId = Number(data.speciesId);
      let speciesInfo = null;
      try {
        speciesInfo = await contract.speciesCatalog(speciesId);
      } catch (err) {
        console.warn("[Pedigree] Failed fetching species catalog entry:", err);
      }

      return {
        id: Number(data.specimenId),
        speciesId,
        speciesName: speciesInfo ? speciesInfo.commonName : `Species ID ${speciesId}`,
        scientificName: speciesInfo ? speciesInfo.scientificName : "",
        birthTimestamp: Number(data.birthTimestamp),
        breeder: data.breeder,
        sireId: Number(data.sireId),
        damId: Number(data.damId),
        ipfsMetadataUri: data.ipfsMetadataUri,
        status: Number(data.status),
        breederStockTag: "",
        // A contract-read specimen is on-chain by definition, so its id IS the
        // authoritative token id.
        onChainId: Number(data.specimenId),
        chainStatus: "synced",
        source: "chain",
      };
    }
  } catch (e) {
    console.warn(`[Pedigree] Contract read failed for specimen ${id}:`, e);
  }

  return null;
}

/**
 * Resolve a full three-generation pedigree tree.
 *
 * Returns `null` when the root itself can't be resolved, so callers can
 * distinguish "no such certificate" from "certificate with unknown parents".
 *
 * @param {object|null} contract
 * @param {number|string} rootId - local serial of the subject
 * @returns {Promise<object|null>}
 */
export async function fetchPedigreeTree(contract, rootId) {
  const target = await fetchSpecimenNode(contract, rootId);
  if (!target) return null;

  const [sire, dam] = await Promise.all([
    target.sireId ? fetchSpecimenNode(contract, target.sireId) : null,
    target.damId ? fetchSpecimenNode(contract, target.damId) : null,
  ]);

  const [sireSire, sireDam, damSire, damDam] = await Promise.all([
    sire?.sireId ? fetchSpecimenNode(contract, sire.sireId) : null,
    sire?.damId ? fetchSpecimenNode(contract, sire.damId) : null,
    dam?.sireId ? fetchSpecimenNode(contract, dam.sireId) : null,
    dam?.damId ? fetchSpecimenNode(contract, dam.damId) : null,
  ]);

  return {
    target,
    parents: { sire, dam },
    grandparents: { sireSire, sireDam, damSire, damDam },
  };
}

/** How many generations {@link fetchPedigreeTree} walks. */
export const PEDIGREE_DEPTH = 3;
