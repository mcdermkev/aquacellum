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
 *
 * ── A PURCHASED LOT PROMOTES THE SAME WAY ───────────────────────────────────
 *
 * §12.4: a lot is a cohort that changed hands, so `services/lotIntake.js` writes it
 * as a spawn-shaped row and everything above applies to it verbatim — which is what
 * closes §9.26 (a sale never decremented the cohort; now it does, because promotion
 * decrements). Two facts differ and only two, both in `lotProvenance` below: the
 * BREEDER is the one named in the lot's pedigree rather than the promoter, and
 * ancestry travels as a document hash rather than as local parent serials.
 */

import { db } from "../db";
import { summarizeGrowout } from "../utils/growoutFunnel";
import { SEX, normalizeSex } from "../utils/specimenSex";
import { formatCertSerial } from "../utils/specimenIdentity";
import { promotedLifeStage } from "../utils/lifeStage";
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

// ─── Copy ───────────────────────────────────────────────────────────────────
//
// Every user-facing string this flow produces lives here, in casual and pro
// variants, guarded by the PROHIBITED_TERMS invariant test — the same pattern as
// PAIRING_COPY in utils/specimenSex.js. The rule and its words stay together.
//
// The strings are deliberately STATIC: counts are interpolated by the caller from
// the result object, not baked in. That keeps the invariant test a plain scan and
// keeps the service mode-agnostic — it returns an `errorKey`, and the component
// decides whether the reader wants "cohort" or "batch of babies".

/** Keys `promoteCohortToCertificates` can return in `errorKey`. */
export const PROMOTION_ERROR = Object.freeze({
  SPAWN_MISSING: "spawnMissing",
  SPAWN_UNATTRIBUTED: "spawnUnattributed",
  COUNT_INVALID: "countInvalid",
  OVER_CAP: "overCap",
  COHORT_EMPTY: "cohortEmpty",
  NOT_ENOUGH_ALIVE: "notEnoughAlive",
  ALL_MINTS_FAILED: "allMintsFailed",
  UNEXPECTED: "unexpected",
});

export const PROMOTION_COPY = Object.freeze({
  // Errors, keyed by PROMOTION_ERROR.
  spawnMissing: Object.freeze({
    pro: "That spawn record can't be found, so there are no parents to record.",
    casual: "We can't find that batch, so we don't know who the parents are.",
  }),
  spawnUnattributed: Object.freeze({
    pro: "That spawn has no owner recorded, so a certificate can't be attributed.",
    casual: "We don't know whose batch this is, so we can't fill out a certificate.",
  }),
  countInvalid: Object.freeze({
    pro: "Enter how many fish to promote.",
    casual: "Choose how many babies you're keeping.",
  }),
  overCap: Object.freeze({
    pro: "That is more than one promotion can handle. Promote a batch, then repeat.",
    casual: "That's too many at once. Do a few now and come back for the rest.",
  }),
  cohortEmpty: Object.freeze({
    pro: "This cohort has no fish left to promote.",
    casual: "There are no babies left in this batch.",
  }),
  notEnoughAlive: Object.freeze({
    pro: "That is more fish than this cohort has left.",
    casual: "That's more babies than this batch has left.",
  }),
  allMintsFailed: Object.freeze({
    pro: "No certificates could be created, so the cohort is unchanged.",
    casual: "We couldn't make any certificates, so nothing changed.",
  }),
  unexpected: Object.freeze({
    pro: "Promotion failed.",
    casual: "That didn't work.",
  }),

  // The panel.
  action: Object.freeze({
    pro: "Promote keepers",
    casual: "Keep some babies",
  }),
  heading: Object.freeze({
    pro: "Promote to individual certificates",
    casual: "Give a baby its own certificate",
  }),
  intro: Object.freeze({
    pro: "The fish you keep get their own certificate and leave the cohort count. Parents come from this spawn, so you don't re-enter them.",
    casual: "The babies you keep get their own record. We already know their parents, so you don't have to type them in.",
  }),
  countLabel: Object.freeze({
    pro: "How many",
    casual: "How many are you keeping?",
  }),
  parentsLabel: Object.freeze({
    pro: "Parents, from this spawn",
    casual: "Their parents",
  }),
  parentsFromLot: Object.freeze({
    // A purchased lot has no parent records on this device, and saying "from this
    // spawn" there would point at nothing. §9.25 / T3 §2.6.
    pro: "Ancestry comes from the pedigree that arrived with this lot, not from records on this device.",
    casual: "Their family tree came with them when you bought them.",
  }),
  sexHint: Object.freeze({
    pro: "Sex is optional — leave it unset if you can't tell yet.",
    casual: "You can leave this blank if you can't tell yet.",
  }),
  namePlaceholder: Object.freeze({
    pro: "Name (optional)",
    casual: "Give it a name (optional)",
  }),
  submit: Object.freeze({
    pro: "Create certificates",
    casual: "Save them",
  }),
  working: Object.freeze({
    pro: "Creating certificates…",
    casual: "Saving…",
  }),
  success: Object.freeze({
    pro: "Certificates created. They've left the cohort count and are now tracked individually.",
    casual: "Done. They have their own records now and left the batch count.",
  }),
  partial: Object.freeze({
    pro: "Not all of them could be created. The cohort was reduced by the number that were.",
    casual: "Some couldn't be saved. Only the ones that worked left the batch count.",
  }),
  exhausted: Object.freeze({
    pro: "Every fish in this cohort has been accounted for.",
    casual: "Every baby in this batch is accounted for.",
  }),
  promotedFunnelLabel: Object.freeze({
    pro: "promoted to certificates",
    casual: "kept with their own record",
  }),
});

