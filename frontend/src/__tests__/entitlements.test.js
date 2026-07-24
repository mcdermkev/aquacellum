/**
 * Unit tests for the centralized entitlement map (Task 6).
 *
 * Verifies the safety-critical classification from
 * docs/TASK_06_ENTITLEMENTS_SPEC.md §3 and §6:
 *   1. Every REQUIRED entitlement is true for a 0-XP, no-role context, and no
 *      REQUIRED entry ever carries a minTier.
 *   2. Tier gating is correct tier-by-tier for every EARNED entitlement.
 *   3. Explicit non-gating assertions for named commerce/safety capabilities.
 *   4. Administrative entitlements gate on role, not XP.
 *   5. The tier discount is a perk, not a checkout precondition.
 *   6. Migrated Reef privileges resolve to their pre-existing required tiers.
 *
 * Run with: npx vitest --run src/__tests__/entitlements.test.js
 */

import { describe, it, expect } from "vitest";
import {
  ENTITLEMENT_CLASS,
  ENTITLEMENTS,
  REQUIRED_ENTITLEMENTS,
  TIER_ORDER,
  tierAtLeast,
  resolveTier,
  hasEntitlement,
  getRequiredTierFor,
} from "../services/entitlements.js";

const { REQUIRED, EARNED, ADMIN } = ENTITLEMENT_CLASS;

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

  it("has at least one EARNED entitlement per gated tier (Coastal/Pelagic/Abyssal/Hadal)", () => {
    const tiers = new Set(earnedKeys.map((k) => ENTITLEMENTS[k].minTier));
    expect(tiers).toEqual(new Set(["Coastal", "Pelagic", "Abyssal", "Hadal"]));
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
    // Pelagic entitlement, just under and just at the 2,500 XP threshold.
    expect(hasEntitlement("order_analytics", { xp: 2499 })).toBe(false);
    expect(hasEntitlement("order_analytics", { xp: 2500 })).toBe(true);
  });

  it("uses the higher of xp and tier so a stale DB tier never locks out earned XP", () => {
    // Local XP profile already at Abyssal, but a stale server tier says Shallow.
    expect(hasEntitlement("bulk_management", { xp: 5000, tier: "Shallow" })).toBe(true);
    // Conversely, a fresher server tier ahead of stale local XP should also count.
    expect(hasEntitlement("bulk_management", { xp: 0, tier: "Abyssal" })).toBe(true);
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
  const expected = {
    canCreateSchools: "Coastal",
    canPostInsights: "Coastal",
    canRequestAudits: "Coastal",
    canGiveAudits: "Abyssal",
    canMentor: "Abyssal",
    canHostVirtualTides: "Abyssal",
    canHostExpoTides: "Hadal",
    canModerate: "Hadal",
  };

  it.each(Object.entries(expected))("%s requires %s", (privilege, tier) => {
    expect(getRequiredTierFor(privilege)).toBe(tier);
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

  const gatedOrderConveniences = ["order_analytics", "csv_export", "species_watchlist", "smart_reorder"];

  it.each(gatedOrderConveniences)("%s is EARNED (tier-gated), not REQUIRED", (key) => {
    expect(ENTITLEMENTS[key].class).toBe(EARNED);
    expect(hasEntitlement(key, { xp: 0, tier: "Shallow" })).toBe(false);
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
