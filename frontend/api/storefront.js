/**
 * storefront.js — Vercel Serverless Function
 *
 * Public REST endpoint: GET /api/storefront?id={wallet-or-slug}
 *
 * Returns a single flat, AI-optimized JSON object containing:
 *   - Breeder profile (display name, avatar, banner, bio, tier, specialties)
 *   - Stats (total sales, rating, species count, repeat buyer rate)
 *   - Active listings (single + batch) with full specimen/species data + purchaseActions
 *   - Breeding history
 *   - Protocol metadata (chain, contract addresses, fee structure)
 *
 * All purchases route through the existing AquadexMarketplace contract (4% protocol fee).
 * This endpoint is fully public — no authentication required.
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders } from "./_lib/cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Protocol constants
const CHAIN_ID = 84532; // Base Sepolia
const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const PROTOCOL_FEE_BPS = 400; // 4%
const BASE_URL = "https://aquadex.fish";
const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export default async function handler(req, res) {
  // CORS — allow GET from anywhere (public API)
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const identifier = req.query.id || req.query.wallet || req.query.slug;
  if (!identifier) {
    return res.status(400).json({
      error: "Missing required parameter: id (wallet address or slug)",
      usage: "GET /api/storefront?id={wallet-or-slug}",
    });
  }

  try {
    // ─── Resolve breeder profile ───────────────────────────────────────────
    const isWallet = identifier.startsWith("0x") && identifier.length === 42;
    const { data: profile, error: profileError } = await supabase
      .from("breeder_profiles")
      .select("*")
      .eq(isWallet ? "wallet_address" : "slug", identifier.toLowerCase())
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        error: "Breeder not found",
        identifier,
        suggestion: "Verify the wallet address or slug is correct.",
      });
    }

    const wallet = profile.wallet_address;

    // ─── Parallel fetch: listings, stats, breeding history ─────────────────
    const [listingsResult, statsResult, historyResult] = await Promise.all([
      supabase
        .from("cloud_listings")
        .select("*")
        .eq("seller", wallet)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase
        .from("breeder_stats")
        .select("*")
        .eq("wallet_address", wallet)
        .single(),
      supabase
        .from("breeding_records")
        .select("*")
        .eq("breeder_wallet", wallet)
        .order("spawn_date", { ascending: false })
        .limit(30),
    ]);

    const listings = listingsResult.data || [];
    const stats = statsResult.data || {};
    const breedingHistory = historyResult.data || [];

    // ─── Build AI-optimized response ───────────────────────────────────────
    const response = {
      // Protocol metadata
      protocol: {
        name: "Aquacellum",
        version: "0.9.4",
        chain: "Base Sepolia",
        chainId: CHAIN_ID,
        marketplaceContract: MARKETPLACE_ADDRESS,
        managerContract: MANAGER_ADDRESS,
        feeStructure: {
          totalFeeBps: PROTOCOL_FEE_BPS,
          description: "4% protocol fee on all marketplace transactions",
        },
        ipfsGateway: IPFS_GATEWAY,
      },

      // Breeder profile
      breeder: {
        walletAddress: wallet,
        slug: profile.slug || null,
        displayName: profile.display_name || truncateAddr(wallet),
        bio: profile.bio || "",
        avatarUrl: profile.avatar_cid ? `${IPFS_GATEWAY}/${profile.avatar_cid}` : null,
        bannerUrl: profile.banner_cid ? `${IPFS_GATEWAY}/${profile.banner_cid}` : null,
        specialties: profile.specialties || [],
        location: profile.location || null,
        isMasterBreeder: profile.is_master_breeder || false,
        currentTier: profile.current_tier || "Shallow",
        storefrontUrl: `${BASE_URL}/store/${profile.slug || wallet}`,
        socialLinks: profile.social_links || {},
        memberSince: profile.created_at,
      },

      // Stats
      stats: {
        totalSales: stats.total_sales || 0,
        totalListings: stats.total_listings || 0,
        activeListings: listings.length,
        avgRating: stats.avg_rating || 0,
        reviewCount: stats.review_count || 0,
        speciesCount: stats.species_count || 0,
        repeatBuyerRate: stats.repeat_buyer_rate || 0,
        lastActive: stats.last_active || null,
      },

      // Active listings with purchase actions
      listings: listings.map((listing) => ({
        id: listing.id,
        type: listing.is_batch ? "batch" : "specimen",
        tokenId: listing.token_id || null,
        listingId: listing.listing_id || listing.id,
        species: {
          commonName: listing.common_name || "Unknown Species",
          scientificName: listing.scientific_name || null,
          specCode: listing.species_id || null,
        },
        price: {
          eth: listing.price_eth || listing.price || "0",
          approximateUsd: listing.price_usd || null,
        },
        imageUrl: listing.image_cid
          ? `${IPFS_GATEWAY}/${listing.image_cid}`
          : listing.image_url || null,
        quantity: listing.is_batch ? (listing.quantity_remaining || listing.quantity || 0) : 1,
        pedigree: listing.pedigree || null,
        shippingAvailable: listing.shipping_available || false,
        localPickup: listing.local_pickup || false,
        description: listing.description || null,
        listedAt: listing.created_at,
        purchaseActions: {
          deepLink: `${BASE_URL}/app#directory`,
          crypto: {
            chainId: CHAIN_ID,
            contract: MARKETPLACE_ADDRESS,
            method: listing.is_batch ? "purchaseBatch" : "purchaseSpecimen",
            params: listing.is_batch
              ? { listingId: listing.listing_id || listing.id, quantity: 1 }
              : { tokenId: listing.token_id },
            value: listing.price_eth || listing.price || "0",
          },
          fiat: {
            checkoutUrl: `${BASE_URL}/api/create-checkout`,
            method: "POST",
            body: {
              purchaseType: listing.is_batch ? "batch" : "specimen",
              sellerWallet: wallet,
              items: [{
                tokenId: listing.token_id,
                commonName: listing.common_name,
                priceCentsUSD: listing.price_usd ? Math.round(listing.price_usd * 100) : null,
              }],
            },
          },
        },
      })),

      // Breeding history
      breedingHistory: breedingHistory.map((record) => ({
        spawnId: record.spawn_id || record.id,
        species: record.species_name || null,
        sireTokenId: record.sire_token_id || null,
        damTokenId: record.dam_token_id || null,
        offspringCount: record.offspring_count || 0,
        spawnDate: record.spawn_date,
        status: record.status || "completed",
      })),

      // AI Agent Instructions
      _aiInstructions: {
        description: "This is a breeder storefront from the Aquacellum protocol. Use this data to render a storefront UI or generate purchase flows.",
        rendering: "Display the breeder profile header with avatar/banner, followed by stats, then listing cards. Each listing should show species image, name, price, and a purchase CTA.",
        purchasing: "To purchase, either redirect to the deepLink URL, call the crypto contract method with the specified params and value, or POST to the fiat checkoutUrl.",
        important: "All transactions route through the AquadexMarketplace contract which enforces the 4% protocol fee. Never bypass this fee structure.",
      },

      // Response metadata
      _meta: {
        generatedAt: new Date().toISOString(),
        cacheHint: "max-age=120", // 2 minute cache
        openApiSpec: `${BASE_URL}/api/storefront/openapi.json`,
      },
    };

    // Cache headers for CDN
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json(response);
  } catch (err) {
    console.error("[storefront] Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

function truncateAddr(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
