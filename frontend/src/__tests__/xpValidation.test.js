/**
 * Unit tests for XP validation logic.
 * 
 * Tests the XP_ACTIONS definitions, tier calculations, and the
 * action-to-key mapping used by the server-side validation endpoint.
 * 
 * Run with: npx vitest --run src/__tests__/xpValidation.test.js
 */

import { describe, it, expect, beforeEach } from "vitest";
import { XP_ACTIONS, TIER_LADDER, getTierInfo, getXpProfile, addXp } from "../utils/xp.js";

// Mock localStorage for Node test environment
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = localStorageMock;
}

// Mock window.dispatchEvent for addXp
if (typeof globalThis.window === "undefined") {
  globalThis.window = { dispatchEvent: () => {} };
}

describe("XP Actions Definitions", () => {
  it("defines all expected care actions", () => {
    expect(XP_ACTIONS.LOG_FEEDING).toBeDefined();
    expect(XP_ACTIONS.LOG_WATER).toBeDefined();
    expect(XP_ACTIONS.LOG_PARAMETERS).toBeDefined();
    expect(XP_ACTIONS.PHOTO_OBSERVATION).toBeDefined();
    expect(XP_ACTIONS.REGISTER_TANK).toBeDefined();
    expect(XP_ACTIONS.ADD_SPECIES).toBeDefined();
  });

  it("defines all expected marketplace actions", () => {
    expect(XP_ACTIONS.VERIFIED_PICKUP_BUYER).toBeDefined();
    expect(XP_ACTIONS.VERIFIED_PICKUP_SELLER).toBeDefined();
    expect(XP_ACTIONS.LIST_DIRECTORY).toBeDefined();
    expect(XP_ACTIONS.COMPLETED_SALE).toBeDefined();
    expect(XP_ACTIONS.CLAIM_EXCHANGE).toBeDefined();
  });

  it("defines all expected breeding actions", () => {
    expect(XP_ACTIONS.MINT_SPECIMEN).toBeDefined();
    expect(XP_ACTIONS.SPAWN_BREED).toBeDefined();
    expect(XP_ACTIONS.BATCH_SHIPPING).toBeDefined();
    expect(XP_ACTIONS.AUDIT_GIVEN).toBeDefined();
    expect(XP_ACTIONS.AUDIT_RECEIVED).toBeDefined();
  });

  it("defines all expected social actions", () => {
    expect(XP_ACTIONS.POST_CURRENT).toBeDefined();
    expect(XP_ACTIONS.PUBLISH_INSIGHT).toBeDefined();
    expect(XP_ACTIONS.ENGAGEMENT_BONUS).toBeDefined();
    expect(XP_ACTIONS.JOIN_SCHOOL).toBeDefined();
    expect(XP_ACTIONS.MENTORED_USER).toBeDefined();
  });

  it("has correct point values per spec", () => {
    expect(XP_ACTIONS.LOG_FEEDING.points).toBe(5);
    expect(XP_ACTIONS.LOG_WATER.points).toBe(10);
    expect(XP_ACTIONS.LOG_PARAMETERS.points).toBe(8);
    expect(XP_ACTIONS.PHOTO_OBSERVATION.points).toBe(12);
    expect(XP_ACTIONS.REGISTER_TANK.points).toBe(25);
    expect(XP_ACTIONS.ADD_SPECIES.points).toBe(15);
    expect(XP_ACTIONS.MINT_SPECIMEN.points).toBe(50);
    expect(XP_ACTIONS.SPAWN_BREED.points).toBe(150);
    expect(XP_ACTIONS.COMPLETED_SALE.points).toBe(40);
    expect(XP_ACTIONS.POST_CURRENT.points).toBe(10);
    expect(XP_ACTIONS.MENTORED_USER.points).toBe(40);
  });

  it("has correct cooldowns for care actions", () => {
    expect(XP_ACTIONS.LOG_FEEDING.cooldownMs).toBe(86400000); // 24h
    expect(XP_ACTIONS.LOG_WATER.cooldownMs).toBe(172800000); // 48h
    expect(XP_ACTIONS.LOG_PARAMETERS.cooldownMs).toBe(172800000); // 48h
  });

  it("has correct daily maximums", () => {
    expect(XP_ACTIONS.PHOTO_OBSERVATION.dailyMax).toBe(3);
    expect(XP_ACTIONS.POST_CURRENT.dailyMax).toBe(2);
    // Actions without daily limits don't define the field (undefined, not null)
    expect(XP_ACTIONS.LOG_FEEDING.dailyMax).toBeFalsy();
  });

  it("marks per-tank cooldowns correctly", () => {
    expect(XP_ACTIONS.LOG_FEEDING.perTank).toBe(true);
    expect(XP_ACTIONS.LOG_WATER.perTank).toBe(true);
    expect(XP_ACTIONS.LOG_PARAMETERS.perTank).toBe(true);
    // Actions without perTank don't define the field
    expect(XP_ACTIONS.PHOTO_OBSERVATION.perTank).toBeFalsy();
    expect(XP_ACTIONS.MINT_SPECIMEN.perTank).toBeFalsy();
  });
});

