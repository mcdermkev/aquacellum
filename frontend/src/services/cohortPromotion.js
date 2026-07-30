/**
 * cohortPromotion.js — cohort count → individual birth certificate.
 *
 * The missing half of the individuals-vs-cohorts model
 * (docs/BREEDER_STATE_MODEL.md §4.2, §9.16). Fish start life as a *count* on a
 * grow-out cohort and become a *certificate* when the breeder decides to track
 * one individually. Until now there was no path between those two states: a
 * breeder pulling keepers out of a grow-out tank had to go to the Register tab
 * and re-enter the sire and dam serials by hand, per fish, from memory — and
 * nothing decremented the cohort, so the same fish were then counted twice.
 *
 * All of that data is one `db.spawns.get()` away, which is what this module does.
 *
 * ── THE INVARIANT THIS MODULE EXISTS TO PROTECT ─────────────────────────────
 *
 *   A fish is counted EITHER as a cohort head OR as an individual certificate.
 *   Never both. Never neither.
 *
 * Everything below follows from that:
 *
 *   1. `promoted` is a DEPARTURE type in utils/growoutFunnel.js, so promoting
 *      decrements the cohort. A cohort of 15 that promotes 3 reads as 12 alive
 *      plus 3 certificates. Without the decrement it reads as 18 fish.
 *   2. You cannot promote more than the cohort has alive. Rejected here, in the
 *      service, and nothing at all is written — not in the form, which is only a
 *      convenience. Otherwise `alive` floors at 0 and the surplus certificates
 *      are fabricated fish.
 *   3. The checkpoint count is the number of certificates that ACTUALLY got
 *      created, counted after the mints — never the number requested. A
 *      checkpoint written first, or written optimistically, decrements the cohort
 *      for a fish that does not exist.
 *
 * ── NOTHING IS FABRICATED TO FILL A GAP ─────────────────────────────────────
 *
 * Parents, species, tank, owner, and hatch date all come from the spawn record.
 * If the spawn is missing or unattributed we fail loudly rather than minting with
 * `sireId: 0` or a guessed wallet: an unparented or mis-dated certificate is
 * worse than a blocked one, because it is silently wrong forever. `tokenURI`
 * reads a stored string and the contract has no setter, and a certificate is
 * never destroyed (§4.1), so there is no correction path afterwards.
 *
 * Sex defaults to Unsexed. Promoted fry are usually too young to sex and the app
 * has no business inferring it.
 */

import { db } from "../db";
import { summarizeGrowout } from "../utils/growoutFunnel";
import { SEX, normalizeSex } from "../utils/specimenSex";
import { formatCertSerial } from "../utils/specimenIdentity";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { relayMintSpecimen } from "./relayer";
import { buildSpecimenMetadata } from "./specimenMetadata";
import { syncGrowoutCheckpointToCloud } from "./cloudSync";

/**
 * Ceiling on one promote action, matching SpawningWizard's offspring cap and for
 * the same reason: every certificate is a Dexie write, a cloud sync, a queued
 * on-chain call, and a metadata upload. Promoting more is repeating the action,
 * which `nextFreeCheckpointTimestamp` below makes safe.
 */
export const PROMOTE_MAX_PER_ACTION = 10;

/** The checkpoint type this module writes. Mirrors GROWOUT_TYPES / the migration. */
export const PROMOTED_TYPE = "promoted";

/**
 * How many fish this cohort can promote right now.
 *
 * Exported so the form's `max` and the service's hard block are the same
 * expression rather than two literals that have to be kept equal.
 *
 * @param {{ alive?: number }} funnel - a `summarizeGrowout` result
 */
export function promotableCount(funnel) {
  const alive = Math.max(0, Number(funnel?.alive) || 0);
  return Math.min(alive, PROMOTE_MAX_PER_ACTION);
}

