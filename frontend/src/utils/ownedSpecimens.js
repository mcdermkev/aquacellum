import { db } from "../db";

/**
 * Load the current user's active specimens from the local-first Dexie store.
 *
 * Used to populate the sire/dam and lineage-lookup pickers so breeders select
 * real specimens instead of typing serial numbers by hand (which never matched
 * before, since IDs are now sequential serials rather than timestamps).
 *
 * @param {string} walletAccount - the current user's wallet address
 * @returns {Promise<Array>} active specimens sorted by serial number ascending
 */
export async function loadOwnedSpecimens(walletAccount) {
  const acct = (walletAccount || "").toLowerCase();
  let rows;

  try {
    const all = await db.specimens.toArray();
    rows = all.filter((s) => {
      if (Number(s.status ?? 0) !== 0) return false; // active only
      const owner = (s.ownerAddress || "").toLowerCase();
      // Match this user, or include legacy records with no owner recorded.
      return owner === acct || owner === "";
    });

    // Beta single-device fallback: if nothing matched the current account but
    // specimens exist locally, surface them anyway so pickers aren't empty.
    if (rows.length === 0 && all.length > 0) {
      rows = all.filter((s) => Number(s.status ?? 0) === 0);
    }
  } catch (e) {
    console.warn("[ownedSpecimens] Failed to load specimens:", e);
    return [];
  }

  return rows
    .map((s) => ({
      id: Number(s.id),
      speciesId: Number(s.speciesId),
      commonName: s.commonName || "",
      scientificName: s.scientificName || "",
      sireId: Number(s.sireId || 0),
      damId: Number(s.damId || 0),
      breederStockTag: s.breederStockTag || "",
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * Human-friendly picker label, e.g. "Cert. 001 — Neon Tetra [esgIV]".
 */
export function specimenOptionLabel(spec) {
  const serial = spec.id.toString().padStart(3, "0");
  const name = spec.commonName || `Species ID ${spec.speciesId}`;
  const tag = spec.breederStockTag ? ` [${spec.breederStockTag}]` : "";
  return `Cert. ${serial} — ${name}${tag}`;
}
