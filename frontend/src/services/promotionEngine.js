/**
 * promotionEngine.js
 *
 * Pure promotion evaluation engine (Task 21B, Tier B). Answers "is this
 * promotion applicable to this cart right now, and if so, for how much?" —
 * nothing else. No side effects, no network, no charge, no `used_count`
 * increment (that bookkeeping is a checkout-time concern, out of scope
 * here — see docs/TASK_21B_PROMOTIONS_SPEC.md §2).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * MONEY BOUNDARY (read before touching this file):
 * This module NEVER calls into checkout/charge code. It does not import
 * from api/stripe.js, does not compute a platform fee, and does not decide
 * a seller payout. It only computes a candidate discount amount for
 * preview/authoring purposes. Applying a computed discount to a real Stripe
 * charge is a separate, Tier A (Opus-reviewed) change to
 * `api/stripe.js handleCreateCheckout` — see `applyPromotionToCheckout`
 * below for the documented seam that step will implement.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cart input shape (compatible with cartModel.js's Cart / cartTotals()):
 *   { items: [{ listingKey, unitPriceCents, quantity, ...}], ... }
 *
 * Promotion input shape (camelCase, matches normalizePromotion() below):
 *   { id, code, type: 'percent'|'fixed', value, scope: 'store'|'collection'|'listing',
 *     scopeRefs: string[], minSubtotalCents, startsAt, endsAt, usageLimit,
 *     usedCount, funding: 'seller_funded'|'platform_funded', active }
 */

// ─── Shape ───────────────────────────────────────────────────────────────────

export const PROMOTION_TYPES = Object.freeze({
  PERCENT: "percent",
  FIXED: "fixed",
});

export const PROMOTION_SCOPES = Object.freeze({
  STORE: "store",
  COLLECTION: "collection",
  LISTING: "listing",
});

export const PROMOTION_FUNDING = Object.freeze({
  SELLER_FUNDED: "seller_funded",
  PLATFORM_FUNDED: "platform_funded",
});

const PROMOTION_TYPE_VALUES = Object.freeze(Object.values(PROMOTION_TYPES));
const PROMOTION_SCOPE_VALUES = Object.freeze(Object.values(PROMOTION_SCOPES));
const PROMOTION_FUNDING_VALUES = Object.freeze(Object.values(PROMOTION_FUNDING));

export const MAX_PERCENT_BPS = 10000; // 100.00%
export const MAX_CODE_LENGTH = 40;

// ─── Web2-safe copy (Task 2 language system) ───────────────────────────────

export const PROMOTION_COPY = Object.freeze({
  addPromotion: "Add a promotion",
  addCode: "Create a discount code",
  addAutomatic: "Create an automatic discount",
  emptyState: "No promotions yet — create a code or an automatic discount to give buyers a deal.",
  activeLabel: "Active",
  pausedLabel: "Paused",
  seller_funded: "You cover this discount",
  platform_funded: "Platform-covered discount",
  previewTitle: "Preview",
  saved: "Promotion saved.",
  saveFailed: "Could not save this promotion. Try again.",
  removePromotion: "Remove this promotion",
  segmentsTitle: "Customer Segments",
  segmentsLocked: "Deeper customer groupings unlock at a higher tier.",
  repeatBuyers: "Repeat buyers",
  highValueBuyers: "High-value buyers",
  atRiskBuyers: "At-risk buyers",
});

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize a promotion row (snake_case DB row or camelCase draft) into one
 * canonical camelCase shape.
 * @param {Object} row
 * @returns {Object}
 */
