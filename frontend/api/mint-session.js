/**
 * Vercel Serverless Function: /api/mint-session
 *
 * JWT Bridge: Privy Access Token → Supabase-compatible JWT
 *
 * Flow:
 *   1. Client sends Privy access token + wallet address in the request
 *   2. Server verifies the Privy token against Privy's JWKS endpoint
 *   3. Server mints a Supabase-compatible JWT signed with SUPABASE_JWT_SECRET
 *      that includes: { role: "authenticated", wallet_address, sub (Privy userId) }
 *   4. Client attaches this JWT as the Authorization header on Supabase REST
 *      requests for real RLS. It deliberately does NOT go through
 *      supabase.auth.setSession(): GoTrue requires `sub` to be a UUID that
 *      exists in auth.users, and these are wallet-identified users minted from
 *      a Privy DID with no auth.users row. Verified against production —
 *      a DID sub gives 400 bad_jwt, and a synthetic UUID sub gives
 *      403 user_not_found. PostgREST validates only the signature and reads
 *      `role` / `wallet_address` from the claims, so it accepts either.
 *      See _mintedToken in src/services/supabaseClient.js.
 *
 * The minted JWT satisfies Supabase's RLS policies that check:
 *   auth.jwt()->>'wallet_address'
 *
 * POST body: { walletAddress: string }
 * Headers: Authorization: Bearer <privy-access-token>
 * Returns: { access_token: string, expires_at: number } | { error: string }
 *
 * Requires env vars:
 *   - SUPABASE_JWT_SECRET (from Supabase Dashboard → Settings → API → JWT Secret)
 *   - VITE_PRIVY_APP_ID or PRIVY_APP_ID
 */

import { SignJWT } from "jose";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";
import { handleCorsPreFlight } from "./_lib/cors.js";

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";

// Extract the Supabase project ref from the URL for the `iss` claim
// e.g. "https://yahsdztnvsykzecjatsl.supabase.co" → "yahsdztnvsykzecjatsl"
function getSupabaseRef() {
  try {
    const url = new URL(SUPABASE_URL);
    return url.hostname.split(".")[0];
  } catch {
    return "supabase";
  }
}

// Token lifetime: 1 hour (matches Supabase's default)
const TOKEN_LIFETIME_SECONDS = 3600;

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Validate server config ───────────────────────────────────────────────
  if (!SUPABASE_JWT_SECRET) {
    console.error("[mint-session] SUPABASE_JWT_SECRET not set in environment");
    return res.status(503).json({ error: "Auth bridge not configured (missing JWT secret)" });
  }

  // ── Verify Privy token ───────────────────────────────────────────────────
  const { verified, userId, walletAddress: tokenWallet, error: authError } = await verifyPrivyToken(req);

  if (!verified) {
    return res.status(401).json({ error: authError || "Authentication failed" });
  }

  // ── Extract wallet address ───────────────────────────────────────────────
  const { walletAddress: bodyWallet } = req.body || {};

  // Use wallet from the token if available, otherwise from the request body
  const walletAddress = (tokenWallet || bodyWallet || "").toLowerCase();

  if (!walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "Valid wallet address is required" });
  }

  // ── Mint Supabase JWT ────────────────────────────────────────────────────
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_LIFETIME_SECONDS;
    const ref = getSupabaseRef();

    // Encode the secret as a Uint8Array for jose
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const accessToken = await new SignJWT({
      // Standard Supabase claims
      role: "authenticated",
      iss: `supabase`,
      sub: userId,
      aud: "authenticated",
      // Custom claims for RLS policies
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
    console.error("[mint-session] JWT signing failed:", err);
    return res.status(500).json({ error: "Failed to mint session token" });
  }
}