/** Every copy string, flattened — used by the language invariant test. */
export function allPromotionCopy() {
  const out = [];
  for (const entry of Object.values(PROMOTION_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

/**
 * Resolve a copy key for the reader's mode.
 *
 * @param {string} key - a PROMOTION_COPY key, e.g. a returned `errorKey`
 * @param {{ casual?: boolean }} [options]
 */
export function promotionText(key, { casual = false } = {}) {
  const entry = PROMOTION_COPY[key];
  if (!entry) return PROMOTION_COPY.unexpected[casual ? "casual" : "pro"];
  return entry[casual ? "casual" : "pro"];
}

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
/**
 * Species names for the new certificates, local-first.
 *
 * Precedence:
 *   1. A caller-supplied catalog entry.
 *   2. A SIBLING certificate of the same species already in Dexie — which for a
 *      promotion is nearly always present, because the spawn minted offspring
 *      when it was recorded. Their names came from the same catalog.
 *   3. The relayer's own defaults ("Specimen" / "Unknown").
 *
 * Step 2 exists so this path needs no RPC. `SpawningWizard` reads the catalog by
 * calling `contract.speciesCatalog(i)` for every species on mount, which is its
 * own open item (§9.12); copying that here would spread the problem rather than
 * solve it. Step 3 is an honest blank, not a guess.
 */
async function resolveSpeciesNames(spawn, speciesCatalog) {
  const entry = speciesCatalog?.[spawn.speciesId];
  if (entry?.commonName || entry?.scientificName) {
    return {
      commonName: entry.commonName || "Specimen",
      scientificName: entry.scientificName || "Unknown",
    };
  }

  try {
    const sibling = await db.specimens.where("speciesId").equals(Number(spawn.speciesId)).first();
    if (sibling?.commonName || sibling?.scientificName) {
      return {
        commonName: sibling.commonName || "Specimen",
        scientificName: sibling.scientificName || "Unknown",
      };
    }
  } catch {
    // Fall through to the defaults. A missing name is a cosmetic gap; guessing
    // one and writing it onto a certificate would not be.
  }

  return { commonName: "Specimen", scientificName: "Unknown" };
}

/**
 * What a PURCHASED lot contributes to the certificates promoted out of it
 * (docs/BREEDER_STATE_MODEL.md §9.25, T3 §2.6). Empty object for a cohort the
 * breeder bred themselves, so that path is byte-for-byte unchanged.
 *
 * ── WHY THE BREEDER IS NOT THE PROMOTER ─────────────────────────────────────
 *
 * A cohort bred here takes `breeder` from `spawn.ownerAddress`, which is right: the
 * owner of the spawning pair bred the fry. A PURCHASED lot inverts that. Somebody
 * else's pair produced these eggs; the buyer hatched them. §5 makes `breeder` a
 * provenance fact about who bred the fish, and §12.3's deciding scenario is precisely
 * that the lineage still traces to the master breeder when the buyer resells — so
 * recording the buyer here would erase the one fact the premium rests on, on the
 * first generation, permanently.
 *
 * The lot document's `subject.breeder` is that breeder, sealed on their own device
 * from their own registry. It is the only trustworthy source for this, which is why
 * it is read off the document rather than off the listing.
 *
 * ── AND WHY THE CHAIN POINTER, NOT SERIALS ──────────────────────────────────
 *
 * `sireId`/`damId` stay 0. A purchased lot's parents live on the seller's device and
 * their serials name different fish here (§3, §12.2). `pedigreeParentDocuments.sire`
 * carries the lot's hash instead, so when this fish is sold on,
 * `issueTransferDocument` seals a document that CHAINS to the lot rather than
 * restating it — the same mechanism `receiveTransferredCertificate` uses for an
 * individual resale.
 */
function lotProvenance(spawn) {
  const hash = spawn?.lotDocumentHash;
  if (typeof hash !== "string" || !hash) return null;
  return {
    hash,
    breeder: spawn?.pedigreeDocument?.body?.subject?.breeder || null,
  };
}

/**
 * The fields `relayMintSpecimen` has no parameters for, written straight after it.
 *
 * A failure here is logged, not thrown. The certificate already exists and §4.1 says
 * it can never be destroyed, so aborting would leave a certificate with no life stage
 * and no chain and no way to correct it — strictly worse than a loud warning next to
 * a row that can still be re-linked.
 */
async function applyPromotionProvenance(specimenId, lot) {
  const updates = { lifeStage: promotedLifeStage() };
  if (lot) {
    updates.lotDocumentHash = lot.hash;
    updates.pedigreeParentDocuments = { sire: lot.hash, dam: null };
  }
  try {
    await db.specimens.update(Number(specimenId), updates);
  } catch (err) {
    console.error("[CohortPromotion] Could not record promotion provenance:", specimenId, err);
  }
}

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

/**
 * A failure result.
 *
 * Carries an `errorKey` rather than a sentence, so the caller renders it in the
 * reader's mode (§2.5) — and so the numbers in the message come from `available`
 * here rather than being baked into copy that then can't be scanned by the
 * language invariant test.
 */
function fail(errorKey, requested, available = null) {
  return {
    success: false,
    promoted: 0,
    requested,
    available,
    specimenIds: [],
    checkpointTimestamp: null,
    errorKey,
    // Pro-mode text, for logs and for callers that don't care about mode.
    error: promotionText(errorKey),
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
      return fail(PROMOTION_ERROR.SPAWN_MISSING, requested);
    }
    if (!spawn.ownerAddress) {
      // No fallback to a connected wallet: guessing the owner of a birth
      // certificate is exactly the class of fabrication this stream removes.
      return fail(PROMOTION_ERROR.SPAWN_UNATTRIBUTED, requested);
    }

    // ── 2. What the cohort actually has ─────────────────────────────────────
    const checkpoints = await db.spawnGrowout.where("spawnId").equals(spawn.spawnId).toArray();
    const funnel = summarizeGrowout(checkpoints);
    const available = promotableCount(funnel);

    // ── 3. Hard block. Nothing is written past this point on failure. ───────
    if (!Number.isInteger(requested) || requested < 1) {
      return fail(PROMOTION_ERROR.COUNT_INVALID, requested, available);
    }
    if (requested > PROMOTE_MAX_PER_ACTION) {
      return fail(PROMOTION_ERROR.OVER_CAP, requested, available);
    }
    if (funnel.alive < 1) {
      return fail(PROMOTION_ERROR.COHORT_EMPTY, requested, available);
    }
    if (requested > available) {
      return fail(PROMOTION_ERROR.NOT_ENOUGH_ALIVE, requested, available);
    }

    // ── 4. Mint. One certificate per fish, through the one mint path. ───────
    const { commonName, scientificName } = await resolveSpeciesNames(spawn, speciesCatalog);
    // Non-null only for a cohort that was BOUGHT. See `lotProvenance`.
    const lot = lotProvenance(spawn);
    // The buyer owns the fish; somebody else bred it. Both facts are recorded.
    const breeder = lot?.breeder || spawn.ownerAddress;
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
        // A purchased lot has no local parent serials to cite — they name different
        // fish here — so it cites the pedigree hash, which is the same string in
        // every wallet. Printing "Sire Cert. —" would read as missing rather than as
        // recorded somewhere a serial cannot reach.
        description: lot
          ? `Raised from a purchased lot. Ancestry is recorded in pedigree ${lot.hash}.`
          : `Promoted from the grow-out cohort of Spawn ${spawn.spawnId}. ` +
            `Sire Cert. ${formatCertSerial(spawn.sireId)}, Dam Cert. ${formatCertSerial(spawn.damId)}.`,
        extraAttributes: lot
          ? [
              { trait_type: "Origin", value: "Raised from a purchased lot" },
              { trait_type: "Pedigree", value: lot.hash },
            ]
          : [
              { trait_type: "Origin", value: "Promoted from grow-out cohort" },
              { trait_type: "Source Spawn", value: String(spawn.spawnId) },
            ],
      });

      const res = await relayMintSpecimen({
        speciesId: spawn.speciesId,
        // The fish was born when the spawn happened. `Date.now()` here would put
        // a false hatch date on a certificate that outlives this app.
        birthTimestamp: Number(spawn.timestamp) || 0,
        breeder,
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

      if (res?.success) {
        specimenIds.push(res.specimenId);
        // Life stage always, chain pointer only for a purchased lot.
        await applyPromotionProvenance(res.specimenId, lot);
      }
    }

    // ── 5. No certificates means no departure. ──────────────────────────────
    if (specimenIds.length === 0) {
      return fail(PROMOTION_ERROR.ALL_MINTS_FAILED, requested, available);
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
      available,
      specimenIds,
      checkpointTimestamp,
      partial,
      // A partial result is a success that must not be rounded off to "done" —
      // the caller has both numbers and the copy key to say so plainly.
      ...(partial ? { errorKey: "partial", error: promotionText("partial") } : {}),
    };
  } catch (err) {
    console.error("[CohortPromotion] Promotion failed:", err);
    return fail(PROMOTION_ERROR.UNEXPECTED, requested);
  }
}
