/**
 * tankMedia.js — Durable photo storage for tanks and specimens (Logbook Rework Task 1).
 *
 * Photos were previously base64-stuffed into localStorage under
 * `aquadex_tank_photo_<id>` / `aquadex_specimen_photo_<id>`, which hits the ~5MB
 * quota fast, isn't synced across devices, and is lost on cache clear. This
 * module reads/writes the Dexie `tankMedia` table instead.
 *
 * Sequencing note: the v23 migration COPIES existing localStorage photos into
 * `tankMedia` but does not delete them, and the current UI still reads
 * localStorage directly. These accessors are the forward path; the surface
 * rework (Tasks 4/5) will switch reads/writes over and then free localStorage.
 * Until then, `putTankPhoto` mirrors to localStorage too, so old and new reads
 * stay in sync.
 */

import { db } from "../db";

/**
 * Keep localStorage in sync until the UI is migrated off it.
 *
 * §9.3 deliberately moves the READS onto `resolveSpecimenPhoto` while leaving this
 * mirror ON. A release where reads have moved but the mirror still writes is safely
 * reversible: if it has to be rolled back, every photo written during it still exists
 * in localStorage, which is where the old readers look. Flipping both at once means a
 * rollback silently loses every photo that was only ever written to Dexie.
 *
 * FOLLOW-UP: flipping this to `false` (and then freeing the legacy keys) is the next
 * step, once this release has shipped and stuck.
 */
const MIRROR_LS = true;

/** The legacy localStorage blob key for either ref type. One definition, so the mirror
 *  writes exactly the key `resolveSpecimenPhoto` falls back to reading. */
function legacyPhotoKey(refType, refId) {
  return refType === "tank" ? `aquadex_tank_photo_${String(refId)}` : specimenPhotoKey(refId);
}

async function getPhoto(refType, refId) {
  try {
    const row = await db.tankMedia
      .where("[refType+refId]")
      .equals([refType, String(refId)])
      .last();
    return row?.dataUrl || null;
  } catch (e) {
    console.warn("[tankMedia] read failed:", e?.message);
    return null;
  }
}

async function putPhoto(refType, refId, dataUrl) {
  if (!dataUrl) return;
  try {
    const existing = await db.tankMedia
      .where("[refType+refId]")
      .equals([refType, String(refId)])
      .first();
    if (existing) {
      await db.tankMedia.update(existing.id, { dataUrl, createdAt: Date.now() });
    } else {
      await db.tankMedia.add({ refType, refId: String(refId), dataUrl, createdAt: Date.now() });
    }
    if (MIRROR_LS && typeof localStorage !== "undefined") {
      const key = legacyPhotoKey(refType, refId);
      try { localStorage.setItem(key, dataUrl); } catch { /* quota — Dexie is the source of truth */ }
    }
  } catch (e) {
    console.warn("[tankMedia] write failed:", e?.message);
  }
}

