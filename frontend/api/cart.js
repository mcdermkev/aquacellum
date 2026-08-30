/**
 * cart.js — Vercel Serverless Function (persistent server-side cart, Task 10)
 *
 * Server mirror of the authenticated account's cart, so it survives a device
 * switch. Guest carts never reach this endpoint — they stay in Dexie only
 * (see src/services/cartStore.js). No money, no ownership, no inventory hold:
 * this endpoint is a dumb, identity-scoped JSON mirror of the client's
 * cartModel.js cart shape.
 *
 *   GET  /api/cart                 → the caller's server cart, or an empty one
 *   PUT  /api/cart                 → replace the caller's server cart
 *   POST /api/cart?action=merge    → merge a supplied guest cart into the
 *                                     server cart (login-time reconciliation)
 *
 * Auth: every route requires a verified Privy access token (Authorization:
 * Bearer <token>). The wallet address is taken ONLY from the verified token
 * claim, never from the request body — a client cannot read or write another
 * account's cart by supplying a different wallet in the payload.
 *
 * Environment variables:
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 */

import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { handleCorsPreFlight } from "./_lib/cors.js";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const MAX_ITEMS = 200; // generous ceiling against a malformed/abusive payload
const MARKETPLACE_ABI = [
  "function listings(uint256) view returns (uint256 tokenId, address seller, uint256 price, uint256 shippingFee, bool active, bool isShipping)",
  "function batchListings(uint256) view returns (uint256 listingId, uint256 spawnId, uint256 quantity, uint256 pricePerFish, address seller, bool isActive)",
];

function parseListingKey(value) {
  const match = /^(single|batch)-([1-9]\d*)$/.exec(String(value || ""));
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) return null;
  return { key: `${match[1]}-${id}`, id, isBatch: match[1] === "batch" };
}

function getMarketplaceReader() {
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";
  const address = process.env.MARKETPLACE_ADDRESS || "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
  return new ethers.Contract(address, MARKETPLACE_ABI, new ethers.providers.JsonRpcProvider(rpcUrl));
}

async function resolveAuthoritativeCartListings(items) {
  const parsedByKey = new Map();
  for (const item of items) {
    const parsed = parseListingKey(item?.listingKey);
    if (!parsed) throw new Error("invalid_listing_key");
    parsedByKey.set(parsed.key, parsed);
  }

  const marketplace = getMarketplaceReader();
  const entries = await Promise.all([...parsedByKey.values()].map(async (parsed) => {
    if (parsed.isBatch) {
      const listing = await marketplace.batchListings(parsed.id);
      return [parsed.key, {
        listingKey: parsed.key,
        isBatch: true,
        seller: String(listing.seller || "").toLowerCase(),
        active: !!listing.isActive,
        availableQuantity: Number(listing.quantity.toString()),
      }];
    }
    const listing = await marketplace.listings(parsed.id);
    return [parsed.key, {
      listingKey: parsed.key,
      isBatch: false,
      seller: String(listing.seller || "").toLowerCase(),
      active: !!listing.active,
      availableQuantity: listing.active ? 1 : 0,
    }];
  }));
  return Object.fromEntries(entries);
}

function canonicalizeMergeItems(items) {
  const seen = new Set();
  const canonicalItems = [];
  for (const item of items || []) {
    const parsed = parseListingKey(item?.listingKey);
    const quantity = Number(item?.quantity);
    if (!parsed) return { error: "Every cart item needs a canonical listing key" };
    if (seen.has(parsed.key)) return { error: "Duplicate cart listing keys are not allowed" };
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || (!parsed.isBatch && quantity !== 1)) {
      return { error: "Every cart item needs a valid quantity" };
    }
    seen.add(parsed.key);
    canonicalItems.push({ ...item, listingKey: parsed.key, quantity });
  }
  canonicalItems.sort((a, b) => (a.listingKey < b.listingKey ? -1 : a.listingKey > b.listingKey ? 1 : 0));
  return { items: canonicalItems };
}

export default async function handler(req, res) {
  const action = (req.query.action || "").toLowerCase();

  switch (action) {
    case "merge":
      return handleMerge(req, res);
    default:
      if (req.method === "GET") return handleGet(req, res);
      if (req.method === "PUT") return handlePut(req, res);
      if (handleCorsPreFlight(req, res, { methods: "GET, PUT, OPTIONS", headers: "Content-Type, Authorization" })) return;
      return res.status(405).json({ error: "Method not allowed. Use GET or PUT." });
  }
}

