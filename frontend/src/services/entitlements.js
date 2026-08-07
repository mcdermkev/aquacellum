/**
 * entitlements.js
 *
 * The single centralized entitlement map (Task 6).
 *
 * Guarantees that core commerce and safety capabilities can never be gated at
 * all, and that the tools which ARE gated open when they become useful rather
 * than when a points bar fills.
 *
 * Every capability is exactly one of four classes:
 *   - REQUIRED: never gated. Must return true for a brand-new, 0-XP account.
 *   - ACTIVITY: opens on demonstrated activity ("you have made a sale"), not XP.
 *   - EARNED:   tier-gated. Now reserved for the loyalty perk and the curator
 *               queue priority — genuine rewards, not authority over others.
 *   - ADMIN:    role-based (curator/operator), never XP. Platform operations.
 *   - GRANTED:  role-based community authority (founder/steward), never XP.
 *               Conferred by trust, not earned — see SOCIAL AUTHORITY below.
 *
 * ─── WHY XP NO LONGER GATES TOOLS ──────────────────────────────────────────
 *
 * XP was doing a job it is bad at, for two independent reasons.
 *
 * 1. IT COULD NOT BE TRUSTED. `hasEntitlement` receives `ctx.xp` from
 *    `getXp()`, i.e. straight out of localStorage, and `resolveTier` takes the
 *    HIGHER of local XP and the server tier — so local inflation always won. A
 *    DevTools one-liner unlocked every gated capability, which
 *    BETA_READINESS_AUDIT.md §3.3 records as a known, accepted risk. A gate
 *    anyone can open is not a gate; it is a chore for honest users only.
 *
 * 2. THE THRESHOLDS MEASURED THE WRONG THING. One ladder served two
 *    populations with wildly different earn rates. A hobbyist with one tank
 *    earns ~14 XP/day and needs ~3.5 months to clear Coastal (1,500); a breeder
 *    logging one spawn plus ten fry certificates clears 650 in an afternoon. So
 *    the same threshold was either months of chores or a rounding error,
 *    depending on who you were — untunable, because it was one number trying to
 *    measure two unrelated things.
 *
 * ACTIVITY gating fixes both. "You have completed an order" is server-checkable,
 * cannot be inflated in DevTools in any way that matters, and — the real point —
 * it hands someone a tool at the moment it starts helping them. Nobody games
 * their way into a bulk-management panel they have nothing to bulk-manage.
 *
 * XP itself is now a SCORE AND A COSMETIC ENGINE: it drives the meter, the
 * companion's form, Dex progress, and expressive unlocks. It withholds nothing
 * functional.
 *
 * ⚠️ TWO RULES FOR COSMETIC UNLOCKS BUILT ON XP:
 *   - Self-visible cosmetics (companion form, your own themes) may unlock from
 *     LOCAL XP. Instant feedback, and inflating it harms nobody but the user.
 *   - Anything OTHER PEOPLE see as credibility (badges on a listing, breeder
 *     flair, a tier label next to your name) must be derived SERVER-SIDE from
 *     verified events. `breederStats` already had this exact defect once: two
 *     badges read a self-reported grow-out `sold` count, so "Sold 50+ bred fish"
 *     was earnable by typing 50 — and every badge has a share button.
 *
 * See docs/TASK_06_ENTITLEMENTS_SPEC.md §3 for the original classification. Do
 * not move a REQUIRED capability into any gated class without an explicit
 * Tier A review.
 */

import { TIER_LADDER } from "../utils/xp.js";

// ─── Classification constants ──────────────────────────────────────────────

export const ENTITLEMENT_CLASS = Object.freeze({
  REQUIRED: "required",
  ACTIVITY: "activity_gated",
  EARNED: "earned_convenience",
  ADMIN: "administrative",
  GRANTED: "granted_authority",
});

const { REQUIRED, ACTIVITY, EARNED, ADMIN, GRANTED } = ENTITLEMENT_CLASS;

// Community roles that confer social authority. Held by founders and a
// hand-picked few (see supabase/migrations/20260808_keeper_roles.sql). Both
// currently grant the full set of authority privileges; the model is a
// role→privilege intersection so narrower roles (e.g. a mentor-only role) can be
// added later without touching this file's consumers.
export const KEEPER_ROLES = Object.freeze(["founder", "steward"]);

/**
 * The activity facts an ACTIVITY entitlement may depend on. Declared as a
 * closed set so a typo in `requires.fact` fails the test suite instead of
 * silently reading `undefined` and gating on nothing — the same
 * name-contract-with-silent-fallback defect that the seam inventory exists to
 * catch.
 *
 * Every fact must be countable from data the user cannot simply assert:
 *   completedOrders — settled purchases (buyer side)
 *   verifiedSales   — settled sales, via breederStats.countVerifiedSales
 *   activeListings  — live listings the seller currently has published
 */
