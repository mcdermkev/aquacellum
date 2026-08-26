/**
 * Live Spec-Dex catalog loader.
 *
 * Primary source: Supabase `species_profiles` WHERE published=true, with living
 * counts joined from view `public.species_living` (already mapped through
 * species_id_map — never join aquadex_specimens.species_id = spec_code).
 *
 * Fallback / offline cache: fishbase_master.json (still shipped via vercel.json
 * includeFiles so this function stays inside the Hobby 12-function ceiling).
 *
 * Living timestamps (last_logged_at, last_spawn_at) are unix SECONDS.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

const PLANT_GENERA = /^(Lemna|Taxiphyllum|Ludwigia|Cryptocoryne|Leptochilus|Echinodorus|Anubias|Limnobium|Vallisneria|Hygrophila|Vesicularia|Bucephalandra|Bacopa)$/i;
const INVERT_GENERA = /^(Neocaridina|Caridina|Palaemonetes|Pomacea|Melanoides|Planorbella|Neritina|Physella|Ambystoma)$/i;
const INVERT_FAMILIES = new Set([
  "atyidae", "palaemonidae", "ampullariidae", "planorbidae",
  "neritidae", "thiaridae", "physidae", "ambystomatidae",
]);

export function toSlug(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function inferCardKind(sp) {
  const explicit = String(sp.cardKind || sp.card_kind || sp.type || "").toLowerCase();
  if (explicit === "plant" || explicit === "invert" || explicit === "fish") return explicit;
  const fam = String(sp.family || "").toLowerCase();
  if (INVERT_FAMILIES.has(fam)) return "invert";
  const genus = String(sp.genus || (sp.scientificName || "").split(" ")[0] || "");
  if (PLANT_GENERA.test(genus)) return "plant";
  if (INVERT_GENERA.test(genus)) return "invert";
  return "fish";
}

function aliasesOf(value) {
  if (Array.isArray(value)) return value.filter((a) => typeof a === "string" && a.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/**
 * Card <img> reads masterPhotoUrl. Live profiles store it on the JSON blob
 * (gold-standard Betta splendens 4768: /species-images/wikimedia-resized/betta-splendens.png).
 * Collapse our own absolute origins so preview/prod hit the same static asset.
 */
export function normalizeMasterPhotoUrl(profile, row) {
  const raw =
    (profile && profile.masterPhotoUrl) ||
    (profile && profile.imageUrl) ||
    row?.master_photo_url ||
    row?.image_url ||
    "";
  if (typeof raw !== "string") return "";
  let url = raw.trim();
  if (!url || url === "null" || url === "undefined") return "";
  url = url.replace(
    /^https?:\/\/(www\.)?(aquadex\.fish|aquacellum\.com|aquacellum\.vercel\.app)/i,
    ""
  );
  return url;
}

/**
 * Shape a published profile row + optional species_living row into the catalog
 * record the Spec-Dex pages already consume (fishbase_master.json paths), plus
 * living / alias / card_kind fields. Identity columns on the row always win
 * over whatever is nested in `profile`.
 */
export function rowToCatalogEntry(row, living = null) {
  const profile = row?.profile && typeof row.profile === "object" ? row.profile : {};
  const live = living || {};
  const aliases = aliasesOf(row?.common_aliases).length
    ? aliasesOf(row.common_aliases)
    : aliasesOf(live.common_aliases);

  const entry = {
    ...profile,
    specCode: row?.spec_code ?? profile.specCode ?? null,
    scientificName: row?.scientific_name || profile.scientificName || null,
    commonName: row?.common_name || profile.commonName || null,
    masterPhotoUrl: normalizeMasterPhotoUrl(profile, row),
    commonAliases: aliases,
    conservationStatus: row?.conservation_status ?? live.conservation_status ?? null,
    cardKind: row?.card_kind || live.card_kind || inferCardKind(profile),
    keepersRunning: live.keepers_running ?? null,
    specimensKept: live.specimens_kept ?? null,
    tanksKeeping: live.tanks_keeping ?? null,
    lastLoggedAt: live.last_logged_at ?? null,
    lastSpawnAt: live.last_spawn_at ?? null,
  };
  entry.cardKind = inferCardKind(entry);
  return entry;
}

