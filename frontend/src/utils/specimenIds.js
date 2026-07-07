import { db } from "../db";

/**
 * Specimen ID reconciliation helpers.
 *
 * Local serials (`specimen.id`) are the stable client-side reference key. The
 * authoritative ERC-721 token id (`specimen.onChainId`) is only known once the
 * on-chain mint confirms, and it lives in a different namespace (the contract
 * assigns `++totalSpecimensMinted`, a global counter). Everything that needs to
 * translate between the two should go through these helpers so no other code
 * hardcodes the assumption that `id === tokenId`.
 */

/**
 * Resolve a local specimen ref to its confirmed on-chain token id.
 * @param {number|string} localId
 * @returns {Promise<number|null>} the on-chain token id, or null if not yet synced
 */
export async function resolveOnChainId(localId) {
  if (localId == null) return null;
  try {
    const rec = await db.specimens.get(Number(localId));
    return rec && rec.onChainId != null ? Number(rec.onChainId) : null;
  } catch {
    return null;
  }
}

/**
 * Reverse lookup: find the local specimen record for a confirmed on-chain id.
 * @param {number|string} onChainId
 * @returns {Promise<number|null>} the local serial id, or null if none maps to it
 */
export async function resolveLocalIdFromOnChain(onChainId) {
  if (onChainId == null) return null;
  try {
    const rec = await db.specimens.where("onChainId").equals(Number(onChainId)).first();
    return rec ? Number(rec.id) : null;
  } catch {
    return null;
  }
}

/**
 * The id to prefer when displaying or querying a specimen: the confirmed
 * on-chain token id when available, otherwise the local serial. This is the
 * single source of truth for "which number represents this specimen right now".
 * @param {object} spec - a specimen record (or lineage node)
 * @returns {number|null}
 */
export function preferredSpecimenId(spec) {
  if (!spec) return null;
  if (spec.onChainId != null) return Number(spec.onChainId);
  const local = spec.id ?? spec.specimenId;
  return local != null ? Number(local) : null;
}

/**
 * Human-readable label for a specimen's on-chain sync state (for UI badges).
 * @param {string} status - chainStatus value
 * @returns {string}
 */
export function chainStatusLabel(status) {
  switch (status) {
    case "synced":
      return "On-chain";
    case "pending":
      return "Pending sync";
    case "failed":
      return "Sync failed";
    default:
      return "Local only";
  }
}
