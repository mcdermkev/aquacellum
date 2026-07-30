/**
 * Vercel Serverless Function: /api/attest-pedigree
 *
 * Platform attestation of a pedigree document hash
 * (docs/BREEDER_STATE_MODEL.md §12, docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md
 * §2.4).
 *
 * Flow — deliberately the same trust root as /api/mint-session, which is why this
 * needed no new user-facing step:
 *   1. Privy has already proven the user controls the wallet.
 *   2. This endpoint verifies that Privy access token against Privy's JWKS.
 *   3. It signs a PURPOSE-BOUND STATEMENT about one pedigree hash.
 *
 * ⚠️ WHY THIS IS NOT /api/mint-session ⚠️
 *
 * The tempting shortcut is to reuse the session JWT that mint-session already
 * returns. That token carries `role: "authenticated"` and `wallet_address`, signed
 * with SUPABASE_JWT_SECRET — it IS a live session credential for that wallet.
 *
 * Pedigree documents are meant to be PUBLISHED: §4.3 puts them in a public Supabase
 * Storage bucket at a deterministic, guessable path. Embedding a session token in
 * one would publish a working credential for the breeder's wallet at a URL anyone
 * can construct. So this endpoint exists to produce a different artifact:
 *
 *   - a distinct key (PEDIGREE_ATTESTATION_PRIVATE_KEY), never the auth secret. A
 *     signature reused across purposes proves the wrong thing, and a leak of one
 *     would compromise the other.
 *   - NO `role` claim, and no `aud`. The client's `assertNotCredential` rejects an
 *     attestation carrying either, so a regression here fails loudly rather than
 *     shipping a credential.
 *   - ASYMMETRIC (ES256). HS256 would mean only we can verify, so a buyer could not
 *     check the attestation at all. With a published public key anyone can verify
 *     that *Aquadex said this* — they still trust that we only attest authenticated
 *     wallets, which is exactly why the client reports this as `platformAttested`
 *     and not `attested`. See the trust ladder in services/pedigreeDocument.js.
 *   - LONG-LIVED. A provenance record that expires in an hour is not a provenance
 *     record. There is no `exp`; the statement is about a moment in the past.
 *
 * The stronger level — a signature from the breeder's own wallet key, verifiable
 * without trusting us at all — is a separate task, because this app is Web2-masked
 * and a signing prompt is a product decision. Nothing here blocks it: a wallet
 * attestation replaces this one on the same document without reissuing the hash.
 *
 * POST body: { pedigreeHash: string, walletAddress?: string }
 * Headers:   Authorization: Bearer <privy-access-token>
 * Returns:   { attestation: { method, purpose, subjectHash, signature, signedBy,
 *                             signedAt, keyId } } | { error: string }
 *
 * Requires env vars:
 *   - PEDIGREE_ATTESTATION_PRIVATE_KEY  (PKCS#8 PEM, ES256 / P-256)
 *   - PEDIGREE_ATTESTATION_KEY_ID       (identifies which public key verifies this)
 */

import { SignJWT, importPKCS8 } from "jose";
import { verifyPrivyToken } from "./_lib/verifyPrivyToken.js";
import { handleCorsPreFlight } from "./_lib/cors.js";

/** Must match ATTESTATION_PURPOSE in src/services/pedigreeDocument.js. */
const ATTESTATION_PURPOSE = "aquadex.pedigree.attestation.v1";

/** Must match ATTESTATION_METHOD.PLATFORM in src/services/pedigreeDocument.js. */
const ATTESTATION_METHOD_PLATFORM = "platform";

const ATTESTATION_ALG = "ES256";

const PRIVATE_KEY_PEM = process.env.PEDIGREE_ATTESTATION_PRIVATE_KEY || "";
const KEY_ID = process.env.PEDIGREE_ATTESTATION_KEY_ID || "";

/** A pedigree hash is a bare lowercase SHA-256 hex digest. */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

let _cachedKey = null;
async function getSigningKey() {
  if (!_cachedKey) _cachedKey = await importPKCS8(PRIVATE_KEY_PEM, ATTESTATION_ALG);
  return _cachedKey;
}

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS", headers: "Content-Type, Authorization" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Validate server config ───────────────────────────────────────────────
  // Fails CLOSED. An unconfigured attestation service must return nothing, never a
  // placeholder or an unsigned "attestation" — the client would surface that as a
  // trust level the document has not earned.
  if (!PRIVATE_KEY_PEM || !KEY_ID) {
    console.error("[attest-pedigree] attestation key not configured");
    return res.status(503).json({ error: "Attestation is not available right now." });
  }

  // ── Reuse the existing trust root ────────────────────────────────────────
  const { verified, walletAddress: tokenWallet, error: authError } = await verifyPrivyToken(req);
  if (!verified) {
    return res.status(401).json({ error: authError || "Authentication failed" });
  }

  const { pedigreeHash, walletAddress: bodyWallet } = req.body || {};

  if (typeof pedigreeHash !== "string" || !HASH_PATTERN.test(pedigreeHash)) {
    return res.status(400).json({ error: "A 64-character pedigree hash is required." });
  }

  const walletAddress = (tokenWallet || bodyWallet || "").toLowerCase();
  if (!walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "Valid wallet address is required" });
  }

  // The wallet in the verified Privy token wins over anything the body claims. If
  // both are present and disagree, refuse — attesting the body's wallet would let a
  // caller attest a pedigree as somebody else, which is the one thing this endpoint
  // exists to prevent.
  if (tokenWallet && bodyWallet && tokenWallet.toLowerCase() !== bodyWallet.toLowerCase()) {
    return res.status(400).json({ error: "Wallet address does not match the signed-in account." });
  }

  // ── Sign a statement, not a session ──────────────────────────────────────
  try {
    const signedAt = Math.floor(Date.now() / 1000);
    const key = await getSigningKey();

    // Note what is absent: no `role`, no `aud`, no `exp`. This is a claim about a
    // past moment, not an authorization to do anything.
    const signature = await new SignJWT({
      purpose: ATTESTATION_PURPOSE,
      subject_hash: pedigreeHash,
      signed_by: walletAddress,
      method: ATTESTATION_METHOD_PLATFORM,
      // What we are actually asserting, stated in the artifact itself so it cannot
      // be read as more than it is: the wallet was authenticated at this time. NOT
      // that the pedigree's contents are true.
      asserts: "wallet_authenticated_at_signing",
    })
      .setProtectedHeader({ alg: ATTESTATION_ALG, typ: "JWT", kid: KEY_ID })
      .setIssuedAt(signedAt)
      .setIssuer("aquadex")
      .sign(key);

    return res.status(200).json({
      attestation: {
        method: ATTESTATION_METHOD_PLATFORM,
        purpose: ATTESTATION_PURPOSE,
        subjectHash: pedigreeHash,
        signature,
        signedBy: walletAddress,
        signedAt,
        keyId: KEY_ID,
        algorithm: ATTESTATION_ALG,
      },
    });
  } catch (err) {
    console.error("[attest-pedigree] signing failed:", err);
    return res.status(500).json({ error: "Failed to attest pedigree" });
  }
}
