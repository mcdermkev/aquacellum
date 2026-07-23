/**
 * ordersSync.js
 *
 * Bidirectional sync between local Dexie marketOrders and Supabase orders table.
 * - On purchase: writes to Dexie immediately (offline-first), then pushes to cloud
 * - On login/resume: pulls cloud orders and merges into local
 * - Subscribes to Supabase Realtime for live status updates from the other party
 *
 * XP-gated features:
 *   - Pelagic+ (2500 XP): Order analytics, watchlist
 *   - Abyssal+ (5000 XP): Smart reorder, priority protection
 *   - Hadal (10000 XP): Auto-release rules, bulk management
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { db } from "../db";
import {
  isStatusAdvanced,
  getLocalStatusString,
  mapCloudStatusToShippingInt,
  mapCloudStatusToBatchInt,
} from "./orderStatus";

// ─── Push: Local → Cloud ───────────────────────────────────────────────────

/**
 * Push a single local order to Supabase.
 * Called after every local purchase/status change.
 *
 * @param {Object} localOrder - The Dexie marketOrders record
 * @returns {Promise<{success: boolean, cloudId?: string, error?: string}>}
 */
export async function pushOrderToCloud(localOrder) {
  if (!isSupabaseConfigured()) return { success: false, error: "Supabase not configured" };

  try {
    const payload = mapLocalToCloud(localOrder);
    const { data, error } = await supabase.rpc("upsert_order_from_sync", payload);

    if (error) {
      console.warn("[OrdersSync] Push failed:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true, cloudId: data };
  } catch (err) {
    console.warn("[OrdersSync] Push error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Push all unsynced local orders to cloud.
 * Called on app startup and after reconnection.
 *
 * @param {string} walletAddress - Current user's wallet
 */
export async function pushAllLocalOrders(walletAddress) {
  if (!isSupabaseConfigured()) return;

  try {
    const orders = await db.marketOrders.toArray();
    const myOrders = orders.filter(
      (o) =>
        (o.buyer || "").toLowerCase() === walletAddress.toLowerCase() ||
        (o.seller || "").toLowerCase() === walletAddress.toLowerCase()
    );

    for (const order of myOrders) {
      await pushOrderToCloud(order);
    }
  } catch (err) {
    console.warn("[OrdersSync] Bulk push failed:", err);
  }
}

// ─── Pull: Cloud → Local ───────────────────────────────────────────────────

/**
 * Pull all orders from cloud and merge into local Dexie.
 * Cloud wins for status (status can only advance, never regress).
 *
 * @param {string} walletAddress - Current user's wallet
 * @returns {Promise<{pulled: number, updated: number}>}
 */
export async function pullOrdersFromCloud(walletAddress) {
  if (!isSupabaseConfigured()) return { pulled: 0, updated: 0 };

  try {
    const { data: cloudOrders, error } = await supabase
      .from("orders")
      .select("*")
      .or(`buyer_wallet.eq.${walletAddress.toLowerCase()},seller_wallet.eq.${walletAddress.toLowerCase()}`)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error || !cloudOrders) {
      console.warn("[OrdersSync] Pull failed:", error?.message);
      return { pulled: 0, updated: 0 };
    }

    let updated = 0;

    for (const cloudOrder of cloudOrders) {
      const merged = await mergeCloudToLocal(cloudOrder, walletAddress);
      if (merged) updated++;
    }

    return { pulled: cloudOrders.length, updated };
  } catch (err) {
    console.warn("[OrdersSync] Pull error:", err);
    return { pulled: 0, updated: 0 };
  }
}

/**
 * Merge a single cloud order into local Dexie.
 * Cloud status wins if it's further along the state machine.
 */
async function mergeCloudToLocal(cloudOrder, walletAddress) {
  const localKey = cloudOrder.local_key;

  try {
    // If we have a local_key, try to find the existing local record by key
    let existing = null;
    if (localKey) {
      existing = await db.marketOrders.get(Number(localKey));
    } else {
      // Cloud-originated order (no local_key): try to match by unique identifiers
      // to avoid duplicates, then insert if not found.
      if (cloudOrder.order_type === "shipping" && cloudOrder.on_chain_token_id) {
        existing = await db.marketOrders
          .where({ orderType: "shipping", tokenId: Number(cloudOrder.on_chain_token_id) })
          .first();
      } else if (cloudOrder.order_type === "batch" && cloudOrder.on_chain_purchase_id) {
        existing = await db.marketOrders
          .where({ orderType: "batch", purchaseId: Number(cloudOrder.on_chain_purchase_id) })
          .first();
      } else if ((cloudOrder.order_type === "fiat" || cloudOrder.order_type === "instant") && cloudOrder.stripe_session_id) {
        // stripeSessionId is not indexed, so use filter instead of where()
        existing = await db.marketOrders
          .filter((o) => o.stripeSessionId === cloudOrder.stripe_session_id)
          .first();
      }
    }

    if (!existing) {
      // Create local record from cloud data
      const localRecord = mapCloudToLocal(cloudOrder, walletAddress);
      await db.marketOrders.put(localRecord);
      return true;
    }

    // Backfill canonical DOA ids onto a pre-existing local order that predates
    // them (e.g. one created optimistically before the cloud row carried the
    // canonical order/line-item ids). Independent of the status-advance merge
    // below so a delivered-but-already-synced order still lights up the claim.
    if (cloudOrder.canonical_order_id && !existing.canonicalOrderId) {
      try {
        await db.marketOrders.update(existing.key, {
          canonicalOrderId: cloudOrder.canonical_order_id,
          canonicalLineItemIds: cloudOrder.canonical_line_item_ids || [],
          paymentIntentId: cloudOrder.stripe_payment_intent || existing.paymentIntentId || null,
        });
      } catch (e) {
        // non-fatal: the legacy dispute path still works without the ids
      }
    }

    // Merge: cloud status wins if it's more advanced
    const cloudStatus = cloudOrder.status;
    const localStatus = getLocalStatusString(existing);

    if (isStatusAdvanced(cloudStatus, localStatus)) {
      const updates = {};

      if (existing.orderType === "shipping") {
        updates.status = mapCloudStatusToShippingInt(cloudStatus);
        if (cloudOrder.tracking_number) updates.trackingNumber = cloudOrder.tracking_number;
        if (cloudOrder.dispatch_timestamp) {
          updates.dispatchTimestamp = Math.floor(new Date(cloudOrder.dispatch_timestamp).getTime() / 1000);
        }
      } else if (existing.orderType === "batch") {
        updates.state = mapCloudStatusToBatchInt(cloudStatus);
      } else if (existing.orderType === "fiat_pending") {
        updates.status = cloudStatus === "settled" ? "settled" : cloudStatus === "failed" ? "failed" : existing.status;
      }

      if (Object.keys(updates).length > 0) {
        await db.marketOrders.update(existing.key, updates);
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn("[OrdersSync] Merge error:", err);
    return false;
  }
}

// ─── Realtime Subscription ─────────────────────────────────────────────────

let _realtimeChannel = null;

/**
 * Subscribe to live order updates via Supabase Realtime.
 * Fires when the other party (buyer/seller) changes order status.
 *
 * @param {string} walletAddress - Current user's wallet
 * @param {Function} onOrderUpdate - Callback when an order changes
 * @returns {Function} Unsubscribe function
 */
export function subscribeToOrderUpdates(walletAddress, onOrderUpdate) {
  if (!isSupabaseConfigured()) return () => {};

  // Clean up any existing subscription
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
  }

  _realtimeChannel = supabase
    .channel("orders-realtime")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "orders",
        filter: `buyer_wallet=eq.${walletAddress.toLowerCase()}`,
      },
      (payload) => {
        handleRealtimeUpdate(payload.new, walletAddress, onOrderUpdate);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "orders",
        filter: `seller_wallet=eq.${walletAddress.toLowerCase()}`,
      },
      (payload) => {
        handleRealtimeUpdate(payload.new, walletAddress, onOrderUpdate);
      }
    )
    .subscribe();

  return () => {
    if (_realtimeChannel) {
      supabase.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
  };
}

async function handleRealtimeUpdate(cloudOrder, walletAddress, onOrderUpdate) {
  const merged = await mergeCloudToLocal(cloudOrder, walletAddress);
  if (merged && onOrderUpdate) {
    onOrderUpdate(cloudOrder);
  }
}

// ─── Cloud Queries (for advanced features) ─────────────────────────────────

/**
 * Fetch order analytics for a seller (XP-gated: Pelagic+ / 2500 XP).
 *
 * @param {string} walletAddress - Seller's wallet
 * @returns {Promise<Object|null>} Analytics object or null
 */
export async function fetchSellerAnalytics(walletAddress) {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from("order_analytics")
    .select("*")
    .eq("seller_wallet", walletAddress.toLowerCase())
    .single();

  if (error) return null;
  return data;
}

/**
 * Fetch buyer analytics (XP-gated: Pelagic+ / 2500 XP).
 */
export async function fetchBuyerAnalytics(walletAddress) {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from("buyer_order_analytics")
    .select("*")
    .eq("buyer_wallet", walletAddress.toLowerCase())
    .single();

  if (error) return null;
  return data;
}

/**
 * Fetch a seller's own orders (seller-scoped) for analytics aggregation.
 * Unlike fetchOrderHistory (which returns both buyer + seller rows), this
 * returns only orders where the wallet is the SELLER — used to build the
 * seller revenue timeline, order mix, and top-species breakdowns.
 *
 * @param {string} walletAddress - Seller wallet
 * @param {Object} options - { limit? }
 * @returns {Promise<Array>}
 */
export async function fetchSellerOrders(walletAddress, options = {}) {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_wallet", walletAddress.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(options.limit || 500);

  if (error) {
    console.warn("[OrdersSync] Seller orders fetch failed:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch full order history from cloud (paginated).
 *
 * @param {string} walletAddress
 * @param {Object} options - { status?, orderType?, limit?, offset? }
 * @returns {Promise<Array>}
 */
export async function fetchOrderHistory(walletAddress, options = {}) {
  if (!isSupabaseConfigured()) return [];

  let query = supabase
    .from("orders")
    .select("*")
    .or(`buyer_wallet.eq.${walletAddress.toLowerCase()},seller_wallet.eq.${walletAddress.toLowerCase()}`)
    .order("created_at", { ascending: false })
    .limit(options.limit || 50)
    .range(options.offset || 0, (options.offset || 0) + (options.limit || 50) - 1);

  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.orderType) {
    query = query.eq("order_type", options.orderType);
  }

  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

/**
 * Fetch order status history timeline (for receipt/details view).
 */
export async function fetchOrderTimeline(orderId) {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("order_status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

// ─── Watchlist (XP-gated: Pelagic+) ───────────────────────────────────────

/**
 * Add a species to the price-drop watchlist.
 */
export async function addToWatchlist(walletAddress, speciesName, scientificName, maxPriceCents) {
  if (!isSupabaseConfigured()) return { success: false };

  const { error } = await supabase.from("order_watchlist").upsert(
    {
      wallet_address: walletAddress.toLowerCase(),
      species_name: speciesName,
      scientific_name: scientificName || null,
      max_price_cents: maxPriceCents || null,
      is_active: true,
    },
    { onConflict: "wallet_address,species_name" }
  );

  return { success: !error, error: error?.message };
}

/**
 * Get the user's active watchlist.
 */
export async function getWatchlist(walletAddress) {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from("order_watchlist")
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * Remove a species from the watchlist.
 */
export async function removeFromWatchlist(walletAddress, speciesName) {
  if (!isSupabaseConfigured()) return { success: false };

  const { error } = await supabase
    .from("order_watchlist")
    .update({ is_active: false })
    .eq("wallet_address", walletAddress.toLowerCase())
    .eq("species_name", speciesName);

  return { success: !error };
}

// ─── Mapping Helpers ───────────────────────────────────────────────────────

/**
 * Map a local Dexie order to the cloud RPC params.
 */
function mapLocalToCloud(localOrder) {
  const orderType = localOrder.orderType === "fiat_pending" ? "fiat" : localOrder.orderType;

  // Convert ETH string prices to USD cents (rough: $1000/ETH placeholder — actual uses market rate)
  const priceToCents = (ethStr) => Math.round(parseFloat(ethStr || "0") * 1000 * 100);

  let subtotalCents = 0;
  let shippingFeeCents = 0;
  let totalPaidCents = 0;

  if (orderType === "shipping") {
    subtotalCents = priceToCents(localOrder.price);
    shippingFeeCents = priceToCents(localOrder.shippingFee);
    totalPaidCents = priceToCents(localOrder.amountLocked);
  } else if (orderType === "batch") {
    totalPaidCents = priceToCents(localOrder.amountLocked);
    subtotalCents = totalPaidCents;
  } else if (orderType === "fiat") {
    // Fiat orders store items as JSON string
    try {
      const items = JSON.parse(localOrder.items || "[]");
      subtotalCents = items.reduce((sum, i) => sum + (i.priceCentsUSD || 0), 0);
    } catch (e) {
      subtotalCents = 0;
    }
    totalPaidCents = subtotalCents;
  }

  // Map local status to cloud status string
  let status = "pending";
  if (orderType === "shipping") {
    status = ["locked", "dispatched", "released", "disputed", "refunded"][localOrder.status] || "locked";
  } else if (orderType === "batch") {
    status = ["pending", "released", "refunded"][localOrder.state] || "pending";
  } else if (orderType === "fiat") {
    status = localOrder.status || "pending";
  }

  // Build items JSON
  let items = [];
  if (localOrder.commonName) {
    items = [{
      commonName: localOrder.commonName,
      tokenId: localOrder.tokenId,
      listingId: localOrder.listingId,
      quantity: localOrder.quantity || 1,
    }];
  }

  return {
    p_local_key: String(localOrder.key),
    p_order_type: orderType,
    p_buyer_wallet: (localOrder.buyer || "").toLowerCase(),
    p_seller_wallet: (localOrder.seller || "").toLowerCase(),
    p_status: status,
    p_subtotal_cents: subtotalCents,
    p_shipping_fee_cents: shippingFeeCents,
    p_total_paid_cents: totalPaidCents,
    p_items: JSON.stringify(items),
    p_tracking_number: localOrder.trackingNumber || null,
    p_quantity: localOrder.quantity || null,
    p_fulfillment_type: localOrder.fulfillmentType === 1 ? "in_person" : localOrder.fulfillmentType === 0 ? "shipping" : null,
    p_stripe_session_id: localOrder.stripeSessionId || null,
    p_on_chain_token_id: localOrder.tokenId || null,
    p_on_chain_purchase_id: localOrder.purchaseId || null,
    p_created_at: localOrder.createdAt
      ? new Date(localOrder.createdAt * 1000).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Map a cloud order to a local Dexie-compatible record.
 */
function mapCloudToLocal(cloudOrder, walletAddress) {
  const isBuyer = cloudOrder.buyer_wallet === walletAddress.toLowerCase();
  const role = isBuyer ? "Buyer" : "Seller";
  const items = cloudOrder.items || [];
  const firstItem = items[0] || {};

  const base = {
    buyer: cloudOrder.buyer_wallet,
    seller: cloudOrder.seller_wallet,
    commonName: firstItem.commonName || "Order",
    createdAt: Math.floor(new Date(cloudOrder.created_at).getTime() / 1000),
    role,
    // Canonical DOA read-through (Task 17/18): surface the canonical order id +
    // its line-item ids (set at webhook when CANONICAL_SETTLEMENT_ENABLED) so the
    // buyer's "report a problem" flow can open a structured DOA claim against the
    // real line items. Null/empty ⇒ the client guard stays inert and uses the
    // legacy dispute path. paymentIntentId/stripeSessionId are the claim's order
    // references (also used as fallbacks by ArrivalModal).
    canonicalOrderId: cloudOrder.canonical_order_id || null,
    canonicalLineItemIds: cloudOrder.canonical_line_item_ids || null,
    paymentIntentId: cloudOrder.stripe_payment_intent || null,
    stripeSessionId: cloudOrder.stripe_session_id || null,
  };

  if (cloudOrder.order_type === "shipping") {
    return {
      ...base,
      orderType: "shipping",
      tokenId: cloudOrder.on_chain_token_id || firstItem.tokenId,
      price: String((cloudOrder.subtotal_cents || 0) / 100000),
      shippingFee: String((cloudOrder.shipping_fee_cents || 0) / 100000),
      amountLocked: String((cloudOrder.total_paid_cents || 0) / 100000),
      trackingNumber: cloudOrder.tracking_number || "",
      dispatchTimestamp: cloudOrder.dispatch_timestamp
        ? Math.floor(new Date(cloudOrder.dispatch_timestamp).getTime() / 1000)
        : 0,
      status: mapCloudStatusToShippingInt(cloudOrder.status),
    };
  } else if (cloudOrder.order_type === "batch") {
    return {
      ...base,
      orderType: "batch",
      purchaseId: cloudOrder.on_chain_purchase_id || Date.now(),
      listingId: firstItem.listingId,
      quantity: cloudOrder.quantity || firstItem.quantity || 1,
      amountLocked: String((cloudOrder.total_paid_cents || 0) / 100000),
      state: mapCloudStatusToBatchInt(cloudOrder.status),
      fulfillmentType: cloudOrder.fulfillment_type === "in_person" ? 1 : 0,
    };
  } else if (cloudOrder.order_type === "fiat") {
    return {
      ...base,
      orderType: "fiat_pending",
      stripeSessionId: cloudOrder.stripe_session_id,
      items: JSON.stringify(items),
      status: cloudOrder.status,
    };
  } else if (cloudOrder.order_type === "instant") {
    return {
      ...base,
      orderType: "instant",
      tokenId: cloudOrder.on_chain_token_id || firstItem.tokenId,
      price: String((cloudOrder.subtotal_cents || 0) / 100000),
      shippingFee: "0",
      amountLocked: String((cloudOrder.total_paid_cents || 0) / 100000),
      status: 2, // completed
    };
  }

  return { ...base, orderType: cloudOrder.order_type, status: cloudOrder.status };
}

// ─── Status Comparison Helpers ─────────────────────────────────────────────
// Moved to ./orderStatus.js (pure, characterization-tested) and imported above.
// See docs/MARKETPLACE_STATE_MODEL.md §6 for the legacy→canonical mapping.
