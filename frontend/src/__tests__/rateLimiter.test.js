/**
 * Unit tests for the server-side in-memory sliding window rate limiter.
 * 
 * Run with: npx vitest --run src/__tests__/rateLimiter.test.js
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, getRateLimitCount } from "../../api/_lib/rateLimiter.js";

describe("rateLimiter", () => {
  // Use unique keys per test to avoid cross-test contamination
  // (the store is module-level and persists between tests)
  let keyBase;
  beforeEach(() => {
    keyBase = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  describe("checkRateLimit", () => {
    it("allows first request for a new key", () => {
      const key = `${keyBase}:first`;
      const result = checkRateLimit(key, { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 max - 1 used = 4 remaining
      expect(result.total).toBe(5);
    });

    it("decrements remaining with each request", () => {
      const key = `${keyBase}:decrement`;
      checkRateLimit(key, { maxRequests: 3, windowMs: 60000 });
      const result = checkRateLimit(key, { maxRequests: 3, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 3 max - 2 used = 1
    });

    it("blocks when max requests reached", () => {
      const key = `${keyBase}:block`;
      const opts = { maxRequests: 3, windowMs: 60000 };
      checkRateLimit(key, opts); // 1
      checkRateLimit(key, opts); // 2
      checkRateLimit(key, opts); // 3
      const result = checkRateLimit(key, opts); // 4 — should be blocked
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetIn).toBeGreaterThan(0);
    });

    it("uses default options when none provided", () => {
      const key = `${keyBase}:defaults`;
      const result = checkRateLimit(key);
      expect(result.allowed).toBe(true);
      expect(result.total).toBe(50); // default maxRequests
    });

    it("expires old requests outside the window", async () => {
      const key = `${keyBase}:expire`;
      const opts = { maxRequests: 2, windowMs: 50 }; // 50ms window
      checkRateLimit(key, opts); // 1
      checkRateLimit(key, opts); // 2

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = checkRateLimit(key, opts);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // old ones expired
    });

    it("returns resetIn in seconds when blocked", () => {
      const key = `${keyBase}:resetIn`;
      const opts = { maxRequests: 1, windowMs: 60000 };
      checkRateLimit(key, opts); // fills the limit
      const result = checkRateLimit(key, opts); // blocked
      expect(result.allowed).toBe(false);
      expect(result.resetIn).toBeGreaterThan(0);
      expect(result.resetIn).toBeLessThanOrEqual(60); // within 60s window
    });
  });

  describe("getRateLimitCount", () => {
    it("returns 0 for unknown key", () => {
      const count = getRateLimitCount(`${keyBase}:unknown`);
      expect(count).toBe(0);
    });

    it("returns current count without incrementing", () => {
      const key = `${keyBase}:countCheck`;
      checkRateLimit(key, { maxRequests: 10, windowMs: 60000 });
      checkRateLimit(key, { maxRequests: 10, windowMs: 60000 });

      const count = getRateLimitCount(key, { windowMs: 60000 });
      expect(count).toBe(2);

      // Calling again shouldn't change it
      const count2 = getRateLimitCount(key, { windowMs: 60000 });
      expect(count2).toBe(2);
    });
  });
});
