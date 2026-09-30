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

/**
 * Every publication this device remembers for `wallet`, as
 * `[{ tankId, token, publicUrl, isPublic, updatedAt }]`. Entries that are not
 * valid JSON or have no valid token are skipped. Never throws.
 */
export function listTankPublications(wallet, storage = defaultStorage()) {
  const w = String(wallet || "").trim().toLowerCase();
  if (!w || !storage) return [];
  const prefix = `${STORAGE_PREFIX}${w}:`;
  let count = 0;
  try {
    count = Number(storage.length) || 0;
  } catch {
    return [];
  }
  const keys = [];
  for (let i = 0; i < count; i++) {
    let key = null;
    try {
      key = storage.key(i);
    } catch {
      continue;
    }
    if (typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length) keys.push(key);
  }
  const out = [];
  for (const key of keys) {
    const tankId = key.slice(prefix.length);
    const publication = readTankPublication(w, tankId, storage);
    if (publication) out.push({ tankId, ...publication });
  }
  return out;
}

/**
 * The id of this wallet's tank that was published under `token`, as stored
 * (a string), or null when this device has no such publication.
 */
export function findTankIdByPublicToken(wallet, token, storage = defaultStorage()) {
  const t = typeof token === "string" ? token.trim() : "";
  if (!TOKEN_RE.test(t)) return null;
  const match = listTankPublications(wallet, storage).find((p) => p.token === t);
  return match ? match.tankId : null;
}

// ─── Reading a scanned label ─────────────────────────────────────────────────

const PRIVATE_TANK_PARAM_RE = /(?:^|[#?&])tank=(\d+)(?=&|$)/i;
const PUBLIC_TANK_PATH_RE = /^\/t\/([A-Za-z0-9_-]{16,128})\/?$/;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST_PATH_RE = /^[^/\s#?]+\.[^/\s#?]+\//; // "aquacellum.com/t/..." typed without https://

/**
 * What a scanned (or typed) tank label points at. Pure.
 *
 * @param {unknown} text - the QR payload or manual entry
 * @returns {{ kind: "private", tankId: number } | { kind: "public", token: string } | { kind: "unknown" }}
 *   - private: a bare tank number, or any http(s) origin with path `/app` and a
 *              numeric `tank=` in the hash or query (`/app#tank=123`)
 *   - public:  any http(s) origin with path `/t/<token>` (16 to 128 of [A-Za-z0-9_-])
 *   - unknown: anything else
 */
export function parseTankScan(text) {
  const unknown = { kind: "unknown" };
  if (text === null || text === undefined) return unknown;
  let raw = String(text).trim();
  if (!raw || raw.length > 2048) return unknown;

  if (/^\d+$/.test(raw)) return { kind: "private", tankId: Number(raw) };

  if (!HAS_SCHEME_RE.test(raw) && BARE_HOST_PATH_RE.test(raw)) raw = `https://${raw}`;

  let u;
  try {
    u = new URL(raw, `${APP_ORIGIN}/`);
  } catch {
    return unknown;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return unknown;

  if (u.pathname.replace(/\/+$/, "") === "/app") {
    const m = u.hash.match(PRIVATE_TANK_PARAM_RE) || u.search.match(PRIVATE_TANK_PARAM_RE);
    return m ? { kind: "private", tankId: Number(m[1]) } : unknown;
  }

  const pm = u.pathname.match(PUBLIC_TANK_PATH_RE);
  if (pm) return { kind: "public", token: pm[1] };

  return unknown;
}

/**
 * What the in-app scanner should do with a scan. Pure apart from reading this
 * device's remembered publications.
 *
 * @param {unknown} text - the QR payload or manual entry
 * @param {{ tanks?: Array, wallet?: string|null, storage?: Storage|null }} ctx
 * @returns
 *   { action: "open", tank }             - one of the user's tanks: open it
 *   { action: "not-found", tankId }      - a private label for a tank not in this account
 *   { action: "public", token, url }     - someone's public tank page (`/t/<token>`, same origin)
 *   { action: "unknown" }                - not a tank label
 *
 * A public label for a tank this wallet published from this device opens the
 * tank, the same as its private label would.
 */
export function resolveTankScan(text, { tanks = [], wallet = null, storage } = {}) {
  const list = Array.isArray(tanks) ? tanks : [];
  const scan = parseTankScan(text);

  if (scan.kind === "private") {
    const tank = list.find((t) => Number(t?.id) === Number(scan.tankId));
    return tank ? { action: "open", tank } : { action: "not-found", tankId: scan.tankId };
  }

  if (scan.kind === "public") {
    const ownedId = findTankIdByPublicToken(wallet, scan.token, storage);
    const tank = ownedId !== null ? list.find((t) => tankIdOf(t) === ownedId) : null;
    if (tank) return { action: "open", tank };
    return { action: "public", token: scan.token, url: `/t/${scan.token}` };
  }

  return { action: "unknown" };
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