export const ACTIVITY_FACTS = Object.freeze([
  "completedOrders",
  "verifiedSales",
  "activeListings",
]);

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

  // ── Formerly XP-gated, now FREE ──────────────────────────────────────────
  //
  // These were never scale tools; the gate was arbitrary. Saving a search,
  // watching a species, or receiving a dispatch reminder costs nothing to
  // provide and helps most on day one — which is exactly when the old ladder
  // withheld them. Charging months of chores for a bookmark is the clearest
  // example of progression that felt like work for no reason.
  //
  // `canPostInsights` / `canRequestAudits` were nominally spam control, but XP
  // was never doing that job: a spammer inflates localStorage XP in one line,
  // while a genuine new keeper waited ~3.5 months. Posting rate limits are the
  // real control and already exist.
  saved_search: { class: REQUIRED, label: "Saved searches" },
  species_watchlist: { class: REQUIRED, label: "Species watchlist" },
  price_alerts: { class: REQUIRED, label: "Price alerts" },
  dispatch_reminders: { class: REQUIRED, label: "Dispatch reminders" },
  convenience_nudges: { class: REQUIRED, label: "Convenience nudges" },
  canPostInsights: { class: REQUIRED, label: "Post insights" },
  canRequestAudits: { class: REQUIRED, label: "Request audits" },

  // ── ACTIVITY — opens when the tool starts being useful ───────────────────
  //
  // Thresholds are deliberately low. The goal is "this appeared exactly when I
  // needed it", not a second grind with a different name. An analytics panel is
  // meaningless with zero orders and obviously useful with one, so that is the
  // bar — not 2,500 points.
  order_analytics: {
    class: ACTIVITY,
    requires: { fact: "completedOrders", min: 1 },
    unlockHint: "your first completed order",
    label: "Order analytics",
  },
  csv_export: {
    class: ACTIVITY,
    requires: { fact: "completedOrders", min: 1 },
    unlockHint: "your first completed order",
    label: "CSV export",
  },
  smart_reorder: {
    // Reordering presupposes having ordered more than once.
    class: ACTIVITY,
    requires: { fact: "completedOrders", min: 2 },
    unlockHint: "two completed orders",
    label: "Smart reorder",
  },
  bulk_management: {
    // Also gates the Breeder Tools batch grow-out panel: logging a checkpoint on
    // ONE spawn is REQUIRED (breeder_growout_tracking); doing it across many at
    // once is a scale convenience, and "many" is now measured in listings rather
    // than points.
    class: ACTIVITY,
    requires: { fact: "activeListings", min: 10 },
    unlockHint: "10 or more active listings",
    label: "Bulk product/fulfillment management",
  },
  auto_completion_rules: {
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 10 },
    unlockHint: "10 verified sales",
    label: "Auto-completion rules",
  },
  full_analytics_dashboard: {
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 10 },
    unlockHint: "10 verified sales",
    label: "Full analytics dashboard",
  },
  deep_reputation_insights: {
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 10 },
    unlockHint: "10 verified sales",
    label: "Deep reputation insights",
  },
  promotion_automation: {
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 10 },
    unlockHint: "10 verified sales",
    label: "Promotion automation",
  },
  customer_segmentation: {
    // Segments need a customer base to segment.
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 10 },
    unlockHint: "10 verified sales",
    label: "Customer segmentation",
  },
  carrier_api_integration: {
    // Wiring your own carrier account only pays off at real shipping volume.
    class: ACTIVITY,
    requires: { fact: "verifiedSales", min: 25 },
    unlockHint: "25 verified sales",
    label: "Carrier API integration",
  },

  // ── EARNED — what legitimately remains tier-gated ────────────────────────
  //
  // §3.4 — the loyalty perk. This one SHOULD track progression: it is the only
  // EARNED entry that is a genuine reward rather than a tool, and withholding a
  // discount from a new account denies nobody a capability.
  //
  // ⚠️ Because it is worth real money at checkout, its tier must come from the
  // SERVER (`ctx.tier` from depth_score), never from local XP alone. Passing
  // only `ctx.xp` here would let DevTools mint a permanent 8% discount.
  tier_discount: { class: EARNED, minTier: "Coastal", label: "Loyalty tier discount" },

  // ── SOCIAL AUTHORITY — GRANTED by role, never earned with XP ─────────────
  //
  // These are NOT conveniences and NOT scale tools: they decide who may judge,
  // teach, or moderate other keepers. XP is a poor proxy for that — it mostly
  // measures how much you sell and is inflation-gameable — so "grind your way to
  // moderator" is exactly the wrong incentive at the highest-stakes surface.
  //
  // They were previously tier-gated only because there was no granting flow, and
  // converting them to roles would have made them a dead control. That blocker is
  // gone: keeper roles (founder/steward) are now granted server-side
  // (supabase/migrations/20260808_keeper_roles.sql), held by the founders and a
  // hand-picked few at launch. `grantedByRoles` lists the roles that confer each
  // privilege; a caller has it iff it holds one of them (checked against
  // ctx.roles, sourced from the user_roles table — never from XP or tier).
  //
  // A real EARNED path can be added later, once a keeper-reputation model
  // (verified husbandry outcomes, peer endorsement) exists — this does not close
  // that door, it refuses to fake it with points.
  canCreateSchools: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Create schools" },
  canGiveAudits: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Give expert audits" },
  canMentor: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Mentor" },
  canHostVirtualTides: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Host virtual Tides" },
  canHostExpoTides: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Host expo Tides" },
  canModerate: { class: GRANTED, grantedByRoles: KEEPER_ROLES, label: "Moderate content" },

  // Still EARNED — a queue-priority perk, not authority over other keepers, so
  // tracking progression is fine here (nothing is withheld from anyone else).
  priority_curator_queue: { class: EARNED, minTier: "Hadal", label: "Priority curator queue" },

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

  if (entry.class === GRANTED) {
    // Social authority: held iff the caller holds one of the granting roles.
    // ctx.roles comes from the server-authoritative user_roles table. XP and
    // tier are deliberately ignored — authority is conferred, not earned.
    const held = ctx.roles || [];
    return (entry.grantedByRoles || []).some((r) => held.includes(r));
  }

  if (entry.class === ACTIVITY) {
    const { fact, min } = entry.requires;
    const value = ctx.activity?.[fact];
    // ⚠️ FAILS OPEN when the fact is unavailable, which is the opposite of the
    // unknown-key rule above, and deliberately so.
    //
    // These are additive conveniences layered on top of capabilities that are
    // already REQUIRED — nothing here withholds a core action. The two failure
    // directions are not symmetric: wrongly WITHHOLDING is invisible (a seller
    // who has earned bulk management just never sees it, and files no bug because
    // they never knew it existed), whereas wrongly GRANTING shows an empty panel,
    // which is self-correcting and obvious. A caller that has not loaded activity
    // facts yet must not be indistinguishable from a brand-new account.
    if (value == null) return true;
    return Number(value) >= min;
  }

  // EARNED: derive tier from ctx.tier or ctx.xp (higher of the two)
  const currentTierKey = resolveTier(ctx);
  return tierAtLeast(currentTierKey, entry.minTier);
}