/**
 * Pick an `event_timestamp` no existing `promoted` checkpoint on this spawn is
 * already using.
 *
 * WHY: the cloud mirror's natural key is
 * `(owner_address, spawn_id, event_timestamp, type)` and a collision resolves by
 * upsert. The parent migration documents that as the desired behavior for a
 * double-submit, and for a fry count it is. For a promotion it is not — two
 * distinct promotions collapsing into one row UNDERCOUNTS the departure, so the
 * cohort keeps heads that are already certificates and the invariant above
 * breaks. Advancing by a second keeps each promotion one auditable event.
 */
function nextFreeCheckpointTimestamp(existingCheckpoints, now) {
  const taken = new Set(
    (existingCheckpoints || [])
      .filter((c) => c?.type === PROMOTED_TYPE)
      .map((c) => Number(c.timestamp))
  );
  let ts = now;
  while (taken.has(ts)) ts += 1;
  return ts;
}

function fail(error, requested) {
  return {
    success: false,
    promoted: 0,
    requested,
    specimenIds: [],
    checkpointTimestamp: null,
    error,
  };
}

/**
 * Promote N fry out of a grow-out cohort into individual birth certificates.
 *
 * @param {object} args
 * @param {number|string} args.spawnId - the cohort's spawn
 * @param {number} args.count - how many to promote
 * @param {string[]} [args.names] - optional per-fish name, index-aligned
 * @param {string[]} [args.sexes] - optional per-fish sex, index-aligned
 * @param {string} [args.note] - optional note recorded on the checkpoint
 * @param {object} [args.speciesCatalog] - `{ [speciesId]: { commonName, scientificName } }`
 * @returns {Promise<{
 *   success: boolean,
 *   promoted: number,
 *   requested: number,
 *   specimenIds: number[],
 *   checkpointTimestamp: number|null,
 *   partial?: boolean,
 *   error?: string,
 * }>}
 */
