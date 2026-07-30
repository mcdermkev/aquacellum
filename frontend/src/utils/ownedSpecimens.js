import { db } from "../db";
import { formatCertSerial } from "./specimenIdentity";
import { normalizeSex, sexSymbol } from "./specimenSex";

/**
 * Load the current user's active specimens from the local-first Dexie store.
 *
 * Used to populate the sire/dam and lineage-lookup pickers so breeders select
 * real specimens instead of typing serial numbers by hand (which never matched
 * before, since IDs are now sequential serials rather than timestamps).
 *
 * OWNERSHIP IS A HARD FILTER. This list feeds the Sire/Dam pickers on the birth
 * certificate form, so anything it returns can be recorded as a parent on a new
 * certificate. It previously carried a "beta single-device fallback" that
 * returned EVERY specimen on the device when nothing matched the current
 * account — which meant that on a shared browser profile, or after an account
 * switch, one account could see and claim another account's fish as parents.
 * An empty picker is correct; a fabricated one corrupts lineage. The callers
 * already render an empty state ("register parents first to link a family
 * tree"), so there is nothing to paper over.
 *
 * Records with no `ownerAddress` at all are still included: those predate the
 * owner field, live in this browser's own IndexedDB, and the Dexie v18 migration
 * already remapped smart-wallet-owned rows onto the canonical EOA.
 *
 * @param {string} walletAccount - the current user's wallet address
 * @returns {Promise<Array>} active specimens sorted by serial number ascending
 */
export async function loadOwnedSpecimens(walletAccount) {
  const acct = (walletAccount || "").toLowerCase();
  let rows;

  // No signed-in account means no owned specimens — never fall through to
  // "everything on this device".
  if (!acct) return [];

  try {
    const all = await db.specimens.toArray();
    rows = all.filter((s) => {
      if (Number(s.status ?? 0) !== 0) return false; // active only
      // Archived certificates are hidden from pickers by design (they're the
      // mis-entries and unknown-fate fish the keeper asked to stop seeing), but
      // they are NOT deleted — services/pedigree.js still resolves them by
      // serial, so any descendant that names one as a parent keeps a valid
      // reference. See docs/BREEDER_STATE_MODEL.md §4.1.
      if (s.archived) return false;
      const owner = (s.ownerAddress || "").toLowerCase();
      // Match this user, or include legacy records with no owner recorded.
      return owner === acct || owner === "";
    });
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
      // Normalized here so every picker gets one vocabulary and no caller has to
      // special-case the legacy "Not Sure" value.
      gender: normalizeSex(s.gender),
      breederStockTag: s.breederStockTag || "",
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * Human-friendly picker label, e.g. "Cert. 001 ♀ — Neon Tetra [esgIV]".
 * An unknown sex adds nothing rather than a placeholder.
 */
export function specimenOptionLabel(spec) {
  const serial = formatCertSerial(spec.id);
  const symbol = sexSymbol(spec.gender);
  const name = spec.commonName || `Species ID ${spec.speciesId}`;
  const tag = spec.breederStockTag ? ` [${spec.breederStockTag}]` : "";
  return `Cert. ${serial}${symbol ? ` ${symbol}` : ""} — ${name}${tag}`;
}
