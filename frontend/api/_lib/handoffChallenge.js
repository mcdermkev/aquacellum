/**
 * handoffChallenge.js — signed one-time handoff challenges (Task 15).
 *
 * Replaces today's forgeable plain-JSON cash-handshake QR payload with a
 * platform-issued, HMAC-signed, single-use, short-lived challenge. This makes
 * the two-party cash/pickup handoff authoritative:
 *
 *   1. The platform ISSUES a signed challenge to the authenticated buyer for a
 *      specific order (issueHandoffChallenge). The buyer's device renders it as
 *      a QR (rendering is local/offline via the existing qrcode dep).
 *   2. At the physical handoff, the buyer shows the QR; the authenticated SELLER
 *      scans and submits it. The platform VERIFIES (verifyHandoffChallenge):
 *      signature (constant-time), not expired, nonce not already used (replay),
 *      and the submitting seller matches the challenge. Buyer possession of a
 *      valid challenge + authenticated seller submission = the two parties.
 *   3. Ownership transfers on that mutual confirmation (cash has no held payment
 *      to release — see MARKETPLACE_STATE_MODEL.md §5.4).
 *
 * Offline: a device without the server secret can still PARSE + structurally
 * check a challenge (parseChallenge / validateStructure) to record a "pending
 * verification" handoff that the platform confirms once back online. It must
 * never show ownership complete from local parsing alone.
 *
 * Server-side (uses Node crypto). The signing secret never leaves the server.
 */

import crypto from "node:crypto";

export const DEFAULT_HANDOFF_TTL_MS = 10 * 60 * 1000; // 10 min — presented in person
export const HANDOFF_TYPES = Object.freeze({ CASH: "cash_handshake", PICKUP: "prepaid_pickup" });

const lc = (v) => (v == null ? v : String(v).toLowerCase());
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url");

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Issue a signed handoff challenge for an order.
 * @returns {{ token:string, payload:Object }}
 */
export function issueHandoffChallenge({
  orderId, buyer, seller, listingId = null, quantity = 1, tokenId = null,
  type = HANDOFF_TYPES.CASH, secret, now = Date.now(), ttlMs = DEFAULT_HANDOFF_TTL_MS, nonce,
}) {
  if (!secret) throw new Error("handoff signing secret required");
  if (!orderId || !buyer || !seller) throw new Error("orderId, buyer, and seller are required");
  const payload = {
    v: 1,
    type,
    orderId: String(orderId),
    buyer: lc(buyer),
    seller: lc(seller),
    listingId: listingId != null ? String(listingId) : null,
    quantity: Math.max(1, Math.round(Number(quantity) || 1)),
    nonce: nonce || crypto.randomUUID(),
    iat: now,
    exp: now + ttlMs,
  };
  // Specimen cash/pickup handoffs carry the explicit on-chain tokenId that the
  // relayer settles (fulfillCashPickup). Added only when provided so existing
  // challenges (no tokenId) serialize byte-identically.
  if (tokenId != null) payload.tokenId = Number(tokenId);
  const payloadB64 = b64url(JSON.stringify(payload));
  return { token: `${payloadB64}.${sign(payloadB64, secret)}`, payload };
}

/**
 * Parse (WITHOUT verifying) a challenge token — for offline display / recording
 * a pending-verification handoff. Returns the payload or null if unparseable.
 */
export function parseChallenge(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  try {
    return JSON.parse(fromB64url(token.split(".")[0]).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Structural + expiry sanity check that needs no secret (offline UX). Never a
 * substitute for verifyHandoffChallenge — a well-formed token can still be
 * forged without the server signature.
 */
export function validateStructure(token, now = Date.now()) {
  const payload = parseChallenge(token);
  if (!payload) return { ok: false, reason: "unparseable" };
  if (!payload.orderId || !payload.buyer || !payload.seller || !payload.nonce) return { ok: false, reason: "missing fields" };
  if (Number(payload.exp) <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload, pendingVerification: true };
}

/**
 * Verify a handoff challenge server-side. All checks must pass.
 *
 * @param {string} token
 * @param {Object} opts
 * @param {string} opts.secret
 * @param {number} [opts.now]
 * @param {(nonce:string)=>(boolean|Promise<boolean>)} [opts.isNonceUsed] - replay guard
 * @param {string} [opts.expectedSeller] - the authenticated seller submitting (two-party)
 * @param {string} [opts.expectedBuyer]
 * @returns {Promise<{ ok:boolean, reason?:string, payload?:Object }>}
 */
export async function verifyHandoffChallenge(token, { secret, now = Date.now(), isNonceUsed, expectedSeller, expectedBuyer } = {}) {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed token" };

  const [payloadB64, sig] = token.split(".");
  const expectedSig = sign(payloadB64, secret);
  // Constant-time comparison; guard against length mismatch (timingSafeEqual throws).
  const a = Buffer.from(sig || "", "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid signature" };
  }

  const payload = parseChallenge(token);
  if (!payload) return { ok: false, reason: "unparseable payload" };
  if (Number(payload.exp) <= now) return { ok: false, reason: "expired" };
  if (expectedSeller && lc(expectedSeller) !== payload.seller) return { ok: false, reason: "seller mismatch" };
  if (expectedBuyer && lc(expectedBuyer) !== payload.buyer) return { ok: false, reason: "buyer mismatch" };
  if (typeof isNonceUsed === "function" && (await isNonceUsed(payload.nonce))) {
    return { ok: false, reason: "replay: challenge already used" };
  }

  return { ok: true, payload };
}
