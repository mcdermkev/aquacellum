/**
 * supabaseDoaClaimStore.js — persistence adapter (I/O boundary) implementing the
 * store port consumed by src/services/doaClaimService.js against the
 * canonical_doa_claims table plus the shared canonical commerce tables
 * (migrations 20260721_doa_reservations.sql and 20260720_canonical_commerce.sql).
 *
 * The DOA workflow spans several tables — a claim row, per-line-item state on
 * canonical_order_line_items, money events on canonical_order_ledger, an order
 * state + open-claim flag on canonical_orders, and (for replacements) linked
 * sub-order rows in canonical_orders. This adapter keeps each of those writes
 * thin and mechanical; all decision logic stays in the doaClaims core and the
 * doaClaimService that orchestrates it.
 */

const CLAIMS = "canonical_doa_claims";
const ORDERS = "canonical_orders";
const LINE_ITEMS = "canonical_order_line_items";
const LEDGER = "canonical_order_ledger";
const TRANSITIONS = "canonical_order_transitions";

/** Map a canonical_doa_claims row to the claim shape the core expects. */
function rowToClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    affectedLineItemIds: row.affected_line_item_ids || [],
    evidence: row.evidence || {},
    resolutions: row.resolutions || null,
    openedAt: Number(row.opened_at_ms),
    sellerResponseDeadlineAt: Number(row.seller_response_deadline_at_ms),
    deadlineAt: Number(row.claim_window_deadline_at_ms),
    resolvedAt: row.resolved_at_ms == null ? null : Number(row.resolved_at_ms),
  };
}

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
    deliveredAt: row.metadata?.deliveredAtMs != null ? Number(row.metadata.deliveredAtMs) : undefined,
    sellerPolicyWindowMs: row.metadata?.sellerPolicyWindowMs != null ? Number(row.metadata.sellerPolicyWindowMs) : undefined,
    hasOpenClaim: row.has_open_claim,
  };
}

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
 * Build a store implementing the doaClaimService port over Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service-role client
 */
export function createSupabaseDoaClaimStore(supabase) {
  return {
    async getOrder(orderId) {
      const { data, error } = await supabase.from(ORDERS).select("*").eq("id", orderId).maybeSingle();
      if (error) throw new Error(`getOrder failed: ${error.message}`);
      return rowToOrder(data);
    },

    async getLineItems(orderId) {
      const { data, error } = await supabase
        .from(LINE_ITEMS)
        .select("id, price_cents, line_state, token_id, listing_id")
        .eq("order_id", orderId);
      if (error) throw new Error(`getLineItems failed: ${error.message}`);
      return (data || []).map((r) => ({
        lineItemId: r.id,
        priceCents: r.price_cents,
        state: r.line_state,
        tokenId: r.token_id,
        listingId: r.listing_id,
      }));
    },

    async getClaim(claimId) {
      const { data, error } = await supabase.from(CLAIMS).select("*").eq("id", claimId).maybeSingle();
      if (error) throw new Error(`getClaim failed: ${error.message}`);
      return rowToClaim(data);
    },

    async getOpenClaimForOrder(orderId) {
      const { data, error } = await supabase
        .from(CLAIMS)
        .select("*")
        .eq("order_id", orderId)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw new Error(`getOpenClaimForOrder failed: ${error.message}`);
      return rowToClaim(data);
    },

    async createClaim(claim) {
      const row = {
        id: claim.id,
        order_id: claim.orderId,
        status: claim.status,
        affected_line_item_ids: claim.affectedLineItemIds,
        evidence: claim.evidence ?? {},
        opened_at_ms: claim.openedAt,
        seller_response_deadline_at_ms: claim.sellerResponseDeadlineAt,
        claim_window_deadline_at_ms: claim.deadlineAt,
      };
      // The partial unique index (one open claim per order) rejects a duplicate
      // open claim; surface that as a clean conflict.
      const { error } = await supabase.from(CLAIMS).insert(row);
      if (error) {
        if (/uq_canonical_doa_open_per_order|duplicate key/i.test(error.message)) {
          return { ok: false, error: "an open claim already exists for this order" };
        }
        throw new Error(`createClaim failed: ${error.message}`);
      }
      return { ok: true };
    },

    async resolveClaimRow(claimId, { status, resolutions, resolvedAtMs }) {
      const { error } = await supabase
        .from(CLAIMS)
        .update({ status, resolutions, resolved_at_ms: resolvedAtMs })
        .eq("id", claimId);
      if (error) throw new Error(`resolveClaimRow failed: ${error.message}`);
    },

    async setLineItemStates(updates) {
      // updates: [{ lineItemId, state, replacementSubOrderId? }]
      for (const u of updates) {
        const patch = { line_state: u.state };
        if (u.replacementSubOrderId) patch.replacement_suborder_id = u.replacementSubOrderId;
        const { error } = await supabase.from(LINE_ITEMS).update(patch).eq("id", u.lineItemId);
        if (error) throw new Error(`setLineItemStates failed for ${u.lineItemId}: ${error.message}`);
      }
    },

    async appendLedgerEntries(orderId, entries) {
      if (!entries || entries.length === 0) return;
      const rows = entries.map((e) => entryToRow(orderId, e));
      const { error } = await supabase
        .from(LEDGER)
        .upsert(rows, { onConflict: "order_id,entry_type,entry_id", ignoreDuplicates: true });
      if (error) throw new Error(`appendLedgerEntries failed: ${error.message}`);
    },

    async createReplacementSubOrder(subOrder) {
      // A replacement is a real (sub-)order with no new buyer charge, linked to
      // the original via metadata (plan Task 17). Inserted at 'created' so it
      // runs its own fulfillment + certificate cycle.
      const row = {
        seller_wallet: subOrder.sellerWallet,
        buyer_wallet: subOrder.buyerWallet,
        method: subOrder.method,
        state: "created",
        gross_charged_cents: 0,
        seller_proceeds_cents: 0,
        metadata: {
          replacesLineItemId: subOrder.replacesLineItemId,
          originalOrderId: subOrder.originalOrderId,
          note: subOrder.note,
        },
      };
      const { data, error } = await supabase.from(ORDERS).insert(row).select("id").single();
      if (error) throw new Error(`createReplacementSubOrder failed: ${error.message}`);
      return data.id;
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
      const { error } = await supabase
        .from(TRANSITIONS)
        .upsert(insert, { onConflict: "order_id,idempotency_key", ignoreDuplicates: true });
      if (error) throw new Error(`recordTransition failed: ${error.message}`);
    },
  };
}