export function normalizePromotion(row = {}) {
  const wallet = row.wallet_address ?? row.walletAddress ?? null;
  const scopeRefsRaw = row.scope_refs ?? row.scopeRefs;

  return {
    id: row.id ?? null,
    walletAddress: wallet ? String(wallet).toLowerCase() : null,
    code: row.code != null ? String(row.code).toUpperCase() : null,
    type: PROMOTION_TYPE_VALUES.includes(row.type) ? row.type : PROMOTION_TYPES.PERCENT,
    value: Number.isFinite(Number(row.value)) ? Math.max(0, Math.round(Number(row.value))) : 0,
    scope: PROMOTION_SCOPE_VALUES.includes(row.scope) ? row.scope : PROMOTION_SCOPES.STORE,
    scopeRefs: Array.isArray(scopeRefsRaw) ? scopeRefsRaw.filter((r) => typeof r === "string") : [],
    minSubtotalCents: Number.isFinite(Number(row.min_subtotal_cents ?? row.minSubtotalCents))
      ? Math.max(0, Math.round(Number(row.min_subtotal_cents ?? row.minSubtotalCents)))
      : 0,
    startsAt: row.starts_at ?? row.startsAt ?? null,
    endsAt: row.ends_at ?? row.endsAt ?? null,
    usageLimit: row.usage_limit ?? row.usageLimit ?? null,
    usedCount: Number.isFinite(Number(row.used_count ?? row.usedCount)) ? Number(row.used_count ?? row.usedCount) : 0,
    funding: PROMOTION_FUNDING_VALUES.includes(row.funding) ? row.funding : PROMOTION_FUNDING.SELLER_FUNDED,
    active: row.active !== false,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a promotion draft (the shape the authoring UI and the server's
 * write path both check).
 * @param {Object} draft
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validatePromotionDraft(draft = {}) {
  if (!draft || typeof draft !== "object") {
    return { ok: false, error: "promotion must be an object" };
  }

  if (!PROMOTION_TYPE_VALUES.includes(draft.type)) {
    return { ok: false, error: `type must be one of: ${PROMOTION_TYPE_VALUES.join(", ")}` };
  }
  if (!PROMOTION_SCOPE_VALUES.includes(draft.scope)) {
    return { ok: false, error: `scope must be one of: ${PROMOTION_SCOPE_VALUES.join(", ")}` };
  }
  if (!PROMOTION_FUNDING_VALUES.includes(draft.funding)) {
    return { ok: false, error: `funding must be one of: ${PROMOTION_FUNDING_VALUES.join(", ")}` };
  }

  const value = Number(draft.value);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "value must be a non-negative number" };
  }
  if (draft.type === PROMOTION_TYPES.PERCENT && value > MAX_PERCENT_BPS) {
    return { ok: false, error: `percent value must be ${MAX_PERCENT_BPS} bps (100%) or less` };
  }

  if (draft.code != null) {
    const code = String(draft.code);
    if (code.length === 0 || code.length > MAX_CODE_LENGTH) {
      return { ok: false, error: `code must be 1-${MAX_CODE_LENGTH} characters` };
    }
    if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      return { ok: false, error: "code may only contain letters, numbers, hyphens, and underscores" };
    }
  }

  if ((draft.scope === PROMOTION_SCOPES.COLLECTION || draft.scope === PROMOTION_SCOPES.LISTING)) {
    const refs = draft.scopeRefs ?? draft.scope_refs;
    if (!Array.isArray(refs) || refs.length === 0) {
      return { ok: false, error: `scopeRefs is required and must be non-empty for scope "${draft.scope}"` };
    }
  }

  const minSubtotal = draft.minSubtotalCents ?? draft.min_subtotal_cents;
  if (minSubtotal != null && (!Number.isFinite(Number(minSubtotal)) || Number(minSubtotal) < 0)) {
    return { ok: false, error: "minSubtotalCents must be a non-negative number" };
  }

  const usageLimit = draft.usageLimit ?? draft.usage_limit;
  if (usageLimit != null && (!Number.isFinite(Number(usageLimit)) || Number(usageLimit) <= 0)) {
    return { ok: false, error: "usageLimit must be a positive number when set" };
  }

  const startsAt = draft.startsAt ?? draft.starts_at;
  const endsAt = draft.endsAt ?? draft.ends_at;
  if (startsAt && endsAt) {
    const startMs = toEpochMs(startsAt);
    const endMs = toEpochMs(endsAt);
    if (startMs != null && endMs != null && startMs >= endMs) {
      return { ok: false, error: "startsAt must be before endsAt" };
    }
  }

  return { ok: true, error: null };
}

