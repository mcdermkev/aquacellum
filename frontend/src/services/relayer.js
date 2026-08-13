/**
 * relayer.js
 * 
 * Local-first architecture with EIP-4337 account abstraction on-chain writes.
 * 
 * Flow for every user action:
 *   1. Instant local write → Dexie (IndexedDB) — user sees results immediately
 *   2. Cloud sync → Supabase (fire-and-forget) — backup and cross-device
 *   3. On-chain write → EIP-4337 UserOperation via Coinbase Smart Wallet + CDP Paymaster
 *      - Gas is sponsored by the CDP Paymaster (users pay nothing)
 *      - Operations are batched into single UserOps when possible
 *      - Failures don't affect local UX (fire-and-forget)
 *
 * CANONICAL ADDRESS RULE:
 *   All ownerAddress / breeder / seller fields stored in Dexie MUST use the
 *   Privy EOA (lowercase), never the derived smart wallet. This ensures a single
 *   canonical identity for queries. The smart wallet is only used for sending
 *   on-chain UserOperations; it never appears in local data.
 */

import { ethers } from "ethers";
import { db } from "../db";
import aquadexAbi from "../abi/AquadexManager.json";
import { syncTankToCloud, syncSpecimenToCloud, syncListingToCloud, deactivateListingInCloud, syncSpawnToCloud } from "./cloudSync";
import { trackEvent } from "./analytics";
import { putSpecimenPhoto } from "./tankMedia";
import { SERIAL_CEILING } from "../utils/specimenIdentity";
import { normalizeSex } from "../utils/specimenSex";
import {
  METADATA_STATUS,
  normalizeMetadataUri,
  publicMetadataUri,
  publishSpecimenMetadata,
} from "./specimenMetadata";
import {
  submitUserOperation,
  buildRegisterTankCall,
  buildMintSpecimenCall,
  buildLogWaterParametersCall,
  buildMoveSpecimenCall,
  buildInitiateSpawnCall,
  buildListSpecimenCall,
  buildCancelListingCall,
  buildApproveCall,
  buildCreateShippingListingCall,
  buildDispatchShippingCall,
  buildReleaseFiatShippingEscrowCall,
  buildDisputeShippingCall,
  buildResolveShippingDisputeCall,
} from "./smartAccountClient";

/**
 * Normalize an address to lowercase for consistent storage.
 * All Dexie writes go through this so there's never a casing mismatch.
 */
function normalizeAddress(addr) {
  return addr ? addr.toLowerCase() : "";
}

/**
 * Submit a single marketplace call on-chain and AWAIT its receipt.
 *
 * Unlike enqueueOnChain (fire-and-forget, batched, best-effort), escrow money
 * movements must be authoritative: the local mirror is only updated after the
 * chain confirms. Returns { success, txHash } or { success:false, error }.
 */
async function submitEscrowCall(call, label = "") {
  const res = await submitUserOperation([call]);
  if (!res.success) {
    console.warn(`[Relayer] on-chain ${label} failed:`, res.error);
  }
  return res;
}

/**
 * Queue for batching on-chain operations.
 * Accumulates calls and flushes them as a single UserOperation.
 */
const _onChainQueue = [];
let _flushTimer = null;
const FLUSH_DELAY_MS = 3000; // Wait 3s to batch multiple rapid actions
const MAX_BATCH_SIZE = 10;   // Flush immediately if queue hits this size

// Interface used to decode SpecimenRegistered events from the flushed UserOp
// receipt, so we can map each on-chain token id back to its local specimen.
const _managerInterface = new ethers.utils.Interface(aquadexAbi);

/**
 * Enqueue an on-chain call for batched submission.
 * @param {object} call - the built contract call
 * @param {string} label - human label for logging
 * @param {object|null} meta - optional reconciliation metadata, e.g.
 *   { type: "mintSpecimen", localId } used to write the confirmed on-chain
 *   token id back onto the local specimen record after the batch settles.
 */
function enqueueOnChain(call, label = "", meta = null) {
  if (!call) return; // Skip null calls (e.g., local-only tank operations)
  
  _onChainQueue.push({ call, label, meta, timestamp: Date.now() });

  // Flush immediately if batch is full
  if (_onChainQueue.length >= MAX_BATCH_SIZE) {
    flushOnChainQueue();
    return;
  }

  // Otherwise debounce: wait for more operations to batch
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flushOnChainQueue, FLUSH_DELAY_MS);
}

async function flushOnChainQueue() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }

  if (_onChainQueue.length === 0) return;

  // Drain the queue
  const batch = _onChainQueue.splice(0);
  const calls = batch.map(b => b.call);

  // Mint items we may need to reconcile with on-chain token ids afterward.
  const mintItems = batch.filter(b => b.meta && b.meta.type === "mintSpecimen" && b.meta.localId != null);

  const result = await submitUserOperation(calls);

  if (!result.success) {
    console.warn(`[4337] Batch failed: ${result.error}`);
    // Mark enqueued mints as failed so the eventual backfill can retry them.
    for (const item of mintItems) {
      db.specimens.update(Number(item.meta.localId), { chainStatus: "failed" }).catch(() => {});
    }
    return;
  }

  // Reconcile: map each SpecimenRegistered event to its local specimen record.
  await reconcileMintedTokenIds(result, mintItems);
}

/**
 * Parse SpecimenRegistered events from a settled UserOperation receipt and write
 * the authoritative on-chain token id back onto the corresponding local records.
 *
 * Mapping is positional: within a single transaction the contract assigns
 * `++totalSpecimensMinted` in call order, so the Nth SpecimenRegistered event
 * corresponds to the Nth mint call in the batch. To stay safe, we only apply the
 * mapping when the event count exactly matches the mint count — otherwise (e.g.
 * a spawn that also emits SpecimenRegistered was batched in) we leave records
 * "pending" for the reconciliation/backfill pass rather than risk a mis-map.
 */
async function reconcileMintedTokenIds(result, mintItems) {
  if (mintItems.length === 0) return;
  try {
    const logs = result.receipt?.receipt?.logs || [];
    const tokenIds = [];
    for (const log of logs) {
      let parsed = null;
      try { parsed = _managerInterface.parseLog(log); } catch { parsed = null; }
      if (parsed && parsed.name === "SpecimenRegistered") {
        const id = parsed.args.specimenId ?? parsed.args.tokenId ?? parsed.args[0];
        if (id != null) tokenIds.push(Number(id));
      }
    }

    if (tokenIds.length !== mintItems.length) {
      console.warn(
        `[4337] Token id reconciliation skipped: ${tokenIds.length} SpecimenRegistered events for ${mintItems.length} mint calls. Records left pending for backfill.`
      );
      return;
    }

    const txHash = result.txHash || null;
    for (let i = 0; i < mintItems.length; i++) {
      await db.specimens.update(Number(mintItems[i].meta.localId), {
        onChainId: tokenIds[i],
        chainStatus: "synced",
        txHash,
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[4337] Could not reconcile minted token ids:", err);
  }
}

// Flush on page unload to avoid losing queued operations
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (_onChainQueue.length > 0) {
      flushOnChainQueue();
    }
  });
}

/**
 * Register a tank locally in Dexie (beta mode — no on-chain write).
 * Returns a generated tank ID and stores it in the local database.
 */
