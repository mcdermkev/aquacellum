/**
 * specimenLifecycle.js — the only place specimen lifecycle state is written.
 *
 * THE RULE: a birth certificate is never destroyed. This is a lineage tracker —
 * a certificate is referenced by `sireId`/`damId` on every descendant, by
 * listings, by orders, and by exported pedigree documents. Deleting one doesn't
 * remove a fish from the world; it silently orphans everything downstream of it.
 * So this module has no delete. It has:
 *
 *   - RETIRE — the fish left your care. A real lifecycle outcome, recorded on the
 *     certificate: Deceased or Rehomed (see RETIREMENT_OUTCOMES).
 *   - ARCHIVE — "get this off my screen." A VISIBILITY concern, not a lifecycle
 *     one. The certificate stays intact and fully resolvable; it just stops
 *     appearing in tank views and parent pickers. This replaces what used to be
 *     a `db.specimens.delete` call in TankList's Farewell modal — which was both
 *     destructive AND ineffective, since `pullCloudDataForWallet` re-inserts any
 *     cloud row missing locally, so the "deleted" record returned on next login.
 *
 * INDIVIDUALS vS COHORTS: none of this applies to eggs or fry that didn't make
 * it. Fish spawn in the hundreds, so eggs and fry are tracked as COUNTS on the
 * spawn's grow-out checkpoints (`fry_count` / `loss` / `cull` / `sold`), not as
 * individual certificates. A fry that dies is a `loss` count, and there was never
 * a certificate to retire or archive. Certificates are for fish you individually
 * track — the ones you keep, name, sell, or breed from. See
 * docs/BREEDER_STATE_MODEL.md §4.1.
 */

import { db } from "../db";
import { syncSpecimenToCloud, syncTankToCloud } from "./cloudSync";
import { RETIREMENT_OUTCOMES } from "../utils/specimenIdentity";

/** True when a specimen has been hidden from tank views and pickers. */
export function isArchived(specimen) {
  return !!specimen?.archived;
}

/**
 * Detach a specimen from whatever tank currently holds it, keeping the tank's
 * embedded `specimens` array and the specimen's `currentTankId` in agreement.
 * Returns the tank id it was removed from, or 0.
 */
async function detachFromTank(specimenId, knownTankId = null) {
  const id = Number(specimenId);
  let tankId = Number(knownTankId || 0);
  if (!tankId) {
    const spec = await db.specimens.get(id);
    tankId = Number(spec?.currentTankId || 0);
  }
  if (!tankId) return 0;

  const tank = await db.tanks.get(tankId);
  if (tank) {
    const remaining = (tank.specimens || []).filter((s) => Number(s.id) !== id);
    await db.tanks.update(tankId, { specimens: remaining });
    const updatedTank = await db.tanks.get(tankId);
    if (updatedTank) syncTankToCloud(updatedTank).catch(() => {});
  }
  return tankId;
}

/**
 * Record that specimens left the owner's care.
 *
 * @param {Array<number>|number} specimenIds
 * @param {number} status - must be one of RETIREMENT_OUTCOMES (Deceased | Rehomed)
 * @returns {Promise<{ok: boolean, updated: number[], error?: string}>}
 */
export async function retireSpecimens(specimenIds, status) {
  const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).map(Number);

  // Guard, not a convenience: an unchecked status here is how "retire" used to
  // silently mean "deceased". Active is not a retirement, and neither is any
  // out-of-range value.
  if (!RETIREMENT_OUTCOMES.some((o) => o.status === status)) {
    console.warn("[SpecimenLifecycle] Refusing to retire with a non-retirement status:", status);
    return { ok: false, updated: [], error: "Invalid retirement status" };
  }

  const updated = [];
  for (const id of ids) {
    try {
      await detachFromTank(id);
      await db.specimens.update(id, { status, currentTankId: 0, retiredAt: nowSeconds() });
      const spec = await db.specimens.get(id);
      if (spec) syncSpecimenToCloud(spec).catch(() => {});
      updated.push(id);
    } catch (err) {
      console.warn(`[SpecimenLifecycle] Failed to retire specimen ${id}:`, err);
    }
  }
  return { ok: updated.length === ids.length, updated };
}

/**
 * Hide specimens from tank views and parent pickers WITHOUT destroying their
 * certificates and WITHOUT claiming an outcome that didn't happen.
 *
 * For a mis-entry, a duplicate, or a fish whose fate you simply don't know.
 * `status` is left untouched — archiving is not a lifecycle event. The
 * certificate remains resolvable by serial, so lineage, pedigree exports, and
 * COI still see it and every descendant keeps a valid parent reference.
 *
 * @param {Array<number>|number} specimenIds
 * @returns {Promise<{ok: boolean, updated: number[]}>}
 */
export async function archiveSpecimens(specimenIds) {
  const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).map(Number);
  const updated = [];
  for (const id of ids) {
    try {
      await detachFromTank(id);
      await db.specimens.update(id, {
        archived: true,
        archivedAt: nowSeconds(),
        currentTankId: 0,
      });
      const spec = await db.specimens.get(id);
      if (spec) syncSpecimenToCloud(spec).catch(() => {});
      updated.push(id);
    } catch (err) {
      console.warn(`[SpecimenLifecycle] Failed to archive specimen ${id}:`, err);
    }
  }
  return { ok: updated.length === ids.length, updated };
}

/**
 * Bring an archived certificate back into view. The counterpart to
 * {@link archiveSpecimens} — because "hidden" must be reversible, or it's just a
 * delete with extra steps.
 *
 * @param {Array<number>|number} specimenIds
 */
export async function unarchiveSpecimens(specimenIds) {
  const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).map(Number);
  const updated = [];
  for (const id of ids) {
    try {
      await db.specimens.update(id, { archived: false, archivedAt: null });
      const spec = await db.specimens.get(id);
      if (spec) syncSpecimenToCloud(spec).catch(() => {});
      updated.push(id);
    } catch (err) {
      console.warn(`[SpecimenLifecycle] Failed to unarchive specimen ${id}:`, err);
    }
  }
  return { ok: updated.length === ids.length, updated };
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
