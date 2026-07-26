/**
 * species.js — Public Species Database API (Vercel Serverless Function)
 *
 * A free, public, read-only API over Aquacellum's 326-species freshwater
 * catalog (FishBase/WoRMS-validated). This is a growth channel: every
 * response links back to aquadex.fish so third-party sites, bots, and
 * tools that embed this data drive traffic to the app and marketplace.
 *
 * Unlike the internal endpoints in this folder, this API intentionally
 * uses an open CORS policy (Access-Control-Allow-Origin: *) — it's meant
 * to be embedded anywhere.
 *
 * Routing:
 *   GET  /api/species                       → paginated list (search + filters)
 *   GET  /api/species?id={specCode|slug}    → single species detail
 *   GET  /api/species?random=true&count=1-10 → random species (demos, bots)
 *   GET  /api/species?stats=true            → catalog-wide stats
 *   POST /api/species?action=request-key    → { email, appName?, appUrl? } → issues a free API key
 *
 * Auth / rate limiting:
 *   - No key:      60 requests/hour per IP.
 *   - x-api-key:   1000 requests/hour, tracked per key in Supabase for analytics.
 *   - Attribution: required by the terms in /developers.html (not code-enforced in v1).
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL (optional; API works without it, just no key issuance/tracking)
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import { readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "./_lib/rateLimiter.js";
import {
  buildSpeciesAvailability,
  serializePublicAvailability,
} from "../src/services/speciesAvailability.js";

const BASE_URL = "https://aquadex.fish";
const APP_URL = `${BASE_URL}/app`;
const MARKETPLACE_URL = `${BASE_URL}/marketplace.html`;

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────
// Catalog loading (cached per cold start, same pattern as _lib/speciesIndex.js)
// ─────────────────────────────────────────────────────────────────────────

let catalog = null;
let bySpecCode = null;
let bySlug = null;

function toSlug(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadCatalog() {
  if (catalog) return catalog;

  const candidatePaths = [
    join(process.cwd(), "public", "fishbase_master.json"),
    join(process.cwd(), "..", "public", "fishbase_master.json"),
    join(process.cwd(), "frontend", "public", "fishbase_master.json"),
  ];

  let raw = null;
  for (const p of candidatePaths) {
    try {
      raw = readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }

  if (!raw) {
    console.error("[species api] fishbase_master.json not found in any expected path");
    catalog = [];
    bySpecCode = new Map();
    bySlug = new Map();
    return catalog;
  }

  catalog = JSON.parse(raw);
  bySpecCode = new Map();
  bySlug = new Map();

  for (const sp of catalog) {
    if (sp.specCode != null) bySpecCode.set(String(sp.specCode), sp);
    const slug = toSlug(sp.scientificName);
    if (slug) bySlug.set(slug, sp);
    const commonSlug = toSlug(sp.commonName);
    if (commonSlug && !bySlug.has(commonSlug)) bySlug.set(commonSlug, sp);
  }

  return catalog;
}

// ─────────────────────────────────────────────────────────────────────────
// Response shaping — public-facing shape decoupled from internal JSON,
// with growth hooks (links back to the app/marketplace) on every record.
// ─────────────────────────────────────────────────────────────────────────

const ALL_FIELDS = [
  "specCode",
  "scientificName",
  "genus",
  "species",
  "commonName",
  "family",
  "maxLengthCm",
  "imageUrl",
  "tankParameters",
  "ecology",
  "diet",
  "reproduction",
  "personality",
  "links",
];

function toPublicSpecies(sp, fields) {
  const slug = toSlug(sp.scientificName);

  const full = {
    specCode: sp.specCode ?? null,
    scientificName: sp.scientificName ?? null,
    genus: sp.genus ?? (sp.scientificName ? sp.scientificName.split(" ")[0] : null),
    species: sp.species ?? null,
    commonName: sp.commonName ?? null,
    family: sp.family ?? null,
    maxLengthCm: sp.maxLengthCm ?? null,
    imageUrl: sp.masterPhotoUrl ? `${BASE_URL}${sp.masterPhotoUrl}` : null,
    tankParameters: sp.tankMetrics
      ? {
          temperatureRangeCelsius: sp.tankMetrics.tempRangeCelsius ?? null,
          phRange: sp.tankMetrics.phRange ?? null,
          difficulty: sp.tankMetrics.difficulty ?? null,
          minimumVolumeGallons: sp.tankMetrics.minVolumeGallons ?? null,
        }
      : null,
    ecology: sp.ecology
      ? {
          summary: sp.ecology.comments ?? null,
          biotope: sp.ecology.biotope ?? null,
          hardnessRange: sp.ecology.hardnessRange ?? null,
          socialBehavior: sp.ecology.socialBehavior ?? null,
        }
      : null,
    diet: sp.diet
      ? {
          trophicLevel: sp.diet.trophicLevel ?? null,
          foodItems: sp.diet.fooditems ?? null,
          feedingGuide: sp.diet.feedingPlaybook ?? null,
        }
      : null,
    reproduction: sp.reproduction
      ? {
          spawningType: sp.reproduction.spawningTrait ?? null,
          breedingSetup: sp.reproduction.layoutRequirement ?? null,
          notes: sp.reproduction.comments ?? null,
        }
      : null,
    personality: sp.personality
      ? {
          tagline: sp.personality.vibeLine?.casual ?? null,
          description: sp.personality.flavorText?.casual ?? null,
        }
      : null,
    links: {
      // Growth hooks: every consumer of this API sees a path back to the app.
      viewOnAquacellum: `${BASE_URL}/species/${slug}`,
      compareSpecies: `${BASE_URL}/compare.html?s1=${slug}`,
      shopMarketplace: `${MARKETPLACE_URL}?search=${encodeURIComponent(sp.commonName || sp.scientificName || "")}`,
      fishbaseSource: sp.specCode ? `https://www.fishbase.se/summary/${sp.specCode}` : null,
    },
  };

  if (!fields || fields.length === 0) return full;

  const picked = {};
  for (const f of fields) {
    if (f in full) picked[f] = full[f];
  }
  // Always keep identifiers so consumers can round-trip lookups.
  picked.specCode = full.specCode;
  picked.scientificName = full.scientificName;
  picked.commonName = full.commonName;
  return picked;
}

// ─────────────────────────────────────────────────────────────────────────
// Filtering / search helpers
// ─────────────────────────────────────────────────────────────────────────

function rangeOverlaps(dataMin, dataMax, wantMin, wantMax) {
  if (dataMin == null || dataMax == null) return false;
  if (wantMin != null && dataMax < wantMin) return false;
  if (wantMax != null && dataMin > wantMax) return false;
  return true;
}

function applyFilters(list, query) {
  let result = list;

  const q = (query.q || query.search || "").trim().toLowerCase();
  if (q) {
    result = result.filter((sp) => {
      return (
        (sp.commonName && sp.commonName.toLowerCase().includes(q)) ||
        (sp.scientificName && sp.scientificName.toLowerCase().includes(q)) ||
        (sp.genus && sp.genus.toLowerCase().includes(q)) ||
        (sp.family && sp.family.toLowerCase().includes(q))
      );
    });
  }

  const family = (query.family || "").trim().toLowerCase();
  if (family) {
    result = result.filter((sp) => (sp.family || "").toLowerCase() === family);
  }

  const difficulty = (query.difficulty || "").trim().toLowerCase();
  if (difficulty) {
    result = result.filter(
      (sp) => (sp.tankMetrics?.difficulty || "").toLowerCase() === difficulty
    );
  }

  const tempMin = query.tempMin != null ? parseFloat(query.tempMin) : null;
  const tempMax = query.tempMax != null ? parseFloat(query.tempMax) : null;
  if (tempMin != null || tempMax != null) {
    result = result.filter((sp) => {
      const t = sp.tankMetrics?.tempRangeCelsius;
      if (!t) return false;
      return rangeOverlaps(t[0], t[1], tempMin, tempMax);
    });
  }

  const phMin = query.phMin != null ? parseFloat(query.phMin) : null;
  const phMax = query.phMax != null ? parseFloat(query.phMax) : null;
  if (phMin != null || phMax != null) {
    result = result.filter((sp) => {
      const p = sp.tankMetrics?.phRange;
      if (!p) return false;
      return rangeOverlaps(p[0], p[1], phMin, phMax);
    });
  }

  const maxSize = query.maxSize != null ? parseFloat(query.maxSize) : null;
  if (maxSize != null) {
    result = result.filter((sp) => sp.maxLengthCm != null && sp.maxLengthCm <= maxSize);
  }

  const minVolume = query.minVolume != null ? parseFloat(query.minVolume) : null;
  if (minVolume != null) {
    result = result.filter(
      (sp) =>
        sp.tankMetrics?.minVolumeGallons != null &&
        sp.tankMetrics.minVolumeGallons <= minVolume
    );
  }

  return result;
}

const SORT_FIELDS = {
  name: (sp) => (sp.commonName || "").toLowerCase(),
  scientificName: (sp) => (sp.scientificName || "").toLowerCase(),
  size: (sp) => sp.maxLengthCm ?? 0,
  difficulty: (sp) => (sp.tankMetrics?.difficulty || ""),
};

function applySort(list, sortKey, dir) {
  const keyFn = SORT_FIELDS[sortKey] || SORT_FIELDS.name;
  const sorted = [...list].sort((a, b) => {
    const av = keyFn(a);
    const bv = keyFn(b);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

// ─────────────────────────────────────────────────────────────────────────
// CORS — intentionally open. This is a public API meant to be embedded
// on third-party sites, unlike the allowlisted internal endpoints.
// ─────────────────────────────────────────────────────────────────────────

function setOpenCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

/**
 * Resolve the caller's rate-limit identity: an API key row (if valid) or
 * an anonymous IP bucket. Free tier keys get a much higher ceiling.
 */
