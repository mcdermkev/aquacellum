/**
 * pedigreeAttestation.js — checking that an attestation is real.
 *
 * docs/BREEDER_STATE_MODEL.md §9.29. Split out of `pedigreeDocument.js` on purpose:
 * that module is pure and offline, and this one needs a network fetch and a crypto
 * library. Keeping them apart is what lets the document logic stay testable with no
 * environment at all.
 *
 * ── WHAT THIS CORRECTS ──────────────────────────────────────────────────────
 *
 * `pedigreeTrustLevel` originally returned `platformAttested` after inspecting the
 * SHAPE of an attestation — method, purpose, subject hash. It never checked the
 * signature. So anyone could paste an arbitrary string into `signature` and read as
 * attested, which is the §9.28 mistake in a new place: a badge asserting more than
 * its backing.
 *
 * Now the shape check tops out at `attestationUnverified`, and reaching a verified
 * level requires this module actually validating the signature against the published
 * key.
 *
 * ── WHAT A VERIFIED PLATFORM ATTESTATION MEANS ──────────────────────────────
 *
 * Narrowly: Aquadex signed a statement that the issuing wallet was authenticated
 * when the pedigree was sealed. It is proof that **we said it**, not proof that the
 * pedigree is accurate. That is why `platformAttested` sits below `attested` — a
 * breeder-key signature needs no trust in us at all.
 *
 * ── WHY jose ────────────────────────────────────────────────────────────────
 *
 * Already a project dependency (used by every API route), pure ESM, Web Crypto
 * based, works in the browser and in the node test environment. Hand-rolling JWT
 * verification to avoid a dependency would trade a real risk for an imaginary one:
 * signature checking is precisely where subtle security bugs live.
 */

import { createLocalJWKSet, jwtVerify } from "jose";
import {
  ATTESTATION_METHOD,
  ATTESTATION_PURPOSE,
  PEDIGREE_TRUST,
  assertNotCredential,
  pedigreeTrustLevel,
} from "./pedigreeDocument";

/** Where the public verification keys live (§9.29). */
export const PEDIGREE_KEYS_URL = "/api/pedigree-keys";

/** The only algorithm accepted. Pinned, so a document cannot propose a weaker one. */
export const ATTESTATION_ALG = "ES256";

/** Reasons verification can fail, for callers that want to explain themselves. */
export const ATTESTATION_FAILURE = Object.freeze({
  NO_ATTESTATION: "noAttestation",
  MALFORMED: "malformed",
  WRONG_SUBJECT: "wrongSubject",
  NO_KEYS: "noKeys",
  BAD_SIGNATURE: "badSignature",
  CLAIM_MISMATCH: "claimMismatch",
  UNSUPPORTED_METHOD: "unsupportedMethod",
});

let _keysCache = null;
let _keysCacheAt = 0;
const KEYS_TTL_MS = 60 * 60 * 1000;

/** Drop the cached key set. Exposed for tests and for a forced refresh. */
export function clearAttestationKeyCache() {
  _keysCache = null;
  _keysCacheAt = 0;
}

/**
 * Fetch the published JWKS.
 *
 * Returns `null` rather than throwing when keys are unavailable — offline is the
 * normal state for a PWA, and "couldn't check" has to be distinguishable from
 * "checked and failed". Conflating them would either cry forgery on a plane or hide
 * a real one.
 *
 * @param {{ fetchImpl?: Function, url?: string }} [options]
 * @returns {Promise<{keys: Array<object>}|null>}
 */
export async function fetchAttestationKeys({ fetchImpl, url = PEDIGREE_KEYS_URL } = {}) {
  const now = Date.now();
  if (_keysCache && now - _keysCacheAt < KEYS_TTL_MS) return _keysCache;

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return null;

  try {
    const response = await doFetch(url);
    if (!response?.ok) return null;
    const body = await response.json();
    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) return null;
    _keysCache = body;
    _keysCacheAt = now;
    return _keysCache;
  } catch {
    // Offline, blocked, or unconfigured (the endpoint 503s rather than serving an
    // empty key set, so this path is genuinely "unknown", not "nothing is trusted").
    return null;
  }
}

/**
 * Verify one attestation's signature against a key set.
 *
 * Pure: the key set is injected, so this is testable with a locally generated pair
 * and no network.
 *
 * @param {object} attestation
 * @param {string} expectedSubjectHash - the document's own hash
 * @param {{keys: Array<object>}|null} jwks
 * @returns {Promise<{verified: boolean, reason: string|null, claims: object|null}>}
 */
