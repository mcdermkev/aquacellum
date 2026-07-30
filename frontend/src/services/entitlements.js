/**
 * entitlements.js
 *
 * The single centralized entitlement map (Task 6).
 *
 * Preserves the existing XP tiers (Shallow/Coastal/Pelagic/Abyssal/Hadal) from
 * `../utils/xp.js` TIER_LADDER while guaranteeing that core commerce and
 * safety capabilities can never be XP-gated. Only convenience, analytics, and
 * scale tools may be gated.
 *
 * Every capability is exactly one of three classes:
 *   - REQUIRED: never gated. Must return true for a brand-new, 0-XP account.
 *   - EARNED:   XP-gated convenience, sourced from the existing tier ladder.
 *   - ADMIN:    role-based (curator/operator/etc.), never XP.
 *
 * See docs/TASK_06_ENTITLEMENTS_SPEC.md for the authoritative classification
 * (§3) that this module implements. Do not move a `required` capability into
 * a gated tier without an explicit Opus review.
 */

import { TIER_LADDER } from "../utils/xp.js";

// ─── Classification constants ──────────────────────────────────────────────

export const ENTITLEMENT_CLASS = Object.freeze({
  REQUIRED: "required",
  EARNED: "earned_convenience",
  ADMIN: "administrative",
});

const { REQUIRED, EARNED, ADMIN } = ENTITLEMENT_CLASS;

// Tier keys in ascending order, reused from the canonical XP tier ladder so
// there is exactly one tier ordering in the codebase.
export const TIER_ORDER = TIER_LADDER.map((t) => t.key);

// ─── The single entitlement map ────────────────────────────────────────────
//
// Keys are stable identifiers used across the app. Do not rename existing
// keys without updating every call site.