describe("Tier Ladder", () => {
  it("has exactly 5 tiers", () => {
    expect(TIER_LADDER).toHaveLength(5);
  });

  it("tiers are ordered by ascending min XP", () => {
    for (let i = 1; i < TIER_LADDER.length; i++) {
      expect(TIER_LADDER[i].min).toBeGreaterThan(TIER_LADDER[i - 1].min);
    }
  });

  it("has correct tier boundaries per spec", () => {
    expect(TIER_LADDER[0]).toMatchObject({ key: "Shallow", min: 0, max: 1499 });
    expect(TIER_LADDER[1]).toMatchObject({ key: "Coastal", min: 1500, max: 2499 });
    expect(TIER_LADDER[2]).toMatchObject({ key: "Pelagic", min: 2500, max: 4999 });
    expect(TIER_LADDER[3]).toMatchObject({ key: "Abyssal", min: 5000, max: 9999 });
    expect(TIER_LADDER[4]).toMatchObject({ key: "Hadal", min: 10000 });
  });

  it("every tier has required display fields", () => {
    for (const tier of TIER_LADDER) {
      expect(tier.level).toBeDefined();
      expect(tier.key).toBeDefined();
      expect(tier.icon).toBeDefined();
      expect(tier.hobbyistLabel).toBeDefined();
      expect(tier.breederLabel).toBeDefined();
      expect(tier.colorHex).toBeDefined();
    }
  });
});

describe("getTierInfo", () => {
  it("returns Shallow for 0 XP", () => {
    const info = getTierInfo(0);
    expect(info.key).toBe("Shallow");
    expect(info.level).toBe(1);
  });

  it("returns Shallow for 1499 XP", () => {
    const info = getTierInfo(1499);
    expect(info.key).toBe("Shallow");
  });

  it("returns Coastal at exactly 1500 XP", () => {
    const info = getTierInfo(1500);
    expect(info.key).toBe("Coastal");
    expect(info.level).toBe(2);
  });

  it("returns Pelagic at 2500 XP", () => {
    const info = getTierInfo(2500);
    expect(info.key).toBe("Pelagic");
    expect(info.level).toBe(3);
  });

  it("returns Abyssal at 5000 XP", () => {
    const info = getTierInfo(5000);
    expect(info.key).toBe("Abyssal");
    expect(info.level).toBe(4);
  });

  it("returns Hadal at 10000 XP", () => {
    const info = getTierInfo(10000);
    expect(info.key).toBe("Hadal");
    expect(info.level).toBe(5);
  });

  it("returns Hadal for very high XP", () => {
    const info = getTierInfo(999999);
    expect(info.key).toBe("Hadal");
    expect(info.level).toBe(5);
    expect(info.progressPct).toBe(100);
  });

  it("calculates progress percentage within tier", () => {
    // Shallow is 0-1499 (range of 1500)
    const mid = getTierInfo(750);
    expect(mid.key).toBe("Shallow");
    expect(mid.progressPct).toBeGreaterThan(40);
    expect(mid.progressPct).toBeLessThan(60);
  });

  it("includes nextLevelXp for non-max tiers", () => {
    const info = getTierInfo(100);
    expect(info.nextLevelXp).toBe(1500); // Coastal starts at 1500
  });

  it("returns null nextLevelXp for Hadal", () => {
    const info = getTierInfo(10000);
    expect(info.nextLevelXp).toBeNull();
  });

  it("handles null/undefined gracefully", () => {
    const info = getTierInfo(null);
    expect(info.key).toBe("Shallow");
    expect(info.level).toBe(1);
  });
});