export async function relayRegisterTank({
  name = "My Tank",
  tankType = 0,
  volumeLiters = 75,
  containment = 0,
  parentUnitId = 0,
  facility = "Main Room",
  room = "",
  rack = "",
  ownerAddress = "",
} = {}) {
  try {
    // Generate a local tank ID (timestamp-based, unique enough for beta)
    const tankId = Date.now();

    const tank = {
      id: tankId,
      ownerAddress: normalizeAddress(ownerAddress),
      name,
      tankType,
      volumeLiters,
      creationTimestamp: Math.floor(Date.now() / 1000),
      active: true,
      containment,
      parentUnitId,
      facility,
      room,
      rack,
      logs: [],
      latestLog: null,
      specimens: [],
    };

    // Store in Dexie
    await db.tanks.put(tank);

    // Fire-and-forget cloud sync (non-blocking)
    syncTankToCloud(tank).catch(() => {});

    // Fire-and-forget on-chain registration via 4337 (non-blocking, batched)
    enqueueOnChain(
      buildRegisterTankCall({ name, tankType, volumeLiters, containment, parentUnitId, facility, room, rack }),
      `registerTank(${name})`
    );

    trackEvent("tank_created", { tank_type: tankType, volume_liters: volumeLiters });

    return { success: true, tankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local tank registration failed:", err);
    return { success: false, error: err.message || "Failed to save tank" };
  }
}

// Bulk tank creation ("rack stamping") — see docs/BULK_TANK_CREATE_SPEC.md.
// Hard cap on how many units one bulk action may create.
export const MAX_BULK_TANKS = 100;
// CSV/paste import (heterogeneous rows) — see docs/CSV_TANK_IMPORT_SPEC.md.
// Larger cap than a single rack stamp: a migrating breeder may bring their whole
// fishroom in one paste.
export const MAX_IMPORT_TANKS = 500;

/**
 * Build a full tank row from a partial spec. Shared by the bulk-create and
 * import paths so every stamped/imported unit has the exact same shape as a
 * single `relayRegisterTank` row. All units are top-level (`parentUnitId: 0`).
 */
function _tankRow(spec, id, owner, creationTimestamp) {
  return {
    id,
    ownerAddress: owner,
    name: spec.name,
    tankType: Number(spec.tankType) || 0,
    volumeLiters: Number(spec.volumeLiters) || 0,
    creationTimestamp,
    active: true,
    containment: Number(spec.containment) || 0,
    parentUnitId: 0,
    facility: String(spec.facility ?? "").trim(),
    room: String(spec.room ?? "").trim(),
    rack: String(spec.rack ?? "").trim(),
    logs: [],
    latestLog: null,
    specimens: [],
  };
}

/**
 * Shared persistence for the bulk tank paths (rack stamping + CSV import).
 *
 * WHY A SHARED HELPER: both paths must (a) assign collision-free ids — a loop of
 * `relayRegisterTank` would reuse the same `Date.now()` and silently overwrite
 * via `put` — and (b) apply identical side effects. Centralizing it means the
 * correctness guarantees are written and tested once.
 *
 * One all-or-nothing `bulkPut`; one initial `ParameterLog` per tank (optional);
 * per-tank fire-and-forget cloud sync + on-chain enqueue. Does NOT award XP or
 * dispatch `aquadex:tank_registered` — callers do that EXACTLY ONCE so a keeper
 * can't farm +25 XP per row. Throws on a failed Dexie write so callers report
 * all-or-nothing failure.
 */
async function _persistTankRows(rows, seedInitialLog, logNote) {
  await db.tanks.bulkPut(rows);

  if (seedInitialLog) {
    const ts = Math.round(Date.now() / 1000);
    await db.actionLogs.bulkAdd(
      rows.map((t) => ({
        tankId: t.id,
        actionType: "ParameterLog",
        timestamp: ts,
        details: { temp: 24.5, ph: 7.2, ammonia: 0, nitrite: 0, nitrate: 5, notes: logNote },
      }))
    );
  }

  for (const t of rows) {
    syncTankToCloud(t).catch(() => {});
    enqueueOnChain(
      buildRegisterTankCall({
        name: t.name,
        tankType: t.tankType,
        volumeLiters: t.volumeLiters,
        containment: t.containment,
        parentUnitId: t.parentUnitId,
        facility: t.facility,
        room: t.room,
        rack: t.rack,
      }),
      `registerTank(${t.name})`
    );
  }
}

/**
 * Build a display name from a numbering pattern.
 *   pad: 0/undefined = no padding, 2 = "01", 3 = "001".
 * Exported for unit tests and for the modal's live preview.
 */
export function buildBulkTankName({ prefix = "Unit", startNumber = 1, pad = 0 }, index = 0) {
  const base = String(prefix ?? "").trim() || "Unit";
  const n = Number(startNumber) + index;
  const digits = String(n);
  const padded = pad > 0 ? digits.padStart(pad, "0") : digits;
  return `${base} ${padded}`;
}

/**
 * Register N identical containment units in one action ("rack stamping").
 *
 * WHY THIS IS NOT `relayRegisterTank` IN A LOOP: that function keys each row by
 * `Date.now()`. Called in a tight loop the ids collide within a millisecond and
 * `db.tanks.put` silently overwrites, so you'd ask for 50 tanks and keep only a
 * few. Here we assign `baseTs + i` ids (monotonic, collision-free) and write the
 * whole set with a single `bulkPut`.
 *
 * Side-effect policy (see spec §5): one Dexie write, one initial ParameterLog
 * per tank, per-tank fire-and-forget cloud sync + on-chain enqueue, but XP is
 * awarded exactly ONCE by the caller (not here) and the
 * `aquadex:tank_registered` event is dispatched ONCE by the caller — awarding
 * +25 XP per row would let a keeper farm 1000s of XP from a single click.
 *
 * `volumeLiters` must already be in LITERS (caller converts from gallons).
 *
 * @returns {{ success: boolean, tankIds: number[], names: string[], error?: string }}
 */
export async function relayRegisterTanksBulk({
  ownerAddress = "",
  count = 1,
  namePattern = { prefix: "Unit", startNumber: 1, pad: 0 },
  tankType = 0,
  volumeLiters = 75,
  containment = 0,
  facility = "",
  room = "",
  rack = "",
  seedInitialLog = true,
} = {}) {
  // Last line of defense on the count, independent of any UI clamp.
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1 || n > MAX_BULK_TANKS) {
    return { success: false, tankIds: [], names: [], error: `Count must be between 1 and ${MAX_BULK_TANKS}.` };
  }

  try {
    const owner = normalizeAddress(ownerAddress);
    const creationTimestamp = Math.floor(Date.now() / 1000);
    const baseTs = Date.now();

    const names = [];
    const rows = [];
    for (let i = 0; i < n; i++) {
      const name = buildBulkTankName(namePattern, i);
      names.push(name);
      // baseTs + i: unique, monotonic, still timestamp-shaped for sorting.
      rows.push(_tankRow({ name, tankType, volumeLiters, containment, facility, room, rack }, baseTs + i, owner, creationTimestamp));
    }

    await _persistTankRows(rows, seedInitialLog, "System initialized via bulk registration");

    trackEvent("tanks_bulk_created", { count: n, tank_type: tankType, volume_liters: volumeLiters });

    return { success: true, tankIds: rows.map((t) => t.id), names };
  } catch (err) {
    console.error("[Relayer] Bulk tank registration failed:", err);
    return { success: false, tankIds: [], names: [], error: err.message || "Failed to create units" };
  }
}

/**
 * Import a heterogeneous list of tank specs (CSV/paste importer).
 * See docs/CSV_TANK_IMPORT_SPEC.md.
 *
 * Each spec is `{ name, tankType, volumeLiters, containment, facility, room, rack }`
 * with `volumeLiters` already in LITERS (the parser converts from gallons).
 * Same persistence guarantees and XP/event policy as `relayRegisterTanksBulk`:
 * unique ids, one all-or-nothing write, and the CALLER awards XP + dispatches
 * `aquadex:tank_registered` exactly once.
 *
 * @returns {{ success: boolean, tankIds: number[], names: string[], error?: string }}
 */
