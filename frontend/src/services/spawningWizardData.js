/**
 * spawningWizardData.js — the Spawning wizard's local-first reads.
 *
 * `SpawningWizard.loadWizardData` used to hammer the RPC on every mount for data
 * that was already in IndexedDB (docs/BREEDER_STATE_MODEL.md §9.12): one
 * `speciesCatalog(i)` per registered species, `ownerOf(i)` + `specimens(i)` for
 * EVERY token ever minted just to keep the caller's own fish, and two unbounded
 * `while (true)` walks over `tankParameterLogs`. The wizard needs species names
 * and a water snapshot; it does not need a full-registry scan to get them.
 *
 * ── PRECEDENTS THIS FOLLOWS ─────────────────────────────────────────────────
 *
 * `services/cohortPromotion.js` → `resolveSpeciesNames` faced the same species
 * problem and solved it by reading a sibling certificate out of Dexie, with the
 * relayer's honest defaults as the last step rather than a guess. Its comment
 * names §9.12 as the open item; this module is that item closed.
 *
 * `SpawningDashboard.loadDashboardData` already resolves the same catalog from
 * `db.species` plus `db.speciesManifest`, so this reads those two tables in that
 * same order rather than inventing a third source.
 *
 * `services/pedigree.js` explains why the contract is not merely slower but
 * WRONG for this: `sireId`/`damId` hold local serials, and the contract assigns
 * token ids from a global counter, so `contract.specimens(serial)` silently
 * returns a real but different fish. Nothing here resolves a serial through the
 * contract.
 *
 * ── NOTHING IS FABRICATED TO FILL A GAP ─────────────────────────────────────
 *
 * A species with no name recorded gets NO catalog entry, so the caller's own
 * `Species ID N` fallback shows through instead of a blank label or an invented
 * name. A water parameter that the local record does not carry comes back
 * `null`, never `0` — 0.00 ppm ammonia is a clean tank, and claiming it from
 * absent data is the kind of confident wrong number this work stream removes.
 * An empty catalog and an empty tank list are real findings, returned as such.
 */

import { db } from "../db";

/**
 * Record one species, if it actually names the species.
 *
 * First source wins, so callers control precedence by call order. An entry with
 * neither name is not knowledge and is skipped: the wizard's labels fall back to
 * `Species ID N`, which is honest, whereas an empty-string entry would render as
 * nothing at all.
 *
 * @returns {boolean} whether an entry was added
 */
function addSpeciesEntry(catalog, rawId, record) {
  const speciesId = Number(rawId);
  if (!Number.isFinite(speciesId) || speciesId <= 0) return false;
  if (catalog[speciesId]) return false;

  const commonName = String(record?.commonName || "").trim();
  const scientificName = String(record?.scientificName || "").trim();
  if (!commonName && !scientificName) return false;

  catalog[speciesId] = { commonName, scientificName };
  return true;
}

/**
 * The species catalog, entirely from Dexie.
 *
 * Precedence, matching SpawningDashboard:
 *   1. `db.species` — the curated local species list.
 *   2. `db.speciesManifest` — the cached curator-approved on-chain catalog,
 *      filling only the ids step 1 didn't cover.
 *
 * Either table can be absent on an older local database, which is why each read
 * stands alone: a missing table costs you that source, not the whole catalog.
 *
 * @returns {Promise<Record<number, {commonName: string, scientificName: string}>>}
 */
export async function loadLocalSpeciesCatalog() {
  const catalog = {};

  try {
    const speciesRecords = await db.table("species").toArray();
    for (const sp of speciesRecords) {
      addSpeciesEntry(catalog, sp?.speciesId || sp?.id || sp?.specCode, sp);
    }
  } catch {
    // Table absent in older DB versions — the manifest below may still cover it.
  }

  try {
    const manifest = await db.speciesManifest.toArray();
    for (const sp of manifest) {
      addSpeciesEntry(catalog, sp?.speciesId, sp);
    }
  } catch {
    // Same: a missing manifest is one fewer source, not an error.
  }

  return catalog;
}

/**
 * Fill remaining gaps from the names carried on the caller's own certificates.
 *
 * Same idea as `cohortPromotion.resolveSpeciesNames` step 2: a certificate of
 * that species is nearly always on the device, and its name came from the
 * catalog in the first place. Species with no named certificate stay absent.
 *
 * @param {object} catalog - result of `loadLocalSpeciesCatalog`
 * @param {Array<{speciesId: number, commonName?: string, scientificName?: string}>} specimens
 * @returns {object} a new catalog; the input is not mutated
 */
export function enrichSpeciesCatalogFromSpecimens(catalog, specimens) {
  const merged = { ...(catalog || {}) };
  for (const spec of specimens || []) {
    addSpeciesEntry(merged, spec?.speciesId, spec);
  }
  return merged;
}

/**
 * One scaled field, or `null` when it wasn't recorded.
 *
 * `null` propagates all the way to an em dash in the tile and to an OMITTED
 * metadata trait. It must never become 0.
 */
function scaled(value, divisor, digits) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return (n / divisor).toFixed(digits);
}

