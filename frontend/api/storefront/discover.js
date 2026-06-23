/**
 * discover.js — Vercel Serverless Function
 *
 * Public endpoint: GET /api/storefront/discover
 *
 * Browse active breeder storefronts with pagination.
 * Tier 1 (Master Breeder) storefronts are featured first.
 * Supports search by name or specialty.
 *
 * Query params:
 *   - limit (default: 20, max: 50)
 *   - offset (default: 0)
 *   - search (optional: filter by name or specialty)
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders } from "../_lib/cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs";
const BASE_URL = "https://aquadex.fish";

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const search = (req.query.search || "").trim();

  try {
    let query = supabase
      .from("breeder_profiles")
      .select("*, breeder_stats(total_sales, avg_rating, species_count)", { count: "exact" })
      .eq("storefront_active", true)
      .order("is_master_breeder", { ascending: false })
      .order("featured_priority", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(
        `display_name.ilike.%${search}%,slug.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("[storefront/discover] Supabase error:", error);
      return res.status(500).json({ error: "Failed to fetch storefronts" });
    }

    const storefronts = (data || []).map((profile) => ({
      walletAddress: profile.wallet_address,
      slug: profile.slug || null,
      displayName: profile.display_name || truncateAddr(profile.wallet_address),
      bio: profile.bio || "",
      avatarUrl: profile.avatar_cid ? `${IPFS_GATEWAY}/${profile.avatar_cid}` : null,
      bannerUrl: profile.banner_cid ? `${IPFS_GATEWAY}/${profile.banner_cid}` : null,
      specialties: profile.specialties || [],
      location: profile.location || null,
      isMasterBreeder: profile.is_master_breeder || false,
      currentTier: profile.current_tier || "Shallow",
      storefrontUrl: `${BASE_URL}/store/${profile.slug || profile.wallet_address}`,
      stats: profile.breeder_stats
        ? {
            totalSales: profile.breeder_stats.total_sales || 0,
            avgRating: profile.breeder_stats.avg_rating || 0,
            speciesCount: profile.breeder_stats.species_count || 0,
          }
        : { totalSales: 0, avgRating: 0, speciesCount: 0 },
    }));

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=180");
    return res.status(200).json({
      storefronts,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[storefront/discover] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function truncateAddr(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