export const ENTITLEMENTS = Object.freeze({
  // ── §3.1 REQUIRED — never gated, available to every account (0 XP) ──────

  // Browsing, search, and compatibility information
  browse_catalog: { class: REQUIRED, label: "Browse and search the catalog" },
  compatibility_info: { class: REQUIRED, label: "View compatibility information" },

  // Viewing seller reputation and verified reviews
  view_reputation: { class: REQUIRED, label: "View seller reputation and reviews" },

  // Leaving a verified review after confirmed fulfillment
  leave_review: { class: REQUIRED, label: "Leave a verified review" },

  // Cart and checkout (all four fulfillment methods)
  checkout: { class: REQUIRED, label: "Checkout" },
  cart: { class: REQUIRED, label: "Cart" },

  // Nationwide shipping rates and tracking
  shipping_rates: { class: REQUIRED, label: "Nationwide shipping rates" },
  tracking: { class: REQUIRED, label: "Shipment tracking" },

  // Local delivery tracking
  local_delivery_tracking: { class: REQUIRED, label: "Local delivery tracking" },

  // Paid and cash pickup handshakes (QR/PIN)
  paid_pickup_handshake: { class: REQUIRED, label: "Prepaid pickup handshake" },
  cash_pickup_handshake: { class: REQUIRED, label: "Cash pickup handshake" },

  // Ownership / birth-certificate transfers
  ownership_transfer: { class: REQUIRED, label: "Ownership / certificate transfer" },

  // ── Breeder Tools core (docs/BREEDER_STATE_MODEL.md §10) ─────────────────
  //
  // These are REQUIRED for the same reason `seller_listing` and `checkout` are:
  // they are the job, not a convenience. A brand-new 0-XP breeder must be able to
  // register a birth certificate, trace its lineage, log a spawn, and track the
  // grow-out — those are the product. XP-gating any of them would mean a breeder
  // could not record a fish they actually bred, and the record would be lost.
  //
  // They are listed explicitly rather than left absent so the safety-invariant
  // test in entitlements.test.js covers them: `hasEntitlement` fails CLOSED for
  // unknown keys, so an unregistered capability silently reads as denied, and
  // nothing stopped someone later attaching a `minTier` to certificate
  // registration. Now that cannot happen without failing the suite.
  //
  // NOTE ON PRO vs CASUAL: that split is a self-service display preference
  // (`aquadex_casual_mode` in localStorage, flipped freely by the mode toggle) —
  // it is NOT an entitlement and must never be modelled as one. Casual mode hides
  // the Breeder Tools tab; it does not withhold a capability.
  breeder_register_certificate: { class: REQUIRED, label: "Register a birth certificate" },
  breeder_view_lineage: { class: REQUIRED, label: "View lineage and pedigree" },
  breeder_export_pedigree: { class: REQUIRED, label: "Export or print a pedigree" },
  breeder_log_spawn: { class: REQUIRED, label: "Log a spawn" },
  breeder_growout_tracking: { class: REQUIRED, label: "Track grow-out checkpoints" },
  breeder_relatedness_check: { class: REQUIRED, label: "Check relatedness before pairing" },
  breeder_genetics_calculator: { class: REQUIRED, label: "Genetics / Punnett calculator" },
  breeder_submit_morph: { class: REQUIRED, label: "Submit a morph for review" },

  // Receipts and order history
  receipts: { class: REQUIRED, label: "Receipts" },
  order_history: { class: REQUIRED, label: "Order history" },

  // Arrival and handoff confirmation
  arrival_confirmation: { class: REQUIRED, label: "Arrival confirmation" },
  handoff: { class: REQUIRED, label: "Handoff confirmation" },

  // Refunds, disputes, DOA claims, and required evidence submission
  refund: { class: REQUIRED, label: "Refunds" },
  dispute: { class: REQUIRED, label: "Disputes" },
  doa_claim: { class: REQUIRED, label: "Open a DOA claim" },
  doa_evidence: { class: REQUIRED, label: "Submit required DOA evidence" },

  // Seller: listing create/edit/publish, fulfillment, label purchase, courier
  // request, pickup scheduling, cash confirmation, customer communication,
  // Stripe payout onboarding
  seller_listing: { class: REQUIRED, label: "Create, edit, and publish listings" },
  seller_fulfillment: { class: REQUIRED, label: "Fulfill orders" },
  seller_label_purchase: { class: REQUIRED, label: "Purchase shipping labels" },
  seller_courier_request: { class: REQUIRED, label: "Request courier pickup" },
  seller_pickup_scheduling: { class: REQUIRED, label: "Schedule pickups" },
  seller_cash_confirmation: { class: REQUIRED, label: "Confirm cash handoff" },
  seller_customer_communication: { class: REQUIRED, label: "Customer communication" },
  seller_payout_onboarding: { class: REQUIRED, label: "Stripe payout onboarding" },

  // ── §3.2 EARNED_CONVENIENCE — XP-gated ───────────────────────────────────

  // Coastal (1,500)
  dispatch_reminders: { class: EARNED, minTier: "Coastal", label: "Dispatch reminders" },
  convenience_nudges: { class: EARNED, minTier: "Coastal", label: "Convenience nudges" },
  canCreateSchools: { class: EARNED, minTier: "Coastal", label: "Create schools" },
  canPostInsights: { class: EARNED, minTier: "Coastal", label: "Post insights" },
  canRequestAudits: { class: EARNED, minTier: "Coastal", label: "Request audits" },

  // Pelagic (2,500)
  order_analytics: { class: EARNED, minTier: "Pelagic", label: "Order analytics" },
  csv_export: { class: EARNED, minTier: "Pelagic", label: "CSV export" },
  species_watchlist: { class: EARNED, minTier: "Pelagic", label: "Species watchlist" },
  price_alerts: { class: EARNED, minTier: "Pelagic", label: "Price alerts" },

  // Abyssal (5,000)
  smart_reorder: { class: EARNED, minTier: "Abyssal", label: "Smart reorder" },
  auto_completion_rules: { class: EARNED, minTier: "Abyssal", label: "Auto-completion rules" },
  // Also gates the Breeder Tools batch grow-out panel: logging a checkpoint on
  // ONE spawn is required (breeder_growout_tracking), logging across many at once
  // is a scale convenience — the same line the Breeder Terminal draws for bulk
  // fulfillment.
  bulk_management: { class: EARNED, minTier: "Abyssal", label: "Bulk product/fulfillment management" },
  canGiveAudits: { class: EARNED, minTier: "Abyssal", label: "Give expert audits" },
  canMentor: { class: EARNED, minTier: "Abyssal", label: "Mentor" },
  canHostVirtualTides: { class: EARNED, minTier: "Abyssal", label: "Host virtual Tides" },

  // Hadal (10,000)
  full_analytics_dashboard: { class: EARNED, minTier: "Hadal", label: "Full analytics dashboard" },
  carrier_api_integration: { class: EARNED, minTier: "Hadal", label: "Carrier API integration" },
  priority_curator_queue: { class: EARNED, minTier: "Hadal", label: "Priority curator queue" },
  deep_reputation_insights: { class: EARNED, minTier: "Hadal", label: "Deep reputation insights" },
  promotion_automation: { class: EARNED, minTier: "Hadal", label: "Promotion automation" },
  customer_segmentation: { class: EARNED, minTier: "Hadal", label: "Customer segmentation" },
  canHostExpoTides: { class: EARNED, minTier: "Hadal", label: "Host expo Tides" },
  canModerate: { class: EARNED, minTier: "Hadal", label: "Moderate content" },

  // §3.4 — loyalty perk, never a checkout precondition
  tier_discount: { class: EARNED, minTier: "Coastal", label: "Loyalty tier discount" },

  // Task 8 — catalog convenience. Browsing/searching itself (browse_catalog)
  // is REQUIRED and never gated; only the ability to *save* a search is an
  // earned convenience, same tier as the other Coastal convenience perks.
  saved_search: { class: EARNED, minTier: "Coastal", label: "Saved searches" },

  // ── §3.3 ADMINISTRATIVE — role-based, never XP ───────────────────────────

  resolve_dispute: { class: ADMIN, role: "curator", label: "Resolve dispute" },
  resolve_doa_claim: { class: ADMIN, role: "curator", label: "Resolve DOA claim" },
  morph_review: { class: ADMIN, role: "curator", label: "Morph review" },
  reconcile_orders: { class: ADMIN, role: "operator", label: "Reconcile orders" },
});