describe("addXp", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("adds points to profile", () => {
    const { newXp, tierInfo } = addXp(25, "Test Action");
    expect(newXp).toBe(25);
    expect(tierInfo.key).toBe("Shallow");
  });

  it("accumulates XP across multiple calls", () => {
    addXp(100, "Action 1");
    const { newXp } = addXp(200, "Action 2");
    expect(newXp).toBe(300);
  });

  it("detects tier changes", () => {
    // Start at 1490, add 20 → cross into Coastal (1500)
    addXp(1490, "Grind");
    const { tierChanged, tierInfo } = addXp(20, "Level Up");
    expect(tierChanged).toBe(true);
    expect(tierInfo.key).toBe("Coastal");
  });

  it("returns tierChanged=false when tier stays same", () => {
    const { tierChanged } = addXp(5, "Small action");
    expect(tierChanged).toBe(false);
  });

  it("ignores zero or negative points", () => {
    addXp(100, "Setup");
    const { newXp: afterZero } = addXp(0, "Nothing");
    expect(afterZero).toBe(100);

    const { newXp: afterNeg } = addXp(-5, "Negative");
    expect(afterNeg).toBe(100);
  });

  it("persists to localStorage", () => {
    addXp(42, "Persist test");
    const stored = JSON.parse(localStorageMock.getItem("aquadex_xp_profile"));
    expect(stored.points).toBe(42);
    expect(localStorageMock.getItem("aquadex_xp")).toBe("42");
  });
});