async function deletePhoto(refType, refId) {
  try {
    const rows = await db.tankMedia.where("[refType+refId]").equals([refType, String(refId)]).toArray();
    await Promise.all(rows.map((r) => db.tankMedia.delete(r.id)));
    if (MIRROR_LS && typeof localStorage !== "undefined") {
      const key = legacyPhotoKey(refType, refId);
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn("[tankMedia] delete failed:", e?.message);
  }
}

export const getTankPhoto = (tankId) => getPhoto("tank", tankId);
export const putTankPhoto = (tankId, dataUrl) => putPhoto("tank", tankId, dataUrl);
export const deleteTankPhoto = (tankId) => deletePhoto("tank", tankId);

export const getSpecimenPhoto = (specimenId) => getPhoto("specimen", specimenId);
export const putSpecimenPhoto = (specimenId, dataUrl) => putPhoto("specimen", specimenId, dataUrl);
export const deleteSpecimenPhoto = (specimenId) => deletePhoto("specimen", specimenId);

/* ───────────────────────────── specimen photo resolution ─────────────────────────── */

/**
 * Where a specimen photo came from. Reported alongside the URL so a caller can say
 * which copy it got instead of implying the copies are equivalent.
 */
export const SPECIMEN_PHOTO_SOURCE = Object.freeze({
  /** The copy recorded on the record itself — a CDN URL from the `specimen-photos` bucket. Works on a device that never saw the fish. */
  HOSTED: "hosted",
  /** The durable local copy: the Dexie `tankMedia` row. Survives a cache clear. */
  LOCAL: "local",
  /** The pre-§9.3 `aquadex_specimen_photo_<id>` localStorage blob. Device-local, quota-bound. */
  LEGACY_LOCAL_STORAGE: "legacyLocalStorage",
  /** No photo anywhere. The caller must render its own placeholder — never a stand-in URL. */
  NONE: "none",
});

/** The legacy localStorage blob key. Exported so migration, callers and tests agree on it. */
export function specimenPhotoKey(specimenId) {
  return `aquadex_specimen_photo_${String(specimenId)}`;
}

/**
 * Where a successful upload to the `specimen-photos` bucket records its public URL.
 * Separate from the blob key: this holds a short URL, not a base64 image.
 */
export function hostedSpecimenPhotoUrlKey(specimenId) {
  return `aquadex_specimen_photo_url_${String(specimenId)}`;
}

function readLocalStorageKey(key) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

/** The recorded hosted URL for a specimen, or `null`. */
export function readHostedSpecimenPhotoUrl(specimenId) {
  return readLocalStorageKey(hostedSpecimenPhotoUrlKey(specimenId));
}

/** Record the public URL of an uploaded photo so other devices can resolve it. */
export function recordHostedSpecimenPhotoUrl(specimenId, url) {
  if (!url || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(hostedSpecimenPhotoUrlKey(specimenId), url);
  } catch { /* quota — the Dexie copy still resolves locally */ }
}

/**
 * Forget the recorded hosted URL. Must be called whenever a photo is DELETED:
 * otherwise the hosted step below keeps resolving a photo the keeper removed.
 */
export function clearHostedSpecimenPhotoUrl(specimenId) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(hostedSpecimenPhotoUrlKey(specimenId));
  } catch { /* ignore */ }
}

/**
 * Resolve a specimen's photo. THE one precedence order — call sites must not build
 * their own fallback chains, which is how the seven readers this replaced drifted.
 *
 *   1. **Hosted** — the copy recorded alongside the record: either handed in as
 *      `hostedUrl` (e.g. a listing's `photoUrl` pulled from the cloud) or read from
 *      `aquadex_specimen_photo_url_<id>` after a successful bucket upload. First
 *      because it is the only copy that resolves on a device that never had the fish.
 *   2. **Local** — the durable Dexie `tankMedia` row. Survives a cache clear.
 *   3. **Legacy localStorage** — the pre-§9.3 blob, for photos taken before the
 *      Dexie table existed and never re-saved.
 *   4. **None**.
 *
 * Nothing is fabricated. If no copy exists anywhere the result is
 * `{ url: null, source: "none" }`, which the caller must render as absent (its own
 * silhouette / master species image), never as a placeholder photo of this fish.
 *
 * Note on `hostedUrl`: "hosted" means "the copy travelling with the record", which for
 * listings written before the bucket upload path landed can still be an inline `data:`
 * blob rather than a CDN URL. It is accepted as-is — dropping it would blank a photo a
 * remote buyer can see today — but see the report in docs for which writers do and do
 * not yet produce a real CDN URL.
 *
 * @param {number|string} specimenId
 * @param {object} [options]
 * @param {string} [options.hostedUrl] - a URL recorded on the record (listing `photoUrl`).
 * @returns {Promise<{url: string|null, source: string}>}
 */
export async function resolveSpecimenPhoto(specimenId, { hostedUrl = "" } = {}) {
  if (specimenId === null || specimenId === undefined || specimenId === "") {
    return { url: null, source: SPECIMEN_PHOTO_SOURCE.NONE };
  }

  const hosted =
    (typeof hostedUrl === "string" && hostedUrl ? hostedUrl : null) ||
    readHostedSpecimenPhotoUrl(specimenId);
  if (hosted) return { url: hosted, source: SPECIMEN_PHOTO_SOURCE.HOSTED };

  const local = await getSpecimenPhoto(specimenId);
  if (local) return { url: local, source: SPECIMEN_PHOTO_SOURCE.LOCAL };

  const legacy = readLocalStorageKey(specimenPhotoKey(specimenId));
  if (legacy) return { url: legacy, source: SPECIMEN_PHOTO_SOURCE.LEGACY_LOCAL_STORAGE };

  return { url: null, source: SPECIMEN_PHOTO_SOURCE.NONE };
}
