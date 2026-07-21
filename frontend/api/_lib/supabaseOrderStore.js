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

/** Map a canonical_orders row to the order shape the cores expect. */
function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    state: row.state,
    method: row.method,
    buyerUserId: row.buyer_user_id,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    sellerProceedsCents: row.seller_proceeds_cents,
    grossChargedCents: row.gross_charged_cents,
    stripePaymentHash: row.stripe_payment_hash,
    handoffChallengeId: row.handoff_challenge_id,
    certificateRef: row.certificate_ref,
    hasOpenClaim: row.has_open_claim,
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

    async createOrder(row) {
      const { data, error } = await supabase.from(ORDERS).insert(row).select("id").single();
      if (error) throw new Error(`createOrder failed: ${error.message}`);
      return data.id;
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
