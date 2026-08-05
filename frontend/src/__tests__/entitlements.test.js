/**
 * Unit tests for the centralized entitlement map (Task 6).
 *
 * Verifies the safety-critical classification from
 * docs/TASK_06_ENTITLEMENTS_SPEC.md §3 and §6:
 *   1. Every REQUIRED entitlement is true for a 0-XP, no-role context, and no
 *      REQUIRED entry ever carries a minTier.
 *   2. Tier gating is correct tier-by-tier for every EARNED entitlement.
 *  2b. ACTIVITY gating opens on demonstrated activity and NEVER on XP.
 *   3. Explicit non-gating assertions for named commerce/safety capabilities.
 *   4. Administrative entitlements gate on role, not XP.
 *   5. The tier discount is a perk, not a checkout precondition.
 *   6. Migrated Reef privileges resolve to their pre-existing required tiers.
 *
 * NOTE ON THE XP REWORK: XP is now a score and a cosmetic engine, so the tools it
 * used to gate moved to REQUIRED (core, never gated) or ACTIVITY (opens when the
 * tool becomes useful). Several assertions here previously pinned the OLD policy —
 * "order_analytics is EARNED", "canPostInsights requires Coastal", "one EARNED
 * entitlement per tier" — and were rewritten rather than deleted, so the new
 * taxonomy is asserted just as tightly as the old one was.
 *
 * Run with: npx vitest --run src/__tests__/entitlements.test.js
 */

import { describe, it, expect } from "vitest";
import {
  ENTITLEMENT_CLASS,
  ENTITLEMENTS,
  REQUIRED_ENTITLEMENTS,
  ACTIVITY_ENTITLEMENTS,
  ACTIVITY_FACTS,
  TIER_ORDER,
  tierAtLeast,
  resolveTier,
  hasEntitlement,
  getRequiredTierFor,
  getUnlockRequirement,
} from "../services/entitlements.js";

const { REQUIRED, ACTIVITY, EARNED, ADMIN } = ENTITLEMENT_CLASS;

describe("TIER_ORDER", () => {
  it("matches the canonical XP tier ladder order", () => {
    expect(TIER_ORDER).toEqual(["Shallow", "Coastal", "Pelagic", "Abyssal", "Hadal"]);
  });
});

describe("1. Safety invariant — REQUIRED entitlements", () => {
  it("every REQUIRED entitlement returns true for a 0-XP, no-role context", () => {
    for (const key of REQUIRED_ENTITLEMENTS) {
      expect(hasEntitlement(key, { xp: 0, tier: "Shallow", roles: [] })).toBe(true);
    }
  });

  it("REQUIRED_ENTITLEMENTS is non-empty and matches the map's REQUIRED keys", () => {
    const expected = Object.keys(ENTITLEMENTS).filter((k) => ENTITLEMENTS[k].class === REQUIRED);
    expect(REQUIRED_ENTITLEMENTS.size).toBeGreaterThan(0);
    expect([...REQUIRED_ENTITLEMENTS].sort()).toEqual(expected.sort());
  });

  it("no REQUIRED entry ever carries a minTier", () => {
    for (const key of REQUIRED_ENTITLEMENTS) {
      expect(ENTITLEMENTS[key].minTier).toBeUndefined();
    }
  });

  it("no REQUIRED entry ever carries a role gate", () => {
    for (const key of REQUIRED_ENTITLEMENTS) {
      expect(ENTITLEMENTS[key].role).toBeUndefined();
    }
  });
});

