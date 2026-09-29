#!/usr/bin/env node
/**
 * Fetch commercially licensed species photos for catalog records that have
 * no `masterPhotoUrl`, marine records first.
 *
 * aquacellum.com is a commercial marketplace, so only CC0, public domain,
 * CC BY and CC BY-SA photos are accepted (any version). NC / ND / "all rights
 * reserved" photos are always rejected. The older scripts/fetch-species-images.cjs
 * is left untouched; this script reuses its source order (iNaturalist, then
 * Wikimedia Commons) with stricter species and license checks.
 *
 * Species confidence rules:
 *   - iNaturalist: the taxon must be an active species whose name equals the
 *     record's scientificName (or a `soldAs` synonym). Photos come from the
 *     taxon's curated photos (default first), then research-grade, non-captive
 *     observations of that exact taxon.
 *   - Wikimedia Commons: the file must be the Wikidata image (P18) of an item
 *     whose taxon name (P225) equals the scientificName, or a file in the exact
 *     `Category:<scientificName>`. Maps, drawings, skeletons, museum specimens
 *     and shop/sale photos are skipped by title.
 *
 * Images are saved as frontend/public/species-images/<genus>-<species>.jpg,
 * longest side <= 800 px, targeting <= 150 KB (sharp from frontend/node_modules).
 *
 * Usage (from the repo root):
 *   node scripts/fetch-marine-images.mjs                 fetch + apply
 *   node scripts/fetch-marine-images.mjs --dry-run       search only, no writes
 *   node scripts/fetch-marine-images.mjs --no-apply      download images, keep catalogs untouched
 *   node scripts/fetch-marine-images.mjs --apply-only    apply a previous --no-apply run
 *   node scripts/fetch-marine-images.mjs --list --only "Genus species"   list every usable candidate
 *   Options: --marine-only, --limit N, --only "Genus species,Genus species",
 *            --exclude inaturalist:<photoId> | --exclude "wikimedia:File:<title>"
 *            (repeatable; rejects a specific photo after visual review),
 *            --pick "Genus species=inaturalist:<photoId>" (repeatable; chooses a
 *            specific candidate from --list; name and license checks still apply)
 *
 * Network: read-only public API calls (~1 request/second) that send only
 * species names. Pending results are kept in the OS temp dir between runs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_CATALOG = path.join(ROOT, "frontend/public/fishbase_master.json");
const MIRROR_CATALOG = path.join(ROOT, "frontend/fishbase_master.json");
const IMAGES_DIR = path.join(ROOT, "frontend/public/species-images");
const ATTRIBUTIONS_PATH = path.join(IMAGES_DIR, "ATTRIBUTIONS.json");
const MANIFEST_PATH = path.join(os.tmpdir(), "aquacellum-species-photo-manifest.json");

const USER_AGENT =
  "AquacellumSpeciesPhotoFetcher/1.0 (+https://aquacellum.com; contact: kevin@aquacellum.com) read-only species photo lookup";
const MIN_INTERVAL_MS = 1100; // ~1 request per second across every host
const MAX_SIDE_PX = 800;
const TARGET_BYTES = 150 * 1024;
const RAW_FALLBACK_MAX_BYTES = 400 * 1024;
const MIN_SOURCE_SIDE_PX = 500;

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const DRY_RUN = flag("--dry-run") || flag("--list");
const NO_APPLY = flag("--no-apply");
const APPLY_ONLY = flag("--apply-only");
const MARINE_ONLY = flag("--marine-only");
const LIMIT = valueOf("--limit") ? Number.parseInt(valueOf("--limit"), 10) : Infinity;
const ONLY = new Set(
  (valueOf("--only") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const EXCLUDED = new Set(argv.filter((a, i) => argv[i - 1] === "--exclude"));
const LIST_MODE = flag("--list");
// --pick "Genus species=inaturalist:<photoId>" forces a specific (still name- and license-checked) photo.
const PICKS = new Map(
  argv
    .filter((a, i) => argv[i - 1] === "--pick" && a.includes("="))
    .map((a) => [a.slice(0, a.indexOf("=")).trim().toLowerCase().replace(/\s+/g, " "), a.slice(a.indexOf("=") + 1).trim()])
);
let currentPick = null; // pick for the record being processed
const listed = []; // --list: every usable candidate for the record being processed

// ---- Image tool ----
let sharp = null;
for (const base of [path.join(ROOT, "frontend/package.json"), path.join(ROOT, "package.json")]) {
  try {
    sharp = createRequire(base)("sharp");
    break;
  } catch {
    /* try the next location */
  }
}

