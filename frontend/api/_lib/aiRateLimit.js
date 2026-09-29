/**
 * aiRateLimit.js — shared (cross-instance) rate limit for the Poseidon endpoints.
 *
 * `rateLimiter.js` keeps its counters in a module-scope Map, so on Vercel each
 * warm instance has its own count and a cold start resets it. The effective
 * ceiling was about N instances x the limit. This module counts in Supabase
 * instead, through `public.ai_rate_hit` (migration 20261003_ai_rate_limit.sql):
 * one atomic upsert on (key, window_start) per request, fixed windows aligned
 * to the epoch so every instance agrees on the bucket.
 *
 * ── Keys ────────────────────────────────────────────────────────────────────
 * Anonymous callers are keyed by IP; a caller with a verified Privy session is
 * keyed by wallet (or the Privy user id when the token has no wallet claim), so
 * people sharing one network (a club meeting, a booth) do not share a budget.
 * Either way the value is HMAC-SHA256 hashed with a server secret before it is
 * stored or used as a memory key. No raw IP or wallet is written anywhere.
 *
 * ── Failure policy ──────────────────────────────────────────────────────────
 *   over the limit                 → blocked (fail closed)
 *   RPC not deployed yet           → in-memory limiter (the old behaviour), so
 *                                    the code can ship before the migration
 *   RPC/network/timeout error      → logged, then the in-memory limiter. That is
 *                                    fail OPEN relative to the shared count: an
 *                                    outage degrades to per-instance limits and
 *                                    does not take chat down.
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './rateLimiter.js';
import { verifyPrivyToken } from './verifyPrivyToken.js';

/** Poseidon chat budget. Anonymous and signed-in callers get the same number today. */
export const POSEIDON_RATE = Object.freeze({ max: 30, windowSeconds: 60 * 60 });

const RPC_TIMEOUT_MS = 1500;
/** After "function does not exist", stop asking for a while. */
const MISSING_RPC_BACKOFF_MS = 5 * 60 * 1000;
/** After an infrastructure error, skip the RPC briefly so an outage does not add latency to every call. */
const ERROR_BACKOFF_MS = 30 * 1000;

let _supabase = null;
let _skipRpcUntil = 0;

function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabase;
}

/** Test hook: reset module state. */
export function __resetAiRateLimitState() {
  _supabase = null;
  _skipRpcUntil = 0;
}

/**
 * Client IP as Vercel reports it. `x-real-ip` and `x-vercel-forwarded-for` are
 * set by Vercel's edge; `x-forwarded-for` is the fallback for other hosts.
 */
export function clientIpFrom(req) {
  const h = req?.headers || {};
  const first = (v) => (typeof v === 'string' ? v.split(',')[0].trim() : '');
  return first(h['x-vercel-forwarded-for'])
    || first(h['x-real-ip'])
    || first(h['x-forwarded-for'])
    || req?.socket?.remoteAddress
    || 'unknown';
}

function hashSecret() {
  return process.env.AI_RATE_LIMIT_SECRET
    || process.env.SUPABASE_JWT_SECRET
    || process.env.SUPABASE_SERVICE_KEY
    || '';
}

/**
 * Hash an identity into a limiter key: `<scope>:<kind>:<hex>`.
 * HMAC with a server secret when one is configured, plain SHA-256 otherwise.
 */
export function hashLimiterKey(scope, kind, value, secret = hashSecret()) {
  const input = `${kind}:${String(value)}`;
  const digest = secret
    ? crypto.createHmac('sha256', secret).update(input).digest('hex')
    : crypto.createHash('sha256').update(input).digest('hex');
  return `${scope}:${kind}:${digest}`;
}

/**
 * Which identity a request is counted against. A verified account wins over IP.
 * Wallets are lower-cased so checksum and lower-case forms share one budget.
 */
export function limiterIdentity({ ip, account }) {
  if (account?.walletAddress) return { kind: 'wallet', value: String(account.walletAddress).toLowerCase() };
  if (account?.userId) return { kind: 'user', value: String(account.userId) };
  return { kind: 'ip', value: ip || 'unknown' };
}

/** PostgREST / Postgres "that function does not exist" (migration not applied yet). */
export function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const msg = String(error.message || '');
  return /could not find the function/i.test(msg) || /function .*ai_rate_hit.* does not exist/i.test(msg);
}

/**
 * Read the RPC's jsonb result. Returns null when it is not the expected shape,
 * which the caller treats as an infrastructure error.
 */
