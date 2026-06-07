/**
 * rateLimiter.js
 * 
 * Client-side rate limiting for social actions.
 * Enforces per-action throttles before hitting Supabase.
 * Server-side enforcement happens via RLS + Edge Functions;
 * this provides instant UX feedback without waiting for a 429.
 * 
 * Limits:
 * - Content creation: 10 posts/hour
 * - Comments: 50/hour
 * - Reactions: 100/hour
 * - Audit requests: 3/day
 * - School creation: 1/day
 * - Poseidon queries: 20/hour
 */

const LIMITS = {
  post: { max: 10, windowMs: 60 * 60 * 1000, label: "posts" },
  comment: { max: 50, windowMs: 60 * 60 * 1000, label: "comments" },
  reaction: { max: 100, windowMs: 60 * 60 * 1000, label: "reactions" },
  audit_request: { max: 3, windowMs: 24 * 60 * 60 * 1000, label: "audit requests" },
  school_create: { max: 1, windowMs: 24 * 60 * 60 * 1000, label: "school creations" },
  poseidon: { max: 20, windowMs: 60 * 60 * 1000, label: "Poseidon queries" },
  tide_chat: { max: 60, windowMs: 60 * 60 * 1000, label: "chat messages" },
};

const STORAGE_KEY = "aquacellum_rate_limits";

/**
 * Get stored action timestamps from localStorage.
 */
function getStore() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save action timestamps to localStorage.
 */
function setStore(store) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable — fail open
  }
}

/**
 * Prune expired timestamps for a given action.
 */
function pruneExpired(timestamps, windowMs) {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

/**
 * Check if an action is allowed under its rate limit.
 * Returns { allowed: boolean, remaining: number, retryAfterMs: number | null }
 */
export function checkRateLimit(action) {
  const config = LIMITS[action];
  if (!config) return { allowed: true, remaining: Infinity, retryAfterMs: null };

  const store = getStore();
  const timestamps = pruneExpired(store[action] || [], config.windowMs);

  if (timestamps.length >= config.max) {
    // Calculate when the oldest relevant action expires
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + config.windowMs - Date.now();
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
      message: `Rate limit reached: ${config.max} ${config.label} per ${config.windowMs >= 86400000 ? "day" : "hour"}. Try again in ${formatRetry(retryAfterMs)}.`,
    };
  }

  return {
    allowed: true,
    remaining: config.max - timestamps.length,
    retryAfterMs: null,
  };
}

/**
 * Record an action (call after successful execution).
 */
export function recordAction(action) {
  const config = LIMITS[action];
  if (!config) return;

  const store = getStore();
  const timestamps = pruneExpired(store[action] || [], config.windowMs);
  timestamps.push(Date.now());
  store[action] = timestamps;
  setStore(store);
}

/**
 * Get current usage stats for all actions.
 */
export function getRateLimitStats() {
  const store = getStore();
  const stats = {};

  for (const [action, config] of Object.entries(LIMITS)) {
    const timestamps = pruneExpired(store[action] || [], config.windowMs);
    stats[action] = {
      used: timestamps.length,
      max: config.max,
      remaining: config.max - timestamps.length,
      label: config.label,
      window: config.windowMs >= 86400000 ? "day" : "hour",
    };
  }

  return stats;
}

/**
 * Reset rate limits (for testing or admin override).
 */
export function resetRateLimits() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Unavailable in test environment
  }
}

/**
 * Format retry-after time into a human-readable string.
 */
function formatRetry(ms) {
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

/**
 * Higher-order function that wraps an async action with rate limiting.
 * Returns { data, error } — if rate limited, returns error with message.
 */
export function withRateLimit(action, fn) {
  return async (...args) => {
    const check = checkRateLimit(action);
    if (!check.allowed) {
      return { data: null, error: check.message };
    }

    const result = await fn(...args);

    // Only record if the action succeeded (no error)
    if (!result.error) {
      recordAction(action);
    }

    return result;
  };
}