// ─── Shared auth ─────────────────────────────────────────────────────────────

/**
 * Resolve the caller's lowercased wallet address from a verified Privy
 * token. Never trusts a client-supplied wallet — the whole point of this
 * endpoint is that a cart is scoped to the token holder's own identity.
 */
async function requireWallet(req, res) {
  const { verified, walletAddress, error } = await verifyPrivyToken(req);
  if (!verified) {
    res.status(401).json({ error: error || "Missing or invalid authentication" });
    return null;
  }
  if (!walletAddress) {
    // The Privy token doesn't always carry a wallet claim (see
    // verifyPrivyToken.js) — without one there's no key to scope the cart to.
    res.status(401).json({ error: "Session has no linked account address" });
    return null;
  }
  return walletAddress.toLowerCase();
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a client-supplied cart payload: items must be an array, bounded
 * in size, and single-seller (every item's `seller` must match, or the item
 * carries no seller at all). Returns { ok, error?, sellerWallet? }.
 */
function validateCartPayload(items) {
  if (!Array.isArray(items)) {
    return { ok: false, error: "items must be an array" };
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: `items exceeds the maximum of ${MAX_ITEMS}` };
  }

  let sellerWallet = null;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "each item must be an object" };
    }
    const itemSeller = item.seller ? String(item.seller).toLowerCase() : null;
    if (itemSeller) {
      if (sellerWallet && sellerWallet !== itemSeller) {
        return { ok: false, error: "cart items must all belong to the same seller" };
      }
      sellerWallet = itemSeller;
    }
  }

  return { ok: true, sellerWallet };
}

// ─── GET /api/cart ───────────────────────────────────────────────────────────