export function interpretRateHit(data, max) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object' || typeof row.allowed !== 'boolean') return null;
  const hits = Number(row.hits);
  const resetIn = Number(row.resetIn);
  if (!Number.isFinite(hits) || !Number.isFinite(resetIn)) return null;
  return {
    allowed: row.allowed,
    remaining: Math.max(0, max - hits),
    resetIn: Math.max(1, Math.ceil(resetIn)),
  };
}

/**
 * Classify an RPC response: `ok` (use its decision), `missing` (not deployed),
 * or `error` (infrastructure problem).
 */
export function classifyRpcResponse({ data, error } = {}, max) {
  if (error) return { kind: isMissingRpcError(error) ? 'missing' : 'error', error };
  const decision = interpretRateHit(data, max);
  if (!decision) return { kind: 'error', error: { message: 'unexpected ai_rate_hit result' } };
  return { kind: 'ok', decision };
}

function memoryHit(key, max, windowSeconds, source) {
  const r = checkRateLimit(key, { maxRequests: max, windowMs: windowSeconds * 1000 });
  return { allowed: r.allowed, remaining: r.remaining, resetIn: r.resetIn, source };
}

async function callRpc(supabase, key, windowSeconds, max) {
  let query = supabase.rpc('ai_rate_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (query && typeof query.abortSignal === 'function' && typeof AbortSignal?.timeout === 'function') {
    query = query.abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: { message: 'ai_rate_hit timed out' } }), RPC_TIMEOUT_MS + 250);
  });
  try {
    return await Promise.race([Promise.resolve(query), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count one request against `key`.
 *
 * @param {{ key: string, max: number, windowSeconds: number, supabase?: object|null, now?: number }} opts
 *   `supabase` defaults to the service-role client; pass null to force memory.
 * @returns {Promise<{ allowed: boolean, remaining: number, resetIn: number, source: 'shared'|'memory'|'fallback' }>}
 */
export async function sharedRateHit({ key, max, windowSeconds, supabase = undefined, now = Date.now() }) {
  const client = supabase === undefined ? getSupabase() : supabase;
  if (!client || now < _skipRpcUntil) return memoryHit(key, max, windowSeconds, 'memory');

  let response;
  try {
    response = await callRpc(client, key, windowSeconds, max);
  } catch (err) {
    response = { data: null, error: { message: err?.message || String(err) } };
  }

  const outcome = classifyRpcResponse(response || {}, max);
  if (outcome.kind === 'ok') return { ...outcome.decision, source: 'shared' };

  if (outcome.kind === 'missing') {
    _skipRpcUntil = now + MISSING_RPC_BACKOFF_MS;
    console.warn('[aiRateLimit] ai_rate_hit is not deployed yet; using the in-memory limiter.');
    return memoryHit(key, max, windowSeconds, 'memory');
  }

  _skipRpcUntil = now + ERROR_BACKOFF_MS;
  console.error('[aiRateLimit] Shared limiter unavailable, failing open to the in-memory limiter:',
    outcome.error?.code || '', outcome.error?.message || outcome.error);
  return memoryHit(key, max, windowSeconds, 'fallback');
}

/**
 * The verified account behind a request, or null. Only looks when a Bearer
 * header is present, so anonymous requests never wait on Privy's JWKS. A bad
 * or expired token is treated as anonymous: chat is public, so it is counted
 * by IP rather than refused.
 */
export async function resolveLimiterAccount(req, verify = verifyPrivyToken) {
  const h = req?.headers || {};
  const auth = h.authorization || h.Authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  try {
    const r = await verify(req);
    if (!r?.verified || !r.userId) return null;
    return { userId: r.userId, walletAddress: r.walletAddress || null };
  } catch {
    return null;
  }
}

/**
 * Count a Poseidon request and set the X-RateLimit-* headers.
 * The caller sends the 429 body, since each endpoint has its own shape.
 */
export async function enforcePoseidonLimit(req, res, scope, rate = POSEIDON_RATE) {
  const account = await resolveLimiterAccount(req);
  const id = limiterIdentity({ ip: clientIpFrom(req), account });
  const key = hashLimiterKey(scope, id.kind, id.value);
  const result = await sharedRateHit({ key, max: rate.max, windowSeconds: rate.windowSeconds });
  res.setHeader('X-RateLimit-Limit', String(rate.max));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(result.resetIn));
  return { ...result, identity: id.kind };
}