function annotateJsonRecord(sp) {
  return {
    ...sp,
    masterPhotoUrl: normalizeMasterPhotoUrl(sp, sp),
    commonAliases: aliasesOf(sp.commonAliases || sp.common_aliases),
    conservationStatus: sp.conservationStatus ?? sp.conservation_status ?? null,
    cardKind: inferCardKind(sp),
    keepersRunning: sp.keepersRunning ?? null,
    specimensKept: sp.specimensKept ?? null,
    tanksKeeping: sp.tanksKeeping ?? null,
    lastLoggedAt: sp.lastLoggedAt ?? null,
    lastSpawnAt: sp.lastSpawnAt ?? null,
  };
}

function buildIndexes(list) {
  const bySpecCode = new Map();
  const bySlug = new Map();
  for (const sp of list) {
    if (sp.specCode != null) bySpecCode.set(String(sp.specCode), sp);
    const slug = toSlug(sp.scientificName);
    if (slug) bySlug.set(slug, sp);
    const commonSlug = toSlug(sp.commonName);
    if (commonSlug && !bySlug.has(commonSlug)) bySlug.set(commonSlug, sp);
    for (const alias of sp.commonAliases || []) {
      const a = toSlug(alias);
      if (a && !bySlug.has(a)) bySlug.set(a, sp);
    }
  }
  return { bySpecCode, bySlug };
}

function jsonFallbackPaths() {
  return [
    join(process.cwd(), "public", "fishbase_master.json"),
    join(process.cwd(), "..", "public", "fishbase_master.json"),
    join(process.cwd(), "frontend", "public", "fishbase_master.json"),
  ];
}

export function loadJsonCatalog() {
  let raw = null;
  for (const p of jsonFallbackPaths()) {
    try {
      raw = readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(annotateJsonRecord);
  } catch (err) {
    console.error("[species catalog] fishbase_master.json parse failed:", err?.message || err);
    return [];
  }
}

function catalogClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchAll(client, table, columns, filterFn) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function loadLiveCatalog() {
  const client = catalogClient();
  if (!client) return null;

  const profiles = await fetchAll(
    client,
    "species_profiles",
    "spec_code, scientific_name, common_name, profile, common_aliases, conservation_status, card_kind, published",
    (q) => q.eq("published", true)
  );
  if (!profiles.length) return null;

  let livingByCode = new Map();
  try {
    // SELECT from the view. Do not join aquadex_specimens.species_id = spec_code
    // — that column is the on-chain id (1–282); the view already goes through
    // species_id_map.
    const living = await fetchAll(
      client,
      "species_living",
      "spec_code, keepers_running, specimens_kept, tanks_keeping, last_logged_at, last_spawn_at, card_kind, conservation_status, common_aliases"
    );
    livingByCode = new Map(living.map((row) => [row.spec_code, row]));
  } catch (err) {
    console.warn("[species catalog] species_living unavailable:", err?.message || err);
  }

  return profiles.map((row) => rowToCatalogEntry(row, livingByCode.get(row.spec_code) || null));
}

let cache = null;
let inflight = null;

/**
 * @returns {Promise<{ catalog: object[], bySpecCode: Map, bySlug: Map, source: string }>}
 */
export async function loadSpeciesCatalog() {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    let catalog = [];
    let source = "fishbase_master.json";
    try {
      const live = await loadLiveCatalog();
      if (live && live.length) {
        catalog = live;
        source = "species_profiles";
      }
    } catch (err) {
      console.warn("[species catalog] live species_profiles failed, using JSON cache:", err?.message || err);
    }

    if (!catalog.length) {
      catalog = loadJsonCatalog();
      source = "fishbase_master.json";
      if (!catalog.length) {
        console.error("[species catalog] fishbase_master.json not found in any expected path");
      }
    }

    const { bySpecCode, bySlug } = buildIndexes(catalog);
    cache = { catalog, bySpecCode, bySlug, source };
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
