/**
 * Vercel Serverless Function: /api/mint-session
 *
 * Verifies a Privy access token, then mints a short-lived Supabase-compatible
 * JWT carrying the wallet claim that Privy signed. A request-body wallet is an
 * optional mismatch assertion only; it never selects the JWT identity.
 *
 * Required server environment:
 *   - PRIVY_APP_ID
 *   - SUPABASE_JWT_SECRET
 */

import { SignJWT } from "jose";
import {
  getPrivyAuthConfiguration,
  verifyPrivyToken,
} from "./_lib/verifyPrivyToken.js";
import { handleCorsPreFlight } from "./_lib/cors.js";

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";
const TOKEN_LIFETIME_SECONDS = 3600;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function isValidWalletAddress(value) {
  return typeof value === "string" && EVM_ADDRESS_PATTERN.test(value);
}

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, {
    methods: "POST, OPTIONS",
    headers: "Content-Type, Authorization",
  })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const privyConfig = getPrivyAuthConfiguration();
  if (!privyConfig.configured) {
    console.error("[mint-session] Privy server configuration unavailable:", privyConfig.code);
    return res.status(503).json({ error: "Auth bridge not configured" });
  }

  if (!SUPABASE_JWT_SECRET) {
    console.error("[mint-session] SUPABASE_JWT_SECRET not set in environment");
    return res.status(503).json({ error: "Auth bridge not configured" });
  }

  const authResult = await verifyPrivyToken(req);
  if (!authResult.verified) {
    if (authResult.code === "PRIVY_APP_ID_MISSING" || authResult.code === "PRIVY_APP_ID_INVALID") {
      return res.status(503).json({ error: "Auth bridge not configured" });
    }
    return res.status(401).json({ error: authResult.error || "Authentication failed" });
  }

  const { userId, walletAddress: tokenWallet } = authResult;
  if (!isValidWalletAddress(tokenWallet)) {
    return res.status(401).json({ error: "Session has no verified linked wallet address" });
  }

  const walletAddress = tokenWallet.toLowerCase();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const hasBodyWallet = Object.prototype.hasOwnProperty.call(body, "walletAddress");

  if (hasBodyWallet) {
    if (!isValidWalletAddress(body.walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address assertion" });
    }
    if (body.walletAddress.toLowerCase() !== walletAddress) {
      return res.status(403).json({ error: "Wallet address does not match authenticated session" });
    }
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_LIFETIME_SECONDS;
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const accessToken = await new SignJWT({
      role: "authenticated",
      iss: "supabase",
      sub: userId,
      aud: "authenticated",
      wallet_address: walletAddress,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(secret);

    return res.status(200).json({
      access_token: accessToken,
      token_type: "bearer",
      expires_at: expiresAt,
      expires_in: TOKEN_LIFETIME_SECONDS,
      wallet_address: walletAddress,
      user_id: userId,
    });
  } catch (err) {
    console.error("[mint-session] JWT signing failed:", err?.code || err?.name || "unknown");
    return res.status(500).json({ error: "Failed to mint session token" });
  }
}
