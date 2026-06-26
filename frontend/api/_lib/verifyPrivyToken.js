/**
 * verifyPrivyToken.js — Shared Privy JWT verification for Vercel API routes
 * 
 * Verifies the Privy access token from the Authorization header.
 * Uses the jose library to validate against Privy's JWKS endpoint.
 * 
 * Usage in an API route:
 *   import { verifyPrivyToken } from './_lib/verifyPrivyToken.js';
 *   const { verified, userId, walletAddress, error } = await verifyPrivyToken(req);
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const PRIVY_APP_ID = process.env.VITE_PRIVY_APP_ID || process.env.PRIVY_APP_ID || "cmprm8kqd000l0cl54w0e9jn3";

// JWKS endpoint for verifying Privy-issued tokens.
// NOTE: Privy serves the key set at `/apps/<app-id>/jwks.json`. The `.well-known`
// variant returns 404, which makes jose throw "Expected 200 OK from the JSON Web
// Key Set HTTP response" and breaks every authenticated API route (mint-session,
// relay-transaction, validate-xp) — cascading into Supabase RLS/406 failures.
const PRIVY_JWKS_URL = `https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`;

// Cache the JWKS keyset (jose handles refresh internally)
let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(PRIVY_JWKS_URL));
  }
  return _jwks;
}

/**
 * Extract and verify the Privy access token from the request.
 * 
 * Expects: Authorization: Bearer <privy-access-token>
 * 
 * @param {import('http').IncomingMessage} req 
 * @returns {Promise<{verified: boolean, userId?: string, walletAddress?: string, error?: string}>}
 */
export async function verifyPrivyToken(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { verified: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!token || token.length < 10) {
    return { verified: false, error: "Empty or malformed token" };
  }

  try {
    const jwks = getJWKS();

    const { payload } = await jwtVerify(token, jwks, {
      issuer: "privy.io",
      audience: PRIVY_APP_ID,
    });

    // Privy tokens include the user's DID as `sub` and wallet info in custom claims
    const userId = payload.sub || null;

    // Extract wallet address from Privy token claims if available
    // Privy stores linked accounts in the token; the wallet address may be
    // in payload.wallet_address or payload.linked_accounts
    const walletAddress = payload.wallet_address || null;

    if (!userId) {
      return { verified: false, error: "Token missing user identifier (sub claim)" };
    }

    return { verified: true, userId, walletAddress };
  } catch (err) {
    // Common failures: expired token, invalid signature, wrong issuer/audience
    const message = err.code === "ERR_JWT_EXPIRED"
      ? "Token expired — please re-authenticate"
      : err.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"
      ? "Invalid token signature"
      : `Token verification failed: ${err.message}`;

    console.warn("[Auth] Privy token verification failed:", err.code || err.message);
    return { verified: false, error: message };
  }
}