export async function relayImportTanks({ ownerAddress = "", tanks = [], seedInitialLog = true } = {}) {
  if (!Array.isArray(tanks) || tanks.length < 1) {
    return { success: false, tankIds: [], names: [], error: "No tanks to import." };
  }
  if (tanks.length > MAX_IMPORT_TANKS) {
    return { success: false, tankIds: [], names: [], error: `Import is limited to ${MAX_IMPORT_TANKS} tanks at once.` };
  }

  try {
    const owner = normalizeAddress(ownerAddress);
    const creationTimestamp = Math.floor(Date.now() / 1000);
    const baseTs = Date.now();

    const rows = tanks.map((spec, i) =>
      _tankRow(
        {
          name: String(spec.name ?? "").trim() || "Unnamed Tank",
          tankType: spec.tankType,
          volumeLiters: spec.volumeLiters,
          containment: spec.containment,
          facility: spec.facility,
          room: spec.room,
          rack: spec.rack,
        },
        baseTs + i,
        owner,
        creationTimestamp
      )
    );

    await _persistTankRows(rows, seedInitialLog, "System initialized via import");

    trackEvent("tanks_imported", { count: rows.length });

    return { success: true, tankIds: rows.map((t) => t.id), names: rows.map((t) => t.name) };
  } catch (err) {
    console.error("[Relayer] Tank import failed:", err);
    return { success: false, tankIds: [], names: [], error: err.message || "Failed to import tanks" };
  }
}

/**
 * Mint a specimen locally in Dexie (beta mode — no on-chain write).
 * Adds the specimen to the target tank's specimens array and to the
 * standalone specimens table for direct queries.
 */
export async function relayMintSpecimen({
  speciesId,
  birthTimestamp = 0,
  breeder = "",
  currentTankId = 0,
  sireId = 0,
  damId = 0,
  ipfsMetadataUri = "",
  ownerAddress = "",
  commonName = "",
  scientificName = "",
  gender = "Unsexed",
  breederStockTag = "",
  /**
   * Optional metadata document to publish for this certificate. When supplied
   * (and no explicit `ipfsMetadataUri` is given), its deterministic hosted URL
   * becomes the on-chain tokenURI and the upload happens fire-and-forget.
   */
  metadataDocument = null,
} = {}) {
  try {
    // Sequential serial number (beta local-first). Human-friendly serials like
    // 1, 2, 3… so sire/dam references and the lineage lookup actually resolve,
    // and the display convention renders them as 001, 002, etc. — see
    // utils/specimenIdentity.js `formatCertSerial`, which owns that formatting
    // and the SERIAL_CEILING constant imported above.
    // Legacy records may carry Date.now() timestamp IDs (~1.7e12); we ignore any
    // ID at or above SERIAL_CEILING when computing the next serial so new
    // specimens still get clean, low numbers and never collide with old data.
    const existing = await db.specimens.toArray();
    const maxSerial = existing.reduce((max, s) => {
      const n = Number(s.id);
      return Number.isFinite(n) && n < SERIAL_CEILING && n > max ? n : max;
    }, 0);
    const specimenId = maxSerial + 1;

    // ── Resolve the certificate's metadata URI ────────────────────────────────
    // This is the one value that becomes the ERC-721 `tokenURI`, so it is
    // resolved here — the only place that knows the assigned serial — and it is
    // never fabricated (see services/specimenMetadata.js for what used to happen).
    //
    // Precedence:
    //   1. A breeder-supplied URI wins, after validation. We don't host it.
    //   2. Otherwise, if there's a document to publish and storage is available,
    //      use its deterministic public URL. Safe to commit before the upload
    //      because the path is derived, not discovered.
    //   3. Otherwise empty — an honest "no document published".
    const suppliedUri = normalizeMetadataUri(ipfsMetadataUri);
    let resolvedMetadataUri = suppliedUri;
    let metadataStatus = METADATA_STATUS.NONE;

    if (suppliedUri) {
      metadataStatus = METADATA_STATUS.EXTERNAL;
    } else if (metadataDocument) {
      const hostedUri = publicMetadataUri(ownerAddress, specimenId);
      if (hostedUri) {
        resolvedMetadataUri = hostedUri;
        metadataStatus = METADATA_STATUS.PENDING;
      }
    }

    const specimen = {
      id: specimenId,
      speciesId: Number(speciesId),
      birthTimestamp,
      breeder: normalizeAddress(breeder || ownerAddress),
      currentTankId: Number(currentTankId),
      sireId: Number(sireId),
      damId: Number(damId),
      ownerAddress: normalizeAddress(ownerAddress),
      commonName,
      scientificName,
      status: 0, // Active
      gender,
      breederStockTag: breederStockTag || "",
      createdAt: Math.floor(Date.now() / 1000),
      // On-chain reconciliation fields (full-on-chain readiness).
      // `id` above is the local serial (stable client ref). The authoritative
      // ERC-721 token id is captured into `onChainId` once the mint confirms.
      onChainId: null,
      chainStatus: "pending", // an on-chain mint is always enqueued below
      txHash: null,
      // Metadata document lifecycle (see services/specimenMetadata.js).
      ipfsMetadataUri: resolvedMetadataUri,
      metadataStatus,
    };

    // Store in standalone specimens table
    await db.specimens.put(specimen);

    // Publish the metadata document to its (already-committed) URL.
    // Fire-and-forget by design: the URL is deterministic, so it was safe to put
    // on-chain before the upload — which keeps certificate creation local-first
    // and non-blocking. A failure is recorded and retried by
    // retryPendingMetadataPublishes on the next sync.
    if (metadataStatus === METADATA_STATUS.PENDING) {
      publishSpecimenMetadata({ ownerAddress, specimenId, document: metadataDocument })
        .then((res) => db.specimens.update(specimenId, {
          metadataStatus: res.success ? METADATA_STATUS.PUBLISHED : METADATA_STATUS.FAILED,
        }))
        .catch(() => db.specimens.update(specimenId, { metadataStatus: METADATA_STATUS.FAILED }))
        .catch(() => {});
    }

    // Fire-and-forget cloud sync (non-blocking)
    syncSpecimenToCloud(specimen).catch(() => {});

    // Fire-and-forget on-chain mint via 4337 (non-blocking, batched).
    // The meta { type, localId } lets flushOnChainQueue write the confirmed
    // on-chain token id back onto this local record once the batch settles.
    enqueueOnChain(
      buildMintSpecimenCall({
        speciesId: Number(speciesId),
        birthTimestamp: birthTimestamp || Math.floor(Date.now() / 1000),
        breeder: breeder || ownerAddress,
        currentTankId: Number(currentTankId),
        sireId: Number(sireId),
        damId: Number(damId),
        // This becomes the certificate's ERC-721 tokenURI verbatim. It is either
        // empty, a breeder-supplied validated URI, or the deterministic URL the
        // document is being published to right now — never a fabricated value.
        ipfsMetadataUri: resolvedMetadataUri
      }),
      `mintSpecimen(species:${speciesId})`,
      { type: "mintSpecimen", localId: specimenId }
    );

    // Also embed in the tank's specimens array if a tank is specified
    if (currentTankId && Number(currentTankId) !== 0) {
      const tank = await db.tanks.get(Number(currentTankId));
      if (tank) {
        const specimens = tank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: Number(speciesId),
          commonName,
          scientificName,
          status: 0,
          gender,
        });
        await db.tanks.update(Number(currentTankId), { specimens });
        // Sync updated tank to cloud
        const updatedTankForSync = await db.tanks.get(Number(currentTankId));
        if (updatedTankForSync) syncTankToCloud(updatedTankForSync).catch(() => {});
      }
    }

    return { success: true, specimenId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen mint failed:", err);
    return { success: false, error: err.message || "Failed to save specimen" };
  }
}

// Livestock/CSV import — see docs/LIVESTOCK_IMPORT_SPEC.md.
export const MAX_IMPORT_SPECIMENS = 1000;

