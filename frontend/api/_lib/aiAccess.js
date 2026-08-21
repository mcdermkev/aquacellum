/**
 * aiAccess.js — the preconditions for spending money on an AI call.
 *
 * Every handler in `api/ai.js` reaches a paid Google model. Two of them accept an
 * IMAGE, which costs materially more per call than text. This module is the gate
 * in front of that spend.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The only control on `api/ai.js` was `checkRateLimit` keyed on the client IP, and
 * `?action=alt-text` had not even that. An IP key is weak twice over: it is taken
 * from `x-forwarded-for`, which the client influences, and the counter lives in a
 * module-scope Map, so it is per-warm-instance. Vercel runs N concurrent
 * instances and resets on cold start, which means the effective ceiling is
 * roughly N × the limit and it RISES under load — exactly backwards for a spend
 * cap. `rateLimiter.js` says as much in its own header.
 *
 * So the primary control here is identity, not counting: a caller must present a
 * Privy token that verifies against Privy's JWKS. That cannot be forged without
 * an account, which turns "spend my Google budget" from an anonymous act into an
 * attributable one. The counter is a secondary brake on top.
 *
 * ── Keyed on userId, deliberately not on wallet ──────────────────────────────
 * `verifyPrivyToken` returns `walletAddress` from the `wallet_address` claim,
 * which is frequently NULL — Privy logins via email or Google mint an embedded
 * wallet that is not necessarily in the token. `_lib/speciesCuration.js` demands a
 * verified wallet and 401s without one, which is right for a curation vote that
 * gets attributed on-chain, but wrong here: it would lock out ordinary signed-in
 * users from a feature that has nothing to do with wallets.
 *
 * `userId` is the Privy DID from the `sub` claim. It is always present on a
 * verified token, and it is the honest answer to "is this a connected account".
 *
 * NEVER fall back to an identity supplied in the request body. That is the
 * weakness `speciesCuration.js` documents in `api/mint-session.js`
 * (`tokenWallet || bodyWallet`) and refuses to inherit; a body-supplied user id
 * would make this gate decorative.
 */

import { verifyPrivyToken } from './verifyPrivyToken.js';
import { checkRateLimit } from './rateLimiter.js';

/**
 * Require a verified, signed-in account.
 *
 * Sends 401 and returns null when the caller is anonymous or the token is bad.
 * A real status code is deliberate: the house style in `api/ai.js` is to return
 * 200 with a friendly `error` field so a failed AI call degrades quietly, but an
 * auth failure is not a degraded answer. The client has to be able to tell "you
 * are not signed in" from "the model was slow", or it will retry forever and show
 * a fallback string instead of a sign-in prompt.
 *
 * @returns {Promise<{userId: string, walletAddress: string|null}|null>}
 */
export async function requireAccount(req, res) {
  const { verified, userId, walletAddress, error } = await verifyPrivyToken(req);

  if (!verified || !userId) {
    res.status(401).json({
      error: error || 'Authentication required',
      needsAuth: true, // lets the client show a sign-in prompt rather than a retry
    });
    return null;
  }

  return { userId, walletAddress: walletAddress || null };
}

/**
 * Per-account quota for a paid AI action.
 *
 * Keyed on the verified `userId`, so it survives an IP change and cannot be reset
 * by rotating through a proxy pool. Sets the usual `X-RateLimit-*` headers to
 * match the existing handlers.
 *
 * HONEST LIMITATION: the underlying store is the in-memory Map in
 * `rateLimiter.js`, so this is per-warm-instance, not global. It is a brake on a
 * single caller hammering one instance, NOT a hard budget ceiling. A real ceiling
 * needs a shared counter — Vercel KV, or a Supabase table, since Supabase is
 * already configured here. Until then, the auth gate is what actually protects
 * the budget, and Google-side quotas remain the backstop.
 *
 * @returns {boolean} true when the request may proceed (429 already sent if not)
 */
export function enforceAccountQuota(res, { userId, action, maxPerDay }) {
  const { allowed, remaining, resetIn } = checkRateLimit(`ai:${action}:${userId}`, {
    maxRequests: maxPerDay,
    windowMs: 24 * 60 * 60 * 1000,
  });

  res.setHeader('X-RateLimit-Limit', String(maxPerDay));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetIn));

  if (!allowed) {
    const hours = Math.max(1, Math.ceil(resetIn / 3600));
    res.status(429).json({
      error: `Daily limit of ${maxPerDay} reached for this feature. Try again in about ${hours}h.`,
      rateLimited: true,
    });
    return false;
  }

  return true;
}

/**
 * Per-day caps. Vision calls cost more than text, so these are deliberately low
 * enough that one account cannot run up a bill worth noticing, and high enough
 * that no honest user meets them.
 */
export const AI_QUOTAS = Object.freeze({
  // One call per photo uploaded to The Reef. A busy day of posting is well inside.
  ALT_TEXT_PER_DAY: 60,
  // A deliberate "what is this fish" action, not something that fires on its own.
  IDENTIFY_PER_DAY: 25,
});
