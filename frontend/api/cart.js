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
import { handleCorsPreFlight } from "./_lib/cors.js";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const MAX_ITEMS = 200; // generous ceiling against a malformed/abusive payload

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
      .select("seller_wallet, items, updated_at")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (error) {
      console.error("[cart] GET fetch failed:", error);
      return res.status(500).json({ error: "Could not load cart" });
    }

    if (!data) {
      return res.status(200).json({ sellerWallet: null, items: [], updatedAt: null });
    }

    return res.status(200).json({
      sellerWallet: data.seller_wallet || null,
      items: data.items || [],
      updatedAt: data.updated_at,
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

  const { items } = req.body || {};
  const validation = validateCartPayload(items);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const { data, error } = await supabase
      .from("canonical_carts")
      .upsert(
        {
          wallet_address: wallet,
          seller_wallet: validation.sellerWallet,
          items: items,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      )
      .select("seller_wallet, items, updated_at")
      .single();

    if (error) {
      console.error("[cart] PUT upsert failed:", error);
      return res.status(500).json({ error: "Could not save cart" });
    }

    return res.status(200).json({
      success: true,
      sellerWallet: data.seller_wallet || null,
      items: data.items || [],
      updatedAt: data.updated_at,
    });
  } catch (err) {
    console.error("[cart] PUT error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── POST /api/cart?action=merge ────────────────────────────────────────────
//
// Merges a supplied guest cart into the server cart at login. The actual
// merge RULES (same-seller union, different-seller keep-most-recent) live in
// the pure cartModel.mergeCarts — this handler only fetches the existing
// server cart, delegates the decision to that same core (imported, not
// re-implemented), and persists the result. Kept server-side so a merge is
// atomic against a concurrent GET/PUT from another device, and so the
// single-seller validation above always applies to what actually lands in
// the database.

async function handleMerge(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const wallet = await requireWallet(req, res);
  if (!wallet) return;

  const { items: guestItems, updatedAt: guestUpdatedAt, sellerWallet: guestSellerWallet } = req.body || {};
  const guestValidation = validateCartPayload(guestItems);
  if (!guestValidation.ok) {
    return res.status(400).json({ error: guestValidation.error });
  }

  try {
    const { mergeCarts } = await import("../src/services/cartModel.js");

    const { data: existing, error: fetchError } = await supabase
      .from("canonical_carts")
      .select("seller_wallet, items, updated_at")
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (fetchError) {
      console.error("[cart] merge fetch failed:", fetchError);
      return res.status(500).json({ error: "Could not load existing cart" });
    }

    const base = {
      seller: existing?.seller_wallet || null,
      items: existing?.items || [],
      updatedAt: existing?.updated_at ? new Date(existing.updated_at).getTime() : 0,
    };
    const incoming = {
      seller: guestSellerWallet || guestValidation.sellerWallet || null,
      items: guestItems || [],
      updatedAt: Number(guestUpdatedAt) || Date.now(),
    };

    const { cart: merged, kept, discarded } = mergeCarts(base, incoming);

    const { data: saved, error: upsertError } = await supabase
      .from("canonical_carts")
      .upsert(
        {
          wallet_address: wallet,
          seller_wallet: merged.seller,
          items: merged.items,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      )
      .select("seller_wallet, items, updated_at")
      .single();

    if (upsertError) {
      console.error("[cart] merge upsert failed:", upsertError);
      return res.status(500).json({ error: "Could not save merged cart" });
    }

    return res.status(200).json({
      success: true,
      sellerWallet: saved.seller_wallet || null,
      items: saved.items || [],
      updatedAt: saved.updated_at,
      kept,
      discardedSeller: discarded?.seller || null,
    });
  } catch (err) {
    console.error("[cart] merge error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
