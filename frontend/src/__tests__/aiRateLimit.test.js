// @vitest-environment node
/**
 * aiRateLimit.test.js — the shared Poseidon limiter (api/_lib/aiRateLimit.js).
 *
 * The old limiter was an in-memory Map per warm instance, so the real ceiling
 * was N instances x 30/hour. What matters here is the POLICY:
 *   - keys never contain a raw IP or wallet,
 *   - a verified account is counted by account, everyone else by IP,
 *   - over the limit is refused (fail closed),
 *   - a missing RPC (migration not applied) or a limiter outage falls back to
 *     the in-memory limiter instead of taking chat down (fail open).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  POSEIDON_RATE,
  clientIpFrom,
  hashLimiterKey,
  limiterIdentity,
  isMissingRpcError,
  interpretRateHit,
  classifyRpcResponse,
  sharedRateHit,
  resolveLimiterAccount,
  __resetAiRateLimitState,
} from "../../api/_lib/aiRateLimit.js";

let seq = 0;
const freshKey = () => `test:${Date.now()}:${seq++}`;
const rpcReturning = (response) => ({ rpc: vi.fn(async () => response) });

beforeEach(() => {
  __resetAiRateLimitState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("keys", () => {
  it("hashes the identity so no raw IP or wallet is stored", () => {
    const key = hashLimiterKey("poseidon", "ip", "203.0.113.7", "secret");
    expect(key).toMatch(/^poseidon:ip:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    // Deterministic, so every instance agrees on the bucket.
    expect(hashLimiterKey("poseidon", "ip", "203.0.113.7", "secret")).toBe(key);
    // The secret matters: a different one gives a different key.
    expect(hashLimiterKey("poseidon", "ip", "203.0.113.7", "other")).not.toBe(key);
    // Still hashed with no secret configured.
    expect(hashLimiterKey("poseidon", "ip", "203.0.113.7", "")).toMatch(/^poseidon:ip:[0-9a-f]{64}$/);
  });

  it("keeps scopes apart", () => {
    expect(hashLimiterKey("poseidon", "ip", "1.1.1.1", "s")).not.toBe(hashLimiterKey("poseidon-listing-desc", "ip", "1.1.1.1", "s"));
  });

  it("counts a verified account by wallet, then by user id, else by IP", () => {
    expect(limiterIdentity({ ip: "1.1.1.1", account: { walletAddress: "0xAbC", userId: "did:privy:1" } }))
      .toEqual({ kind: "wallet", value: "0xabc" });
    expect(limiterIdentity({ ip: "1.1.1.1", account: { walletAddress: null, userId: "did:privy:1" } }))
      .toEqual({ kind: "user", value: "did:privy:1" });
    expect(limiterIdentity({ ip: "1.1.1.1", account: null })).toEqual({ kind: "ip", value: "1.1.1.1" });
  });

  it("reads the client IP from Vercel's headers first", () => {
    expect(clientIpFrom({ headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })).toBe("9.9.9.9");
    expect(clientIpFrom({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })).toBe("1.2.3.4");
    expect(clientIpFrom({ headers: {}, socket: { remoteAddress: "::1" } })).toBe("::1");
    expect(clientIpFrom({ headers: {} })).toBe("unknown");
  });
});

describe("RPC result handling", () => {
  it("reads the jsonb decision", () => {
    expect(interpretRateHit({ allowed: true, hits: 3, limit: 30, resetIn: 120 }, 30))
      .toEqual({ allowed: true, remaining: 27, resetIn: 120 });
    expect(interpretRateHit({ allowed: false, hits: 31, limit: 30, resetIn: 5 }, 30))
      .toEqual({ allowed: false, remaining: 0, resetIn: 5 });
    expect(interpretRateHit(null, 30)).toBeNull();
    expect(interpretRateHit({ hits: 1 }, 30)).toBeNull();
  });

  it("recognises 'function not deployed yet'", () => {
    expect(isMissingRpcError({ code: "PGRST202", message: "Could not find the function public.ai_rate_hit" })).toBe(true);
    expect(isMissingRpcError({ code: "42883" })).toBe(true);
    expect(isMissingRpcError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });

  it("classifies ok / missing / error", () => {
    expect(classifyRpcResponse({ data: { allowed: true, hits: 1, resetIn: 10 } }, 30).kind).toBe("ok");
    expect(classifyRpcResponse({ error: { code: "PGRST202" } }, 30).kind).toBe("missing");
    expect(classifyRpcResponse({ error: { message: "fetch failed" } }, 30).kind).toBe("error");
    expect(classifyRpcResponse({ data: "garbage" }, 30).kind).toBe("error");
  });
});

describe("sharedRateHit decisions", () => {
  const opts = { max: 2, windowSeconds: 3600 };

  it("uses the shared count and fails CLOSED when over the limit", async () => {
    const supabase = rpcReturning({ data: { allowed: false, hits: 3, limit: 2, resetIn: 900 }, error: null });
    const r = await sharedRateHit({ key: freshKey(), ...opts, supabase });
    expect(r).toEqual({ allowed: false, remaining: 0, resetIn: 900, source: "shared" });
    expect(supabase.rpc).toHaveBeenCalledWith("ai_rate_hit", expect.objectContaining({ p_window_seconds: 3600, p_max: 2 }));
  });

  it("allows under the limit", async () => {
    const supabase = rpcReturning({ data: { allowed: true, hits: 1, limit: 2, resetIn: 900 }, error: null });
    const r = await sharedRateHit({ key: freshKey(), ...opts, supabase });
    expect(r).toMatchObject({ allowed: true, remaining: 1, source: "shared" });
  });

  it("falls back to memory when the RPC is not deployed, and stops asking for a while", async () => {
    const supabase = rpcReturning({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const key = freshKey();
    const a = await sharedRateHit({ key, ...opts, supabase });
    const b = await sharedRateHit({ key, ...opts, supabase });
    const c = await sharedRateHit({ key, ...opts, supabase });
    expect(a).toMatchObject({ allowed: true, source: "memory" });
    expect(b).toMatchObject({ allowed: true, source: "memory" });
    // The in-memory brake still applies.
    expect(c).toMatchObject({ allowed: false, source: "memory" });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN (to the in-memory limiter) on an infrastructure error, and logs it", async () => {
    const supabase = { rpc: vi.fn(async () => { throw new Error("ECONNRESET"); }) };
    const r = await sharedRateHit({ key: freshKey(), ...opts, supabase });
    expect(r).toMatchObject({ allowed: true, source: "fallback" });
    expect(console.error).toHaveBeenCalled();
  });

  it("treats an error response the same way", async () => {
    const supabase = rpcReturning({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const r = await sharedRateHit({ key: freshKey(), ...opts, supabase });
    expect(r).toMatchObject({ allowed: true, source: "fallback" });
  });

  it("uses memory when Supabase is not configured", async () => {
    const r = await sharedRateHit({ key: freshKey(), ...opts, supabase: null });
    expect(r).toMatchObject({ allowed: true, source: "memory" });
  });

  it("keeps the anonymous budget at 30 per hour", () => {
    expect(POSEIDON_RATE).toEqual({ max: 30, windowSeconds: 3600 });
  });
});

describe("resolveLimiterAccount", () => {
  it("does not call the verifier without a bearer header", async () => {
    const verify = vi.fn();
    expect(await resolveLimiterAccount({ headers: {} }, verify)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns the verified account, and treats a bad token as anonymous", async () => {
    const req = { headers: { authorization: "Bearer abc.def.ghi" } };
    expect(await resolveLimiterAccount(req, async () => ({ verified: true, userId: "did:privy:1", walletAddress: "0x1" })))
      .toEqual({ userId: "did:privy:1", walletAddress: "0x1" });
    expect(await resolveLimiterAccount(req, async () => ({ verified: false }))).toBeNull();
    expect(await resolveLimiterAccount(req, async () => { throw new Error("jwks down"); })).toBeNull();
  });
});
