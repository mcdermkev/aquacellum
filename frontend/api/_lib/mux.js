/**
 * mux.js — Shared Mux helpers for the /api/mux serverless function
 *
 * Centralizes the Mux REST calls and the Supabase writes that the video
 * upload endpoint and the webhook handler both rely on, so the thin route
 * handlers in api/mux.js stay focused on request/response shaping.
 */

import crypto from "crypto";

const MUX_API_BASE = "https://api.mux.com";

/**
 * Whether Mux API credentials are present in the environment.
 */
export function isMuxConfigured() {
  return !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

/**
 * Resolve the Supabase REST config used by the webhook to update video status.
 * Returns null when Supabase isn't configured.
 */
export function getSupabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Create a Mux Direct Upload via the REST API (no @mux/mux-node SDK needed).
 * The wallet address is stored as passthrough so the webhook can correlate the
 * finished asset back to the uploading user.
 *
 * @param {{ walletAddress: string, corsOrigin?: string }} params
 * @returns {Promise<{ uploadUrl: string, uploadId: string }>}
 * @throws {Error} with code "MUX_NOT_CONFIGURED" or "MUX_API_ERROR"
 */
export async function createDirectUpload({ walletAddress, corsOrigin }) {
  if (!isMuxConfigured()) {
    const err = new Error("Video upload not configured (Mux credentials missing)");
    err.code = "MUX_NOT_CONFIGURED";
    throw err;
  }

  const credentials = Buffer
    .from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`)
    .toString("base64");

  const response = await fetch(`${MUX_API_BASE}/video/v1/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      new_asset_settings: {
        playback_policy: ["public"],
        encoding_tier: "baseline",
        passthrough: JSON.stringify({ walletAddress }),
      },
      cors_origin: corsOrigin || process.env.FRONTEND_ORIGIN || "https://aquadex.io",
      timeout: 600, // 10 min for slow connections
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("[Mux] Upload API error:", response.status, body);
    const err = new Error(`Mux upload creation failed (${response.status})`);
    err.code = "MUX_API_ERROR";
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const upload = data.data;
  return { uploadUrl: upload.url, uploadId: upload.id };
}

/**
 * Verify a Mux webhook signature (best-effort). Vercel's JSON body parsing can
 * alter the raw bytes, so a mismatch is logged rather than treated as fatal —
 * matching the prior behavior of the standalone webhook.
 */
export function verifyMuxSignature(req, secret) {
  if (!secret) return;
  const signature = req.headers["mux-signature"];
  if (!signature) {
    console.warn("[Mux] No signature header — proceeding without verification");
    return;
  }
  const parts = signature.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));
  if (!timestampPart || !signaturePart) return;

  const timestamp = timestampPart.slice(2);
  const expectedSig = signaturePart.slice(3);
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const computedSig = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (computedSig !== expectedSig) {
    console.warn("[Mux] Signature mismatch — allowing anyway (Vercel body parsing may alter raw body)");
  }
}

/**
 * Safely parse the passthrough JSON string carried on a Mux asset.
 */
export function parsePassthrough(passthrough) {
  if (!passthrough) return {};
  try {
    return JSON.parse(passthrough);
  } catch {
    return {};
  }
}

/**
 * PATCH a Supabase table row by matching a column value (via the REST API).
 * No-ops when the match value is missing.
 */
export async function supabasePatch({ url, key, table, matchColumn, matchValue, updates }) {
  if (!matchValue || !table) return;

  const endpoint = `${url}/rest/v1/${table}?${matchColumn}=eq.${encodeURIComponent(matchValue)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Mux] Supabase update (${table}) failed: ${response.status} ${errText}`);
  }
}
