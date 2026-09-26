/**
 * verifyPrivyToken.js — Shared Privy JWT verification for Vercel API routes.
 *
 * The server-side `PRIVY_APP_ID` is the trust root for both the JWKS location
 * and JWT audience. Browser variables and literals are deliberately excluded.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const PRIVY_APP_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

let cachedJwks = null;
let cachedJwksAppId = null;

function failure(code, error) {
  return { verified: false, code, error };
}

/**
 * Read and validate the server-only Privy configuration.
 *
 * @returns {{configured: true, appId: string} | {configured: false, code: string, error: string}}
 */
export function getPrivyAuthConfiguration() {
  const appId = process.env.PRIVY_APP_ID?.trim() || "";

  if (!appId) {
    return {
      configured: false,
      code: "PRIVY_APP_ID_MISSING",
      error: "Authentication service is not configured",
    };
  }

  if (!PRIVY_APP_ID_PATTERN.test(appId)) {
    return {
      configured: false,
      code: "PRIVY_APP_ID_INVALID",
      error: "Authentication service is not configured",
    };
  }

  return { configured: true, appId };
}

export function isPrivyConfigurationFailure(result) {
  return result?.code === "PRIVY_APP_ID_MISSING"
    || result?.code === "PRIVY_APP_ID_INVALID";
}

/**
 * Send the one generic HTTP response used when the Privy trust root is absent.
 * Returns true when it handled the response so callers can return immediately.
 */
export function respondToPrivyConfigurationFailure(result, res) {
  if (!isPrivyConfigurationFailure(result)) return false;
  res.status(503).json({ error: "Authentication service unavailable" });
  return true;
}

function getJWKS(appId) {
  if (!cachedJwks || cachedJwksAppId !== appId) {
    const url = new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
    cachedJwks = createRemoteJWKSet(url);
    cachedJwksAppId = appId;
  }
  return cachedJwks;
}

/**
 * Extract and verify the Privy access token from the request.
 *
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<{
 *   verified: boolean,
 *   userId?: string,
 *   walletAddress?: string | null,
 *   code?: string,
 *   error?: string
 * }>}
 */
export async function verifyPrivyToken(req) {
  const config = getPrivyAuthConfiguration();
  if (!config.configured) {
    return failure(config.code, config.error);
  }

  const headers = req?.headers || {};
  const authHeader = headers.authorization || headers.Authorization;

  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return failure("AUTH_HEADER_INVALID", "Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    return failure("TOKEN_MALFORMED", "Empty or malformed token");
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(config.appId), {
      issuer: "privy.io",
      audience: config.appId,
    });

    if (typeof payload.sub !== "string" || !payload.sub.trim()) {
      return failure("TOKEN_SUB_MISSING", "Token missing user identifier");
    }

    const walletAddress = typeof payload.wallet_address === "string"
      ? payload.wallet_address
      : null;

    return {
      verified: true,
      userId: payload.sub,
      walletAddress,
    };
  } catch (err) {
    const verifierCode = typeof err?.code === "string" ? err.code : "TOKEN_INVALID";
    console.warn("[Auth] Privy token verification failed:", verifierCode);

    if (verifierCode === "ERR_JWT_EXPIRED") {
      return failure("TOKEN_EXPIRED", "Token expired — please re-authenticate");
    }

    if (verifierCode === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      return failure("TOKEN_SIGNATURE_INVALID", "Invalid token signature");
    }

    return failure("TOKEN_INVALID", "Token verification failed");
  }
}