export async function verifyAttestationSignature(attestation, expectedSubjectHash, jwks) {
  if (!attestation || typeof attestation !== "object" || !attestation.signature) {
    return { verified: false, reason: ATTESTATION_FAILURE.NO_ATTESTATION, claims: null };
  }

  // A credential is not an attestation, and must not be handed to a verifier that
  // might succeed on it. See the notes in pedigreeDocument.js.
  try {
    assertNotCredential(attestation);
  } catch {
    return { verified: false, reason: ATTESTATION_FAILURE.MALFORMED, claims: null };
  }

  if (attestation.subjectHash !== expectedSubjectHash) {
    return { verified: false, reason: ATTESTATION_FAILURE.WRONG_SUBJECT, claims: null };
  }

  if (attestation.method !== ATTESTATION_METHOD.PLATFORM) {
    // A wallet-key signature is checked against the signer's address, not a JWKS.
    // Until that rung is built, say so instead of failing in a way that reads as
    // forgery.
    return { verified: false, reason: ATTESTATION_FAILURE.UNSUPPORTED_METHOD, claims: null };
  }

  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return { verified: false, reason: ATTESTATION_FAILURE.NO_KEYS, claims: null };
  }

  let payload;
  try {
    const keyset = createLocalJWKSet(jwks);
    // `algorithms` is pinned: without it a caller could present a token signed with
    // whatever algorithm they liked, including `none`.
    const result = await jwtVerify(attestation.signature, keyset, {
      algorithms: [ATTESTATION_ALG],
      issuer: "aquadex",
    });
    payload = result.payload;
  } catch {
    return { verified: false, reason: ATTESTATION_FAILURE.BAD_SIGNATURE, claims: null };
  }

  // A valid signature over the WRONG STATEMENT is not a valid attestation. Every
  // claim that carries meaning is re-checked against the document, so a genuine
  // signature from a different pedigree cannot be transplanted.
  if (payload.purpose !== ATTESTATION_PURPOSE) {
    return { verified: false, reason: ATTESTATION_FAILURE.CLAIM_MISMATCH, claims: payload };
  }
  if (payload.subject_hash !== expectedSubjectHash) {
    return { verified: false, reason: ATTESTATION_FAILURE.CLAIM_MISMATCH, claims: payload };
  }
  if (payload.method !== ATTESTATION_METHOD.PLATFORM) {
    return { verified: false, reason: ATTESTATION_FAILURE.CLAIM_MISMATCH, claims: payload };
  }
  // The signed wallet is authoritative; a mismatch means the envelope was edited.
  if (
    attestation.signedBy &&
    payload.signed_by &&
    String(attestation.signedBy).toLowerCase() !== String(payload.signed_by).toLowerCase()
  ) {
    return { verified: false, reason: ATTESTATION_FAILURE.CLAIM_MISMATCH, claims: payload };
  }

  return { verified: true, reason: null, claims: payload };
}

/**
 * The document's trust level, with the signature actually checked.
 *
 * This is what a UI should call. It degrades to `attestationUnverified` when keys
 * cannot be fetched, which is the honest answer offline, and to `invalid` only when
 * a signature was checked and did not hold.
 *
 * @param {object} document
 * @param {{ fetchImpl?: Function, jwks?: object|null }} [options]
 * @returns {Promise<{level: string, verified: boolean|null, reason: string|null}>}
 */
export async function resolvePedigreeTrust(document, { fetchImpl, jwks } = {}) {
  const attestation = document?.attestation;

  // Nothing to check — let the shape-level ladder answer.
  if (!attestation || typeof attestation !== "object" || !attestation.signature) {
    return { level: await pedigreeTrustLevel(document), verified: null, reason: null };
  }

  const keyset = jwks !== undefined ? jwks : await fetchAttestationKeys({ fetchImpl });

  const { verified, reason } = await verifyAttestationSignature(
    attestation,
    document?.hash,
    keyset
  );

  // Couldn't check, rather than checked-and-failed. Offline and
  // not-yet-published both land here, and neither is evidence of forgery.
  const unknown =
    reason === ATTESTATION_FAILURE.NO_KEYS ||
    reason === ATTESTATION_FAILURE.UNSUPPORTED_METHOD;

  const level = await pedigreeTrustLevel(document, {
    attestationVerified: verified ? true : unknown ? null : false,
  });

  return { level, verified: verified ? true : unknown ? null : false, reason };
}

/** True only for levels a premium claim may lean on. */
export function isPedigreeTrustworthy(level) {
  return (
    level === PEDIGREE_TRUST.PLATFORM_ATTESTED ||
    level === PEDIGREE_TRUST.ATTESTED ||
    level === PEDIGREE_TRUST.ANCHORED
  );
}