/**
 * Set of all REQUIRED entitlement keys, derived from the map. Used by the
 * safety-invariant test to assert none of them ever carry a minTier.
 */
export const REQUIRED_ENTITLEMENTS = new Set(
  Object.keys(ENTITLEMENTS).filter((key) => ENTITLEMENTS[key].class === REQUIRED)
);

// ─── Tier comparison ────────────────────────────────────────────────────────

/**
 * Compare two tier keys using the canonical TIER_ORDER (from TIER_LADDER).
 * Returns true if `currentTierKey` is at or above `minTierKey`.
 * Unknown tier keys are treated as below every known tier (fail closed).
 */
export function tierAtLeast(currentTierKey, minTierKey) {
  const currentIndex = TIER_ORDER.indexOf(currentTierKey);
  const minIndex = TIER_ORDER.indexOf(minTierKey);
  if (minIndex === -1) return false; // unknown required tier -> deny
  if (currentIndex === -1) return false; // unknown current tier -> deny
  return currentIndex >= minIndex;
}

/**
 * Resolve the effective tier key for a context.
 *
 * Mirrors useUnlockGate's existing "don't lock out on stale DB value"
 * behavior: use the higher of local/provided XP and any provided server
 * tier, rather than trusting either source alone.
 *
 * @param {{ xp?: number, tier?: string }} ctx
 * @returns {string} tier key (e.g. "Shallow")
 */
export function resolveTier(ctx = {}) {
  const xpTierIndex = ctx.xp != null ? tierIndexForXp(ctx.xp) : -1;
  const explicitTierIndex = ctx.tier != null ? TIER_ORDER.indexOf(ctx.tier) : -1;
  const bestIndex = Math.max(xpTierIndex, explicitTierIndex);
  return bestIndex >= 0 ? TIER_ORDER[bestIndex] : TIER_ORDER[0];
}

function tierIndexForXp(xp) {
  const points = Number(xp || 0);
  let index = 0;
  for (let i = 0; i < TIER_LADDER.length; i++) {
    if (points >= TIER_LADDER[i].min) index = i;
  }
  return index;
}

// ─── The single decision function ──────────────────────────────────────────

/**
 * Decide whether a given entitlement is available in the given context.
 *
 * @param {string} key - an ENTITLEMENTS key
 * @param {{ xp?: number, tier?: string, roles?: string[] }} ctx
 * @returns {boolean}
 */
export function hasEntitlement(key, ctx = {}) {
  const entry = ENTITLEMENTS[key];
  if (!entry) return false; // unknown -> deny (fail closed)

  if (entry.class === REQUIRED) return true; // never gated

  if (entry.class === ADMIN) {
    return (ctx.roles || []).includes(entry.role);
  }

  // EARNED: derive tier from ctx.tier or ctx.xp (higher of the two)
  const currentTierKey = resolveTier(ctx);
  return tierAtLeast(currentTierKey, entry.minTier);
}

/**
 * Get the minimum tier key required for an EARNED entitlement, or null for
 * REQUIRED/ADMIN/unknown keys. Used by UI callers (e.g. UnlockPrompt) that
 * need to display the required tier.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function getRequiredTierFor(key) {
  const entry = ENTITLEMENTS[key];
  if (!entry || entry.class !== EARNED) return null;
  return entry.minTier;
}