// ─── Cart helpers ────────────────────────────────────────────────────────────

function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cartItems(cart) {
  return Array.isArray(cart?.items) ? cart.items : [];
}

function lineSubtotalCents(item) {
  const price = Number(item.unitPriceCents ?? item.priceCents) || 0;
  const qty = Number(item.quantity) || 1;
  return Math.round(price * qty);
}

/**
 * Sum of subtotal across the cart lines that fall within a promotion's
 * scope. Store scope = every line (whole-cart subtotal); collection/listing
 * scope = only lines whose identifying ref is present in `scopeRefs`.
 *
 * For 'listing' scope, a line matches when its `listingKey` (or `id`, which
 * cartModel.js sets equal to listingKey) is in `scopeRefs`. For 'collection'
 * scope, a line matches when its `collectionRefs` (if the caller attaches
 * that — e.g. from storeMerchandising section membership) intersects
 * `scopeRefs`; callers that don't attach `collectionRefs` simply get no
 * matching lines for collection-scoped promos, which correctly resolves to
 * "not applicable" rather than guessing.
 * @param {Object} promo - a normalized promotion
 * @param {Object} cart
 * @returns {number}
 */
export function applicableSubtotalCents(promo, cart) {
  const items = cartItems(cart);
  if (promo.scope === PROMOTION_SCOPES.STORE) {
    return items.reduce((sum, item) => sum + lineSubtotalCents(item), 0);
  }

  const refs = new Set(promo.scopeRefs || []);
  if (refs.size === 0) return 0;

  return items.reduce((sum, item) => {
    if (promo.scope === PROMOTION_SCOPES.LISTING) {
      const key = item.listingKey ?? item.id;
      if (key != null && refs.has(String(key))) return sum + lineSubtotalCents(item);
      return sum;
    }
    // collection scope
    const collectionRefs = Array.isArray(item.collectionRefs) ? item.collectionRefs : [];
    if (collectionRefs.some((r) => refs.has(String(r)))) return sum + lineSubtotalCents(item);
    return sum;
  }, 0);
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Evaluate whether a promotion applies to a cart right now, and for how
 * much. Pure — no side effects, no `usedCount` mutation, no network.
 * Deterministic for identical inputs.
 *
 * @param {Object} promoInput - raw or normalized promotion row
 * @param {Object} cart - a Cart (cartModel.js shape) or any object exposing `.items`
 * @param {{ now?: (number|Date|string) }} [ctx]
 * @returns {{ applicable:boolean, discountCents:number, funding:string, reason:string }}
 */
export function evaluatePromotion(promoInput, cart, ctx = {}) {
  const promo = normalizePromotion(promoInput);
  const nowMs = toEpochMs(ctx.now) ?? Date.now();

  if (!promo.active) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "promotion is paused" };
  }

  const startMs = toEpochMs(promo.startsAt);
  if (startMs != null && nowMs < startMs) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "promotion has not started yet" };
  }

  const endMs = toEpochMs(promo.endsAt);
  if (endMs != null && nowMs > endMs) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "promotion has expired" };
  }

  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "usage limit reached" };
  }

  const applicableCents = applicableSubtotalCents(promo, cart);
  if (applicableCents <= 0) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "no matching items in cart" };
  }

  const cartSubtotalCents = cartItems(cart).reduce((sum, item) => sum + lineSubtotalCents(item), 0);
  if (cartSubtotalCents < promo.minSubtotalCents) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "cart subtotal below minimum" };
  }

  let discountCents;
  if (promo.type === PROMOTION_TYPES.PERCENT) {
    discountCents = Math.round((applicableCents * promo.value) / MAX_PERCENT_BPS);
  } else {
    discountCents = promo.value;
  }
  // Never negative, never exceeds the applicable subtotal (hard clamp).
  discountCents = Math.max(0, Math.min(discountCents, applicableCents));

  if (discountCents <= 0) {
    return { applicable: false, discountCents: 0, funding: promo.funding, reason: "computed discount is zero" };
  }

  return { applicable: true, discountCents, funding: promo.funding, reason: "applicable" };
}