// ---- Helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const isMarine = (r) => Array.isArray(r.waterTypes) && r.waterTypes.includes("marine");

function toImageFilename(scientificName) {
  return `${norm(scientificName).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}.jpg`;
}

/** CC0, public domain, CC BY, CC BY-SA (any version/port). Everything else is rejected. */
function isAllowedLicense(license) {
  const n = String(license || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (/\b(nc|nd)\b|non ?commercial|no ?deriv|all rights reserved|proprietary/.test(n)) return false;
  if (/^cc0\b|^cc zero\b/.test(n)) return true;
  if (/^(public domain|pd)\b/.test(n)) return true;
  return /^cc by( sa)?(\s|$)/.test(n);
}

/** Names a matched taxon may carry: the scientificName plus any listed soldAs synonyms. */
function acceptedNames(record) {
  const soldAs = Array.isArray(record.soldAs) ? record.soldAs : record.soldAs ? [record.soldAs] : [];
  return new Set([record.scientificName, ...soldAs.filter((s) => typeof s === "string")].map(norm));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

let lastRequestAt = 0;
async function request(url, { binary = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(3000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 3) throw new Error(`HTTP ${res.status} for ${url}`);
      await sleep(5000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error(`Request failed: ${url}`);
}

// ---- iNaturalist ----
function inatAuthor(photo, fallback) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  if (clean(photo.attribution_name)) return clean(photo.attribution_name);
  const m = /^(?:\(c\)|photo by|uploaded by)?\s*(.+?),\s*(?:some|all|no) rights reserved/i.exec(
    clean(photo.attribution)
  );
  return (m && m[1].trim()) || clean(fallback);
}

function inatCandidate(photo, fallbackAuthor) {
  if (!photo || !photo.id) return null;
  const dims = photo.original_dimensions;
  const license = photo.license_code || "";
  return {
    id: `inaturalist:${photo.id}`,
    source: "inaturalist",
    license,
    attribution: inatAuthor(photo, fallbackAuthor),
    sourceUrl: `https://www.inaturalist.org/photos/${photo.id}`,
    imageUrl: photo.large_url || String(photo.url || "").replace(/\/(square|small|medium|thumb)\./, "/large."),
    tooSmall: dims ? Math.max(dims.width, dims.height) < MIN_SOURCE_SIDE_PX : false,
    flagged: Array.isArray(photo.flags) && photo.flags.length > 0,
  };
}

const usable = (c) =>
  c &&
  !c.tooSmall &&
  !c.flagged &&
  c.imageUrl &&
  c.attribution &&
  isAllowedLicense(c.license) &&
  !EXCLUDED.has(c.id) &&
  (!currentPick || c.id === currentPick);

/** First usable candidate; in --list mode, record them all and keep searching. */
function choose(candidates, extra) {
  const ok = candidates.filter(usable).map((c) => ({ ...c, ...extra }));
  if (LIST_MODE) {
    listed.push(...ok);
    return null;
  }
  return ok[0] || null;
}

async function findINaturalist(record) {
  const names = acceptedNames(record);
  const search = await request(
    `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(record.scientificName)}&per_page=10`
  );
  const taxon = (search.results || []).find((t) => t.rank === "species" && t.is_active && names.has(norm(t.name)));
  if (!taxon) return { reason: "iNaturalist: no active species taxon with this exact name" };

  const detail = await request(`https://api.inaturalist.org/v1/taxa/${taxon.id}`);
  const full = (detail.results || [])[0] || taxon;
  const curated = (full.taxon_photos || []).filter((tp) => tp.taxon_id === taxon.id).map((tp) => tp.photo);
  if (curated.length === 0 && full.default_photo) curated.push(full.default_photo);
  const pick = choose(curated.map((p) => inatCandidate(p)), { via: "iNaturalist taxon photo", matchedName: full.name });
  if (pick) return { candidate: pick };

  const obs = await request(
    `https://api.inaturalist.org/v1/observations?taxon_id=${taxon.id}&quality_grade=research&captive=false` +
      `&photos=true&photo_license=cc0,cc-by,cc-by-sa&order_by=votes&per_page=30`
  );
  for (const o of obs.results || []) {
    if (!names.has(norm(o.taxon && o.taxon.name))) continue; // exact taxon only (no subspecies/lookalikes)
    const author = (o.user && (o.user.name || o.user.login)) || "";
    const c = choose(
      (o.photos || []).map((p) => inatCandidate(p, author)),
      { via: "iNaturalist research-grade observation", matchedName: o.taxon.name }
    );
    if (c) return { candidate: c };
  }
  return { reason: "iNaturalist: exact taxon found, but no CC0/CC BY/CC BY-SA photo" };
}

// ---- Wikimedia Commons (via Wikidata P18 and the species category) ----
const BAD_TITLE =
  /\b(map|range|distribution|drawing|illustration|diagram|lithograph|engraving|stamp|logo|skeleton|skull|x-?ray|museum|specimen|preserved|dried|herbarium|naturalis|mnhn|shop|store|sale|price|market|product|label|packag|aquarium shop|fish ?market|sketch|icon)\b|\.(svg|tiff?|gif|webm|ogv|pdf|djvu)$/i;

function commonsCandidate(page) {
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const license = (meta.LicenseShortName && meta.LicenseShortName.value) || "";
  let author = stripHtml(meta.Artist && meta.Artist.value).slice(0, 160);
  if (!author && /^(public domain|pd|cc0)/i.test(license)) author = "Unknown author (public domain)";
  return {
    id: `wikimedia:${page.title}`,
    source: "wikimedia",
    license,
    attribution: author,
    sourceUrl: info.descriptionurl,
    imageUrl: info.thumburl || info.url,
    tooSmall: Math.max(info.width || 0, info.height || 0) < MIN_SOURCE_SIDE_PX,
    flagged: BAD_TITLE.test(page.title) || !/^image\/(jpeg|png)$/.test(info.mime || ""),
    pixels: (info.width || 0) * (info.height || 0),
    title: page.title,
  };
}

const COMMONS_INFO =
  "prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=800" +
  "&iiextmetadatafilter=LicenseShortName|Artist|AttributionRequired&format=json";

async function findWikimedia(record) {
  const names = acceptedNames(record);
  const ordered = [];

  // 1) Wikidata items whose taxon name (P225) is exactly this name → their image (P18).
  const q = `haswbstatement:"P225=${record.scientificName}"`;
  const found = await request(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json`
  );
  const ids = ((found.query && found.query.search) || []).map((s) => s.title);
  const p18 = [];
  if (ids.length) {
    const ents = await request(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims&format=json`
    );
    for (const ent of Object.values(ents.entities || {})) {
      const claims = ent.claims || {};
      const taxonNames = (claims.P225 || []).map((c) => c.mainsnak?.datavalue?.value);
      if (!taxonNames.some((n) => names.has(norm(n)))) continue;
      for (const c of claims.P18 || []) {
        const file = c.mainsnak?.datavalue?.value;
        if (file) p18.push(`File:${file}`);
      }
    }
  }
  if (p18.length) {
    const info = await request(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(p18.join("|"))}&${COMMONS_INFO}`
    );
    ordered.push(...Object.values((info.query && info.query.pages) || {}).map(commonsCandidate));
  }

  // 2) Files in the exact species category.
  const cat = await request(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers` +
      `&gcmtitle=${encodeURIComponent(`Category:${record.scientificName}`)}&gcmtype=file&gcmlimit=40&${COMMONS_INFO}`
  );
  const catFiles = Object.values((cat.query && cat.query.pages) || {})
    .map(commonsCandidate)
    .filter(Boolean)
    .sort((a, b) => b.pixels - a.pixels);
  ordered.push(...catFiles);

  const viaOf = (c) => (p18.includes(c.title) ? "Wikidata image (P18)" : `Commons Category:${record.scientificName}`);
  const pick = choose(
    ordered.filter(Boolean).map((c) => ({ ...c, via: viaOf(c) })),
    { matchedName: record.scientificName }
  );
  if (pick) return { candidate: pick };
  if (!ids.length && !catFiles.length) return { reason: "Wikimedia: no Wikidata taxon or Commons category for this name" };
  return { reason: "Wikimedia: no suitable CC0/PD/CC BY/CC BY-SA photo" };
}

// ---- Image processing ----
async function saveImage(imageUrl, destPath) {
  const buf = await request(imageUrl, { binary: true });
  if (buf.length < 5000) throw new Error(`download too small (${buf.length} bytes)`);
  if (!sharp) {
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isJpeg || buf.length > RAW_FALLBACK_MAX_BYTES) {
      throw new Error("no image tool available and original is not a JPEG under 400 KB");
    }
    fs.writeFileSync(destPath, buf);
    return { bytes: buf.length, processed: false };
  }
  let out = null;
  for (const side of [MAX_SIDE_PX, 700, 600]) {
    for (let quality = 82; quality >= 50; quality -= 8) {
      out = await sharp(buf)
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (out.length <= TARGET_BYTES) break;
    }
    if (out.length <= TARGET_BYTES) break;
  }
  const meta = await sharp(out).metadata();
  fs.writeFileSync(destPath, out);
  return { bytes: out.length, processed: true, width: meta.width, height: meta.height };
}

// ---- Manifest (pending results between --no-apply and --apply-only) ----
function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { hits: {}, misses: {} };
  }
}
const saveManifest = (m) => fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));