describe("2. Tier gating — EARNED entitlements", () => {
  const earnedKeys = Object.keys(ENTITLEMENTS).filter((k) => ENTITLEMENTS[k].class === EARNED);

  it("tier-gates ONLY the loyalty perk and social authority — never a tool", () => {
    // XP is now a score and a cosmetic engine, not a gate. What legitimately
    // remains tier-gated is (a) the loyalty discount, which is a reward rather
    // than a capability, and (b) the privileges that decide who may judge, teach,
    // or moderate other keepers — held back pending a policy decision, because
    // converting them to ungranted roles would make them permanently unreachable.
    //
    // Every other former EARNED entry became REQUIRED or ACTIVITY. If a new tool
    // shows up in this list, someone has put a convenience back behind a grind.
    expect(new Set(earnedKeys)).toEqual(
      new Set([
        "tier_discount",
        "canCreateSchools",
        "canGiveAudits",
        "canMentor",
        "canHostVirtualTides",
        "canHostExpoTides",
        "canModerate",
        "priority_curator_queue",
      ])
    );
  });

  it("has no Pelagic rung left, because nothing useful lives there any more", () => {
    const tiers = new Set(earnedKeys.map((k) => ENTITLEMENTS[k].minTier));
    expect(tiers.has("Pelagic")).toBe(false);
  });

  it("returns false below minTier and true at/above it, across all five tiers", () => {
    for (const key of earnedKeys) {
      const minTier = ENTITLEMENTS[key].minTier;
      const minIndex = TIER_ORDER.indexOf(minTier);

      TIER_ORDER.forEach((tierKey, tierIndex) => {
        const result = hasEntitlement(key, { tier: tierKey });
        if (tierIndex >= minIndex) {
          expect(result, `${key} should be granted at ${tierKey}`).toBe(true);
        } else {
          expect(result, `${key} should be denied at ${tierKey}`).toBe(false);
        }
      });
    }
  });

  it("derives tier from xp when tier is absent", () => {
    // Abyssal social-authority privilege, just under and just at 5,000 XP.
    expect(hasEntitlement("canGiveAudits", { xp: 4999 })).toBe(false);
    expect(hasEntitlement("canGiveAudits", { xp: 5000 })).toBe(true);
  });

  it("uses the higher of xp and tier so a stale DB tier never locks out earned XP", () => {
    // Local XP profile already at Abyssal, but a stale server tier says Shallow.
    expect(hasEntitlement("canMentor", { xp: 5000, tier: "Shallow" })).toBe(true);
    // Conversely, a fresher server tier ahead of stale local XP should also count.
    expect(hasEntitlement("canMentor", { xp: 0, tier: "Abyssal" })).toBe(true);
  });
});

describe("2b. ACTIVITY gating — opens on demonstrated activity, not XP", () => {
  const activityKeys = [...ACTIVITY_ENTITLEMENTS];

  it("covers every scale tool that used to be tier-gated", () => {
    expect(new Set(activityKeys)).toEqual(
      new Set([
        "order_analytics",
        "csv_export",
        "smart_reorder",
        "bulk_management",
        "auto_completion_rules",
        "full_analytics_dashboard",
        "deep_reputation_insights",
        "promotion_automation",
        "customer_segmentation",
        "carrier_api_integration",
      ])
    );
  });

  it("declares a fact from the closed ACTIVITY_FACTS set, with a min and a hint", () => {
    // A typo in `fact` would otherwise read undefined and gate on nothing — the
    // silent name-mismatch defect the seam inventory exists to catch.
    for (const key of activityKeys) {
      const entry = ENTITLEMENTS[key];
      expect(ACTIVITY_FACTS, `${key} declares an unknown fact`).toContain(entry.requires.fact);
      expect(entry.requires.min, `${key} needs a positive min`).toBeGreaterThan(0);
      expect(entry.unlockHint, `${key} needs copy the UI can show`).toBeTruthy();
    }
  });

  it("is NOT unlocked by any amount of XP", () => {
    // The whole point. Grinding must not open these, or we have just renamed the
    // ladder rather than removed it.
    for (const key of activityKeys) {
      expect(
        hasEntitlement(key, { xp: 999999, tier: "Hadal", activity: { completedOrders: 0, verifiedSales: 0, activeListings: 0 } }),
        `${key} must not open on XP alone`
      ).toBe(false);
    }
  });

  it("opens exactly at its declared threshold", () => {
    for (const key of activityKeys) {
      const { fact, min } = ENTITLEMENTS[key].requires;
      expect(hasEntitlement(key, { activity: { [fact]: min - 1 } }), `${key} below min`).toBe(false);
      expect(hasEntitlement(key, { activity: { [fact]: min } }), `${key} at min`).toBe(true);
    }
  });

  it("FAILS OPEN when activity facts have not loaded", () => {
    // Deliberate, and the opposite of the unknown-key rule. Wrongly withholding is
    // invisible — a seller who has earned bulk management simply never sees it and
    // files no bug. Wrongly granting shows an empty panel, which is obvious and
    // self-correcting. So an unloaded caller must not look like a new account.
    for (const key of activityKeys) {
      expect(hasEntitlement(key, {}), `${key} with no ctx`).toBe(true);
      expect(hasEntitlement(key, { activity: null }), `${key} with null activity`).toBe(true);
      expect(hasEntitlement(key, { activity: {} }), `${key} with empty facts`).toBe(true);
    }
  });
});

