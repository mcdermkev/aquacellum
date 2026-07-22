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
 * Task 20 (Verified Structured Reviews) additions — kept on this consolidated
 * router rather than a new `frontend/api/reviews.js` file because
 * `frontend/api/` is already at Vercel Hobby's 12-function limit, and this
 * router already owns the `breeder_stats` reads reviews aggregate into:
 *
 *   GET  /api/storefront-detail?action=reviews&seller=<wallet>&limit=&offset=
 *                                                            → published reviews + aggregate for a seller (public)
 *   GET  /api/storefront-detail?action=review-for-order&order=<orderId|ref>
 *                                                            → the review for one order, or null (public)
 *   POST /api/storefront-detail?action=submit-review        → authenticated buyer submits a review
 *   POST /api/storefront-detail?action=respond-review       → authenticated seller responds to a review on their order
 *   POST /api/storefront-detail?action=report-review        → any authenticated user reports a review
 *   POST /api/storefront-detail?action=moderate-review      → curator-only: hide/dismiss a reported review
 *
 * Consolidated from separate functions to stay within Vercel Hobby plan limits.
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   STOREFRONT_BETA_WALLETS — comma-separated wallet addresses (optional override)
 *   CURATOR_WALLET / CRON_SECRET — review moderation authorization (mirrors api/stripe.js authorizeAdminOrCurator)
 */

import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handleCorsPreFlight } from "./_lib/cors.js";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";
import {
  isOrderReviewable,
  applicableRatingDimensions,
  canRespondToReview,
} from "../src/services/reviewEligibility.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Protocol constants
const CHAIN_ID = 84532; // Base Sepolia
const MARKETPLACE_ADDRESS = "0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF";
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
    // ── Task 20: Verified Structured Reviews ──
    case "reviews":
      return handleGetReviews(req, res);
    case "review-for-order":
      return handleGetReviewForOrder(req, res);
    case "submit-review":
      return handleSubmitReview(req, res);
    case "respond-review":
      return handleRespondReview(req, res);
    case "report-review":
      return handleReportReview(req, res);
    case "moderate-review":
      return handleModerateReview(req, res);
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
      // Listings live in aquadex_listings (the table the app writes to via
      // cloudSync). The full listing object is stored as a JSON blob in `data`.
      supabase
        .from("aquadex_listings")
        .select("*")
        .eq("seller_address", wallet)
        .eq("is_active", true)
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

    // Normalize aquadex_listings rows (top-level columns + `data` JSON blob)
    // into the snake_case shape the response mapper below expects.
    const listings = (listingsResult.data || []).map((row) => {
      let d = {};
      try {
        d = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
      } catch {
        d = {};
      }
      return {
        id: row.id,
        is_batch: row.is_batch ?? d.isBatch ?? false,
        token_id: d.tokenId || null,
        listing_id: d.listingId || row.id,
        common_name: row.common_name || d.commonName || "Unknown Species",
        scientific_name: d.scientificName || null,
        species_id: row.species_id || d.speciesId || null,
        price_eth: row.price || d.price || "0",
        price: row.price || d.price || "0",
        price_usd: d.priceUsd || null,
        image_cid: d.imageCid || null,
        image_url: d.photoUrl || d.imageUrl || null,
        quantity: d.quantity || 0,
        quantity_remaining: d.quantityRemaining || d.quantity || 0,
        pedigree: (d.sireId || d.damId) ? { sireId: d.sireId, damId: d.damId } : null,
        shipping_available: d.isShipping || false,
        local_pickup: d.localPickup || false,
        description: d.description || null,
        created_at: row.created_at,
      };
    });
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
        // Prefer full public URLs (Supabase Storage); fall back to IPFS CID via gateway.
        avatarUrl: profile.avatar_url || (profile.avatar_cid ? `${IPFS_GATEWAY}/${profile.avatar_cid}` : null),
        bannerUrl: profile.banner_url || (profile.banner_cid ? `${IPFS_GATEWAY}/${profile.banner_cid}` : null),
        specialties: profile.specialties || [],
        location: profile.location || null,
        isMasterBreeder: profile.is_master_breeder || false,
        currentTier: profile.current_tier || "Shallow",
        storefrontUrl: `${BASE_URL}/store/${profile.slug || wallet}`,
        socialLinks: profile.social_links || {},
        policies: {
          shipping: profile.shipping_policy || null,
          doa: profile.doa_policy || null,
          handshake: profile.handshake_policy || null,
        },
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
            checkoutUrl: `${BASE_URL}/api/stripe?action=create-checkout`,
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
        description: "This is a breeder storefront from the Aquacellum marketplace. Use this data to render a storefront UI or generate purchase flows.",
        rendering: "Display the breeder profile header with avatar/banner, followed by stats, then listing cards. Each listing should show species image, name, price, and a purchase CTA.",
        purchasing: "To purchase, either redirect to the deepLink URL or POST to the fiat checkoutUrl to create a Stripe Checkout session.",
        important: "All transactions include a 4% marketplace fee. The platform handles all payment processing and buyer protection automatically.",
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
      avatarUrl: profile.avatar_url || (profile.avatar_cid ? `${IPFS_GATEWAY}/${profile.avatar_cid}` : null),
      bannerUrl: profile.banner_url || (profile.banner_cid ? `${IPFS_GATEWAY}/${profile.banner_cid}` : null),
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