async function handleGet(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "GET, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed. Use GET." });

  const wallet = await requireWallet(req, res);
  if (!wallet) return; // response already sent

  try {
    const { data, error } = await supabase
      .from("canonical_carts")
      .select("seller_wallet, items, updated_at, revision")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (error) {
      console.error("[cart] GET fetch failed:", error);
      return res.status(500).json({ error: "Could not load cart" });
    }

    if (!data) {
      return res.status(200).json({ sellerWallet: null, items: [], updatedAt: null, revision: 0 });
    }

    return res.status(200).json({
      sellerWallet: data.seller_wallet || null,
      items: data.items || [],
      updatedAt: data.updated_at,
      revision: Number(data.revision) || 0,
    });
  } catch (err) {
    console.error("[cart] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── PUT /api/cart ───────────────────────────────────────────────────────────

async function handlePut(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "PUT, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed. Use PUT." });

  const wallet = await requireWallet(req, res);
  if (!wallet) return;

  const { items, expectedRevision } = req.body || {};
  const validation = validateCartPayload(items);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const revision = Number(expectedRevision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return res.status(400).json({ error: "expectedRevision must be a non-negative safe integer" });
  }

  try {
    const { data, error } = await supabase.rpc("replace_canonical_cart", {
      p_wallet: wallet,
      p_items: items,
      p_seller_wallet: validation.sellerWallet,
      p_expected_revision: revision,
    });

    if (error) {
      console.error("[cart] PUT replace failed:", error);
      return res.status(500).json({ error: "Could not save cart" });
    }
    if (data?.code === "revision_conflict") return res.status(409).json(data);
    if (!data?.success) return res.status(500).json({ error: "Could not save cart" });

    return res.status(200).json(data);
  } catch (err) {
    console.error("[cart] PUT error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── POST /api/cart?action=merge ────────────────────────────────────────────
//
// Links a supplied guest cart into the verified account cart. The service-role
// RPC serializes this operation with ordinary PUT replacements, derives live
// listing state from the contract snapshot, and records durable idempotency.
// The request body never chooses the account wallet.

async function handleMerge(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireWallet(req, res);
  if (!wallet) return;

  const {
    items: guestItems,
    updatedAt: guestUpdatedAt,
    sellerWallet: guestSellerWallet,
    operationId,
    resolution = null,
    reviewedAccountRevision = null,
  } = req.body || {};
  const guestValidation = validateCartPayload(guestItems);
  if (!guestValidation.ok) return res.status(400).json({ error: guestValidation.error });
  const mergeValidation = canonicalizeMergeItems(guestItems);
  if (mergeValidation.error) return res.status(400).json({ error: mergeValidation.error });
  const canonicalGuestItems = mergeValidation.items;
  const guestUpdatedAtMs = Number(guestUpdatedAt);
  if (!Number.isSafeInteger(guestUpdatedAtMs) || guestUpdatedAtMs <= 0) {
    return res.status(400).json({ error: "updatedAt must be a positive safe integer" });
  }
  if (typeof operationId !== "string" || operationId.length < 8 || operationId.length > 120) {
    return res.status(400).json({ error: "A stable merge operationId is required" });
  }
  if (resolution != null && resolution !== "account" && resolution !== "guest") {
    return res.status(400).json({ error: "resolution must be account or guest" });
  }
  const reviewedRevision = reviewedAccountRevision == null ? null : Number(reviewedAccountRevision);
  if (resolution == null && reviewedRevision != null) {
    return res.status(400).json({ error: "reviewedAccountRevision is only valid with a resolution" });
  }
  if (resolution != null && (!Number.isSafeInteger(reviewedRevision) || reviewedRevision < 0)) {
    return res.status(400).json({ error: "reviewedAccountRevision must be a non-negative safe integer" });
  }
  if (guestSellerWallet && guestValidation.sellerWallet
      && String(guestSellerWallet).toLowerCase() !== guestValidation.sellerWallet) {
    return res.status(400).json({ error: "sellerWallet does not match the cart items" });
  }

  try {
    // Completed operations replay without a catalog dependency. The RPC still
    // compares the immutable request payload and returns the current cart, so
    // an old A retry after newer operation B cannot restore A's old result.
    const { data: priorOperation, error: priorError } = await supabase
      .from("canonical_cart_merge_operations")
      .select("status")
      .eq("wallet_address", wallet)
      .eq("operation_id", operationId)
      .maybeSingle();
    if (priorError) {
      console.error("[cart] merge ledger lookup failed:", priorError);
      return res.status(500).json({ error: "Could not verify merge operation" });
    }
    if (priorOperation?.status === "completed") {
      const { data: replay, error: replayError } = await supabase.rpc("merge_canonical_cart", {
        p_wallet: wallet,
        p_operation_id: operationId,
        p_guest_items: canonicalGuestItems,
        p_guest_updated_at: guestUpdatedAtMs,
        p_resolution: resolution,
        p_reviewed_account_revision: reviewedRevision,
        p_authoritative_listings: {},
      });
      if (replayError) {
        console.error("[cart] merge replay failed:", replayError);
        return res.status(500).json({ error: "Could not replay merge result" });
      }
      if (replay?.code === "operation_mismatch") return res.status(409).json(replay);
      return res.status(200).json(replay);
    }

    // Resolve every currently observed account and guest row against the
    // marketplace contract before entering the atomic merge transaction. The
    // RPC treats any concurrently introduced/unresolved row as unavailable.
    const { data: preview, error: previewError } = await supabase
      .from("canonical_carts")
      .select("items")
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (previewError) {
      console.error("[cart] merge preview failed:", previewError);
      return res.status(500).json({ error: "Could not load existing cart" });
    }

    let authoritativeListings;
    try {
      authoritativeListings = await resolveAuthoritativeCartListings([
        ...(preview?.items || []),
        ...canonicalGuestItems,
      ]);
    } catch (catalogError) {
      console.error("[cart] authoritative merge lookup failed:", catalogError);
      return res.status(503).json({
        error: "Live listing availability could not be verified. Please try again.",
        code: "catalog_unavailable",
      });
    }

    const { data: result, error: mergeError } = await supabase.rpc("merge_canonical_cart", {
      p_wallet: wallet,
      p_operation_id: operationId,
      p_guest_items: canonicalGuestItems,
      p_guest_updated_at: guestUpdatedAtMs,
      p_resolution: resolution,
      p_reviewed_account_revision: reviewedRevision,
      p_authoritative_listings: authoritativeListings,
    });

    if (mergeError) {
      console.error("[cart] atomic merge failed:", mergeError);
      return res.status(500).json({ error: "Could not merge carts" });
    }
    if (result?.code === "seller_conflict") {
      return res.status(409).json(result);
    }
    if (result?.code === "operation_mismatch" || result?.code === "invalid_cart") {
      return res.status(409).json(result);
    }
    if (result?.code === "catalog_retry") {
      return res.status(503).json(result);
    }
    if (!result?.success) {
      return res.status(500).json({ error: "Could not merge carts" });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[cart] merge error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
