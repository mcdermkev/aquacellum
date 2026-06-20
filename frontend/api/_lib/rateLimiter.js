/**
 * rateLimiter.js — In-memory sliding window rate limiter for Vercel serverless
 *
 * Provides per-key rate limiting using a sliding window counter stored in
 * module-level memory. On Vercel, serverless function instances stay warm
 * for several minutes, so this catches burst abuse within warm windows.
 *
 * For production, consider upgrading to Vercel KV (Redis) for cross-instance
 * state. For beta with a small user base, in-memory is sufficient.
 *
 * Usage:
 *   import { checkRateLimit } from './_lib/rateLimiter.js';
 *   const { allowed, remaining, resetIn } = checkRateLimit(userId, { maxRequests: 50, windowMs: 3600000 });
 */

// Map<key, { timestamps: number[] }>
const store = new Map();

// Cleanup interval: every 5 minutes, remove expired entries
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

/**
 * Check if a request is within the rate limit for the given key.
 *
 * @param {string} key - Unique identifier (userId, walletAddress, IP, etc.)
 * @param {{ maxRequests?: number, windowMs?: number }} options
 * @returns {{ allowed: boolean, remaining: number, resetIn: number, total: number }}
 */
export function checkRateLimit(key, options = {}) {
  const maxRequests = options.maxRequests || 50;
  const windowMs = options.windowMs || 60 * 60 * 1000; // 1 hour default

  const now = Date.now();
  const cutoff = now - windowMs;

  // Periodic cleanup
  cleanup(windowMs);

  // Get or create entry
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  const currentCount = entry.timestamps.length;

  if (currentCount >= maxRequests) {
    // Rate limited — calculate when the oldest request in the window expires
    const oldestInWindow = entry.timestamps[0];
    const resetIn = Math.ceil((oldestInWindow + windowMs - now) / 1000); // seconds

    return {
      allowed: false,
      remaining: 0,
      resetIn,
      total: maxRequests,
    };
  }

  // Allow the request — record it
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetIn: Math.ceil(windowMs / 1000),
    total: maxRequests,
  };
}

/**
 * Get the current count for a key without incrementing.
 * Useful for health checks and monitoring.
 *
 * @param {string} key
 * @param {{ windowMs?: number }} options
 * @returns {number}
 */
export function getRateLimitCount(key, options = {}) {
  const windowMs = options.windowMs || 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const entry = store.get(key);
  if (!entry) return 0;

  return entry.timestamps.filter(t => t > cutoff).length;
}