// ---- Apply to catalogs + ATTRIBUTIONS.json (guarded) ----
function withoutPhoto(record) {
  const { masterPhotoUrl: _ignored, ...rest } = record;
  return JSON.stringify(rest);
}

function applyManifest(manifest) {
  const rawPublic = fs.readFileSync(PUBLIC_CATALOG, "utf8");
  const rawMirror = fs.readFileSync(MIRROR_CATALOG, "utf8");
  if (rawPublic !== rawMirror) throw new Error("Catalog mirrors differ; refusing to write.");
  const before = JSON.parse(rawPublic);
  if (JSON.stringify(before, null, 2) !== rawPublic) {
    throw new Error("Catalog is not in JSON.stringify(_, null, 2) form; refusing to rewrite it.");
  }

  const after = JSON.parse(rawPublic);
  const filled = [];
  for (const rec of after) {
    const hit = manifest.hits[rec.scientificName];
    if (!hit) continue;
    if (!fs.existsSync(path.join(IMAGES_DIR, hit.file))) {
      console.warn(`  ! ${rec.scientificName}: ${hit.file} missing on disk, skipped`);
      continue;
    }
    if (rec.masterPhotoUrl === hit.url) continue; // already applied
    if (rec.masterPhotoUrl) {
      console.warn(`  ! ${rec.scientificName}: already has ${rec.masterPhotoUrl}, left alone`);
      continue;
    }
    rec.masterPhotoUrl = hit.url;
    filled.push(rec.scientificName);
  }

  // Guard: only masterPhotoUrl may change, only from "" to one of our files.
  if (after.length !== before.length) throw new Error("Record count changed.");
  const filledSet = new Set(filled);
  for (let i = 0; i < before.length; i++) {
    if (withoutPhoto(before[i]) !== withoutPhoto(after[i])) throw new Error(`Record ${i} changed beyond masterPhotoUrl.`);
    if (before[i].masterPhotoUrl !== after[i].masterPhotoUrl) {
      if (before[i].masterPhotoUrl !== "" || !filledSet.has(after[i].scientificName)) {
        throw new Error(`Unexpected masterPhotoUrl change on ${after[i].scientificName}.`);
      }
    }
  }

  const attrRaw = fs.readFileSync(ATTRIBUTIONS_PATH, "utf8");
  const existing = JSON.parse(attrRaw);
  const known = new Set(existing.map((e) => `${e.species}|${e.sourceUrl || ""}`));
  const additions = [];
  for (const rec of after) {
    const hit = manifest.hits[rec.scientificName];
    if (!hit || rec.masterPhotoUrl !== hit.url) continue;
    if (known.has(`${rec.scientificName}|${hit.sourceUrl}`)) continue;
    additions.push({
      species: rec.scientificName,
      source: hit.source,
      license: hit.license,
      attribution: hit.attribution,
      sourceUrl: hit.sourceUrl,
    });
  }
  const merged = [...existing, ...additions];
  if (JSON.stringify(merged.slice(0, existing.length)) !== JSON.stringify(existing)) {
    throw new Error("Existing attribution entries would change.");
  }
  if (additions.some((a) => !isAllowedLicense(a.license))) throw new Error("Refusing a non-commercial license.");

  if (filled.length === 0 && additions.length === 0) {
    console.log("Nothing new to apply.");
    return;
  }

  // Re-read right before writing: both mirrors must still be the exact text we diffed.
  if (fs.readFileSync(PUBLIC_CATALOG, "utf8") !== rawPublic || fs.readFileSync(MIRROR_CATALOG, "utf8") !== rawPublic) {
    throw new Error("Catalog changed on disk during the run; refusing to write.");
  }
  const serialized = JSON.stringify(after, null, 2);
  if (filled.length) {
    fs.writeFileSync(PUBLIC_CATALOG, serialized, "utf8");
    fs.writeFileSync(MIRROR_CATALOG, serialized, "utf8");
    if (fs.readFileSync(PUBLIC_CATALOG, "utf8") !== fs.readFileSync(MIRROR_CATALOG, "utf8")) {
      throw new Error("Mirrors differ after write.");
    }
  }
  if (additions.length) fs.writeFileSync(ATTRIBUTIONS_PATH, JSON.stringify(merged, null, 2), "utf8");
  console.log(`Applied: ${filled.length} catalog photos (both mirrors), ${additions.length} attribution entries.`);
}