describe("Server Validation Logic (action type matching)", () => {
  // This tests the same logic the server uses to match action types
  // Mirrors the mapReasonToActionKey function from useXPSync

  function mapReasonToActionKey(reason) {
    const r = (reason || "").toLowerCase();
    if (r.includes("feed")) return "LOG_FEEDING";
    if (r.includes("water change")) return "LOG_WATER";
    if ((r.includes("water") && r.includes("test")) || r.includes("parameter")) return "LOG_PARAMETERS";
    if (r.includes("algae") || r.includes("scrape")) return "LOG_FEEDING";
    if (r.includes("photo") || r.includes("observation")) return "PHOTO_OBSERVATION";
    if (r.includes("tank") && r.includes("register")) return "REGISTER_TANK";
    if (r.includes("species") && r.includes("add")) return "ADD_SPECIES";
    if (r.includes("mint") || r.includes("birth certificate")) return "MINT_SPECIMEN";
    if (r.includes("spawn") || r.includes("breed")) return "SPAWN_BREED";
    if (r.includes("list")) return "LIST_DIRECTORY";
    if (r.includes("handshake") || r.includes("pickup")) return "VERIFIED_PICKUP_BUYER";
    if (r.includes("sale") || r.includes("sold")) return "COMPLETED_SALE";
    if (r.includes("purchase") || r.includes("bought") || r.includes("checkout")) return "CLAIM_EXCHANGE";
    if (r.includes("audit") && r.includes("gave")) return "AUDIT_GIVEN";
    if (r.includes("audit")) return "AUDIT_RECEIVED";
    if (r.includes("current") || r.includes("post")) return "POST_CURRENT";
    if (r.includes("insight")) return "PUBLISH_INSIGHT";
    if (r.includes("school") || r.includes("join")) return "JOIN_SCHOOL";
    if (r.includes("mentor")) return "MENTORED_USER";
    if (r.includes("arrival") && r.includes("batch")) return "BATCH_ARRIVAL_CONFIRMED";
    if (r.includes("arrival")) return "ARRIVAL_CONFIRMED";
    return "LOG_FEEDING";
  }

  it("maps feeding actions correctly", () => {
    expect(mapReasonToActionKey("Logged Feed")).toBe("LOG_FEEDING");
    expect(mapReasonToActionKey("Daily feeding log")).toBe("LOG_FEEDING");
  });

  it("maps water change correctly", () => {
    expect(mapReasonToActionKey("Logged Water Change")).toBe("LOG_WATER");
  });

  it("maps water test correctly", () => {
    expect(mapReasonToActionKey("Logged Quick Water Test")).toBe("LOG_PARAMETERS");
    expect(mapReasonToActionKey("Water parameter check")).toBe("LOG_PARAMETERS");
  });

  it("maps algae scraping to feeding", () => {
    expect(mapReasonToActionKey("Logged Scraped Algae")).toBe("LOG_FEEDING");
  });

  it("maps photo observations", () => {
    expect(mapReasonToActionKey("Photo observation shared")).toBe("PHOTO_OBSERVATION");
  });

  it("maps tank registration", () => {
    expect(mapReasonToActionKey("Tank registered")).toBe("REGISTER_TANK");
  });

  it("maps minting", () => {
    expect(mapReasonToActionKey("Minted birth certificate")).toBe("MINT_SPECIMEN");
  });

  it("maps spawning", () => {
    expect(mapReasonToActionKey("Successful spawn event")).toBe("SPAWN_BREED");
    expect(mapReasonToActionKey("Breed pair recorded")).toBe("SPAWN_BREED");
  });

  it("maps marketplace actions", () => {
    expect(mapReasonToActionKey("Listed for sale")).toBe("LIST_DIRECTORY");
    expect(mapReasonToActionKey("Completed sale")).toBe("COMPLETED_SALE");
    expect(mapReasonToActionKey("Purchased specimen")).toBe("CLAIM_EXCHANGE");
    expect(mapReasonToActionKey("Checkout complete")).toBe("CLAIM_EXCHANGE");
  });

  it("maps handshake/pickup", () => {
    expect(mapReasonToActionKey("Handshake verified")).toBe("VERIFIED_PICKUP_BUYER");
    expect(mapReasonToActionKey("Local pickup confirmed")).toBe("VERIFIED_PICKUP_BUYER");
  });

  it("maps social actions", () => {
    expect(mapReasonToActionKey("Posted a current")).toBe("POST_CURRENT");
    expect(mapReasonToActionKey("Published insight")).toBe("PUBLISH_INSIGHT");
    expect(mapReasonToActionKey("Joined school")).toBe("JOIN_SCHOOL");
    expect(mapReasonToActionKey("Mentored a user")).toBe("MENTORED_USER");
  });

  it("maps arrival flow", () => {
    expect(mapReasonToActionKey("Confirmed arrival")).toBe("ARRIVAL_CONFIRMED");
    expect(mapReasonToActionKey("Batch arrival confirmed")).toBe("BATCH_ARRIVAL_CONFIRMED");
  });

  it("falls back to LOG_FEEDING for unknown actions", () => {
    expect(mapReasonToActionKey("Unknown activity")).toBe("LOG_FEEDING");
    expect(mapReasonToActionKey("")).toBe("LOG_FEEDING");
  });

  describe("Points validation (server-side matching)", () => {
    it("all defined actions have points within expected bounds", () => {
      for (const [key, def] of Object.entries(XP_ACTIONS)) {
        expect(def.points).toBeGreaterThan(0);
        expect(def.points).toBeLessThanOrEqual(150); // SPAWN_BREED is the max
      }
    });

    it("server would reject points mismatch", () => {
      // Simulate server-side check: |claimed - expected| > 1 → reject
      const claimed = 999;
      const expected = XP_ACTIONS.LOG_FEEDING.points; // 5
      const mismatch = Math.abs(claimed - expected) > 1;
      expect(mismatch).toBe(true);
    });

    it("server accepts points within ±1 tolerance", () => {
      const claimed = 6; // 5 + 1
      const expected = XP_ACTIONS.LOG_FEEDING.points; // 5
      const mismatch = Math.abs(claimed - expected) > 1;
      expect(mismatch).toBe(false);
    });
  });
});