/**
 * Bulk-create imported specimens (livestock importer).
 *
 * WHY NOT LOOP relayMintSpecimen: that path recomputes the next serial by
 * scanning the whole table on every call, so it must be awaited sequentially or
 * serials collide. Here we read the max serial ONCE and assign `base + 1 + i`,
 * and do the specimen + tank writes inside a single Dexie transaction so the
 * whole import is atomic (a throw rolls everything back).
 *
 * Each spec is `{ speciesId, commonName, scientificName, gender, currentTankId,
 * breederStockTag? }` where `speciesId` is the CONTRACT-catalog id resolved +
 * confirmed by the caller (never a fuzzy guess). Lineage is always
 * `sireId/damId = 0` — importing fabricated parent pointers is unsafe, so it is
 * not done here.
 *
 * XP and the `aquadex:specimen_added` event are the caller's responsibility,
 * fired exactly once (mirrors the single add-fish flow).
 *
 * @returns {{ success: boolean, specimenIds: number[], error?: string }}
 */
export async function relayImportSpecimens({ ownerAddress = "", specimens = [] } = {}) {
  if (!Array.isArray(specimens) || specimens.length < 1) {
    return { success: false, specimenIds: [], error: "No livestock to import." };
  }
  if (specimens.length > MAX_IMPORT_SPECIMENS) {
    return { success: false, specimenIds: [], error: `Import is limited to ${MAX_IMPORT_SPECIMENS} fish at once.` };
  }

  try {
    const owner = normalizeAddress(ownerAddress);
    const createdAt = Math.floor(Date.now() / 1000);
    let rows = [];
    const touchedTankIds = new Set();

    await db.transaction("rw", db.specimens, db.tanks, async () => {
      // Base serial computed ONCE (same rule as relayMintSpecimen: ignore legacy
      // Date.now() ids at/above SERIAL_CEILING).
      const existing = await db.specimens.toArray();
      const maxSerial = existing.reduce((max, s) => {
        const n = Number(s.id);
        return Number.isFinite(n) && n < SERIAL_CEILING && n > max ? n : max;
      }, 0);

      rows = specimens.map((s, i) => ({
        id: maxSerial + 1 + i,
        speciesId: Number(s.speciesId),
        birthTimestamp: 0,
        breeder: owner,
        currentTankId: Number(s.currentTankId) || 0,
        sireId: 0,
        damId: 0,
        ownerAddress: owner,
        commonName: s.commonName || "",
        scientificName: s.scientificName || "",
        status: 0, // Active
        gender: normalizeSex(s.gender),
        // Free-text breeder label. The lineage-first intake flow uses it as the
        // line/pair name, which is what lets a declared pair be a durable grouping
        // with no new table and no migration (docs/LINEAGE_FIRST_INTAKE_SPEC.md §3).
        breederStockTag: String(s.breederStockTag ?? "").trim(),
        createdAt,
        onChainId: null,
        chainStatus: "pending",
        txHash: null,
        ipfsMetadataUri: "",
        metadataStatus: METADATA_STATUS.NONE,
      }));

      await db.specimens.bulkPut(rows);

      // Append subset copies into each tank's embedded specimens[] (what the
      // app reads for inhabitants + species count), grouped so each tank is
      // touched once.
      const byTank = new Map();
      for (const r of rows) {
        if (!r.currentTankId) continue;
        if (!byTank.has(r.currentTankId)) byTank.set(r.currentTankId, []);
        byTank.get(r.currentTankId).push({
          id: r.id,
          speciesId: r.speciesId,
          commonName: r.commonName,
          scientificName: r.scientificName,
          status: 0,
          gender: r.gender,
        });
      }
      for (const [tankId, embeds] of byTank) {
        const tank = await db.tanks.get(tankId);
        if (tank) {
          await db.tanks.update(tankId, { specimens: (tank.specimens || []).concat(embeds) });
          touchedTankIds.add(tankId);
        }
      }
    });

    // Best-effort side effects, outside the transaction, per the single mint path.
    for (const r of rows) {
      syncSpecimenToCloud(r).catch(() => {});
      enqueueOnChain(
        buildMintSpecimenCall({
          speciesId: r.speciesId,
          birthTimestamp: createdAt,
          breeder: owner,
          currentTankId: r.currentTankId,
          sireId: 0,
          damId: 0,
          ipfsMetadataUri: "",
        }),
        `mintSpecimen(species:${r.speciesId})`,
        { type: "mintSpecimen", localId: r.id }
      );
    }
    for (const tankId of touchedTankIds) {
      db.tanks.get(tankId).then((t) => t && syncTankToCloud(t).catch(() => {})).catch(() => {});
    }

    trackEvent("specimens_imported", { count: rows.length });

    return { success: true, specimenIds: rows.map((r) => r.id) };
  } catch (err) {
    console.error("[Relayer] Livestock import failed:", err);
    return { success: false, specimenIds: [], error: err.message || "Failed to import livestock" };
  }
}

/**
 * Move a specimen between tanks locally in Dexie (beta mode — no on-chain write).
 * Removes the specimen from the source tank's array and adds it to the target.
 */
export async function relayMoveSpecimen({
  specimenId,
  targetTankId,
} = {}) {
  try {
    specimenId = Number(specimenId);
    targetTankId = Number(targetTankId);

    // Update the specimen record
    const specimen = await db.specimens.get(specimenId);
    if (!specimen) {
      return { success: false, error: "Specimen not found" };
    }

    const sourceTankId = specimen.currentTankId;

    // Remove from source tank's specimens array
    if (sourceTankId && sourceTankId !== 0) {
      const sourceTank = await db.tanks.get(sourceTankId);
      if (sourceTank) {
        const filtered = (sourceTank.specimens || []).filter(s => s.id !== specimenId);
        await db.tanks.update(sourceTankId, { specimens: filtered });
        // Sync source tank
        const updatedSource = await db.tanks.get(sourceTankId);
        if (updatedSource) syncTankToCloud(updatedSource).catch(() => {});
      }
    }

    // Add to target tank's specimens array
    if (targetTankId !== 0) {
      const targetTank = await db.tanks.get(targetTankId);
      if (targetTank) {
        const specimens = targetTank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: specimen.speciesId,
          commonName: specimen.commonName,
          scientificName: specimen.scientificName,
          status: specimen.status,
        });
        await db.tanks.update(targetTankId, { specimens });
        // Sync target tank
        const updatedTarget = await db.tanks.get(targetTankId);
        if (updatedTarget) syncTankToCloud(updatedTarget).catch(() => {});
      }
    }

    // Update specimen's currentTankId
    await db.specimens.update(specimenId, { currentTankId: targetTankId });
    // Sync updated specimen
    const updatedSpec = await db.specimens.get(specimenId);
    if (updatedSpec) syncSpecimenToCloud(updatedSpec).catch(() => {});

    // Fire-and-forget on-chain move via 4337 (non-blocking, batched)
    enqueueOnChain(
      buildMoveSpecimenCall({ specimenId, targetTankId }),
      `moveSpecimen(${specimenId} → tank:${targetTankId})`
    );

    return { success: true, specimenId, targetTankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen move failed:", err);
    return { success: false, error: err.message || "Failed to move specimen" };
  }
}

/**
 * Log water parameters locally in Dexie (beta mode — no on-chain write).
 * Appends the log to the tank's logs array and updates latestLog.
 */