// ---- Main ----
async function main() {
  console.log(`Species photo fetcher | sharp: ${sharp ? "yes" : "NO (raw fallback)"} | manifest: ${MANIFEST_PATH}`);
  const manifest = loadManifest();

  if (!APPLY_ONLY) {
    const catalog = JSON.parse(fs.readFileSync(PUBLIC_CATALOG, "utf8"));
    const todo = catalog
      .filter((r) => !r.masterPhotoUrl && r.scientificName)
      .filter((r) => !MARINE_ONLY || isMarine(r))
      .filter((r) => ONLY.size === 0 || ONLY.has(norm(r.scientificName)))
      .sort((a, b) => Number(isMarine(b)) - Number(isMarine(a)))
      .slice(0, LIMIT);
    console.log(`Records to process: ${todo.length} (${todo.filter(isMarine).length} marine)\n`);

    for (const [i, rec] of todo.entries()) {
      const name = rec.scientificName;
      const file = toImageFilename(name);
      process.stdout.write(`[${i + 1}/${todo.length}] ${name} ... `);
      currentPick = PICKS.get(norm(name)) || null;
      listed.length = 0;
      const reasons = [];
      let candidate = null;
      for (const finder of [findINaturalist, findWikimedia]) {
        try {
          const r = await finder(rec);
          if (r.candidate) {
            candidate = r.candidate;
            break;
          }
          reasons.push(r.reason);
        } catch (err) {
          reasons.push(`${finder.name}: ${err.message}`);
        }
      }
      if (LIST_MODE) {
        console.log(`${listed.length} usable candidates`);
        for (const c of listed) console.log(`    ${c.id} | ${c.license} | ${c.attribution} | ${c.via} | ${c.imageUrl}`);
        continue;
      }
      if (!candidate) {
        console.log(`none (${reasons.join("; ")})`);
        if (!DRY_RUN) {
          // A previous run's (now rejected) download must not linger unreferenced.
          const stale = manifest.hits[name] && path.join(IMAGES_DIR, manifest.hits[name].file);
          if (stale && fs.existsSync(stale)) fs.unlinkSync(stale);
          delete manifest.hits[name];
          manifest.misses[name] = reasons.join("; ");
        }
        continue;
      }
      if (DRY_RUN) {
        console.log(`${candidate.via} | ${candidate.license} | ${candidate.attribution} | ${candidate.sourceUrl}`);
        continue;
      }
      try {
        const saved = await saveImage(candidate.imageUrl, path.join(IMAGES_DIR, file));
        manifest.hits[name] = {
          file,
          url: `/species-images/${file}`,
          source: candidate.source,
          license: candidate.license,
          attribution: candidate.attribution,
          sourceUrl: candidate.sourceUrl,
          photoId: candidate.id,
          via: candidate.via,
          matchedName: candidate.matchedName,
          bytes: saved.bytes,
          processed: saved.processed,
          marine: isMarine(rec),
          type: rec.type || "",
        };
        delete manifest.misses[name];
        console.log(`saved ${file} (${Math.round(saved.bytes / 1024)} KB, ${candidate.source}, ${candidate.license})`);
      } catch (err) {
        manifest.misses[name] = `download/processing failed: ${err.message}`;
        console.log(`failed (${err.message})`);
      }
      saveManifest(manifest);
    }
    if (!DRY_RUN) saveManifest(manifest);
  }

  if (!DRY_RUN && !NO_APPLY) applyManifest(manifest);
  const hits = Object.keys(manifest.hits).length;
  console.log(`\nManifest: ${hits} photos, ${Object.keys(manifest.misses).length} without a usable photo.`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
