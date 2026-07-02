/**
 * breederRegistry.js — Breeder Registry Service
 *
 * Manages breeder profiles stored in Supabase with IPFS CID pointers.
 * Profiles contain: slug, display name, avatar CID, banner CID, bio,
 * tier status, specialties, location, and storefront configuration.
 *
 * The BreederRegistry pattern mirrors the existing cloudSync approach:
 * Supabase as the source of truth with Dexie as offline cache.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || ""
);

/**
 * Fetch a breeder profile by wallet address or slug.
 * @param {string} identifier - Wallet address (0x...) or slug string
 * @returns {Promise<Object|null>} Breeder profile or null
 */
export async function fetchBreederProfile(identifier) {
  const isWallet = identifier.startsWith("0x") && identifier.length === 42;

  const { data, error } = await supabase
    .from("breeder_profiles")
    .select("*")
    .eq(isWallet ? "wallet_address" : "slug", isWallet ? identifier.toLowerCase() : identifier.toLowerCase())
    .single();

  if (error || !data) return null;
  return normalizeBreederProfile(data);
}

/**
 * Fetch a breeder's active listings (single + batch) from Supabase cloud listings.
 * @param {string} walletAddress - Seller wallet address
 * @returns {Promise<Array>} Active listings
 */
export async function fetchBreederListings(walletAddress) {
  const { data, error } = await supabase
    .from("cloud_listings")
    .select("*")
    .eq("seller", walletAddress.toLowerCase())
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[BreederRegistry] Failed to fetch listings:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch breeder's breeding history / spawn records.
 * @param {string} walletAddress
 * @returns {Promise<Array>} Breeding history entries
 */
export async function fetchBreedingHistory(walletAddress) {
  const { data, error } = await supabase
    .from("breeding_records")
    .select("*")
    .eq("breeder_wallet", walletAddress.toLowerCase())
    .order("spawn_date", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[BreederRegistry] Failed to fetch breeding history:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch breeder stats (total sales, rating, species count, etc.)
 * @param {string} walletAddress
 * @returns {Promise<Object>} Stats object
 */
export async function fetchBreederStats(walletAddress) {
  const { data, error } = await supabase
    .from("breeder_stats")
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();

  if (error || !data) {
    return {
      totalSales: 0,
      totalListings: 0,
      avgRating: 0,
      reviewCount: 0,
      speciesCount: 0,
      repeatBuyerRate: 0,
      memberSince: null,
      lastActive: null,
    };
  }
  return {
    totalSales: data.total_sales || 0,
    totalListings: data.total_listings || 0,
    avgRating: data.avg_rating || 0,
    reviewCount: data.review_count || 0,
    speciesCount: data.species_count || 0,
    repeatBuyerRate: data.repeat_buyer_rate || 0,
    memberSince: data.member_since,
    lastActive: data.last_active,
  };
}

/**
 * Discover active storefronts with Tier 1 (Master Breeder) featured first.
 * @param {{ limit?: number, offset?: number, search?: string }} options
 * @returns {Promise<{ storefronts: Array, total: number }>}
 */
export async function discoverStorefronts({ limit = 20, offset = 0, search = "" } = {}) {
  let query = supabase
    .from("breeder_profiles")
    .select("*, breeder_stats(total_sales, avg_rating, species_count)", { count: "exact" })
    .eq("storefront_active", true)
    .order("is_master_breeder", { ascending: false })
    .order("featured_priority", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`display_name.ilike.%${search}%,slug.ilike.%${search}%,specialties.cs.{${search}}`);
  }

  const { data, error, count } = await query;

  if (error) {
    console.warn("[BreederRegistry] Discovery failed:", error.message);
    return { storefronts: [], total: 0 };
  }

  return {
    storefronts: (data || []).map(normalizeBreederProfile),
    total: count || 0,
  };
}

/**
 * Update a breeder's own profile (requires authenticated wallet).
 * @param {string} walletAddress
 * @param {Object} updates
 * @returns {Promise<Object|null>}
 */
export async function updateBreederProfile(walletAddress, updates) {
  const { data, error } = await supabase
    .from("breeder_profiles")
    .upsert({
      wallet_address: walletAddress.toLowerCase(),
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: "wallet_address" })
    .select()
    .single();

  if (error) {
    console.error("[BreederRegistry] Update failed:", error.message);
    return null;
  }
  return normalizeBreederProfile(data);
}

/**
 * Check if a breeder qualifies for Master Breeder (Tier 1) storefront.
 * Requirements: Tier 4+ gamification level, 5+ completed sales, avg rating >= 4.0
 */
export function checkMasterBreederEligibility(profile, stats) {
  const TIER_THRESHOLD = 4;
  const SALES_THRESHOLD = 5;
  const RATING_THRESHOLD = 4.0;

  const tierMap = { "Shallow": 1, "Coastal": 2, "Pelagic": 3, "Abyssal": 4, "Hadal": 5, "God-Tier": 6 };
  const tierLevel = tierMap[profile?.currentTier] || 0;

  return {
    eligible: tierLevel >= TIER_THRESHOLD && stats.totalSales >= SALES_THRESHOLD && stats.avgRating >= RATING_THRESHOLD,
    requirements: {
      tier: { required: TIER_THRESHOLD, current: tierLevel, met: tierLevel >= TIER_THRESHOLD },
      sales: { required: SALES_THRESHOLD, current: stats.totalSales, met: stats.totalSales >= SALES_THRESHOLD },
      rating: { required: RATING_THRESHOLD, current: stats.avgRating, met: stats.avgRating >= RATING_THRESHOLD },
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function normalizeBreederProfile(row) {
  return {
    walletAddress: row.wallet_address,
    slug: row.slug || null,
    displayName: row.display_name || truncateAddress(row.wallet_address),
    bio: row.bio || "",
    avatarCid: row.avatar_cid || null,
    bannerCid: row.banner_cid || null,
    // Full public URLs (preferred); components fall back to CID gateway if absent.
    avatarUrl: row.avatar_url || (row.avatar_cid ? `https://gateway.pinata.cloud/ipfs/${row.avatar_cid}` : null),
    bannerUrl: row.banner_url || (row.banner_cid ? `https://gateway.pinata.cloud/ipfs/${row.banner_cid}` : null),
    specialties: row.specialties || [],
    location: row.location || null,
    isMasterBreeder: row.is_master_breeder || false,
    storefrontActive: row.storefront_active || false,
    featuredPriority: row.featured_priority || 0,
    currentTier: row.current_tier || "Shallow",
    themeConfig: row.theme_config || null,
    socialLinks: row.social_links || {},
    policies: {
      shipping: row.shipping_policy || null,
      doa: row.doa_policy || null,
      handshake: row.handshake_policy || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Joined stats if present
    stats: row.breeder_stats ? {
      totalSales: row.breeder_stats.total_sales || 0,
      avgRating: row.breeder_stats.avg_rating || 0,
      speciesCount: row.breeder_stats.species_count || 0,
    } : null,
  };
}

function truncateAddress(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
