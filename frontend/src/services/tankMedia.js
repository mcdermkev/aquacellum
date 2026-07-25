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

const MIRROR_LS = true; // keep localStorage in sync until the UI is migrated off it

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
      const key = refType === "tank" ? `aquadex_tank_photo_${refId}` : `aquadex_specimen_photo_${refId}`;
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
      const key = refType === "tank" ? `aquadex_tank_photo_${refId}` : `aquadex_specimen_photo_${refId}`;
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
