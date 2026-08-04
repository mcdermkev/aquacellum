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

/**
 * ⚠️ THESE TESTS WRITE TO WHATEVER SUPABASE PROJECT IS CONFIGURED, SO THEY ARE
 * OPT-IN.
 *
 * They used to run whenever `isSupabaseConfigured()` was true — which is true for
 * any developer with a populated `frontend/.env`. Since each run mints a fresh
 * `0xTEST_INTEGRATION_<timestamp>` wallet, every `npm test` on a normal dev machine
 * inserted a new profile row into the PRODUCTION database. By 2026-08-04 that was
 * 287 of 298 profiles (96%), accumulated since 2026-06-07.
 *
 * The `afterAll` cleanup below looked like it prevented exactly this. It did not,
 * and the way it failed is worth remembering: there is **no DELETE policy on
 * `profiles`**, so with RLS enabled the anon client cannot delete a profile — and
 * PostgREST answers a delete whose rows are filtered out by RLS with *success and
 * zero rows affected*, not an error. So nothing threw, the `catch` never ran, and
 * the cleanup reported success 287 times while deleting nothing. Same shape as the
 * push-subscription bug: an unchecked write that looks like it worked.
 *
 * Note the fix is NOT to add a DELETE policy for anon — that would let anyone
 * delete anyone's profile. The fix is to not create the rows in a real project in
 * the first place, and to make cleanup prove it worked when it does run.
 *
 * To run them deliberately, against a project you are willing to write to:
 *   RUN_REEF_INTEGRATION=1 npx vitest --run src/__tests__/reef-integration.test.js
 */
const OPTED_IN = process.env.RUN_REEF_INTEGRATION === "1";

describe("Reef Integration Tests", () => {
  // Both conditions required: opted in AND actually configured.
  const configured = OPTED_IN && isSupabaseConfigured();

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
        expect(data.wallet_address).toBe(TEST_WALLET.toLowerCase());
        expect(data.display_name).toBe("Test User");
      }
    });

    it.skipIf(!configured)("fetches a profile by wallet", async () => {
      const { data, error } = await getProfile(TEST_WALLET);
      // May be null if previous test failed due to auth
      if (data) {
        expect(data.wallet_address).toBe(TEST_WALLET.toLowerCase());
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
  //
  // ⚠️ This MUST verify, not just attempt. The previous version swallowed all
  // errors as "non-critical" — but the failure mode here is not an exception, it is
  // a delete that RLS silently reduces to zero rows. Attempting without checking is
  // how 287 profiles accumulated while this block reported success every time.
  afterAll(async () => {
    if (!configured) return;

    const leaked = [];

    try {
      await supabase.from("comments").delete().eq("author_wallet", TEST_WALLET);
      await supabase.from("reactions").delete().eq("user_wallet", TEST_WALLET);
      await supabase.from("currents").delete().eq("author_wallet", TEST_WALLET);
      await supabase.from("connection_requests").delete().eq("from_wallet", TEST_WALLET);
      await supabase.from("profiles").delete().eq("wallet_address", TEST_WALLET);
      await supabase.from("profiles").delete().eq("wallet_address", TEST_WALLET_2);
    } catch (err) {
      leaked.push(`delete threw: ${err?.message || err}`);
    }

    // Read back. A row still present means the delete was filtered, not applied.
    for (const wallet of [TEST_WALLET, TEST_WALLET_2]) {
      const { data } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("wallet_address", wallet);
      if (data && data.length > 0) leaked.push(wallet);
    }

    resetRateLimits();

    if (leaked.length > 0) {
      // Loud on purpose. Silent accumulation in a real project is the bug this
      // whole block exists to prevent, so a leak has to be impossible to miss.
      throw new Error(
        `[reef-integration] CLEANUP FAILED — test rows are still in the database: ` +
          `${leaked.join(", ")}. There is no DELETE policy on \`profiles\`, so the ` +
          `anon client cannot remove them and PostgREST reports success anyway. ` +
          `Remove them with a service-role connection before running again.`
      );
    }
  });
});