/**
 * Pick the single best applicable promotion for a cart. No stacking in v1
 * (documented) — ties break deterministically by promotion id (ascending
 * string compare) so identical inputs always produce identical output.
 *
 * @param {Object[]} promoInputs
 * @param {Object} cart
 * @param {{ now?: (number|Date|string) }} [ctx]
 * @returns {{ promotion:(Object|null), evaluation:{applicable:boolean, discountCents:number, funding:string, reason:string} }}
 */
export function bestPromotion(promoInputs = [], cart, ctx = {}) {
  let best = null;
  let bestEval = { applicable: false, discountCents: 0, funding: PROMOTION_FUNDING.SELLER_FUNDED, reason: "no promotions" };

  for (const promoInput of promoInputs || []) {
    const promo = normalizePromotion(promoInput);
    const evaluation = evaluatePromotion(promo, cart, ctx);
    if (!evaluation.applicable) continue;

    if (
      best == null ||
      evaluation.discountCents > bestEval.discountCents ||
      (evaluation.discountCents === bestEval.discountCents && String(promo.id) < String(best.id))
    ) {
      best = promo;
      bestEval = evaluation;
    }
  }

  return { promotion: best, evaluation: best ? bestEval : { applicable: false, discountCents: 0, funding: PROMOTION_FUNDING.SELLER_FUNDED, reason: "no applicable promotion" } };
}

// ─── Documented seam for the Tier A checkout step (NOT implemented here) ───

/**
 * @typedef {Object} CheckoutPromotionSeam
 *
 * THIS FUNCTION IS INTENTIONALLY NOT IMPLEMENTED IN THIS FILE.
 *
 * This JSDoc block documents the CONTRACT the Tier A (Opus-reviewed) checkout
 * step must implement inside `api/stripe.js handleCreateCheckout` once a
 * promotion is applied to a real charge. It exists here only so the
 * boundary between "safe to build on Sonnet" and "money-critical, Opus only"
 * is unambiguous — see docs/TASK_21B_PROMOTIONS_SPEC.md §2.
 *
 * Planned signature (to be implemented in api/stripe.js, NOT this file):
 *
 *   applyPromotionToCheckout({ authoritativeGoodsCents, cart, promo, now })
 *     → { discountCents, funding, adjustedGoodsCents, note }
 *
 * Responsibilities that belong to the Tier A implementation, not here:
 *   - Re-validating the promotion server-side against AUTHORITATIVE prices
 *     (never trust a client-supplied discount amount).
 *   - Deciding how `adjustedGoodsCents` feeds the platform-fee base
 *     (`platformFeeCents = round(adjustedGoodsCents * 4%)`) and
 *     `sellerPayoutCents` for `seller_funded` promotions.
 *   - Ensuring a `platform_funded` promotion reduces the buyer's charged
 *     total WITHOUT reducing `sellerPayoutCents`.
 *   - Atomically incrementing `used_count` only after a successful charge
 *     (never speculatively, never twice for the same order — idempotency).
 *   - Recording which promotion (if any) applied to an order, for receipts
 *     and the seller's own reporting.
 *
 * This module (`promotionEngine.js`) supplies ONLY the pure evaluation
 * (`evaluatePromotion`/`bestPromotion`) that the Tier A step should call as
 * its first input — it must not reimplement or loosen that evaluation logic
 * itself, and this file must never import from api/stripe.js or perform any
 * of the responsibilities listed above.
 */
export const CHECKOUT_PROMOTION_SEAM_DOCUMENTED_ONLY = true;