async function resolveCaller(req) {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  const ip = getClientIp(req);

  if (!apiKey || !supabase) {
    return { keyRow: null, rateLimitKey: `ip:${ip}`, maxRequests: 60, ip };
  }

  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key", apiKey)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) {
      return { keyRow: null, rateLimitKey: `ip:${ip}`, maxRequests: 60, ip };
    }

    const maxRequests = data.tier === "partner" ? 5000 : 1000;
    return { keyRow: data, rateLimitKey: `key:${data.id}`, maxRequests, ip };
  } catch {
    return { keyRow: null, rateLimitKey: `ip:${ip}`, maxRequests: 60, ip };
  }
}

/** Fire-and-forget usage tracking. Never blocks or fails the response. */
function logUsage(caller, endpoint, speciesId) {
  if (!supabase) return;
  const insert = {
    api_key_id: caller.keyRow?.id ?? null,
    endpoint,
    ip_hash: caller.keyRow ? null : hashIp(caller.ip),
    species_id: speciesId ?? null,
  };
  supabase.from("api_request_log").insert(insert).then(
    () => {},
    () => {}
  );
  if (caller.keyRow) {
    supabase
      .from("api_keys")
      .update({
        request_count: (caller.keyRow.request_count || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", caller.keyRow.id)
      .then(
        () => {},
        () => {}
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setOpenCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  // Public per-species marketplace availability (Fish Finder T4c). Merged into
  // this function from the former standalone /api/species-availability to stay
  // within Vercel's Hobby-plan 12-serverless-function limit. Aggregate-only
  // (never raw listings), service-key read, edge-cached, no rate limit — it is
  // its own self-contained branch handled before the catalog/rate-limit path.
  //   GET /api/species?availability=true
  if (req.query.availability === "true") {
    return handleAvailability(req, res);
  }

  const action = (req.query.action || "").toLowerCase();
  if (action === "request-key") {
    return handleRequestKey(req, res);
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed. Use GET." });
  }

  loadCatalog();

  const caller = await resolveCaller(req);
  const rl = checkRateLimit(caller.rateLimitKey, {
    maxRequests: caller.maxRequests,
    windowMs: 60 * 60 * 1000,
  });

  res.setHeader("X-RateLimit-Limit", String(rl.total));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(rl.resetIn));

  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.resetIn));
    return res.status(429).json({
      error: "Rate limit exceeded.",
      limit: rl.total,
      retryAfterSeconds: rl.resetIn,
      hint: caller.keyRow
        ? "Contact us for a partner-tier key with a higher limit."
        : `Get a free API key with a higher rate limit: POST ${BASE_URL}/api/species?action=request-key`,
    });
  }

  if (req.query.stats === "true") {
    logUsage(caller, "stats");
    return handleStats(req, res);
  }

  if (req.query.random === "true") {
    logUsage(caller, "random");
    return handleRandom(req, res);
  }

  if (req.query.id) {
    return handleDetail(req, res, caller);
  }

  logUsage(caller, "list");
  return handleList(req, res);
}

// ── GET /api/species?availability=true ──────────────────────────────────
// Aggregate-only "who's selling what" for the public species database. Reuses
// the EXACT in-app aggregator (buildSpeciesAvailability) + public whitelist
// (serializePublicAvailability) so public and in-app numbers can't drift, and
// there is one place that decides what is public. Returns ONLY counts +
// from-price + shipping flag, keyed by lowercased scientific name — never raw
// listings, seller wallet addresses, or per-listing detail. Degrades to an
// empty aggregate (never an error page) on missing env / query failure.

const AVAILABILITY_MAX_ROWS = 5000; // generous ceiling; the aggregate collapses per-species

async function handleAvailability(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }
  try {
    const listings = await fetchActiveListings();
    const index = buildSpeciesAvailability(listings);
    const byScientificName = serializePublicAvailability(index);

    // Edge cache: 5 min fresh, 10 min stale-while-revalidate. Availability is a
    // discovery signal, not real-time, and caching shields Supabase from public
    // traffic.
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      byScientificName,
      count: Object.keys(byScientificName).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Never surface an error page to the public site — degrade to empty.
    console.error("[species availability] failed:", err?.message || err);
    return res.status(200).json({
      byScientificName: {},
      count: 0,
      generatedAt: new Date().toISOString(),
      degraded: true,
    });
  }
}

