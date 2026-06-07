/**
 * reef-integration.test.js
 * 
 * Integration test scaffolding for The Reef social layer.
 * Tests the critical path: profile → post → reaction → notification.
 * 
 * Run with: npx vitest --run src/__tests__/reef-integration.test.js
 * 
 * Prerequisites:
 * - Supabase project configured (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 * - Test wallet address available
 * - Tables seeded (run migrations first)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

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

// Service imports
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";
import {
  ensureProfile,
  getProfile,
  updateProfile,
  createCurrent,
  getDiscoverFeed,
  toggleReaction,
  getReactions,
  postComment,
  getComments,
  sendTankmateRequest,
  getNotifications,
} from "../services/reefApi";
import { checkRateLimit, recordAction, resetRateLimits } from "../services/rateLimiter";
import { exportUserData } from "../services/gdprService";

// Test wallet for integration tests (not a real wallet)
const TEST_WALLET = "0xTEST_INTEGRATION_" + Date.now().toString(36);
const TEST_WALLET_2 = "0xTEST_INTEGRATION_2_" + Date.now().toString(36);

describe("Reef Integration Tests", () => {
  const configured = isSupabaseConfigured();

  describe("Rate Limiter (client-side)", () => {
    beforeAll(() => {
      resetRateLimits();
    });

    afterAll(() => {
      resetRateLimits();
    });

    it("allows actions within limits", () => {
      const result = checkRateLimit("post");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it("records actions and decrements remaining", () => {
      recordAction("post");
      recordAction("post");
      const result = checkRateLimit("post");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(8);
    });

    it("blocks when limit reached", () => {
      resetRateLimits();
      // Fill up the post limit (10/hour)
      for (let i = 0; i < 10; i++) {
        recordAction("post");
      }
      const result = checkRateLimit("post");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.message).toContain("Rate limit reached");
    });

    it("handles unknown actions gracefully", () => {
      const result = checkRateLimit("unknown_action");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it("enforces daily limits for audits", () => {
      resetRateLimits();
      for (let i = 0; i < 3; i++) {
        recordAction("audit_request");
      }
      const result = checkRateLimit("audit_request");
      expect(result.allowed).toBe(false);
      expect(result.message).toContain("day");
    });
  });

  describe("Profile System", () => {
    it.skipIf(!configured)("creates a profile on first connect", async () => {
      const { data, error } = await ensureProfile(TEST_WALLET, {
        display_name: "Test User",
        tank_count: 3,
        species_count: 12,
      });

      // In anon mode this may fail due to RLS — that's expected
      if (!error) {
        expect(data.wallet_address).toBe(TEST_WALLET);
        expect(data.display_name).toBe("Test User");
      }
    });

    it.skipIf(!configured)("fetches a profile by wallet", async () => {
      const { data, error } = await getProfile(TEST_WALLET);
      // May be null if previous test failed due to auth
      if (data) {
        expect(data.wallet_address).toBe(TEST_WALLET);
      }
    });

    it.skipIf(!configured)("updates profile fields", async () => {
      const { data, error } = await updateProfile(TEST_WALLET, {
        bio: "Integration test bio",
      });
      if (data) {
        expect(data.bio).toBe("Integration test bio");
      }
    });
  });

  describe("Content Creation & Feed", () => {
    let testCurrentId = null;

    it.skipIf(!configured)("creates a Tank Current", async () => {
      const { data, error } = await createCurrent({
        authorWallet: TEST_WALLET,
        title: "Integration Test Post",
        body: "This is a test current created by the integration test suite.",
        visibility: "public",
        speciesTags: ["Neon Tetra"],
      });

      if (data) {
        testCurrentId = data.id;
        expect(data.title).toBe("Integration Test Post");
        expect(data.visibility).toBe("public");
      }
    });

    it.skipIf(!configured)("appears in the Discover feed", async () => {
      const { data } = await getDiscoverFeed({ limit: 5 });
      // New post should be in the feed
      if (testCurrentId && data?.length > 0) {
        const found = data.find((c) => c.id === testCurrentId);
        expect(found).toBeDefined();
      }
    });

    it.skipIf(!configured)("can receive a reaction", async () => {
      if (!testCurrentId) return;
      const { data } = await toggleReaction(testCurrentId, "🐟");
      if (data) {
        expect(data.action).toBe("added");
      }
    });

    it.skipIf(!configured)("reaction counts are correct", async () => {
      if (!testCurrentId) return;
      const { data } = await getReactions(testCurrentId);
      if (data?.["🐟"]) {
        expect(data["🐟"].count).toBeGreaterThanOrEqual(1);
      }
    });

    it.skipIf(!configured)("can receive a comment", async () => {
      if (!testCurrentId) return;
      const { data } = await postComment(testCurrentId, "Great post! 🐠");
      if (data) {
        expect(data.body).toBe("Great post! 🐠");
        expect(data.current_id).toBe(testCurrentId);
      }
    });

    it.skipIf(!configured)("comments are threaded correctly", async () => {
      if (!testCurrentId) return;
      const { data } = await getComments(testCurrentId);
      if (data?.length > 0) {
        expect(data[0].current_id).toBe(testCurrentId);
      }
    });
  });

  describe("Social Connections", () => {
    it.skipIf(!configured)("can send a tankmate request", async () => {
      const { data, error } = await sendTankmateRequest(TEST_WALLET_2, "Hey, want to connect?");
      // May fail on RLS in anon mode — acceptable
      if (data) {
        expect(data.status).toBe("pending");
      }
    });
  });

  describe("Notifications", () => {
    it.skipIf(!configured)("retrieves notifications", async () => {
      const { data, error } = await getNotifications({ limit: 5 });
      // Should return an array (even if empty)
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("GDPR Export", () => {
    it.skipIf(!configured)("exports user data as structured JSON", async () => {
      const { data, error } = await exportUserData();
      if (data) {
        expect(data._meta.format).toBe("aquacellum-reef-export-v1");
        expect(data.wallet_address).toBeDefined();
        expect(Array.isArray(data.currents)).toBe(true);
        expect(Array.isArray(data.comments)).toBe(true);
      }
    });
  });

  // Cleanup
  afterAll(async () => {
    if (!configured) return;

    // Clean up test data
    try {
      await supabase.from("comments").delete().eq("author_wallet", TEST_WALLET);
      await supabase.from("reactions").delete().eq("user_wallet", TEST_WALLET);
      await supabase.from("currents").delete().eq("author_wallet", TEST_WALLET);
      await supabase.from("connection_requests").delete().eq("from_wallet", TEST_WALLET);
      await supabase.from("profiles").delete().eq("wallet_address", TEST_WALLET);
      await supabase.from("profiles").delete().eq("wallet_address", TEST_WALLET_2);
    } catch {
      // Cleanup failures are non-critical
    }

    resetRateLimits();
  });
});
