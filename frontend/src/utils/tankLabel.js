/**
 * tankLabel.js — what a tank's printed QR label points at. Pure; no React.
 *
 * A label that encodes `/app#tank=<id>` only works for the owner, on a device
 * that already has the tank, so a visitor at a fish room or club who scans it
 * gets nothing. A tank the owner has published has a public `/t/<token>` page
 * (api/storefront-detail.js `publish-tank` / `public-tank`, tank.html), and its
 * label should point there instead.
 *
 * Nothing here publishes anything. Publishing is an explicit user action in
 * TankLabelDialog, through the existing `publishTank` call.
 *
 * Publication state is remembered on this device (the server has no "is this
 * tank published" read, and the public token is unguessable on purpose).
 * Re-publishing the same tank returns the same token, so a label printed on one
 * device keeps working if the owner publishes again from another.
 */

import { livingInhabitants } from "../components/logbook/inhabitants.js";
import { tankKindLabel } from "./tankUtils.js";

export const APP_ORIGIN = "https://aquacellum.com";

/** Printed in small text on a private label, and shown in the dialog. */
export const PRIVATE_LABEL_NOTE = "Private label. Opens only in the owner's app.";

/** The public token the server mints: random hex today, bounded like the column. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const STORAGE_PREFIX = "aquadex:tank-publication:v1:";

function tankIdOf(tank) {
  const id = tank?.id;
  if (id === null || id === undefined) return null;
  const s = String(id).trim();
  return s ? s : null;
}

/**
 * The public URL for a publication, or null. Prefers the URL the server
 * returned, but only if it really is a `/t/<token>` page; otherwise builds it
 * from the token.
 */
export function publicTankUrl(publication) {
  if (!publication || typeof publication !== "object") return null;
  const token = typeof publication.token === "string" ? publication.token.trim() : "";
  if (!TOKEN_RE.test(token)) return null;
  const fallback = `${APP_ORIGIN}/t/${encodeURIComponent(token)}`;
  const raw = typeof publication.publicUrl === "string" ? publication.publicUrl.trim() : "";
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return fallback;
    if (u.pathname !== `/t/${token}`) return fallback;
    return `${u.origin}${u.pathname}`;
  } catch {
    return fallback;
  }
}

/** "aquacellum.com/t/abc…" — the URL as printed under the QR. */
export function shortUrlOf(url) {
  if (!url) return "";
  return String(url).replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/**
 * What the label for `tank` encodes, given what we know about its publication.
 *
 * @param {object|null} tank - a tank record (needs `id`)
 * @param {object|null} publication - `{ token, publicUrl?, isPublic? }` or null
 * @returns {{ kind: "public"|"private"|"none", tankId: string|null, url: string|null, shortUrl: string, note: string }}
 *   - public:  the `/t/<token>` page, no note
 *   - private: `/app#tank=<id>` with PRIVATE_LABEL_NOTE
 *   - none:    no tank id, nothing to encode
 */
export function tankLabelTarget(tank, publication) {
  const tankId = tankIdOf(tank);
  if (!tankId) return { kind: "none", tankId: null, url: null, shortUrl: "", note: "" };

  const isPublic = !!publication && publication.isPublic !== false;
  const publicUrl = isPublic ? publicTankUrl(publication) : null;
  if (publicUrl) {
    return { kind: "public", tankId, url: publicUrl, shortUrl: shortUrlOf(publicUrl), note: "" };
  }

  const url = `${APP_ORIGIN}/app#tank=${encodeURIComponent(tankId)}`;
  return { kind: "private", tankId, url, shortUrl: shortUrlOf(url), note: PRIVATE_LABEL_NOTE };
}

/** The stable, owner-scoped ref the server keys a publication on. */
export function tankRefFor(tank) {
  const tankId = tankIdOf(tank);
  return tankId ? `logbook-tank-${tankId}` : null;
}

/**
 * Exactly what publishing this tank sends, and so exactly what becomes public:
 * the tank name, one entry per species living in it (common and scientific
 * name), and the tank type and volume. No location (facility, room, rack), no
 * nicknames, notes, logs, photos, listings, prices, or wallet.
 */
export function tankPublicSnapshot(tank) {
  const title = String(tank?.name || "").trim().slice(0, 120) || "Aquarium";

  const specimens = [];
  const seen = new Set();
  for (const s of livingInhabitants(tank)) {
    const commonName = String(s?.commonName || "").trim();
    const rawSci = String(s?.scientificName || "").trim();
    const scientificName = rawSci && rawSci.toLowerCase() !== "unknown" ? rawSci : "";
    const name = commonName || scientificName;
    if (!name) continue;
    const key = `${name.toLowerCase()}|${scientificName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    specimens.push({ publicName: name, commonName: commonName || null, scientificName: scientificName || null });
    if (specimens.length >= 40) break; // server cap (PUBLIC_TANK_MAX_SPECIMENS)
  }

  const volume = Number(tank?.volumeLiters);
  const facts = {
    tankType: tank ? tankKindLabel(tank) : null,
    volumeLiters: Number.isFinite(volume) && volume > 0 ? volume : null,
  };

  return { title, specimens, facts };
}

// ─── This device's memory of what the owner published ───────────────────────

function storageKey(wallet, tankId) {
  const w = String(wallet || "").trim().toLowerCase();
  const t = String(tankId ?? "").trim();
  if (!w || !t) return null;
  return `${STORAGE_PREFIX}${w}:${t}`;
}

function defaultStorage() {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/** The remembered publication for this wallet's tank, or null. Never throws. */
export function readTankPublication(wallet, tankId, storage = defaultStorage()) {
  const key = storageKey(wallet, tankId);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !TOKEN_RE.test(String(parsed.token || ""))) return null;
    return {
      token: String(parsed.token),
      publicUrl: typeof parsed.publicUrl === "string" ? parsed.publicUrl : null,
      isPublic: parsed.isPublic !== false,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

/** Remember a publish-tank response for this wallet's tank. Never throws. */
export function saveTankPublication(wallet, tankId, response, storage = defaultStorage()) {
  const key = storageKey(wallet, tankId);
  if (!key || !storage || !response || !TOKEN_RE.test(String(response.token || ""))) return null;
  const record = {
    token: String(response.token),
    publicUrl: typeof response.publicUrl === "string" ? response.publicUrl : null,
    isPublic: response.isPublic !== false,
    updatedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage full or blocked: the label still works for this session.
  }
  return record;
}
