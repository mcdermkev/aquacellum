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
 * Task 21A (Storefront Merchandising) addition — same reasoning (stay under
 * the 12-function cap; this router already owns storefront reads/writes):
 *
 *   GET  /api/storefront-detail?action=sections&seller=<wallet>
 *                                                            → the seller's visible sections, ordered (public)
 *   PUT|POST /api/storefront-detail?action=sections          → authenticated owner replaces their sections
 *
 * Task 21B (Promotions & Customer Segments) addition — same reasoning; both
 * are seller-scoped (never public — promo codes are not publicly
 * enumerable) and session-authed:
 *
 *   GET    /api/storefront-detail?action=promotions          → the authenticated seller's own promotions
 *   POST   /api/storefront-detail?action=promotions          → create a promotion for the authenticated seller
 *   PUT    /api/storefront-detail?action=promotions&id=<id>  → update one of the seller's own promotions
 *   DELETE /api/storefront-detail?action=promotions&id=<id>  → delete one of the seller's own promotions
 *   GET    /api/storefront-detail?action=segments             → the authenticated seller's alias-only customer segments
 *
 *   IMPORTANT: this router's promotions endpoint is authoring/storage ONLY.
 *   It never applies a discount to a real charge and never touches
 *   `api/stripe.js`. See docs/TASK_21B_PROMOTIONS_SPEC.md — wiring a
 *   promotion into `handleCreateCheckout`'s charge math is a separate,
 *   Tier A (Opus-reviewed) change.
 *
 * Task 25 (Local Pickup Coordination) addition — same reasoning (stay under
 * the 12-function cap):
 *
 *   GET    /api/storefront-detail?action=pickup-locations         → the authenticated seller's own pickup spots
 *   POST   /api/storefront-detail?action=pickup-locations          → create a pickup spot for the authenticated seller
 *   PUT    /api/storefront-detail?action=pickup-locations&id=<id>  → update one of the seller's own spots
 *   DELETE /api/storefront-detail?action=pickup-locations&id=<id>  → delete/deactivate one of the seller's own spots
 *   GET    /api/storefront-detail?action=pickup-for-order&order=<ref>
 *                                                            → resolved pickup spot + arrangement for ONE order, ONLY if the
 *                                                              caller is the buyer or seller on that order (session-authed)
 *   POST   /api/storefront-detail?action=pickup-arrange     → buyer proposes a pickup time for an order they own
 *   POST   /api/storefront-detail?action=pickup-confirm     → seller confirms/counters the proposed time
 *
 *   GUARDRAIL (spec §0.1, review-critical): none of these handlers may call
 *   settlement/release/reserve/refund/escrow code. A pickup arrangement is
 *   pure logistics metadata layered on TOP of an already-paid prepaid-pickup
 *   order — it never holds inventory and never changes the order's payment
 *   state. Exact coordinates are revealed only via pickup-for-order, and
 *   only to the buyer/seller verified against that specific order row.
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
import {
  normalizeSection,
  validateSectionsPayload,
  assembleStorefrontLayout,
} from "../src/services/storeMerchandising.js";
import {
  normalizePromotion,
  validatePromotionDraft,
  MAX_CODE_LENGTH,
} from "../src/services/promotionEngine.js";
import { buildCustomerSegments } from "../src/services/customerSegments.js";
import {
  normalizePickupLocation,
  validatePickupLocationDraft,
  validateProposedTime,
} from "../src/services/pickupCoordination.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Protocol constants
const CHAIN_ID = 84532; // Base Sepolia
const MARKETPLACE_ADDRESS = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
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
    // ── Task 21A: Storefront Merchandising (sections) ──
    case "sections":
      return handleSections(req, res);
    // ── Task 21B: Promotions & Customer Segments ──
    case "promotions":
      return handlePromotions(req, res);
    case "segments":
      return handleSegments(req, res);
    // ── Task 25: Local Pickup Coordination ──
    case "pickup-locations":
      return handlePickupLocations(req, res);
    case "pickup-for-order":
      return handlePickupForOrder(req, res);
    case "pickup-arrange":
      return handlePickupArrange(req, res);
    case "pickup-confirm":
      return handlePickupConfirm(req, res);
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

    const [listingsResult, statsResult, historyResult, sectionsResult] = await Promise.all([
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
      // Task 21A: fold the store's visible sections into the same fetch so
      // the public store page never needs a second round trip.
      supabase
        .from("store_sections")
        .select("*")
        .eq("wallet_address", wallet)
        .eq("visible", true)
        .order("sort_order", { ascending: true }),
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
      const isBatch = row.is_batch ?? d.isBatch ?? false;
      const tokenId = d.tokenId || null;
      const listingId = d.listingId || row.id;
      return {
        id: row.id,
        is_batch: isBatch,
        token_id: tokenId,
        listing_id: listingId,
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
        // camelCase aliases (Task 21A) — getListingKey/isListingActive from
        // catalogQuery.js read isBatch/tokenId/listingId/isActive/active, not
        // the snake_case fields above. Query already filters is_active=true,
        // so both flags are true for every row reaching this map. These
        // aliases let assembleStorefrontLayout resolve `listing_refs` (which
        // were derived client-side from this same camelCase shape, via
        // useMarketplaceListings/pullCloudListings) against the identical
        // key derivation used to create them.
        isBatch,
        tokenId,
        listingId,
        isActive: true,
        active: true,
      };
    });
    const stats = statsResult.data || {};
    const breedingHistory = historyResult.data || [];
    const rawSections = (sectionsResult.data || []).map(sectionRowToClient);

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
      listings: listings.map((listing) => mapListingForResponse(listing, wallet)),
      breedingHistory: breedingHistory.map((record) => ({
        spawnId: record.spawn_id || record.id,
        species: record.species_name || null,
        sireTokenId: record.sire_token_id || null,
        damTokenId: record.dam_token_id || null,
        offspringCount: record.offspring_count || 0,
        spawnDate: record.spawn_date,
        status: record.status || "completed",
      })),
      // Task 21A: sections pre-arranged through the pure, tested
      // assembleStorefrontLayout — the exact fn the seller's editor preview
      // uses (storeMerchandising.js). store.html (a static, bundler-free
      // page) just renders these in order rather than re-implementing the
      // featured/collection/catch-all + inactive-listing-drop logic in
      // vanilla JS. Each entry's `listings` already carry the same
      // response-mapped shape as the top-level `listings` array above.
      sections: assembleStorefrontLayout(null, listings, rawSections).map((section) => ({
        id: section.id,
        type: section.type,
        title: section.title,
        listings: section.listings.map((listing) => mapListingForResponse(listing, wallet)),
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
// TASK 21A: STOREFRONT MERCHANDISING (SECTIONS)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ordering/emptiness decisions (featured-first, drop inactive listings, drop
// empty sections) belong ONLY to the pure, tested
// storeMerchandising.assembleStorefrontLayout — this router never re-sorts
// or re-filters sections itself. It resolves rows, validates the write
// payload via validateSectionsPayload, and returns rows in `sort_order` so
// the public store page and the seller's live preview render identically.

/**
 * Resolve the caller's lowercased wallet from a verified Privy session token
 * ONLY — never from the request body. Mirrors api/stripe.js's
 * requireWalletFromSession / api/cart.js's requireWallet: a client cannot
 * write another seller's sections by supplying a different wallet anywhere
 * in the request.
 */
async function requireWalletFromSession(req, res) {
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

/** Map a store_sections row to the client shape (normalizeSection's own camelCase output). */
function sectionRowToClient(row) {
  return normalizeSection(row);
}

/**
 * GET ?action=sections&seller=<wallet> — the store's visible sections,
 * ordered by sort_order. Public (storefronts are public).
 *
 * PUT|POST ?action=sections — replace/upsert the authenticated owner's
 * sections. Owner wallet comes ONLY from the verified session token.
 */
async function handleSections(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, POST, PUT, OPTIONS", headers: "Content-Type, Authorization" })) return;

  if (req.method === "GET") {
    const seller = (req.query.seller || "").toLowerCase();
    if (!seller) return res.status(400).json({ error: "Missing seller query parameter" });

    try {
      const { data, error } = await supabase
        .from("store_sections")
        .select("*")
        .eq("wallet_address", seller)
        .eq("visible", true)
        .order("sort_order", { ascending: true });

      if (error) {
        console.error("[sections] GET failed:", error);
        return res.status(500).json({ error: "Could not load storefront sections" });
      }

      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=180");
      return res.status(200).json({ sections: (data || []).map(sectionRowToClient) });
    } catch (err) {
      console.error("[sections] GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    const wallet = await requireWalletFromSession(req, res);
    if (!wallet) return;

    const sections = Array.isArray(req.body?.sections) ? req.body.sections : null;
    if (!sections) {
      return res.status(400).json({ error: "Missing sections array" });
    }

    const validation = validateSectionsPayload(sections);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      // Replace-all semantics, scoped strictly to this wallet: delete the
      // owner's existing rows, then insert the submitted set. Never touches
      // another seller's rows — the delete/insert are both filtered to the
      // session-derived wallet, not any id the client might supply.
      const { error: deleteError } = await supabase
        .from("store_sections")
        .delete()
        .eq("wallet_address", wallet);

      if (deleteError) {
        console.error("[sections] delete-before-replace failed:", deleteError);
        return res.status(500).json({ error: "Could not save storefront sections" });
      }

      if (sections.length === 0) {
        return res.status(200).json({ success: true, sections: [] });
      }

      const rows = sections.map((draft, idx) => ({
        wallet_address: wallet,
        type: draft.type,
        title: typeof draft.title === "string" ? draft.title.slice(0, 60) : null,
        listing_refs: Array.isArray(draft.listingRefs ?? draft.listing_refs)
          ? (draft.listingRefs ?? draft.listing_refs).slice(0, 100)
          : [],
        sort_order: Number.isFinite(Number(draft.sortOrder ?? draft.sort_order)) ? Number(draft.sortOrder ?? draft.sort_order) : idx,
        visible: draft.visible !== false,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from("store_sections")
        .insert(rows)
        .select("*");

      if (insertError) {
        console.error("[sections] insert failed:", insertError);
        return res.status(500).json({ error: "Could not save storefront sections" });
      }

      return res.status(200).json({ success: true, sections: (inserted || []).map(sectionRowToClient) });
    } catch (err) {
      console.error("[sections] write error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed. Use GET, POST, or PUT." });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 21B: PROMOTIONS & CUSTOMER SEGMENTS
// ═══════════════════════════════════════════════════════════════════════════════
//
// MONEY BOUNDARY: this section is authoring/storage ONLY. It validates and
// persists promotion rows via the pure, tested promotionEngine.js
// (validatePromotionDraft/normalizePromotion) — it never evaluates a
// promotion against a real cart at checkout time, never increments
// used_count, and never touches api/stripe.js or any charge/payout math.
// Wiring a promotion into handleCreateCheckout is a separate, Tier A
// (Opus-reviewed) change — see docs/TASK_21B_PROMOTIONS_SPEC.md §2/§6.

/** Map a seller_promotions row to the client shape (normalizePromotion's own camelCase output). */
function promotionRowToClient(row) {
  return normalizePromotion(row);
}

/**
 * ?action=promotions — the authenticated seller's own promotion CRUD.
 * Never public: promo codes should not be publicly enumerable, and this
 * endpoint returns the seller's full row set (including paused/expired)
 * for the authoring UI, not a buyer-facing filtered list.
 *
 *   GET    → list the caller's promotions
 *   POST   → create a promotion for the caller
 *   PUT    → update one of the caller's existing promotions (?id=... or body.id)
 *   DELETE → remove one of the caller's promotions (?id=... or body.id)
 *
 * Auth: verified Privy session required for every method (mirrors
 * stripe.js's handleParcelPresets pattern) — wallet derived ONLY from the
 * session token, and every mutation re-checks the target row belongs to
 * that wallet before writing.
 */
async function handlePromotions(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, POST, PUT, DELETE, OPTIONS", headers: "Content-Type, Authorization" })) return;

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("seller_promotions")
        .select("*")
        .eq("wallet_address", wallet)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[promotions] GET failed:", error);
        return res.status(500).json({ error: "Could not load promotions" });
      }
      return res.status(200).json({ success: true, promotions: (data || []).map(promotionRowToClient) });
    } catch (err) {
      console.error("[promotions] GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST") {
    const draft = normalizePromotion(req.body || {});
    const validation = validatePromotionDraft(draft);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      const { data, error } = await supabase
        .from("seller_promotions")
        .insert(promotionDraftToRow(draft, wallet))
        .select("*")
        .single();

      if (error) {
        if (String(error.message || "").includes("duplicate") || error.code === "23505") {
          return res.status(409).json({ error: "A promotion with this code already exists" });
        }
        console.error("[promotions] POST failed:", error);
        return res.status(500).json({ error: "Could not create promotion" });
      }
      return res.status(201).json({ success: true, promotion: promotionRowToClient(data) });
    } catch (err) {
      console.error("[promotions] POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "PUT") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const draft = normalizePromotion(req.body || {});
    const validation = validatePromotionDraft(draft);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      // Ownership check before writing — the wallet came from the session,
      // but the ROW must also belong to that wallet, not just the request.
      const { data: existing } = await supabase
        .from("seller_promotions")
        .select("wallet_address")
        .eq("id", id)
        .maybeSingle();

      if (!existing || existing.wallet_address !== wallet) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      const { data, error } = await supabase
        .from("seller_promotions")
        .update(promotionDraftToRow(draft, wallet))
        .eq("id", id)
        .eq("wallet_address", wallet)
        .select("*")
        .single();

      if (error) {
        if (String(error.message || "").includes("duplicate") || error.code === "23505") {
          return res.status(409).json({ error: "A promotion with this code already exists" });
        }
        console.error("[promotions] PUT failed:", error);
        return res.status(500).json({ error: "Could not update promotion" });
      }
      return res.status(200).json({ success: true, promotion: promotionRowToClient(data) });
    } catch (err) {
      console.error("[promotions] PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "DELETE") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    try {
      const { data: existing } = await supabase
        .from("seller_promotions")
        .select("wallet_address")
        .eq("id", id)
        .maybeSingle();

      if (!existing || existing.wallet_address !== wallet) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      const { error } = await supabase
        .from("seller_promotions")
        .delete()
        .eq("id", id)
        .eq("wallet_address", wallet);

      if (error) {
        console.error("[promotions] DELETE failed:", error);
        return res.status(500).json({ error: "Could not delete promotion" });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[promotions] DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed. Use GET, POST, PUT, or DELETE." });
}

/** Map a normalized promotion draft to a seller_promotions row for insert/update. */
function promotionDraftToRow(draft, wallet) {
  return {
    wallet_address: wallet,
    code: draft.code ? String(draft.code).toUpperCase().slice(0, MAX_CODE_LENGTH) : null,
    type: draft.type,
    value: draft.value,
    scope: draft.scope,
    scope_refs: draft.scopeRefs.slice(0, 100),
    min_subtotal_cents: draft.minSubtotalCents,
    starts_at: draft.startsAt || null,
    ends_at: draft.endsAt || null,
    usage_limit: draft.usageLimit || null,
    funding: draft.funding,
    active: draft.active,
  };
}

/**
 * GET ?action=segments — the authenticated seller's own alias-only customer
 * segments (repeat buyers / high-value buyers / at-risk buyers), computed by
 * the pure, tested customerSegments.js over the seller's own `orders` rows.
 * Never public, never exposes a raw wallet — buildCustomerSegments returns
 * alias-only summaries by construction.
 */
async function handleSegments(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  try {
    const { data, error } = await supabase
      .from("orders")
      .select("buyer_wallet, status, total_paid_cents, created_at")
      .eq("seller_wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("[segments] GET failed:", error);
      return res.status(500).json({ error: "Could not load customer segments" });
    }

    const segments = buildCustomerSegments(data || []);
    return res.status(200).json({ success: true, segments });
  } catch (err) {
    console.error("[segments] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 25: LOCAL PICKUP COORDINATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// GUARDRAIL 1 (spec §0.1, review-critical): none of the handlers below call
// settlement/release/reserve/refund/escrow code, and none of them write to
// `orders`/`canonical_orders`/`fiat_settlements`/any inventory or reservation
// table. A prepaid-pickup order's payment is already held via the existing
// Stripe flow (unchanged by this feature) — pickup_locations/
// pickup_arrangements are pure logistics metadata describing where/when the
// already-paid handoff happens. Verified by a source-guard test (grep-guard
// for absence of release/settle/reserve/refund/escrow writes in this section).
//
// GUARDRAIL 2/3: exact coordinates are revealed only post-purchase, only to
// the buyer/seller verified against that specific order row (never a public
// read), and every write derives its wallet from the verified Privy session
// token — never the request body. Mirrors the reviews system's
// loadOrderForReview + requireWalletFromSession pattern above.

/** Map a pickup_locations row to the client shape (normalizePickupLocation's own camelCase output). */
function pickupLocationRowToClient(row) {
  return normalizePickupLocation(row);
}

/**
 * Resolve the canonical `orders` row a pickup arrangement targets, by
 * orderId (uuid) or a legacy orderRef (local_key / stripe_session_id).
 * Mirrors the reviews system's loadOrderForReview exactly — same identity
 * scheme, same table. Returns null if neither is found.
 */
const ORDER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrderForPickup({ orderId, orderRef }) {
  // Route each candidate ref to the ONE column whose type it matches. A
  // non-uuid ref (a Dexie local_key or a stripe session id) must never land
  // in an `id.eq.<value>` comparison: `id` is a uuid column, and PostgREST
  // evaluates every comparand in an .or() up front, 400-ing the whole query
  // on the first type mismatch ("invalid input syntax for type uuid") — which
  // would 404 every legacy-ref pickup lookup (verified against the live DB).
  // uuid → id, all-digits → local_key (integer), anything else →
  // stripe_session_id (text).
  const seen = new Set();
  for (const ref of [orderId, orderRef]) {
    if (ref == null) continue;
    const refStr = String(ref);
    if (!refStr || seen.has(refStr)) continue;
    seen.add(refStr);

    let query = supabase.from("orders").select("*");
    if (ORDER_UUID_RE.test(refStr)) {
      query = query.eq("id", refStr);
    } else if (/^\d+$/.test(refStr)) {
      query = query.eq("local_key", Number(refStr));
    } else {
      query = query.eq("stripe_session_id", refStr);
    }
    const { data } = await query.maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Map a pickup_arrangements row to the client shape (camelCase). */
function arrangementRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderRef: row.order_ref,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    pickupLocationId: row.pickup_location_id,
    proposedTime: row.proposed_time,
    confirmedTime: row.confirmed_time,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ?action=pickup-locations — the authenticated seller's own pickup-spot CRUD.
 * Never public: exact coordinates must only be revealed post-purchase via
 * pickup-for-order's order-scoped gate, never through a general listing read.
 *
 *   GET    → list the caller's own spots (including inactive, for the setup UI)
 *   POST   → create a spot for the caller
 *   PUT    → update one of the caller's existing spots (?id=... or body.id)
 *   DELETE → remove one of the caller's spots (?id=... or body.id)
 */
async function handlePickupLocations(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, POST, PUT, DELETE, OPTIONS", headers: "Content-Type, Authorization" })) return;

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("pickup_locations")
        .select("*")
        .eq("wallet_address", wallet)
        .order("sort_order", { ascending: true });

      if (error) {
        console.error("[pickup-locations] GET failed:", error);
        return res.status(500).json({ error: "Could not load pickup spots" });
      }
      return res.status(200).json({ success: true, locations: (data || []).map(pickupLocationRowToClient) });
    } catch (err) {
      console.error("[pickup-locations] GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST") {
    const draft = normalizePickupLocation(req.body || {});
    const validation = validatePickupLocationDraft(draft);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      const { data, error } = await supabase
        .from("pickup_locations")
        .insert(pickupLocationDraftToRow(draft, wallet))
        .select("*")
        .single();

      if (error) {
        console.error("[pickup-locations] POST failed:", error);
        return res.status(500).json({ error: "Could not create pickup spot" });
      }
      return res.status(201).json({ success: true, location: pickupLocationRowToClient(data) });
    } catch (err) {
      console.error("[pickup-locations] POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "PUT") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const draft = normalizePickupLocation(req.body || {});
    const validation = validatePickupLocationDraft(draft);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      const { data: existing } = await supabase
        .from("pickup_locations")
        .select("wallet_address")
        .eq("id", id)
        .maybeSingle();

      if (!existing || existing.wallet_address !== wallet) {
        return res.status(404).json({ error: "Pickup spot not found" });
      }

      const { data, error } = await supabase
        .from("pickup_locations")
        .update(pickupLocationDraftToRow(draft, wallet))
        .eq("id", id)
        .eq("wallet_address", wallet)
        .select("*")
        .single();

      if (error) {
        console.error("[pickup-locations] PUT failed:", error);
        return res.status(500).json({ error: "Could not update pickup spot" });
      }
      return res.status(200).json({ success: true, location: pickupLocationRowToClient(data) });
    } catch (err) {
      console.error("[pickup-locations] PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "DELETE") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    try {
      const { data: existing } = await supabase
        .from("pickup_locations")
        .select("wallet_address")
        .eq("id", id)
        .maybeSingle();

      if (!existing || existing.wallet_address !== wallet) {
        return res.status(404).json({ error: "Pickup spot not found" });
      }

      const { error } = await supabase
        .from("pickup_locations")
        .delete()
        .eq("id", id)
        .eq("wallet_address", wallet);

      if (error) {
        console.error("[pickup-locations] DELETE failed:", error);
        return res.status(500).json({ error: "Could not delete pickup spot" });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[pickup-locations] DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed. Use GET, POST, PUT, or DELETE." });
}

/** Map a normalized pickup-location draft to a pickup_locations row for insert/update. */
function pickupLocationDraftToRow(draft, wallet) {
  return {
    wallet_address: wallet,
    label: draft.label.slice(0, 80),
    lat: draft.lat,
    lng: draft.lng,
    address_text: draft.addressText ? String(draft.addressText).slice(0, 500) : null,
    notes: draft.notes ? String(draft.notes).slice(0, 500) : null,
    availability: draft.availability,
    active: draft.active,
    sort_order: draft.sortOrder,
  };
}

/**
 * GET ?action=pickup-for-order&order=<orderId|orderRef> — the resolved
 * pickup spot (exact lat/lng/address_text) + arrangement for ONE order.
 * Session-authed; returns 403 unless the caller is the buyer or seller on
 * that specific order (Guardrail 2/3 — the reveal gate).
 */
async function handlePickupForOrder(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  const orderRef = req.query.order;
  if (!orderRef) return res.status(400).json({ error: "Missing order query parameter" });

  try {
    const orderRow = await loadOrderForPickup({ orderId: orderRef, orderRef });
    if (!orderRow) return res.status(404).json({ error: "Order not found" });

    const buyerWallet = (orderRow.buyer_wallet || "").toLowerCase();
    const sellerWallet = (orderRow.seller_wallet || "").toLowerCase();
    if (wallet !== buyerWallet && wallet !== sellerWallet) {
      return res.status(403).json({ error: "You are not a party to this order" });
    }

    const { data: arrangementRow } = await supabase
      .from("pickup_arrangements")
      .select("*")
      .eq("order_ref", orderRow.id)
      .maybeSingle();

    let location = null;
    if (arrangementRow?.pickup_location_id) {
      const { data: locationRow } = await supabase
        .from("pickup_locations")
        .select("*")
        .eq("id", arrangementRow.pickup_location_id)
        .maybeSingle();
      if (locationRow) location = pickupLocationRowToClient(locationRow);
    } else {
      // No arrangement yet — fall back to the seller's active default spot
      // (lowest sort_order) so the buyer sees available windows before a
      // time is proposed.
      const { data: defaultRows } = await supabase
        .from("pickup_locations")
        .select("*")
        .eq("wallet_address", sellerWallet)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(1);
      if (defaultRows && defaultRows[0]) location = pickupLocationRowToClient(defaultRows[0]);
    }

    return res.status(200).json({
      success: true,
      location,
      arrangement: arrangementRowToClient(arrangementRow || null),
    });
  } catch (err) {
    console.error("[pickup-for-order] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST ?action=pickup-arrange — session buyer proposes a time for a
 * prepaid-pickup order they own. Server re-validates the time against the
 * seller's availability windows via validateProposedTime (never trusts a
 * client-side check). Upserts the single arrangement row for this order.
 */
async function handlePickupArrange(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  const { orderId, orderRef, pickupLocationId, proposedTime } = req.body || {};
  if ((!orderId && !orderRef) || !proposedTime) {
    return res.status(400).json({ error: "Missing orderId/orderRef or proposedTime" });
  }

  try {
    const orderRow = await loadOrderForPickup({ orderId, orderRef });
    if (!orderRow) return res.status(404).json({ error: "Order not found" });

    const buyerWallet = (orderRow.buyer_wallet || "").toLowerCase();
    const sellerWallet = (orderRow.seller_wallet || "").toLowerCase();
    if (wallet !== buyerWallet) {
      return res.status(403).json({ error: "Only the buyer on this order may propose a pickup time" });
    }

    // Resolve the target pickup spot: an explicit id, or the arrangement's
    // existing spot, or the seller's default active spot.
    let locationId = pickupLocationId || null;
    if (!locationId) {
      const { data: existingArrangement } = await supabase
        .from("pickup_arrangements")
        .select("pickup_location_id")
        .eq("order_ref", orderRow.id)
        .maybeSingle();
      locationId = existingArrangement?.pickup_location_id || null;
    }
    if (!locationId) {
      const { data: defaultRows } = await supabase
        .from("pickup_locations")
        .select("id")
        .eq("wallet_address", sellerWallet)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(1);
      locationId = defaultRows?.[0]?.id || null;
    }
    if (!locationId) {
      return res.status(422).json({ error: "This seller has not set up a pickup spot yet" });
    }

    const { data: locationRow } = await supabase.from("pickup_locations").select("*").eq("id", locationId).maybeSingle();
    if (!locationRow) return res.status(404).json({ error: "Pickup spot not found" });

    const timeCheck = validateProposedTime(normalizePickupLocation(locationRow), proposedTime, {});
    if (!timeCheck.ok) {
      return res.status(422).json({ error: timeCheck.error });
    }

    const { data: upserted, error } = await supabase
      .from("pickup_arrangements")
      .upsert(
        {
          order_ref: orderRow.id,
          buyer_wallet: buyerWallet,
          seller_wallet: sellerWallet,
          pickup_location_id: locationId,
          proposed_time: proposedTime,
          confirmed_time: null,
          status: "proposed",
        },
        { onConflict: "order_ref" }
      )
      .select("*")
      .single();

    if (error) {
      console.error("[pickup-arrange] upsert failed:", error);
      return res.status(500).json({ error: "Could not propose this pickup time" });
    }

    return res.status(200).json({ success: true, arrangement: arrangementRowToClient(upserted) });
  } catch (err) {
    console.error("[pickup-arrange] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST ?action=pickup-confirm — session seller confirms (or counters) the
 * proposed time for an order they are selling. A countered time is
 * re-validated against the seller's own availability windows exactly like
 * a buyer proposal (a seller's counter must still land in a real window).
 */
async function handlePickupConfirm(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireWalletFromSession(req, res);
  if (!wallet) return;

  const { orderId, orderRef, confirmedTime } = req.body || {};
  if (!orderId && !orderRef) {
    return res.status(400).json({ error: "Missing orderId or orderRef" });
  }

  try {
    const orderRow = await loadOrderForPickup({ orderId, orderRef });
    if (!orderRow) return res.status(404).json({ error: "Order not found" });

    const sellerWallet = (orderRow.seller_wallet || "").toLowerCase();
    if (wallet !== sellerWallet) {
      return res.status(403).json({ error: "Only the seller on this order may confirm a pickup time" });
    }

    const { data: existingArrangement } = await supabase
      .from("pickup_arrangements")
      .select("*")
      .eq("order_ref", orderRow.id)
      .maybeSingle();

    if (!existingArrangement) {
      return res.status(404).json({ error: "No proposed pickup time to confirm yet" });
    }

    const timeToConfirm = confirmedTime || existingArrangement.proposed_time;
    if (!timeToConfirm) {
      return res.status(400).json({ error: "Missing confirmedTime" });
    }

    // A seller counter-time must itself land in the spot's own availability.
    if (existingArrangement.pickup_location_id) {
      const { data: locationRow } = await supabase
        .from("pickup_locations")
        .select("*")
        .eq("id", existingArrangement.pickup_location_id)
        .maybeSingle();
      if (locationRow) {
        const timeCheck = validateProposedTime(normalizePickupLocation(locationRow), timeToConfirm, {});
        if (!timeCheck.ok) {
          return res.status(422).json({ error: timeCheck.error });
        }
      }
    }

    const { data: updated, error } = await supabase
      .from("pickup_arrangements")
      .update({ confirmed_time: timeToConfirm, status: "confirmed" })
      .eq("order_ref", orderRow.id)
      .select("*")
      .single();

    if (error) {
      console.error("[pickup-confirm] update failed:", error);
      return res.status(500).json({ error: "Could not confirm this pickup time" });
    }

    return res.status(200).json({ success: true, arrangement: arrangementRowToClient(updated) });
  } catch (err) {
    console.error("[pickup-confirm] error:", err);
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

/** Map one normalized listing (see handleStorefrontDetail's `listings` map) to the public response shape. */
function mapListingForResponse(listing, wallet) {
  return {
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
  };
}