// Beta allowlist — DISABLED: open to all authenticated users for testing
// const HARDCODED_BETA_WALLETS = [
//   "0x53d3c6f4f11b0b08bc1a5034bbce7d46198b6851",
//   "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6",
//   "0x41e562ee88825ad8d79b48311a30742ac276c9eb",
// ];
//
// function getBetaWallets() {
//   const envWallets = process.env.STOREFRONT_BETA_WALLETS;
//   if (envWallets) {
//     return envWallets.split(",").map((w) => w.trim().toLowerCase());
//   }
//   return HARDCODED_BETA_WALLETS.map((w) => w.toLowerCase());
// }

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

async function handleSetup(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const {
    walletAddress,
    slug,
    displayName,
    bio,
    specialties,
    location,
    avatarUrl,
    bannerUrl,
    shippingPolicy,
    doaPolicy,
    handshakePolicy,
  } = req.body;

  if (!walletAddress || !slug || !displayName) {
    return res.status(400).json({
      error: "Missing required fields: walletAddress, slug, displayName",
    });
  }

  const wallet = walletAddress.toLowerCase();

  // Beta gate removed — storefront open to all authenticated users

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

  // Policy length limits (mirror the DB CHECK constraints)
  const POLICY_MAX = 1500;
  for (const [field, val] of [
    ["shippingPolicy", shippingPolicy],
    ["doaPolicy", doaPolicy],
    ["handshakePolicy", handshakePolicy],
  ]) {
    if (val && String(val).length > POLICY_MAX) {
      return res.status(400).json({
        error: `${field} must be ${POLICY_MAX} characters or fewer.`,
        code: "POLICY_TOO_LONG",
      });
    }
  }

  // Only accept image URLs from trusted origins (Supabase Storage / IPFS gateway).
  const isSafeImageUrl = (url) => {
    if (!url) return true; // null/empty is fine (clears the field)
    try {
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        (u.hostname.endsWith(".supabase.co") ||
          u.hostname === "gateway.pinata.cloud" ||
          u.hostname.endsWith(".ipfs.dweb.link"))
      );
    } catch {
      return false;
    }
  };
  if (!isSafeImageUrl(avatarUrl) || !isSafeImageUrl(bannerUrl)) {
    return res.status(400).json({
      error: "Image URLs must be https and hosted on an allowed origin.",
      code: "INVALID_IMAGE_URL",
    });
  }

  const clean = (val) => {
    const trimmed = (val ?? "").toString().trim();
    return trimmed ? trimmed.slice(0, POLICY_MAX) : null;
  };

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
          avatar_url: avatarUrl || null,
          banner_url: bannerUrl || null,
          shipping_policy: clean(shippingPolicy),
          doa_policy: clean(doaPolicy),
          handshake_policy: clean(handshakePolicy),
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
// TASK 20: VERIFIED STRUCTURED REVIEWS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Eligibility (who may review, and when) is decided ONLY by the pure,
// Opus-reviewed reviewEligibility.js — this file never re-implements or
// loosens that logic; it just resolves the order/review rows and calls it.
// The client (ReviewComposer.jsx) also checks eligibility before rendering
// the form, but that check is UX only — this server-side check is the real
// authorization boundary, since the client can never be trusted.