export async function promoteCohortToCertificates({
  spawnId,
  count,
  names = [],
  sexes = [],
  note = "",
  speciesCatalog = null,
} = {}) {
  const requested = Number(count);

  try {
    // ── 1. The spawn is the source of truth for provenance ──────────────────
    const spawn = await db.spawns.get(Number(spawnId));
    if (!spawn) {
      return fail("That spawn record could not be found, so there are no parents to record.", requested);
    }
    if (!spawn.ownerAddress) {
      // No fallback to a connected wallet: guessing the owner of a birth
      // certificate is exactly the class of fabrication this stream removes.
      return fail("That spawn has no owner recorded, so a certificate can't be attributed.", requested);
    }

    // ── 2. What the cohort actually has ─────────────────────────────────────
    const checkpoints = await db.spawnGrowout.where("spawnId").equals(spawn.spawnId).toArray();
    const funnel = summarizeGrowout(checkpoints);
    const available = promotableCount(funnel);

    // ── 3. Hard block. Nothing is written past this point on failure. ───────
    if (!Number.isInteger(requested) || requested < 1) {
      return fail("Choose how many fish to promote.", requested);
    }
    if (requested > PROMOTE_MAX_PER_ACTION) {
      return fail(
        `You can promote up to ${PROMOTE_MAX_PER_ACTION} at a time. Promote a batch, then repeat.`,
        requested
      );
    }
    if (funnel.alive < 1) {
      return fail("This cohort has no fish left to promote.", requested);
    }
    if (requested > available) {
      return fail(
        `This cohort only has ${funnel.alive} fish left, so ${requested} can't be promoted.`,
        requested
      );
    }

    // ── 4. Mint. One certificate per fish, through the one mint path. ───────
    const speciesEntry = speciesCatalog?.[spawn.speciesId] || null;
    const commonName = speciesEntry?.commonName || "Specimen";
    const scientificName = speciesEntry?.scientificName || "Unknown";
    const specimenIds = [];

    for (let i = 0; i < requested; i += 1) {
      const fishName = (names[i] || "").trim();
      // normalizeSex maps anything unrecognized — including undefined — to
      // "Unsexed", so an omitted entry is an explicit unknown, not a guess.
      const gender = normalizeSex(sexes[i]);

      // Self-describing origin, so a future reader can tell a promoted fry from a
      // wizard-registered offspring — the same reason T1 records "COI Method"
      // alongside the coefficient. Built through the shared builder; this module
      // does not define a second document shape.
      const document = buildSpecimenMetadata({
        commonName,
        speciesId: spawn.speciesId,
        sireId: spawn.sireId,
        damId: spawn.damId,
        tankId: spawn.tankId,
        sex: gender === SEX.UNSEXED ? null : gender,
        name: fishName || `${commonName} Keeper`,
        description:
          `Promoted from the grow-out cohort of Spawn ${spawn.spawnId}. ` +
          `Sire Cert. ${formatCertSerial(spawn.sireId)}, Dam Cert. ${formatCertSerial(spawn.damId)}.`,
        extraAttributes: [
          { trait_type: "Origin", value: "Promoted from grow-out cohort" },
          { trait_type: "Source Spawn", value: String(spawn.spawnId) },
        ],
      });

      const res = await relayMintSpecimen({
        speciesId: spawn.speciesId,
        // The fish was born when the spawn happened. `Date.now()` here would put
        // a false hatch date on a certificate that outlives this app.
        birthTimestamp: Number(spawn.timestamp) || 0,
        breeder: spawn.ownerAddress,
        currentTankId: spawn.tankId,
        // Local serials, straight off the spawn — never an on-chain token id, and
        // never resolved through contract.specimens() (§3).
        sireId: spawn.sireId,
        damId: spawn.damId,
        ownerAddress: spawn.ownerAddress,
        commonName: fishName || commonName,
        scientificName,
        gender,
        // No `ipfsMetadataUri`: the relayer resolves the on-chain URI from the
        // serial it assigns. Supplying one here is how fabricated CIDs got
        // on-chain in the first place (§4.3).
        metadataDocument: document,
      });

      if (res?.success) specimenIds.push(res.specimenId);
    }

    // ── 5. No certificates means no departure. ──────────────────────────────
    if (specimenIds.length === 0) {
      return fail("No certificates could be created, so the cohort is unchanged.", requested);
    }

    // ── 6. Log the departure, for the count that actually exists ────────────
    const checkpointTimestamp = nextFreeCheckpointTimestamp(
      checkpoints,
      Math.round(Date.now() / 1000)
    );
    const checkpoint = {
      spawnId: spawn.spawnId,
      timestamp: checkpointTimestamp,
      type: PROMOTED_TYPE,
      // The number of certificates that exist, counted after the mints.
      count: specimenIds.length,
      note:
        note.trim() ||
        `Promoted to ${specimenIds.length === 1 ? "certificate" : "certificates"} ` +
          specimenIds.map((id) => formatCertSerial(id)).join(", "),
      photo: null,
    };
    await db.spawnGrowout.add(checkpoint);
    syncGrowoutCheckpointToCloud(checkpoint, spawn.ownerAddress).catch(() => {});

    // ── 7. The spawn learns about its new offspring ─────────────────────────
    // Appended, not replaced: otherwise the promoted fish have parents but the
    // spawn doesn't know them, and the spawn→offspring edge is wrong.
    const offspringIds = [...(spawn.offspringIds || []), ...specimenIds];
    await db.spawns.update(spawn.spawnId, { offspringIds });

    // One award per action, not per fish — matching how the Spawning wizard
    // awards SPAWN_BREED once for a cohort of up to ten offspring rather than ten
    // separate certificate awards.
    addXp(XP_ACTIONS.MINT_SPECIMEN.points, XP_ACTIONS.MINT_SPECIMEN.label);

    const partial = specimenIds.length < requested;
    return {
      success: true,
      promoted: specimenIds.length,
      requested,
      specimenIds,
      checkpointTimestamp,
      partial,
      ...(partial
        ? {
            error: `Only ${specimenIds.length} of ${requested} certificates could be created. The cohort was decremented by ${specimenIds.length}.`,
          }
        : {}),
    };
  } catch (err) {
    console.error("[CohortPromotion] Promotion failed:", err);
    return fail(err?.message || "Promotion failed.", requested);
  }
}