export async function relayLogWaterParameters({
  tankId,
  tempCelsiusX10,
  phX10,
  salinitySgX10000,
  ammoniaPpmX100,
  nitritePpmX100,
  nitratePpmX100,
  notes = "",
} = {}) {
  try {
    tankId = Number(tankId);

    const tank = await db.tanks.get(tankId);
    if (!tank) {
      return { success: false, error: "Tank not found" };
    }

    const log = {
      timestamp: Math.floor(Date.now() / 1000),
      tempCelsiusX10,
      phX10,
      salinitySgX10000,
      ammoniaPpmX100,
      nitritePpmX100,
      nitratePpmX100,
      notes,
    };

    const logs = tank.logs || [];
    logs.push(log);

    await db.tanks.update(tankId, { logs, latestLog: log });
    // Sync updated tank (with new logs) to cloud
    const updatedTank = await db.tanks.get(tankId);
    if (updatedTank) syncTankToCloud(updatedTank).catch(() => {});

    // Fire-and-forget on-chain parameter log via 4337 (non-blocking, batched)
    enqueueOnChain(
      buildLogWaterParametersCall({
        tankId, tempCelsiusX10, phX10, salinitySgX10000,
        ammoniaPpmX100, nitritePpmX100, nitratePpmX100, notes: notes || ""
      }),
      `logWaterParameters(tank:${tankId})`
    );

    return { success: true, tankId, logIndex: logs.length - 1, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local water parameter log failed:", err);
    return { success: false, error: err.message || "Failed to log parameters" };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MARKETPLACE — Local-first (beta). No MetaMask, no gas.
// All listing/purchase/escrow state lives in Dexie until on-chain publish.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Returns the user's locally-created beta listings, merged-ready for the
 * marketplace board reads. Safe to call even if the table is empty.
 */
export async function getLocalListings(speciesId = null) {
  try {
    let rows = await db.localListings.toArray();
    if (speciesId) {
      rows = rows.filter((l) => Number(l.speciesId) === Number(speciesId));
    }
    return rows;
  } catch (err) {
    console.warn("[Relayer] getLocalListings failed:", err);
    return [];
  }
}

/**
 * Create a single specimen listing locally (beta).
 * Mirrors the object shape produced by listingManager.fetchListingsByBreed.
 */
export async function relayCreateListing({
  tokenId,
  priceCentsUSD = 0,
  shippingFeeCents = 0,
  priceUsd = null,
  isShipping = false,
  seller = "",
  speciesId = 0,
  commonName = "Specimen",
  scientificName = "Unknown",
  sireId = 0,
  damId = 0,
  ipfsMetadataUri = "",
  careLevel = 0,
  minTemp = 0,
  maxTemp = 0,
  minPh = 0,
  maxPh = 0,
  // Enhanced listing fields
  description = "",
  age = "",
  size = "",
  diet = "",
  temperament = "",
  tankSizeMin = 0,
  healthStatus = "healthy",
  doaGuarantee = true,
  photoDataUrl = "",
  // Packing profile (Task 9 Increment 2 / Task 11) — the seller-editable
  // starting point from packingEngine.deriveDefaultPackingProfile, or the
  // seller's own override. Purely additive: omitting it (existing callers)
  // leaves the listing exactly as before, and downstream packing math
  // (packingEngine.js) already treats a missing/null profile as "derive
  // defaults from species size/temperament" — this never changes that
  // fallback, it only lets a listing carry its own profile when one exists.
  packingProfile = null,
} = {}) {
  try {
    // Store the photo durably (§9.3). This was a raw localStorage write, which shares
    // one ~5MB origin quota with every other photo and dies on a cache clear;
    // putSpecimenPhoto writes the Dexie `tankMedia` row (and still mirrors to
    // localStorage) so the listing's photo survives and resolves on other surfaces.
    if (photoDataUrl) {
      await putSpecimenPhoto(Number(tokenId), photoDataUrl);
    }

    // USD is canonical (Web2-masked marketplace). *Cents fields drive Stripe;
    // the dollar strings are for display.
    const centsUSD = Number(priceCentsUSD) || 0;
    const shipCents = Number(shippingFeeCents) || 0;
    const priceDisplayUsd = priceUsd != null ? String(priceUsd) : (centsUSD / 100).toFixed(2);
    const shipDisplayUsd = (shipCents / 100).toFixed(2);

    const listing = {
      id: Number(tokenId),
      tokenId: Number(tokenId),
      seller: normalizeAddress(seller),
      // USD canonical: price/priceUsd are display dollars, *Cents are for Stripe checkout.
      price: priceDisplayUsd,
      priceUsd: priceDisplayUsd,
      priceCentsUSD: centsUSD,
      rawPrice: priceDisplayUsd,
      shippingFee: shipDisplayUsd,
      shippingFeeCents: shipCents,
      isShipping: !!isShipping,
      speciesId: Number(speciesId),
      commonName,
      scientificName,
      sireId: Number(sireId),
      damId: Number(damId),
      ipfsMetadataUri,
      careLevel: Number(careLevel),
      minTemp: Number(minTemp),
      maxTemp: Number(maxTemp),
      minPh: Number(minPh),
      maxPh: Number(maxPh),
      // Enhanced fields
      description: String(description || ""),
      age: String(age || ""),
      size: String(size || ""),
      diet: String(diet || ""),
      temperament: String(temperament || ""),
      tankSizeMin: Number(tankSizeMin || 0),
      healthStatus: String(healthStatus || "healthy"),
      doaGuarantee: !!doaGuarantee,
      photoUrl: photoDataUrl || "",
      // Packing profile is stored as-is (packingEngine shape) when the seller
      // provided/edited one; null/undefined means "let the packing engine
      // derive defaults from species data" — never fabricated here.
      packingProfile: packingProfile || null,
      isBatch: false,
      active: true,
      // No fabricated location. A listing carries a real location only once a
      // seller sets one (real pickup/zone data); we never invent coordinates.
      createdAt: Math.floor(Date.now() / 1000),
    };

    // ── Seal the pedigree, here, on the seller's device ──────────────────────
    // The individual-certificate counterpart to what BatchListingWizard does for a
    // cohort (BREEDER_STATE_MODEL §9.25, T3 §2.5/§2.6). Listing time is the only
    // moment the full pedigree is readable: settlement runs server-side in the Stripe
    // webhook and the ancestors live in this browser's Dexie (§3).
    //
    // Dynamically imported so this module — which everything imports — does not gain
    // the pedigree graph as a static dependency.
    //
    // Non-blocking on purpose. A listing that fails to seal is a listing without a
    // published pedigree, which the trust ladder reports honestly, and that is far
    // better than refusing to let somebody sell their fish.
    let listingWithPedigree = listing;
    try {
      const { sealSpecimenPedigree, attachPedigreeToListing } = await import("./listingPedigree");
      const sealed = await sealSpecimenPedigree({
        specimenId: Number(tokenId),
        issuer: seller,
      });
      // The ancestor documents ride along too, so a buyer can VERIFY the chain rather
      // than only read the root's claims (§9.31).
      listingWithPedigree = attachPedigreeToListing(
        listing,
        sealed.ok ? sealed.document : null,
        sealed.ok ? sealed.chain : []
      );
    } catch (pedigreeErr) {
      console.warn("[Relayer] Pedigree sealing failed; listing without one:", pedigreeErr);
      try {
        const { attachPedigreeToListing } = await import("./listingPedigree");
        listingWithPedigree = attachPedigreeToListing(listing, null);
      } catch { /* leave the listing as-is */ }
    }

    await db.localListings.put(listingWithPedigree);
    // Also write to the listings cache so it shows immediately
    try { await db.listings.put(listingWithPedigree); } catch (e) {}

    // Sync to Supabase so other users can see this listing (fire-and-forget)
    syncListingToCloud(listingWithPedigree).catch(() => {});

    // On-chain: approve marketplace + list specimen (batched in one UserOp).
    // The on-chain "price" is USD cents, recorded for provenance only — money
    // settles via Stripe through the *Fiat functions. It just needs to be > 0 so
    // the listing is valid and the NFT is escrowed in the marketplace contract.
    const priceOnChain = BigInt(centsUSD);
    if (isShipping) {
      enqueueOnChain(buildApproveCall({ tokenId: Number(tokenId) }), `approve(${tokenId})`);
      enqueueOnChain(buildCreateShippingListingCall({ tokenId: Number(tokenId), priceWei: priceOnChain, shippingFeeWei: BigInt(shipCents) }), `createShippingListing(${tokenId})`);
    } else {
      enqueueOnChain(buildApproveCall({ tokenId: Number(tokenId) }), `approve(${tokenId})`);
      enqueueOnChain(buildListSpecimenCall({ tokenId: Number(tokenId), priceWei: priceOnChain }), `listSpecimen(${tokenId})`);
    }

    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local listing creation failed:", err);
    return { success: false, error: err.message || "Failed to create listing" };
  }
}

/**
 * Cancel (remove) a single specimen listing locally.
 */
export async function relayCancelListing(tokenId) {
  try {
    await db.localListings.delete(Number(tokenId));
    try { await db.listings.delete(Number(tokenId)); } catch (e) {}

    // Deactivate in cloud so other users stop seeing it
    deactivateListingInCloud(tokenId).catch(() => {});

    // On-chain: cancel the listing
    enqueueOnChain(buildCancelListingCall({ tokenId: Number(tokenId) }), `cancelListing(${tokenId})`);

    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local listing cancel failed:", err);
    return { success: false, error: err.message || "Failed to cancel listing" };
  }
}

/**
 * Cancel (remove) a batch listing locally.
 */
export async function relayCancelBatchListing(listingId) {
  try {
    const rows = await db.localListings.where("listingId").equals(Number(listingId)).toArray();
    for (const r of rows) {
      await db.localListings.delete(r.id);
      try { await db.listings.delete(r.id); } catch (e) {}
    }
    return { success: true, listingId: Number(listingId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local batch listing cancel failed:", err);
    return { success: false, error: err.message || "Failed to cancel batch listing" };
  }
}

/**
 * Update an existing listing's price, shipping toggle, and shipping fee locally.
 */
export async function relayUpdateListing({
  tokenId,
  listingId,
  isBatch,
  priceCentsUSD = 0,
  shippingFeeCents = 0,
  priceUsd = null,
  isShipping = false,
  quantity,
} = {}) {
  try {
    // USD canonical. Build the price fields once and reuse for batch/single.
    const centsUSD = Number(priceCentsUSD) || 0;
    const shipCents = Number(shippingFeeCents) || 0;
    const priceDisplayUsd = priceUsd != null ? String(priceUsd) : (centsUSD / 100).toFixed(2);
    const shipDisplayUsd = (shipCents / 100).toFixed(2);
    const priceUpdates = {
      price: priceDisplayUsd,
      priceUsd: priceDisplayUsd,
      priceCentsUSD: centsUSD,
      rawPrice: priceDisplayUsd,
      shippingFee: shipDisplayUsd,
      shippingFeeCents: shipCents,
      isShipping: !!isShipping,
    };

    if (isBatch) {
      const idToFind = Number(listingId);
      const rows = await db.localListings.where("listingId").equals(idToFind).toArray();
      if (rows.length === 0) {
        return { success: false, error: "Batch listing not found" };
      }
      const updates = { ...priceUpdates };
      if (quantity !== undefined) {
        updates.quantity = Number(quantity);
      }
      for (const r of rows) {
        await db.localListings.update(r.id, updates);
        try { await db.listings.update(r.id, updates); } catch (e) {}
      }
      return { success: true, listingId: idToFind, txHash: null };
    } else {
      const idToFind = Number(tokenId);
      const existing = await db.localListings.get(idToFind);
      if (!existing) {
        return { success: false, error: "Listing not found" };
      }
      await db.localListings.update(idToFind, priceUpdates);
      try { await db.listings.update(idToFind, priceUpdates); } catch (e) {}
      return { success: true, tokenId: idToFind, txHash: null };
    }
  } catch (err) {
    console.error("[Relayer] Local listing update failed:", err);
    return { success: false, error: err.message || "Failed to update listing" };
  }
}


/**
 * Optimistic LOCAL mirror of a specimen purchase.
 *
 * IMPORTANT: this does NOT move money and does NOT settle ownership on-chain.
 * In this Web2-masked model buyers pay USD through Stripe Checkout
 * (see services/stripePayments.js -> api/create-checkout.js). The authoritative
 * on-chain settlement (NFT transfer + ShippingEscrow creation) is performed by
 * the backend relayer holding FIAT_RELAYER_ROLE, triggered by the Stripe webhook
 * (api/stripe.js -> purchaseSpecimenFiat / purchaseShippingFiat). This function
 * only updates local Dexie so the UI can show the order immediately; it must be
 * reconciled against the on-chain state / fiat_settlements record.
 */
export async function relayPurchaseSpecimen({
  tokenId,
  buyer = "",
  seller = "",
  priceEth = "0",
  shippingFeeEth = "0",
  isShipping = false,
  commonName = "Specimen",
} = {}) {
  try {
    tokenId = Number(tokenId);
    const txHash = null; // settlement happens via the Stripe webhook relayer, not here

    // Remove the listing locally
    await db.localListings.delete(tokenId);
    try { await db.listings.delete(tokenId); } catch (e) {}

    // Deactivate in cloud (listing sold)
    deactivateListingInCloud(tokenId).catch(() => {});

    // Transfer specimen ownership locally if it exists
    const specimen = await db.specimens.get(tokenId);
    if (specimen && buyer) {
      await db.specimens.update(tokenId, {
        ownerAddress: normalizeAddress(buyer),
        // Arrival Flow: mark specimen as in transit
        arrivalStatus: "transit",
        purchasedAt: Math.floor(Date.now() / 1000),
        purchaseType: isShipping ? "shipping" : "instant",
        purchaseOrderKey: isShipping ? `shipping:${tokenId}` : null,
      });
    }

    if (isShipping) {
      // Record a shipping escrow order so the Orders view can track it
      const order = {
        orderType: "shipping",
        tokenId,
        buyer: normalizeAddress(buyer),
        seller: normalizeAddress(seller),
        price: String(priceEth),
        shippingFee: String(shippingFeeEth),
        amountLocked: String(Number(priceEth) + Number(shippingFeeEth)),
        trackingNumber: "",
        dispatchTimestamp: 0,
        status: 0, // 0 = locked / awaiting dispatch
        txHash,
        commonName,
        createdAt: Math.floor(Date.now() / 1000),
      };
      await db.marketOrders.put(order);
    } else {
      // Instant (non-shipping) sale: ownership transfers immediately, no escrow.
      // Record it as a completed instant order for history rather than mislabeling
      // it as a shipping escrow (which previously exposed bogus dispatch/release
      // actions on a sale that had no escrow).
      const order = {
        orderType: "instant",
        tokenId,
        buyer: normalizeAddress(buyer),
        seller: normalizeAddress(seller),
        price: String(priceEth),
        shippingFee: "0",
        amountLocked: String(priceEth),
        status: 2, // 2 = released / completed
        txHash,
        commonName,
        createdAt: Math.floor(Date.now() / 1000),
      };
      await db.marketOrders.put(order);
    }

    trackEvent("marketplace_purchase", {
      token_id: tokenId,
      price_eth: priceEth,
      is_shipping: isShipping,
      common_name: commonName,
      payment_method: "crypto",
    });

    return { success: true, tokenId, txHash };
  } catch (err) {
    console.error("[Relayer] Specimen purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase specimen" };
  }
}

/**
 * Purchase multiple specimens locally (consolidated checkout).
 */
export async function relayPurchaseMultiple({ tokenIds = [], buyer = "", listings = [] } = {}) {
  try {
    // Local mirror only. Real consolidated checkout goes through Stripe
    // (purchaseType "multi") and settles on-chain via purchaseMultipleFiat in
    // the webhook relayer.
    for (const tid of tokenIds) {
      const item = listings.find((l) => Number(l.tokenId) === Number(tid)) || {};
      await relayPurchaseSpecimen({
        tokenId: tid,
        buyer,
        seller: item.seller || "",
        priceEth: item.price || "0",
        shippingFeeEth: item.shippingFee || "0",
        isShipping: item.isShipping || false,
        commonName: item.commonName || "Specimen",
      });
    }
    return { success: true, count: tokenIds.length, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local consolidated purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase specimens" };
  }
}

/**
 * Purchase a batch (juveniles) locally. Decrements listing quantity and
 * records a batch escrow order. Returns a generated purchaseId.
 */
export async function relayPurchaseBatch({
  listingId,
  quantity,
  buyer = "",
  seller = "",
  pricePerFishEth = "0",
  commonName = "Juvenile Fry Batch",
  fulfillmentType = 0,
  /**
   * The pedigree the seller sealed at listing time (services/listingPedigree.js),
   * copied straight off the listing object the caller is already holding.
   *
   * THIS IS THE TRANSPORT, and it has to happen here (§9.25, T3 §2.6). The document
   * rides on `aquadex_listings.data`, so the buyer receives it while browsing — but
   * `useMarketplaceListings` clears and refills `db.listings` from on-chain data,
   * which carries no document, and the seller's `localListings` row does not exist on
   * this device at all. So the ONLY moment the buyer can capture it is the purchase,
   * with the listing in hand. Stashing it on the order is what makes it still be
   * there days later when the fish actually arrive.
   *
   * Life stage travels with it for the same reason: it decides whether the arriving
   * lot has anything alive to count yet (utils/lifeStage.js).
   */
  pedigreeDocument = null,
  pedigreeHash = null,
  /** The ancestor documents, so the buyer can verify the chain and republish it (§9.31). */
  pedigreeChain = [],
  lifeStage = null,
  speciesId = null,
  scientificName = "",
} = {}) {
  try {
    listingId = Number(listingId);
    quantity = Number(quantity);

    // Decrement quantity on the local batch listing
    const rows = await db.localListings.where("listingId").equals(listingId).toArray();
    for (const r of rows) {
      const newQty = Number(r.quantity || 0) - quantity;
      if (newQty <= 0) {
        await db.localListings.delete(r.id);
        try { await db.listings.delete(r.id); } catch (e) {}
      } else {
        await db.localListings.update(r.id, { quantity: newQty });
        try { await db.listings.update(r.id, { quantity: newQty }); } catch (e) {}
      }
    }

    const purchaseId = Date.now();
    const order = {
      orderType: "batch",
      purchaseId,
      listingId,
      buyer: normalizeAddress(buyer),
      seller: normalizeAddress(seller),
      quantity,
      amountLocked: String(Number(pricePerFishEth) * quantity),
      state: 0, // 0 = pending
      fulfillmentType: Number(fulfillmentType),
      commonName,
      // Recorded as null when the seller published none, rather than left undefined,
      // so a reader can tell an unpublished pedigree from a row that predates this.
      pedigreeDocument: pedigreeDocument || null,
      pedigreeHash: pedigreeHash || pedigreeDocument?.hash || null,
      pedigreeChain: Array.isArray(pedigreeChain) ? pedigreeChain : [],
      lifeStage: lifeStage || null,
      speciesId: speciesId == null ? null : Number(speciesId),
      scientificName: scientificName || "",
      createdAt: Math.floor(Date.now() / 1000),
    };
    await db.marketOrders.put(order);

    return { success: true, purchaseId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local batch purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase batch" };
  }
}

/**
 * Load the user's local orders (as buyer or seller), shaped for CheckoutSummary.
 */
export async function relayGetOrders(walletAccount = "") {
  const acct = (walletAccount || "").toLowerCase();
  const shippingEscrows = [];
  const purchases = [];
  try {
    const orders = await db.marketOrders.toArray();
    for (const o of orders) {
      const isBuyer = (o.buyer || "").toLowerCase() === acct;
      const isSeller = (o.seller || "").toLowerCase() === acct;
      if (!isBuyer && !isSeller) continue;
      const role = isBuyer ? "Buyer" : "Seller";
      if (o.orderType === "shipping") {
        shippingEscrows.push({ ...o, role });
      } else if (o.orderType === "batch") {
        purchases.push({ ...o, role });
      } else if (o.orderType === "instant") {
        // Instant (non-shipping) purchases: surface them alongside shipping
        // escrows so they appear in the orders list with a "completed" status.
        shippingEscrows.push({ ...o, role, isInstant: true, status: 2 });
      } else if (o.orderType === "fiat_pending" || o.orderType === "fiat") {
        // Stripe (fiat) orders: surface them as held escrows so the buyer can
        // confirm arrival / complete the handshake, which drives the backend
        // release. We carry the Stripe session id for that release call.
        let items = [];
        try { items = typeof o.items === "string" ? JSON.parse(o.items) : (o.items || []); } catch (e) {}
        const first = items[0] || {};
        // status: paid-but-awaiting-handoff → 0; released → 2; disputed → 3; refunded → 4.
        const statusMap = { pending: 0, settled: 0, released: 2, disputed: 3, refunded: 4, failed: 0 };
        shippingEscrows.push({
          ...o,
          role,
          isFiat: true,
          purchaseType: o.purchaseType || "shipping",
          tokenId: Number(first.tokenId ?? o.tokenId ?? 0),
          commonName: first.commonName || o.commonName || "Specimen",
          price: first.priceCentsUSD != null ? (Number(first.priceCentsUSD) / 100).toFixed(2) : (o.price || "0"),
          shippingFee: first.shippingFeeCents != null ? (Number(first.shippingFeeCents) / 100).toFixed(2) : (o.shippingFee || "0"),
          status: statusMap[o.status] ?? 0,
          stripeSessionId: o.stripeSessionId || null,
        });
      }
    }
  } catch (err) {
    console.warn("[Relayer] relayGetOrders failed:", err);
  }
  return { shippingEscrows, purchases };
}

/**
 * Update a shipping order's status locally (dispatch / release / dispute / resolve).
 */
export async function relayUpdateShippingOrder(tokenId, changes = {}) {
  try {
    const order = await db.marketOrders.where({ orderType: "shipping", tokenId: Number(tokenId) }).first();
    if (!order) return { success: false, error: "Order not found" };
    await db.marketOrders.update(order.key, changes);
    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Shipping order update failed:", err);
    return { success: false, error: err.message || "Failed to update order" };
  }
}

/**
 * Update a batch order's state locally (release / refund).
 */
export async function relayUpdateBatchOrder(purchaseId, changes = {}) {
  try {
    const order = await db.marketOrders.where({ orderType: "batch", purchaseId: Number(purchaseId) }).first();
    if (!order) return { success: false, error: "Order not found" };
    await db.marketOrders.update(order.key, changes);
    return { success: true, purchaseId: Number(purchaseId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Batch order update failed:", err);
    return { success: false, error: err.message || "Failed to update order" };
  }
}

// ─── Shipping escrow lifecycle (real, awaited on-chain transitions) ─────────
// These call the marketplace contract and only mirror the new status locally
// after the chain confirms. This is what makes the buyer-protection guarantees
// (escrow hold, dispatch window, dispute/refund) actually enforceable rather
// than a local-only status flip.

/**
 * Seller dispatches a shipping order on-chain (records tracking + starts the
 * 3-day safety window), then mirrors the DISPATCHED status locally.
 */
export async function relayDispatchShipping(tokenId, trackingNumber = "") {
  try {
    tokenId = Number(tokenId);
    if (!trackingNumber) return { success: false, error: "Tracking number required" };

    const res = await submitEscrowCall(
      buildDispatchShippingCall({ tokenId, trackingNumber }),
      `dispatchShipping(${tokenId})`
    );
    if (!res.success) return { success: false, error: res.error || "Dispatch failed" };

    const order = await db.marketOrders.where({ orderType: "shipping", tokenId }).first();
    if (order) {
      await db.marketOrders.update(order.key, {
        status: 1, // DISPATCHED
        trackingNumber,
        dispatchTimestamp: Math.floor(Date.now() / 1000),
        txHash: res.txHash || order.txHash || null,
      });
    }
    return { success: true, tokenId, txHash: res.txHash || null };
  } catch (err) {
    console.error("[Relayer] Dispatch shipping failed:", err);
    return { success: false, error: err.message || "Failed to dispatch shipping" };
  }
}

/**
 * Release the shipping escrow on-chain, confirming safe arrival. This is the
 * FIAT path: it transfers only the NFT to the buyer (the USD was captured by
 * Stripe at checkout; seller payout is a Stripe concern). Callable by the buyer
 * at any time, or the seller after the safety window (contract-enforced).
 * Mirrors the RELEASED status locally on success.
 */
export async function relayReleaseShipping(tokenId) {
  try {
    tokenId = Number(tokenId);
    const res = await submitEscrowCall(
      buildReleaseFiatShippingEscrowCall({ tokenId }),
      `releaseFiatShippingEscrow(${tokenId})`
    );
    if (!res.success) return { success: false, error: res.error || "Release failed" };

    const order = await db.marketOrders.where({ orderType: "shipping", tokenId }).first();
    if (order) await db.marketOrders.update(order.key, { status: 2 }); // RELEASED
    return { success: true, tokenId, txHash: res.txHash || null };
  } catch (err) {
    console.error("[Relayer] Release shipping failed:", err);
    return { success: false, error: err.message || "Failed to release shipping escrow" };
  }
}

/**
 * Buyer disputes a dispatched shipment on-chain (must be before the safety
 * window elapses; the contract enforces this). Mirrors DISPUTED locally.
 */
export async function relayDisputeShipping(tokenId) {
  try {
    tokenId = Number(tokenId);
    const res = await submitEscrowCall(
      buildDisputeShippingCall({ tokenId }),
      `disputeShipping(${tokenId})`
    );
    if (!res.success) return { success: false, error: res.error || "Dispute failed" };

    const order = await db.marketOrders.where({ orderType: "shipping", tokenId }).first();
    if (order) await db.marketOrders.update(order.key, { status: 3 }); // DISPUTED
    return { success: true, tokenId, txHash: res.txHash || null };
  } catch (err) {
    console.error("[Relayer] Dispute shipping failed:", err);
    return { success: false, error: err.message || "Failed to dispute shipping" };
  }
}

/**
 * Curator resolves a disputed shipping order on-chain. refundBuyer=true refunds
 * the buyer (returns token to seller); false releases funds to the seller.
 * The contract restricts this to the curator; mirrors the outcome locally.
 */
export async function relayResolveShippingDispute(tokenId, refundBuyer) {
  try {
    tokenId = Number(tokenId);
    const res = await submitEscrowCall(
      buildResolveShippingDisputeCall({ tokenId, refundBuyer: !!refundBuyer }),
      `resolveShippingDispute(${tokenId}, ${!!refundBuyer})`
    );
    if (!res.success) return { success: false, error: res.error || "Resolution failed" };

    const order = await db.marketOrders.where({ orderType: "shipping", tokenId }).first();
    if (order) {
      await db.marketOrders.update(order.key, {
        status: refundBuyer ? 4 : 2, // REFUNDED or RELEASED
      });
    }
    return { success: true, tokenId, txHash: res.txHash || null };
  } catch (err) {
    console.error("[Relayer] Resolve dispute failed:", err);
    return { success: false, error: err.message || "Failed to resolve shipping dispute" };
  }
}

/**
 * Settle an in-person / cash handshake locally. Removes the pending handshake
 * pre-image and marks the related order complete.
 */
export async function relaySettleHandshake({ purchaseId, tokenIds = [], buyer = "" } = {}) {
  try {
    if (purchaseId != null) {
      const order = await db.marketOrders.where({ orderType: "batch", purchaseId: Number(purchaseId) }).first();
      if (order) await db.marketOrders.update(order.key, { state: 1 });
      try { await db.pendingHandshakes.delete(Number(purchaseId)); } catch (e) {}
    }
    for (const tid of tokenIds) {
      const order = await db.marketOrders.where({ orderType: "shipping", tokenId: Number(tid) }).first();
      if (order) await db.marketOrders.update(order.key, { status: 2 });

      // Arrival Flow: mark specimen as in-person transit (buyer is carrying fish home)
      const specimen = await db.specimens.get(Number(tid));
      if (specimen && buyer) {
        await db.specimens.update(Number(tid), {
          ownerAddress: normalizeAddress(buyer),
          arrivalStatus: "transit",
          purchasedAt: Math.floor(Date.now() / 1000),
          purchaseType: "in-person",
        });
      }
    }
    return { success: true, txHash: null };
  } catch (err) {
    console.error("[Relayer] Handshake settle failed:", err);
    return { success: false, error: err.message || "Failed to settle handshake" };
  }
}

/**
 * Register a spawn locally and mint its offspring as local specimens.
 * Returns the generated spawnId and the list of offspring specimen IDs.
 */
export async function relaySpawn({
  sireId,
  damId,
  tankId = 0,
  speciesId,
  offspringCount = 0,
  ownerAddress = "",
  commonName = "Specimen",
  scientificName = "Unknown",
  ipfsMetadataUri = "",
  metadata = null,
} = {}) {
  try {
    const spawnId = Date.now();

    const spawn = {
      spawnId,
      sireId: Number(sireId),
      damId: Number(damId),
      tankId: Number(tankId),
      speciesId: Number(speciesId),
      status: 1, // Fry
      offspringIds: [],
      ownerAddress: normalizeAddress(ownerAddress),
      timestamp: Math.floor(Date.now() / 1000),
      metadata,
    };
    await db.spawns.put(spawn);

    // Fire-and-forget cloud sync so spawn activity is aggregable across users
    // (species pages surface "N spawns logged this month" from this table).
    syncSpawnToCloud({ ...spawn, commonName, scientificName }).catch(() => {});

    // Fire-and-forget on-chain spawn initiation via 4337 (non-blocking, batched)
    enqueueOnChain(
      buildInitiateSpawnCall({
        sireId: Number(sireId),
        damId: Number(damId),
        tankId: Number(tankId),
        ipfsLogUri: ipfsMetadataUri || ""
      }),
      `initiateSpawn(sire:${sireId}, dam:${damId})`
    );

    const offspringIds = [];
    for (let i = 0; i < Number(offspringCount); i++) {
      const res = await relayMintSpecimen({
        speciesId,
        birthTimestamp: Math.floor(Date.now() / 1000),
        breeder: ownerAddress,
        currentTankId: tankId,
        sireId,
        damId,
        ipfsMetadataUri,
        // Each offspring gets its own hosted document at its own serial's URL.
        metadataDocument: metadata,
        ownerAddress,
        commonName,
        scientificName,
      });
      if (res.success) offspringIds.push(res.specimenId);
    }

    await db.spawns.update(spawnId, { offspringIds });

    // Re-sync with the final offspring count now that fry have been minted
    // (the first sync above fires before offspringIds is known).
    const finalSpawn = await db.spawns.get(spawnId);
    if (finalSpawn) {
      syncSpawnToCloud({ ...finalSpawn, commonName, scientificName }).catch(() => {});
    }

    return { success: true, spawnId, offspringIds, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local spawn failed:", err);
    return { success: false, error: err.message || "Failed to register spawn" };
  }
}

/**
 * Approve / register a species locally (curator action) — writes to the
 * species catalog cache so it appears in selectors without an on-chain tx.
 */
export async function relayAddSpecies({
  scientificName,
  commonName,
  ipfsUri = "",
  careLevel = 0,
  minTemp = 0,
  maxTemp = 0,
  minPh = 0,
  maxPh = 0,
  contractAddress = "",
} = {}) {
  try {
    const speciesId = Date.now();
    const record = {
      speciesId,
      scientificName,
      commonName,
      contractAddress,
      ipfsUri,
      careLevel: Number(careLevel),
      minTempCelsiusX10: Math.round(Number(minTemp) * 10),
      maxTempCelsiusX10: Math.round(Number(maxTemp) * 10),
      minPhX10: Math.round(Number(minPh) * 10),
      maxPhX10: Math.round(Number(maxPh) * 10),
      active: true,
      cachedAt: Math.floor(Date.now() / 1000),
    };
    await db.speciesManifest.put(record);
    return { success: true, speciesId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local species add failed:", err);
    return { success: false, error: err.message || "Failed to add species" };
  }
}
