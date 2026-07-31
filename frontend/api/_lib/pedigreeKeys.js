/**
 * Vercel Serverless Function: /api/pedigree-keys
 *
 * The public half of the pedigree attestation key, as a JWKS
 * (docs/BREEDER_STATE_MODEL.md §9.29).
 *
 * WHY THIS EXISTS: `/api/attest-pedigree` signs with **ES256 specifically so that a
 * buyer does not have to trust us to check an attestation** — asymmetric means the
 * verifier needs only the public key. Without publishing that key the choice is
 * pointless: verification would be possible only for whoever holds the secret, which
 * is exactly the position HS256 would have put us in.
 *
 * So this endpoint is not a nicety. It is the half of the design that makes the other
 * half honest.
 *
 * WHAT IT DOES NOT DO: publishing this key lets anyone confirm *Aquadex signed this
 * statement*. It does not make the statement true. What we attest is narrow and
 * stated inside every signature (`asserts: "wallet_authenticated_at_signing"`): the
 * issuing wallet was authenticated at the moment the pedigree was sealed. Whether
 * the pedigree's contents are accurate is the breeder's claim, which is why a
 * breeder-key signature is a strictly higher rung — see the trust ladder in
 * src/services/pedigreeDocument.js.
 *
 * ROTATION: every signature carries `kid` in its protected header, and this endpoint
 * serves an array. To rotate, add the new key and keep the old one published for as
 * long as documents signed with it must stay verifiable — which, for a provenance
 * record, is indefinitely. Retiring a key silently invalidates every pedigree it
 * ever signed.
 *
 * GET → { keys: [ { kty, crv, x, y, kid, alg, use } ] }
 *
 * Requires env vars:
 *   - PEDIGREE_ATTESTATION_PUBLIC_KEY  (SPKI PEM, ES256 / P-256)
 *   - PEDIGREE_ATTESTATION_KEY_ID      (must match the signer's kid)
 * Optional:
 *   - PEDIGREE_ATTESTATION_PREVIOUS_KEYS  (JSON array of { pem, kid }) for rotation
 */

import { importSPKI, exportJWK } from "jose";
import { setCorsHeaders } from "./cors.js";

const ATTESTATION_ALG = "ES256";

const PUBLIC_KEY_PEM = process.env.PEDIGREE_ATTESTATION_PUBLIC_KEY || "";
const KEY_ID = process.env.PEDIGREE_ATTESTATION_KEY_ID || "";
const PREVIOUS_KEYS_JSON = process.env.PEDIGREE_ATTESTATION_PREVIOUS_KEYS || "";

let _cachedJwks = null;

async function toJwk(pem, kid) {
  const key = await importSPKI(pem, ATTESTATION_ALG);
  const jwk = await exportJWK(key);
  return { ...jwk, kid, alg: ATTESTATION_ALG, use: "sig" };
}

function previousKeyEntries() {
  if (!PREVIOUS_KEYS_JSON) return [];
  try {
    const parsed = JSON.parse(PREVIOUS_KEYS_JSON);
    return Array.isArray(parsed) ? parsed.filter((e) => e?.pem && e?.kid) : [];
  } catch (err) {
    // A malformed rotation list must not take the current key offline with it.
    console.error("[pedigree-keys] PEDIGREE_ATTESTATION_PREVIOUS_KEYS is not valid JSON:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS", headers: "Content-Type" });

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Fails CLOSED, and says so plainly. An empty `keys` array would look like a
  // working endpoint that happens to trust nothing, and every attestation would
  // quietly read as unverified with no indication why.
  if (!PUBLIC_KEY_PEM || !KEY_ID) {
    console.error("[pedigree-keys] attestation public key not configured");
    return res.status(503).json({ error: "Pedigree attestation keys are not published yet." });
  }

  try {
    if (!_cachedJwks) {
      const keys = [await toJwk(PUBLIC_KEY_PEM, KEY_ID)];
      for (const entry of previousKeyEntries()) {
        try {
          keys.push(await toJwk(entry.pem, entry.kid));
        } catch (err) {
          console.error(`[pedigree-keys] skipping unusable retired key ${entry.kid}:`, err.message);
        }
      }
      _cachedJwks = { keys };
    }

    // Long cache: a public verification key is stable by design, and every
    // pedigree chart render wants it. `kid` is what distinguishes keys, so a new
    // one does not invalidate a cached response for the old.
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return res.status(200).json(_cachedJwks);
  } catch (err) {
    console.error("[pedigree-keys] failed to export public key:", err);
    return res.status(500).json({ error: "Failed to publish attestation keys" });
  }
}