/**
 * Fetch active cloud listings and return their listing objects (the `data`
 * JSON blob per row), ready for buildSpeciesAvailability. Server-side read with
 * the service key (the SUPABASE_SERVICE_KEY-backed `supabase` client above).
 */
async function fetchActiveListings() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("aquadex_listings")
    .select("data")
    .eq("is_active", true)
    .limit(AVAILABILITY_MAX_ROWS);

  if (error) {
    console.warn("[species availability] listings query failed:", error.message);
    return [];
  }

  return (data || [])
    .map((row) => {
      try {
        return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── GET /api/species ────────────────────────────────────────────────────

function handleList(req, res) {
  const fields = req.query.fields
    ? req.query.fields.split(",").map((f) => f.trim()).filter((f) => ALL_FIELDS.includes(f))
    : null;

  const filtered = applyFilters(catalog, req.query);
  const sorted = applySort(filtered, req.query.sort, req.query.dir);

  const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const page = sorted.slice(offset, offset + limit);

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({
    data: page.map((sp) => toPublicSpecies(sp, fields)),
    meta: {
      total: sorted.length,
      limit,
      offset,
      nextOffset: offset + limit < sorted.length ? offset + limit : null,
    },
    attribution: {
      required: true,
      text: "Species data provided by Aquacellum (https://aquadex.fish), validated against FishBase.",
    },
    _meta: {
      poweredBy: BASE_URL,
      appUrl: APP_URL,
      marketplaceUrl: MARKETPLACE_URL,
      documentation: `${BASE_URL}/developers.html`,
      openApiSpec: `${BASE_URL}/species-openapi.json`,
    },
  });
}

// ── GET /api/species?id= ────────────────────────────────────────────────

function handleDetail(req, res, caller) {
  const idRaw = String(req.query.id);
  const sp = bySpecCode.get(idRaw) || bySlug.get(toSlug(idRaw)) || bySlug.get(idRaw.toLowerCase());

  if (!sp) {
    return res.status(404).json({
      error: "Species not found.",
      id: idRaw,
      hint: "Use a specCode (e.g. 3615) or a scientific-name slug (e.g. amatitlania-nigrofasciata). Browse GET /api/species to find valid ids.",
    });
  }

  logUsage(caller, "detail", sp.specCode);

  const fields = req.query.fields
    ? req.query.fields.split(",").map((f) => f.trim()).filter((f) => ALL_FIELDS.includes(f))
    : null;

  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1200");
  return res.status(200).json({
    data: toPublicSpecies(sp, fields),
    attribution: {
      required: true,
      text: "Species data provided by Aquacellum (https://aquadex.fish), validated against FishBase.",
    },
    _meta: {
      poweredBy: BASE_URL,
      appUrl: APP_URL,
      marketplaceUrl: MARKETPLACE_URL,
    },
  });
}

// ── GET /api/species?random=true&count= ─────────────────────────────────

function handleRandom(req, res) {
  const count = Math.min(Math.max(parseInt(req.query.count) || 1, 1), 10);
  const pool = [...catalog];
  const picks = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    data: picks.map((sp) => toPublicSpecies(sp, null)),
    attribution: {
      required: true,
      text: "Species data provided by Aquacellum (https://aquadex.fish), validated against FishBase.",
    },
    _meta: { poweredBy: BASE_URL, appUrl: APP_URL },
  });
}

// ── GET /api/species?stats=true ─────────────────────────────────────────

function handleStats(req, res) {
  const byFamily = {};
  const byDifficulty = {};

  for (const sp of catalog) {
    const fam = sp.family || "Unclassified";
    byFamily[fam] = (byFamily[fam] || 0) + 1;

    const diff = sp.tankMetrics?.difficulty || "Unknown";
    byDifficulty[diff] = (byDifficulty[diff] || 0) + 1;
  }

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
  return res.status(200).json({
    data: {
      totalSpecies: catalog.length,
      familyCount: Object.keys(byFamily).length,
      byFamily,
      byDifficulty,
    },
    _meta: { poweredBy: BASE_URL, appUrl: APP_URL, source: "FishBase / WoRMS-validated catalog" },
  });
}

// ── POST /api/species?action=request-key ────────────────────────────────

function generateApiKey() {
  return `aq_live_${crypto.randomBytes(20).toString("hex")}`;
}

async function handleRequestKey(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  if (!supabase) {
    return res.status(503).json({
      error: "API key issuance is temporarily unavailable. Please try again later.",
    });
  }

  const { email, appName, appUrl } = req.body || {};

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  // IP-based limiter to prevent bulk key farming.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`keyreq:${ip}`, { maxRequests: 5, windowMs: 24 * 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({
      error: "Too many key requests from this network. Try again tomorrow, or contact us directly.",
    });
  }

  try {
    // Reuse an existing active key for this email instead of issuing duplicates.
    const { data: existing } = await supabase
      .from("api_keys")
      .select("key, created_at")
      .eq("owner_email", email.toLowerCase().trim())
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        key: existing.key,
        message: "You already have an active API key. Returning your existing key.",
        rateLimit: "1000 requests/hour",
        documentation: `${BASE_URL}/developers.html`,
      });
    }

    const key = generateApiKey();
    const { error } = await supabase.from("api_keys").insert({
      key,
      owner_email: email.toLowerCase().trim(),
      app_name: appName ? String(appName).slice(0, 120) : null,
      app_url: appUrl ? String(appUrl).slice(0, 300) : null,
      tier: "free",
    });

    if (error) {
      console.error("[species api] key issuance error:", error);
      return res.status(500).json({ error: "Failed to issue API key. Please try again." });
    }

    return res.status(201).json({
      key,
      message: "Save this key — it won't be shown again. Include it as the x-api-key header on requests.",
      rateLimit: "1000 requests/hour",
      documentation: `${BASE_URL}/developers.html`,
      attributionRequired: "Species data provided by Aquacellum (https://aquadex.fish), validated against FishBase.",
    });
  } catch (err) {
    console.error("[species api] request-key error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
