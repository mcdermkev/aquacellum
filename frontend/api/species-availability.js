/**
 * species-availability.js — Public per-species marketplace availability
 * (Vercel Serverless Function; Fish Finder Rework, Task 4c).
 *
 * Returns an aggregate-only "who's selling what" signal for the public species
 * database:
 *
 *   GET /api/species-availability
 *     → {
 *         byScientificName: {
 *           "<lowercased scientific name>": {
 *             scientificName, commonName, sellerCount, listingCount,
 *             unitsAvailable, fromPriceCents, fromPriceDisplay, hasShipping
 *           }, ...
 *         },
 *         count, generatedAt
 *       }
 *
 * It reuses the EXACT in-app aggregator (`buildSpeciesAvailability`) and the
 * public whitelist (`serializePublicAvailability`) from
 * src/services/speciesAvailability.js, so the public and in-app numbers can
 * never drift, and there is one place that decides what is public.
 *
 * ── SECURITY / PRIVACY (read before touching) ───────────────────────────────
 * This endpoint is the ONLY intended public exposure of listing data. It:
 *   - reads listings server-side with the Supabase SERVICE key, and
 *   - returns ONLY aggregates (counts + from-price + shipping flag). It never
 *     returns raw listings, seller wallet addresses, or per-listing detail.
 * REQUIRED OPS CHECK: confirm RLS on `aquadex_listings` DENIES anonymous
 * SELECT, so the raw seller/price blobs are not publicly readable via the
 * client anon key. This endpoint's aggregate is the sanctioned public surface.
 *
 * Scope: aggregates ACTIVE cloud listings (aquadex_listings). On-chain-only
 * listings are out of scope here (no server chain read); the in-app board still
 * merges those for authenticated users.
 *
 * Open CORS (embeddable on the public species database) + short edge cache so
 * public traffic doesn't hit Supabase per request. Returns an empty aggregate
 * (never an error page) if Supabase env is unset or the query fails.
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import { createClient } from "@supabase/supabase-js";
import {
  buildSpeciesAvailability,
  serializePublicAvailability,
} from "../src/services/speciesAvailability.js";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const MAX_ROWS = 5000; // generous ceiling; the aggregate collapses to per-species

export default async function handler(req, res) {
  // Open CORS — this is meant to be embedded on the public species database.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
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
    console.error("[species-availability] failed:", err?.message || err);
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
 * JSON blob per row), ready for buildSpeciesAvailability. Mirrors the in-app
 * cloudSync.pullCloudListings read, but server-side with the service key.
 */
async function fetchActiveListings() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("aquadex_listings")
    .select("data")
    .eq("is_active", true)
    .limit(MAX_ROWS);

  if (error) {
    console.warn("[species-availability] listings query failed:", error.message);
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