/** Map a marketplace_reviews row (snake_case) to the client shape. */
function reviewRowToClient(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderRef: row.order_ref,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    fulfillmentMethod: row.fulfillment_method,
    overall: row.overall,
    health: row.health,
    accuracy: row.accuracy,
    packaging: row.packaging,
    communication: row.communication,
    fulfillment: row.fulfillment,
    body: row.body,
    photoUrls: row.photo_urls || [],
    sellerResponse: row.seller_response,
    sellerRespondedAt: row.seller_responded_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve the caller's lowercased wallet from a verified Privy session
 * token ONLY — never from the request body. Mirrors api/stripe.js's
 * requireWalletFromSession / api/cart.js's requireWallet.
 */
async function requireReviewerWallet(req, res) {
  const { verified, walletAddress, error } = await verifyPrivyToken(req);
  if (!verified) {
    res.status(401).json({ error: error || "Missing or invalid authentication" });
    return null;
  }
  if (!walletAddress) {
    res.status(401).json({ error: "Session has no linked account address" });
    return null;
  }
  return walletAddress.toLowerCase();
}

/**
 * Load the canonical `orders` row a review targets, by orderId (uuid) or a
 * legacy orderRef (local_key / stripe_session_id). Returns null if neither
 * is found.
 */
async function loadOrderForReview({ orderId, orderRef }) {
  if (orderId) {
    const { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (data) return data;
  }
  if (orderRef) {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .or(`local_key.eq.${orderRef},stripe_session_id.eq.${orderRef}`)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Map an `orders` row's fulfillment_type/order_type to a FULFILLMENT_METHODS value for applicableRatingDimensions. */
function resolveOrderMethod(orderRow) {
  if (orderRow.order_type === "cash_handshake") return "cash_pickup";
  if (orderRow.fulfillment_type === "in_person") return "prepaid_pickup";
  return "shipping";
}

/**
 * GET ?action=reviews&seller=<wallet>&limit=&offset= — published reviews for
 * a seller + the aggregate summary. Public (view_reputation is REQUIRED).
 */
async function handleGetReviews(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });

  const seller = (req.query.seller || "").toLowerCase();
  if (!seller) return res.status(400).json({ error: "Missing seller query parameter" });

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const { data, error, count } = await supabase
      .from("marketplace_reviews")
      .select("*", { count: "exact" })
      .eq("seller_wallet", seller)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[reviews] GET failed:", error);
      return res.status(500).json({ error: "Could not load reviews" });
    }

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=180");
    return res.status(200).json({
      reviews: (data || []).map(reviewRowToClient),
      total: count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[reviews] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET ?action=review-for-order&order=<orderId|orderRef> — the review for one
 * order, or null. Public.
 */
async function handleGetReviewForOrder(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });

  const order = req.query.order;
  if (!order) return res.status(400).json({ error: "Missing order query parameter" });

  try {
    const { data } = await supabase
      .from("marketplace_reviews")
      .select("*")
      .or(`order_id.eq.${order},order_ref.eq.${order}`)
      .maybeSingle();

    return res.status(200).json({ review: data ? reviewRowToClient(data) : null });
  } catch (err) {
    console.error("[reviews] review-for-order error:", err);
    return res.status(200).json({ review: null });
  }
}

/**
 * POST ?action=submit-review — authenticated buyer submits a review.
 * Server re-verifies eligibility (never trusts the client): 403 if the
 * caller isn't the order's buyer, 409 if a review already exists, 422 if
 * the order hasn't reached a verified completed state.
 */
async function handleSubmitReview(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireReviewerWallet(req, res);
  if (!wallet) return;

  const { orderId, orderRef, ...ratingFields } = req.body || {};
  if (!orderId && !orderRef) {
    return res.status(400).json({ error: "Missing orderId or orderRef" });
  }

  const overall = Number(ratingFields.overall);
  if (!Number.isFinite(overall) || overall < 1 || overall > 5) {
    return res.status(400).json({ error: "overall must be a number from 1 to 5" });
  }

  try {
    const orderRow = await loadOrderForReview({ orderId, orderRef });
    if (!orderRow) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { data: existingReview } = await supabase
      .from("marketplace_reviews")
      .select("id")
      .eq("order_id", orderRow.id)
      .maybeSingle();

    const decision = isOrderReviewable(
      { buyerWallet: orderRow.buyer_wallet, legacyStatus: orderRow.status },
      { viewerWallet: wallet, existingReview }
    );

    if (!decision.eligible) {
      if (existingReview) return res.status(409).json({ error: decision.reason });
      if (wallet !== (orderRow.buyer_wallet || "").toLowerCase()) {
        return res.status(403).json({ error: decision.reason });
      }
      return res.status(422).json({ error: decision.reason });
    }

    // Sanitize sub-ratings to the ones actually applicable to this order's
    // fulfillment method — never trust the client to have already done this.
    const method = resolveOrderMethod(orderRow);
    const allowedDims = new Set(applicableRatingDimensions(method));
    const row = {
      order_id: orderRow.id,
      order_ref: orderRef || orderRow.local_key || orderRow.stripe_session_id || null,
      buyer_wallet: wallet,
      seller_wallet: (orderRow.seller_wallet || "").toLowerCase(),
      fulfillment_method: method,
      overall,
      health: allowedDims.has("health") ? clampRating(ratingFields.health) : null,
      accuracy: allowedDims.has("accuracy") ? clampRating(ratingFields.accuracy) : null,
      packaging: allowedDims.has("packaging") ? clampRating(ratingFields.packaging) : null,
      communication: allowedDims.has("communication") ? clampRating(ratingFields.communication) : null,
      fulfillment: allowedDims.has("fulfillment") ? clampRating(ratingFields.fulfillment) : null,
      body: typeof ratingFields.body === "string" ? ratingFields.body.slice(0, 2000) : null,
      photo_urls: Array.isArray(ratingFields.photoUrls) ? ratingFields.photoUrls.slice(0, 6) : [],
      status: "published",
    };

    const { data: inserted, error } = await supabase
      .from("marketplace_reviews")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      if (String(error.message || "").includes("duplicate") || error.code === "23505") {
        return res.status(409).json({ error: "a review already exists for this order" });
      }
      console.error("[reviews] submit-review insert failed:", error);
      return res.status(500).json({ error: "Could not submit review" });
    }

    return res.status(201).json({ success: true, review: reviewRowToClient(inserted) });
  } catch (err) {
    console.error("[reviews] submit-review error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/**
 * POST ?action=respond-review — authenticated seller adds their one
 * response to a review on their own order.
 */
async function handleRespondReview(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireReviewerWallet(req, res);
  if (!wallet) return;

  const { reviewId, response } = req.body || {};
  if (!reviewId || !String(response || "").trim()) {
    return res.status(400).json({ error: "Missing reviewId or response" });
  }

  try {
    const { data: review } = await supabase
      .from("marketplace_reviews")
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();

    if (!review) return res.status(404).json({ error: "Review not found" });

    if (!canRespondToReview(
      { sellerWallet: review.seller_wallet, sellerResponse: review.seller_response },
      { viewerWallet: wallet }
    )) {
      return res.status(403).json({ error: "You may not respond to this review" });
    }

    const { data: updated, error } = await supabase
      .from("marketplace_reviews")
      .update({ seller_response: String(response).trim().slice(0, 1000), seller_responded_at: new Date().toISOString() })
      .eq("id", reviewId)
      .select("*")
      .single();

    if (error) {
      console.error("[reviews] respond-review failed:", error);
      return res.status(500).json({ error: "Could not save response" });
    }

    return res.status(200).json({ success: true, review: reviewRowToClient(updated) });
  } catch (err) {
    console.error("[reviews] respond-review error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST ?action=report-review — any authenticated user reports a review.
 */
async function handleReportReview(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireReviewerWallet(req, res);
  if (!wallet) return;

  const { reviewId, reason, details } = req.body || {};
  const ALLOWED_REASONS = ["spam", "inappropriate", "misinformation", "harassment", "other"];
  if (!reviewId || !ALLOWED_REASONS.includes(reason)) {
    return res.status(400).json({ error: `Missing reviewId or invalid reason (must be one of: ${ALLOWED_REASONS.join(", ")})` });
  }

  try {
    const { error } = await supabase.from("review_reports").insert({
      review_id: reviewId,
      reporter_wallet: wallet,
      reason,
      details: details ? String(details).slice(0, 1000) : null,
    });

    if (error) {
      console.error("[reviews] report-review failed:", error);
      return res.status(500).json({ error: "Could not submit report" });
    }

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error("[reviews] report-review error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Authorize a curator (or the CRON_SECRET backend) exactly like
 * api/stripe.js's authorizeAdminOrCurator — duplicated here in miniature
 * rather than importing across the two Vercel functions (each function is
 * bundled independently; importing api/stripe.js into api/storefront-
 * detail.js would pull in the entire Stripe SDK for no reason).
 */
async function authorizeCuratorForReviews(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, via: "cron" };
  }
  const curatorWallet = (process.env.CURATOR_WALLET || "").toLowerCase();
  if (authHeader.startsWith("Bearer ") && curatorWallet) {
    try {
      const { verified, walletAddress } = await verifyPrivyToken(req);
      if (verified && walletAddress && walletAddress.toLowerCase() === curatorWallet) {
        return { ok: true, via: "curator" };
      }
    } catch (e) {
      // fall through to unauthorized
    }
  }
  return { ok: false, status: 403, error: "Not authorized" };
}

/**
 * POST ?action=moderate-review — curator-only: hide a review (and mark its
 * report actioned) or dismiss a report. Composes the same
 * ModerationPanel.jsx action shape (status/reviewer_wallet/reviewed_at) so
 * the curator UI is a thin extra tab on that existing pattern, not a new
 * moderation system.
 */
async function handleModerateReview(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const auth = await authorizeCuratorForReviews(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });

  const { reportId, action: modAction } = req.body || {};
  if (!reportId || !["hide", "dismiss"].includes(modAction)) {
    return res.status(400).json({ error: "Missing reportId or invalid action (hide | dismiss)" });
  }

  try {
    const { data: report } = await supabase
      .from("review_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (!report) return res.status(404).json({ error: "Report not found" });

    const reviewerWallet = auth.via === "curator" ? (process.env.CURATOR_WALLET || "").toLowerCase() : "cron";

    const { error: reportError } = await supabase
      .from("review_reports")
      .update({
        status: modAction === "hide" ? "actioned" : "dismissed",
        reviewer_wallet: reviewerWallet,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reportId);

    if (reportError) {
      console.error("[reviews] moderate-review report update failed:", reportError);
      return res.status(500).json({ error: "Could not update report" });
    }

    if (modAction === "hide") {
      const { error: reviewError } = await supabase
        .from("marketplace_reviews")
        .update({ status: "hidden" })
        .eq("id", report.review_id);
      if (reviewError) {
        console.error("[reviews] moderate-review hide failed:", reviewError);
        return res.status(500).json({ error: "Could not hide review" });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[reviews] moderate-review error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function truncateAddr(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