describe("3. Explicit non-gating assertions (0 XP, no roles)", () => {
  const alwaysAvailable = [
    "checkout",
    "leave_review",
    "doa_claim",
    "refund",
    "handoff",
    "ownership_transfer",
    "order_history",
    "tracking",
    "seller_fulfillment",
    "view_reputation",
  ];

  it.each(alwaysAvailable)("%s is available at 0 XP", (key) => {
    expect(hasEntitlement(key, { xp: 0, tier: "Shallow", roles: [] })).toBe(true);
  });

  it.each(alwaysAvailable)("%s is classified REQUIRED", (key) => {
    expect(ENTITLEMENTS[key].class).toBe(REQUIRED);
  });
});

describe("4. Administrative entitlements gate on role, not XP", () => {
  it("a Hadal (max XP) non-curator cannot resolve_dispute", () => {
    expect(hasEntitlement("resolve_dispute", { xp: 999999, tier: "Hadal", roles: [] })).toBe(false);
    expect(hasEntitlement("resolve_dispute", { xp: 999999, tier: "Hadal", roles: ["operator"] })).toBe(false);
  });

  it("a curator with 0 XP can resolve_dispute", () => {
    expect(hasEntitlement("resolve_dispute", { xp: 0, tier: "Shallow", roles: ["curator"] })).toBe(true);
  });

  it("an operator with 0 XP can reconcile_orders; a curator cannot", () => {
    expect(hasEntitlement("reconcile_orders", { xp: 0, roles: ["operator"] })).toBe(true);
    expect(hasEntitlement("reconcile_orders", { xp: 999999, tier: "Hadal", roles: ["curator"] })).toBe(false);
  });

  it("all ADMIN entries specify a role and no minTier", () => {
    for (const key of Object.keys(ENTITLEMENTS)) {
      const entry = ENTITLEMENTS[key];
      if (entry.class === ADMIN) {
        expect(entry.role).toBeTruthy();
        expect(entry.minTier).toBeUndefined();
      }
    }
  });
});

describe("5. Discount invariant", () => {
  it("tier_discount is classified EARNED (a perk), never REQUIRED", () => {
    expect(ENTITLEMENTS.tier_discount.class).toBe(EARNED);
  });

  it("checkout is REQUIRED and independent of the discount entitlement", () => {
    // A 0-XP account without the discount can still check out.
    expect(hasEntitlement("tier_discount", { xp: 0 })).toBe(false);
    expect(hasEntitlement("checkout", { xp: 0 })).toBe(true);
  });
});

describe("6. Reef parity — migrated privileges resolve to their existing required tiers", () => {
  // The privileges that decide who may judge, teach, or moderate others keep their
  // original tiers on purpose — see the SOCIAL AUTHORITY note in entitlements.js.
  const expected = {
    canCreateSchools: "Coastal",
    canGiveAudits: "Abyssal",
    canMentor: "Abyssal",
    canHostVirtualTides: "Abyssal",
    canHostExpoTides: "Hadal",
    canModerate: "Hadal",
  };

  it.each(Object.entries(expected))("%s requires %s", (privilege, tier) => {
    expect(getRequiredTierFor(privilege)).toBe(tier);
  });

  // These two were nominally spam control, which XP never actually provided: a
  // spammer inflates localStorage XP in one line, while a genuine new keeper waited
  // months. Posting rate limits are the real control.
  it.each(["canPostInsights", "canRequestAudits"])("%s is no longer tier-gated", (privilege) => {
    expect(getRequiredTierFor(privilege)).toBeNull();
    expect(hasEntitlement(privilege, { xp: 0 })).toBe(true);
  });
});

