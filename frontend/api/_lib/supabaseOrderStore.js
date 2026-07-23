/**
 * supabaseOrderStore.js — the persistence adapter (I/O boundary) that implements
 * the store port consumed by src/services/orderService.js against the canonical
 * commerce tables (migration 20260720_canonical_commerce.sql).
 *
 * This is the only place that touches the database for order state; all
 * decision logic lives in the pure cores. It is intentionally thin: map rows to
 * the camelCase shape the cores expect and back, and lean on the DB's unique
 * constraints for ledger de-duplication and transition idempotency.
 *
 * Usage in a handler:
 *   import { createClient } from "@supabase/supabase-js";
 *   import { createSupabaseOrderStore } from "./_lib/supabaseOrderStore.js";
 *   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
 *   const store = createSupabaseOrderStore(supabase);
 *   await runSettlement({ store, orderId, actor, effects });
 */

const ORDERS = "canonical_orders";
const LEDGER = "canonical_order_ledger";
const TRANSITIONS = "canonical_order_transitions";
const LINE_ITEMS = "canonical_order_line_items";

/** Map a canonical_orders row to the order shape the cores expect. */
function rowToOrder(row) {
  if (!row) return null;
  const metadata = row.metadata || {};
  return {
    id: row.id,
    state: row.state,
    method: row.method,
    buyerUserId: row.buyer_user_id,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    sellerProceedsCents: row.seller_proceeds_cents,
    grossChargedCents: row.gross_charged_cents,
    stripePaymentIntent: row.stripe_payment_intent,
    stripePaymentHash: row.stripe_payment_hash,
    handoffChallengeId: row.handoff_challenge_id,
    certificateRef: row.certificate_ref,
    hasOpenClaim: row.has_open_claim,
    // Raw metadata + the delivery-lifecycle timestamps derived from it (Task 16).
    // The pure cores ignore extra fields; deliveryLifecycle/canonicalDelivery read these.
    metadata,
    dispatchedAt: metadata.dispatchedAtMs != null ? Number(metadata.dispatchedAtMs) : null,
    deliveredAt: metadata.deliveredAtMs != null ? Number(metadata.deliveredAtMs) : null,
    sellerPolicyWindowMs: metadata.sellerPolicyWindowMs != null ? Number(metadata.sellerPolicyWindowMs) : undefined,
    trackingNumber: metadata.trackingNumber ?? null,
  };
}

/** Map a canonical_order_ledger row to a ledger entry for reduceLedger. */
function rowToEntry(row) {
  return {
    type: row.entry_type,
    id: row.entry_id,
    amountCents: row.amount_cents,
    sellerPortionCents: row.seller_portion_cents,
    transferId: row.transfer_id,
    ref: row.ref,
  };
}

/** Map a ledger entry (from the cores) to a canonical_order_ledger insert row. */
function entryToRow(orderId, e) {
  return {
    order_id: orderId,
    entry_type: e.type,
    entry_id: e.id ?? null,
    amount_cents: e.amountCents ?? 0,
    seller_portion_cents: e.sellerPortionCents ?? null,
    transfer_id: e.transferId ?? null,
    ref: e.ref ?? null,
  };
}

/**
 * Build a store implementing the orderService port over Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service-role client
 */