/**
 * Normalize a local water log into the wizard's snapshot shape.
 *
 * Tolerates both local shapes, the same way `utils/tankHealth.normalizeReading`
 * does:
 *   - the fixed-point log `relayLogWaterParameters` writes to
 *     `tanks.latestLog` / `tanks.logs` (`tempCelsiusX10`, `ammoniaPpmX100`, …)
 *   - a decimal `paramReadings` row (`temp`, `ammonia`, …)
 *
 * A row that carries no parameter at all is not a snapshot, so it returns
 * `null` and the caller reports "no telemetry logged" rather than showing five
 * dashes and a date.
 *
 * @param {object|null} log
 * @returns {{temp: string|null, ph: string|null, ammonia: string|null,
 *            nitrite: string|null, nitrate: string|null,
 *            gh: string|null, kh: string|null, tal: string|null,
 *            timestamp: number|null} | null}
 */
export function parameterSnapshotFromLog(log) {
  if (!log || typeof log !== "object") return null;

  const present = (key) => log[key] !== undefined && log[key] !== null;
  const snapshot = {
    temp: present("tempCelsiusX10") ? scaled(log.tempCelsiusX10, 10, 1) : scaled(log.temp, 1, 1),
    ph: present("phX10") ? scaled(log.phX10, 10, 1) : scaled(log.ph, 1, 1),
    ammonia: present("ammoniaPpmX100") ? scaled(log.ammoniaPpmX100, 100, 2) : scaled(log.ammonia, 1, 2),
    nitrite: present("nitritePpmX100") ? scaled(log.nitritePpmX100, 100, 2) : scaled(log.nitrite, 1, 2),
    nitrate: present("nitratePpmX100") ? scaled(log.nitratePpmX100, 100, 1) : scaled(log.nitrate, 1, 1),
    gh: present("ghX10") ? scaled(log.ghX10, 10, 1) : scaled(log.gh, 1, 1),
    kh: present("khX10") ? scaled(log.khX10, 10, 1) : scaled(log.kh, 1, 1),
    tal: present("talPpm") ? scaled(log.talPpm, 1, 0) : scaled(log.tal, 1, 0),
    timestamp: Number(log.timestamp) || null,
  };

  const measured = [snapshot.temp, snapshot.ph, snapshot.ammonia, snapshot.nitrite, snapshot.nitrate, snapshot.gh, snapshot.kh, snapshot.tal];
  if (measured.every((v) => v === null)) return null;

  return snapshot;
}

/**
 * The newest water snapshot recorded locally for one tank.
 *
 * The tank row is asked first because `relayLogWaterParameters` writes the log
 * there and enqueues the identical on-chain call — so the removed
 * `tankParameterLogs` walk was reading back what Dexie already held.
 * `paramReadings` is consulted only when the tank row has no log: it is the
 * Logbook's own readings table (partly backfilled from historical water tests),
 * so it can be the only local record of a test, and it can be partial.
 */
async function latestLocalSnapshot(tank) {
  const logs = Array.isArray(tank?.logs) ? tank.logs : [];
  const logged = tank?.latestLog || (logs.length > 0 ? logs[logs.length - 1] : null);
  const fromTank = parameterSnapshotFromLog(logged);
  if (fromTank) return fromTank;

  try {
    // Historical rows key tankId as a number or a string — same key set
    // hooks/useUserTanks.js uses.
    const idKeys = [tank?.id, Number(tank?.id), String(tank?.id)];
    const readings = await db.paramReadings.where("tankId").anyOf(idKeys).toArray();
    const newest = (readings || []).reduce(
      (best, row) => ((Number(row?.timestamp) || 0) > (Number(best?.timestamp) || 0) ? row : best),
      null
    );
    return parameterSnapshotFromLog(newest);
  } catch {
    // Table absent pre-migration. No reading is a finding, not an error.
    return null;
  }
}

/**
 * The caller's tanks for the wizard's tank picker, with each one's newest local
 * water snapshot already attached as `latestReading`.
 *
 * Carrying the NORMALIZED snapshot rather than a raw log is deliberate: the two
 * local shapes are reconciled once, here, instead of at the point of display
 * where a missing field would have divided `undefined` and printed `NaN`.
 *
 * @param {string} walletAccount
 * @returns {Promise<Array<{id: number, name: string, volumeLiters: number,
 *                          latestReading: object|null}>>}
 */
export async function loadLocalBreedingTanks(walletAccount) {
  const owner = (walletAccount || "").toLowerCase();
  if (!owner) return [];

  let rows;
  try {
    rows = await db.tanks.where("ownerAddress").equals(owner).toArray();
  } catch (err) {
    console.warn("[SpawningWizardData] Local tank read failed:", err);
    return [];
  }

  const tanks = [];
  for (const row of rows) {
    if (row?.active === false) continue;
    tanks.push({
      id: Number(row.id),
      name: row.name,
      volumeLiters: Number(row.volumeLiters || 0),
      latestReading: await latestLocalSnapshot(row),
    });
  }
  return tanks;
}