describe("Task 18 — buyer order capabilities are REQUIRED, only analytics/watchlist/reorder/export are EARNED", () => {
  // docs/TASK_18_BUYER_ORDERS_SPEC.md §4.11: order history, receipts, tracking,
  // arrival/handoff confirmation, reporting a problem (DOA), and refunds must
  // never be gated. Only order_analytics / csv_export / species_watchlist /
  // smart_reorder — the features CheckoutSummary/OrderAnalytics/
  // OrderWatchlistReorder now gate via hasEntitlement (migrated off the legacy
  // orderFeatureGates.isFeatureUnlocked) — may be tier-gated.
  const requiredOrderCapabilities = [
    "order_history",
    "receipts",
    "tracking",
    "local_delivery_tracking",
    "arrival_confirmation",
    "handoff",
    "doa_claim",
    "doa_evidence",
    "refund",
    "dispute",
    "paid_pickup_handshake",
    "cash_pickup_handshake",
    "ownership_transfer",
  ];

  it.each(requiredOrderCapabilities)("%s is REQUIRED (never gated) at 0 XP / no role", (key) => {
    expect(ENTITLEMENTS[key], `unknown entitlement key: ${key}`).toBeDefined();
    expect(ENTITLEMENTS[key].class).toBe(REQUIRED);
    expect(hasEntitlement(key, { xp: 0, tier: "Shallow", roles: [] })).toBe(true);
  });

  // Watching a species is core discovery and is now REQUIRED. Charging months of
  // chores for a bookmark was the clearest case of progression that felt like work
  // for no reason.
  it("species_watchlist is REQUIRED — a bookmark is not a reward", () => {
    expect(ENTITLEMENTS.species_watchlist.class).toBe(REQUIRED);
    expect(hasEntitlement("species_watchlist", { xp: 0, tier: "Shallow" })).toBe(true);
  });

  // The three genuine order tools open on having actually ordered.
  const activityGatedOrderTools = ["order_analytics", "csv_export", "smart_reorder"];

  it.each(activityGatedOrderTools)("%s opens on completed orders, not tier", (key) => {
    expect(ENTITLEMENTS[key].class).toBe(ACTIVITY);
    expect(ENTITLEMENTS[key].requires.fact).toBe("completedOrders");
    // A maxed-out account with no orders still has nothing to analyse.
    expect(hasEntitlement(key, { xp: 999999, activity: { completedOrders: 0 } })).toBe(false);
  });
});

describe("Task 15 — cash pickup handoff surfaces are REQUIRED (never gated)", () => {
  // docs/TASK_15_CASH_PICKUP_UI_SPEC.md §5: presenting a pickup code
  // (buyer) and confirming a cash handoff (seller) are core fulfillment and
  // must never be XP-gated. cash_pickup_handshake already covers both —
  // this reasserts it explicitly for Task 15's new PickupCode/
  // CashPickupConfirm components.
  it("cash_pickup_handshake is REQUIRED and granted at 0 XP / no role", () => {
    expect(ENTITLEMENTS.cash_pickup_handshake.class).toBe(REQUIRED);
    expect(hasEntitlement("cash_pickup_handshake", { xp: 0, tier: "Shallow", roles: [] })).toBe(true);
  });
});

describe("Task 25 — pickup coordination capabilities are REQUIRED (never gated)", () => {
  // docs/TASK_25_PICKUP_COORDINATION_SPEC.md §0: seller_pickup_scheduling,
  // paid_pickup_handshake, handoff, and ownership_transfer are all
  // REQUIRED-class and must stay that way — pickup coordination is core
  // fulfillment, not a convenience feature. No new entitlement keys were
  // introduced for this task; it reuses these existing REQUIRED keys.
  const pickupCoordinationCapabilities = [
    "seller_pickup_scheduling",
    "paid_pickup_handshake",
    "handoff",
    "ownership_transfer",
  ];

  it.each(pickupCoordinationCapabilities)("%s is REQUIRED and granted at 0 XP / no role", (key) => {
    expect(ENTITLEMENTS[key], `unknown entitlement key: ${key}`).toBeDefined();
    expect(ENTITLEMENTS[key].class).toBe(REQUIRED);
    expect(hasEntitlement(key, { xp: 0, tier: "Shallow", roles: [] })).toBe(true);
  });

  it("none of these carry a minTier or role gate", () => {
    for (const key of pickupCoordinationCapabilities) {
      expect(ENTITLEMENTS[key].minTier).toBeUndefined();
      expect(ENTITLEMENTS[key].role).toBeUndefined();
    }
  });
});

describe("hasEntitlement — unknown keys fail closed", () => {
  it("returns false for an unknown entitlement key regardless of context", () => {
    expect(hasEntitlement("not_a_real_entitlement", { xp: 999999, roles: ["curator", "operator"] })).toBe(false);
  });
});

describe("tierAtLeast", () => {
  it("compares tiers using canonical ordering", () => {
    expect(tierAtLeast("Hadal", "Shallow")).toBe(true);
    expect(tierAtLeast("Shallow", "Hadal")).toBe(false);
    expect(tierAtLeast("Pelagic", "Pelagic")).toBe(true);
  });

  it("fails closed for unknown tier keys", () => {
    expect(tierAtLeast("NotATier", "Coastal")).toBe(false);
    expect(tierAtLeast("Coastal", "NotATier")).toBe(false);
  });
});

describe("resolveTier", () => {
  it("defaults to the base tier when no xp or tier is provided", () => {
    expect(resolveTier({})).toBe("Shallow");
  });
});