/**
 * Describe what would unlock a capability, so the UI can say something true.
 *
 * Exists because the old prompt copy ("unlocks at the Pelagic tier") becomes a
 * LIE for an ACTIVITY entitlement — nothing about reaching a tier opens it. A
 * gate that misreports its own condition is worse than a locked button: it sends
 * someone off to grind for something the grind will never deliver.
 *
 * @param {string} key
 * @returns {{kind:"none"}
 *   | {kind:"unknown"}
 *   | {kind:"role", role:string}
 *   | {kind:"granted", roles:string[]}
 *   | {kind:"tier", tier:string}
 *   | {kind:"activity", fact:string, min:number, hint:string}}
 */
export function getUnlockRequirement(key) {
  const entry = ENTITLEMENTS[key];
  if (!entry) return { kind: "unknown" };
  if (entry.class === REQUIRED) return { kind: "none" };
  if (entry.class === ADMIN) return { kind: "role", role: entry.role };
  if (entry.class === GRANTED) return { kind: "granted", roles: entry.grantedByRoles || [] };
  if (entry.class === ACTIVITY) {
    return {
      kind: "activity",
      fact: entry.requires.fact,
      min: entry.requires.min,
      hint: entry.unlockHint,
    };
  }
  return { kind: "tier", tier: entry.minTier };
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

/**
 * Set of ACTIVITY keys, derived from the map. Used by the test suite to assert
 * every one declares a fact from the closed ACTIVITY_FACTS set.
 */
export const ACTIVITY_ENTITLEMENTS = new Set(
  Object.keys(ENTITLEMENTS).filter((key) => ENTITLEMENTS[key].class === ACTIVITY)
);