export function createSupabaseOrderStore(supabase) {
  return {
    async getOrder(orderId) {
      const { data, error } = await supabase.from(ORDERS).select("*").eq("id", orderId).maybeSingle();
      if (error) throw new Error(`getOrder failed: ${error.message}`);
      return rowToOrder(data);
    },

    async getOrderByPaymentIntent(paymentIntentId) {
      const { data, error } = await supabase
        .from(ORDERS)
        .select("*")
        .eq("stripe_payment_intent", paymentIntentId)
        .maybeSingle();
      if (error) throw new Error(`getOrderByPaymentIntent failed: ${error.message}`);
      return rowToOrder(data);
    },

    /**
     * Resolve a canonical order by the tracking number stamped into its
     * metadata at dispatch (Task 16). The ShipEngine delivery webhook only
     * carries a tracking number, so this is how a delivery event maps back to
     * the canonical order.
     */
    async getOrderByTracking(trackingNumber) {
      if (!trackingNumber) return null;
      const { data, error } = await supabase
        .from(ORDERS)
        .select("*")
        .eq("metadata->>trackingNumber", String(trackingNumber))
        .maybeSingle();
      if (error) throw new Error(`getOrderByTracking failed: ${error.message}`);
      return rowToOrder(data);
    },

    /**
     * Merge a patch into an order's metadata jsonb (read-modify-write). Used to
     * stamp delivery-lifecycle timestamps (dispatchedAtMs / deliveredAtMs) and
     * the tracking number without clobbering the rest of the metadata. Not
     * atomic against a concurrent metadata write, which is acceptable here: the
     * fields written are set-once and idempotent (callers only set a timestamp
     * when it is absent).
     */
    async patchOrderMetadata(orderId, metaPatch) {
      const { data, error: readErr } = await supabase
        .from(ORDERS)
        .select("metadata")
        .eq("id", orderId)
        .maybeSingle();
      if (readErr) throw new Error(`patchOrderMetadata read failed: ${readErr.message}`);
      const merged = { ...(data?.metadata || {}), ...metaPatch };
      const { error } = await supabase.from(ORDERS).update({ metadata: merged }).eq("id", orderId);
      if (error) throw new Error(`patchOrderMetadata write failed: ${error.message}`);
    },

    /**
     * List orders currently in the delivery phase (in_transit / delivered /
     * review_window) for the auto-advance cron. Bounded; the cron caps how many
     * it processes per run.
     */
    async listDeliveryCandidates(limit = 200) {
      const { data, error } = await supabase
        .from(ORDERS)
        .select("*")
        .in("state", ["in_transit", "delivered", "review_window"])
        .eq("has_open_claim", false)
        .limit(limit);
      if (error) throw new Error(`listDeliveryCandidates failed: ${error.message}`);
      return (data || []).map(rowToOrder);
    },

    async createOrder(row) {
      const { data, error } = await supabase.from(ORDERS).insert(row).select("id").single();
      if (error) throw new Error(`createOrder failed: ${error.message}`);
      return data.id;
    },

    /**
     * Create the per-fish line items for an order and return their generated ids
     * in insertion order. These are the ids the buyer's client references when
     * opening a structured DOA claim (affectedLineItemIds), so a claim can name
     * exactly which specimens arrived unhealthy. Idempotency is the caller's
     * concern (recordCanonicalOrderProtected only creates line items when it
     * created the order).
     * @param {string} orderId
     * @param {Array<{tokenId?:*, listingId?:*, commonName?:string, scientificName?:string, quantity?:number, priceCents?:number}>} items
     * @returns {Promise<string[]>}
     */
    async createLineItems(orderId, items) {
      if (!Array.isArray(items) || items.length === 0) return [];
      const rows = items.map((it) => ({
        order_id: orderId,
        token_id: it.tokenId != null ? Number(it.tokenId) : null,
        listing_id: it.listingId != null ? String(it.listingId) : null,
        common_name: it.commonName ?? null,
        scientific_name: it.scientificName ?? null,
        quantity: Number.isFinite(Number(it.quantity)) ? Number(it.quantity) : 1,
        price_cents: Number.isFinite(Number(it.priceCents)) ? Number(it.priceCents) : 0,
      }));
      const { data, error } = await supabase.from(LINE_ITEMS).insert(rows).select("id");
      if (error) throw new Error(`createLineItems failed: ${error.message}`);
      return (data || []).map((r) => r.id);
    },

    /** Return an order's line-item ids in creation order (for the idempotent replay path). */
    async getLineItemIds(orderId) {
      const { data, error } = await supabase
        .from(LINE_ITEMS)
        .select("id")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`getLineItemIds failed: ${error.message}`);
      return (data || []).map((r) => r.id);
    },

    async getLedgerEntries(orderId) {
      const { data, error } = await supabase
        .from(LEDGER)
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`getLedgerEntries failed: ${error.message}`);
      return (data || []).map(rowToEntry);
    },

    async findTransition(orderId, idempotencyKey) {
      if (!idempotencyKey) return null;
      const { data, error } = await supabase
        .from(TRANSITIONS)
        .select("id")
        .eq("order_id", orderId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw new Error(`findTransition failed: ${error.message}`);
      return data || null;
    },

    async appendLedgerEntries(orderId, entries) {
      if (!entries || entries.length === 0) return;
      const rows = entries.map((e) => entryToRow(orderId, e));
      // The DB unique(order_id, entry_type, entry_id) enforces webhook-replay
      // de-duplication; ignore duplicates so a replay is a safe no-op.
      const { error } = await supabase
        .from(LEDGER)
        .upsert(rows, { onConflict: "order_id,entry_type,entry_id", ignoreDuplicates: true });
      if (error) throw new Error(`appendLedgerEntries failed: ${error.message}`);
    },

    async setOrderState(orderId, state, patch = {}) {
      const { error } = await supabase.from(ORDERS).update({ state, ...patch }).eq("id", orderId);
      if (error) throw new Error(`setOrderState failed: ${error.message}`);
    },

    async recordTransition(row) {
      const insert = {
        order_id: row.orderId,
        from_state: row.fromState ?? null,
        to_state: row.toState,
        actor_role: row.actorRole ?? null,
        actor_id: row.actorId ?? null,
        idempotency_key: row.idempotencyKey ?? null,
        reason: row.reason ?? null,
      };
      // Unique(order_id, idempotency_key) makes a replayed transition a no-op.
      const { error } = await supabase
        .from(TRANSITIONS)
        .upsert(insert, { onConflict: "order_id,idempotency_key", ignoreDuplicates: true });
      if (error) throw new Error(`recordTransition failed: ${error.message}`);
    },
  };
}
