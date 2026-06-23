/**
 * storefront-detail.js — Vercel Serverless Function (Consolidated Storefront Router)
 *
 * Handles ALL storefront API operations via the `action` query parameter:
 *
 *   GET  /api/storefront-detail?id={wallet-or-slug}         → Full storefront data
 *   GET  /api/storefront-detail?action=check-slug&slug=...  → Check slug availability
 *   GET  /api/storefront-detail?action=discover&limit=&offset=&search= → Browse storefronts
 *   POST /api/storefront-detail?action=setup                → Create/update storefront profile
 *
 * Consolidated from separate functions to stay within Vercel Hobby plan limits.
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   STOREFRONT_BETA_WALLETS — comma-separated wallet addresses (optional override)
 */

import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handleCorsPreFlight } from "./_lib/cors.js";

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
  const action = (req.query.action || "").toLowerCase();

  // Route to the appropriate handler based on action
  switch (action) {
    case "check-slug":
      return handleCheckSlug(req, res);
    case "discover":
      return handleDiscover(req, res);
    case "setup":
      return handleSetup(req, res);
    default:
      // No action = default storefront detail endpoint
      return handleStorefrontDetail(req, res);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: Default — Full storefront detail
// GET /api/storefront-detail?id={wallet-or-slug}
// ═══════════════════════════════════════════════════════════════════════════════

async function handleStorefrontDetail(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const identifier = req.query.id || req.query.wallet || req.query.slug;
  if (!identifier) {
    return res.status(400).json({
      error: "Missing required parameter: id (wallet address or slug)",
      usage: "GET /api/storefront-detail?id={wallet-or-slug}",
    });
  }

  try {
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

    const response = {
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
      breedingHistory: breedingHistory.map((record) => ({
        spawnId: record.spawn_id || record.id,
        species: record.species_name || null,
        sireTokenId: record.sire_token_id || null,
        damTokenId: record.dam_token_id || null,
        offspringCount: record.offspring_count || 0,
        spawnDate: record.spawn_date,
        status: record.status || "completed",
      })),
      _aiInstructions: {
        description: "This is a breeder storefront from the Aquacellum protocol. Use this data to render a storefront UI or generate purchase flows.",
        rendering: "Display the breeder profile header with avatar/banner, followed by stats, then listing cards. Each listing should show species image, name, price, and a purchase CTA.",
        purchasing: "To purchase, either redirect to the deepLink URL, call the crypto contract method with the specified params and value, or POST to the fiat checkoutUrl.",
        important: "All transactions route through the AquadexMarketplace contract which enforces the 4% protocol fee. Never bypass this fee structure.",
      },
      _meta: {
        generatedAt: new Date().toISOString(),
        cacheHint: "max-age=120",
        openApiSpec: `${BASE_URL}/storefront-openapi.json`,
      },
    };

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json(response);
  } catch (err) {
    console.error("[storefront-detail] Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: check-slug
// GET /api/storefront-detail?action=check-slug&slug={slug}
// ═══════════════════════════════════════════════════════════════════════════════

async function handleCheckSlug(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const slug = (req.query.slug || "").toLowerCase().trim();

  if (!slug) {
    return res.status(400).json({ error: "Missing slug parameter." });
  }

  try {
    const { data, error } = await supabase
      .from("breeder_profiles")
      .select("wallet_address")
      .eq("slug", slug)
      .single();

    const available = !data && (error?.code === "PGRST116" || !data);
    return res.status(200).json({ available, slug });
  } catch (err) {
    return res.status(200).json({ available: true, slug });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: discover
// GET /api/storefront-detail?action=discover&limit=20&offset=0&search=
// ═══════════════════════════════════════════════════════════════════════════════

async function handleDiscover(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();

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

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: setup
// POST /api/storefront-detail?action=setup
// ═══════════════════════════════════════════════════════════════════════════════

// Beta allowlist
const HARDCODED_BETA_WALLETS = [
  "0x53d3c6f4f11b0b08bc1a5034bbce7d46198b6851",
  "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6",
  "0x41e562ee88825ad8d79b48311a30742ac276c9eb",
];

function getBetaWallets() {
  const envWallets = process.env.STOREFRONT_BETA_WALLETS;
  if (envWallets) {
    return envWallets.split(",").map((w) => w.trim().toLowerCase());
  }
  return HARDCODED_BETA_WALLETS.map((w) => w.toLowerCase());
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

async function handleSetup(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { walletAddress, slug, displayName, bio, specialties, location } = req.body;

  if (!walletAddress || !slug || !displayName) {
    return res.status(400).json({
      error: "Missing required fields: walletAddress, slug, displayName",
    });
  }

  const wallet = walletAddress.toLowerCase();

  // Beta gate check
  const betaWallets = getBetaWallets();
  if (!betaWallets.includes(wallet)) {
    return res.status(403).json({
      error: "Storefront creation is currently in beta. Your wallet is not on the allowlist.",
      code: "BETA_GATED",
    });
  }

  // Slug format validation
  if (!SLUG_REGEX.test(slug)) {
    return res.status(400).json({
      error: "Invalid slug. Must be 3-32 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens.",
      code: "INVALID_SLUG",
    });
  }

  // Display name length
  if (displayName.trim().length < 2 || displayName.trim().length > 60) {
    return res.status(400).json({
      error: "Display name must be 2-60 characters.",
      code: "INVALID_NAME",
    });
  }

  // Bio length
  if (bio && bio.length > 280) {
    return res.status(400).json({
      error: "Bio must be 280 characters or fewer.",
      code: "BIO_TOO_LONG",
    });
  }

  // Specialties limit
  if (specialties && specialties.length > 5) {
    return res.status(400).json({
      error: "Maximum 5 specialties allowed.",
      code: "TOO_MANY_SPECIALTIES",
    });
  }

  try {
    // Check slug availability
    const { data: existing } = await supabase
      .from("breeder_profiles")
      .select("wallet_address")
      .eq("slug", slug)
      .single();

    if (existing && existing.wallet_address !== wallet) {
      return res.status(409).json({
        error: "This slug is already taken. Choose a different one.",
        code: "SLUG_TAKEN",
      });
    }

    // Upsert profile
    const { data: profile, error: upsertError } = await supabase
      .from("breeder_profiles")
      .upsert(
        {
          wallet_address: wallet,
          slug: slug.toLowerCase(),
          display_name: displayName.trim(),
          bio: (bio || "").trim().slice(0, 280),
          specialties: (specialties || []).slice(0, 5),
          location: location ? location.trim().slice(0, 60) : null,
          storefront_active: true,
          is_master_breeder: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("[storefront/setup] Upsert error:", upsertError);
      return res.status(500).json({
        error: "Failed to save storefront profile.",
        detail: upsertError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Storefront published successfully.",
      profile: {
        walletAddress: profile.wallet_address,
        slug: profile.slug,
        displayName: profile.display_name,
        storefrontUrl: `https://aquadex.fish/store/${profile.slug}`,
      },
    });
  } catch (err) {
    console.error("[storefront/setup] Error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function truncateAddr(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
