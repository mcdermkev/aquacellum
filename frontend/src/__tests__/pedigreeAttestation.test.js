/**
 * Attestation signature verification (docs/BREEDER_STATE_MODEL.md §9.29).
 *
 * THESE ARE REAL CRYPTO TESTS, not shape guards. Each one generates an ES256 keypair,
 * signs a genuine attestation with it, and verifies against the exported JWKS — the
 * same path production takes through /api/attest-pedigree and /api/pedigree-keys. A
 * forgery test that only checks strings would pass against an implementation that
 * never verifies anything, which is exactly the bug this module was added to fix.
 *
 * THE BUG IT FIXES: `pedigreeTrustLevel` used to return `platformAttested` after
 * inspecting the SHAPE of an attestation — method, purpose, subject hash — without
 * ever checking the signature. Anyone could paste an arbitrary string into
 * `signature` and read as attested. That is §9.28's mistake (a badge asserting more
 * than its backing) inside the machinery built to prevent it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  ATTESTATION_FAILURE,
  ATTESTATION_ALG,
  clearAttestationKeyCache,
  fetchAttestationKeys,
  isPedigreeTrustworthy,
  resolvePedigreeTrust,
  verifyAttestationSignature,
} from "../services/pedigreeAttestation";
import {
  ATTESTATION_METHOD,
  ATTESTATION_PURPOSE,
  PEDIGREE_TRUST,
  attachAttestation,
  sealPedigreeDocument,
} from "../services/pedigreeDocument";

const MASTER = "0xmasterbreeder000000000000000000000000aaaa";
const KID = "pedigree-test-key-1";

const node = (id, breeder = MASTER) => ({
  id,
  speciesId: 42,
  scientificName: "Paracheirodon innesi",
  birthTimestamp: 1700000000 + id,
  breeder,
  sireId: 0,
  damId: 0,
  onChainId: null,
});

const tree = () => ({
  target: node(10),
  parents: { sire: node(7), dam: node(8) },
  grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
});

/** The real signing key for a test, plus the JWKS a verifier would fetch. */
async function makeKeys(kid = KID) {
  const { privateKey, publicKey } = await generateKeyPair(ATTESTATION_ALG, { extractable: true });
  const jwk = await exportJWK(publicKey);
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid, alg: ATTESTATION_ALG, use: "sig" }] },
    kid,
  };
}

/**
 * Sign an attestation the way /api/attest-pedigree does — same claims, same header,
 * no `exp`, no `role`.
 */
async function signAttestation({ privateKey, kid, subjectHash, overrides = {}, claims = {} }) {
  const signedAt = 1730000001;
  const signature = await new SignJWT({
    purpose: ATTESTATION_PURPOSE,
    subject_hash: subjectHash,
    signed_by: MASTER,
    method: ATTESTATION_METHOD.PLATFORM,
    asserts: "wallet_authenticated_at_signing",
    ...claims,
  })
    .setProtectedHeader({ alg: ATTESTATION_ALG, typ: "JWT", kid })
    .setIssuedAt(signedAt)
    .setIssuer("aquadex")
    .sign(privateKey);

  return {
    method: ATTESTATION_METHOD.PLATFORM,
    purpose: ATTESTATION_PURPOSE,
    subjectHash,
    signature,
    signedBy: MASTER,
    signedAt,
    keyId: kid,
    algorithm: ATTESTATION_ALG,
    ...overrides,
  };
}

const sealed = () => sealPedigreeDocument({ tree: tree(), issuer: MASTER, issuedAt: 1730000000 });

beforeEach(() => clearAttestationKeyCache());

// ─── A genuine signature verifies ───────────────────────────────────────────

describe("a real platform attestation verifies end to end", () => {
  it("verifies a signature made with the matching key", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const attestation = await signAttestation({ privateKey, kid, subjectHash: doc.hash });

    const result = await verifyAttestationSignature(attestation, doc.hash, jwks);
    expect(result.verified).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.claims.asserts).toBe("wallet_authenticated_at_signing");
  });

  it("reaches platformAttested through resolvePedigreeTrust", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const attested = attachAttestation(
      doc,
      await signAttestation({ privateKey, kid, subjectHash: doc.hash })
    );

    const { level, verified } = await resolvePedigreeTrust(attested, { jwks });
    expect(verified).toBe(true);
    expect(level).toBe(PEDIGREE_TRUST.PLATFORM_ATTESTED);
    expect(isPedigreeTrustworthy(level)).toBe(true);
  });

  it("does NOT reach `attested` — that rung needs the breeder's own key", async () => {
    // A verified platform attestation is proof that Aquadex said something, not that
    // the breeder did. Collapsing the two would be the overclaim the ladder exists
    // to prevent.
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const attested = attachAttestation(
      doc,
      await signAttestation({ privateKey, kid, subjectHash: doc.hash })
    );
    const { level } = await resolvePedigreeTrust(attested, { jwks });
    expect(level).not.toBe(PEDIGREE_TRUST.ATTESTED);
    expect(level).not.toBe(PEDIGREE_TRUST.ANCHORED);
  });
});

// ─── Forgeries are caught ───────────────────────────────────────────────────

describe("forgeries do not verify", () => {
  it("rejects a signature from a DIFFERENT key", async () => {
    // The attacker signs a perfectly well-formed attestation with their own key.
    // Only the published key may satisfy it.
    const legit = await makeKeys();
    const attacker = await makeKeys(KID); // same kid, different key material
    const doc = await sealed();
    const forged = await signAttestation({
      privateKey: attacker.privateKey,
      kid: KID,
      subjectHash: doc.hash,
    });

    const result = await verifyAttestationSignature(forged, doc.hash, legit.jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.BAD_SIGNATURE);
  });

  it("rejects an arbitrary string pasted into `signature`", async () => {
    // THE ORIGINAL BUG. Shape inspection alone accepted this.
    const { jwks } = await makeKeys();
    const doc = await sealed();
    const bogus = {
      method: ATTESTATION_METHOD.PLATFORM,
      purpose: ATTESTATION_PURPOSE,
      subjectHash: doc.hash,
      signature: "totally-a-real-signature",
      signedBy: MASTER,
    };
    const result = await verifyAttestationSignature(bogus, doc.hash, jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.BAD_SIGNATURE);
  });

  it("reports a checked-and-failed signature as INVALID, not merely unattested", async () => {
    // A forged attestation is a signal about the document. Reporting it as an honest
    // gap would make a forgery indistinguishable from a fish with no paperwork.
    const legit = await makeKeys();
    const attacker = await makeKeys(KID);
    const doc = await sealed();
    const forged = attachAttestation(
      doc,
      await signAttestation({ privateKey: attacker.privateKey, kid: KID, subjectHash: doc.hash })
    );

    const { level, verified } = await resolvePedigreeTrust(forged, { jwks: legit.jwks });
    expect(verified).toBe(false);
    expect(level).toBe(PEDIGREE_TRUST.INVALID);
    expect(isPedigreeTrustworthy(level)).toBe(false);
  });

  it("rejects a genuine signature transplanted from another pedigree", async () => {
    // Valid signature, valid key, wrong subject. The envelope's subjectHash is
    // rewritten to match the target document, so only the SIGNED claim catches it.
    const { privateKey, jwks, kid } = await makeKeys();
    const target = await sealed();
    const other = await sealPedigreeDocument({
      tree: tree(), issuer: MASTER, issuedAt: 1730009999,
    });
    expect(other.hash).not.toBe(target.hash);

    const transplanted = await signAttestation({
      privateKey,
      kid,
      subjectHash: other.hash,
      overrides: { subjectHash: target.hash },
    });

    const result = await verifyAttestationSignature(transplanted, target.hash, jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.CLAIM_MISMATCH);
  });

  it("rejects a signature issued for a different purpose", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const wrongPurpose = await signAttestation({
      privateKey,
      kid,
      subjectHash: doc.hash,
      claims: { purpose: "aquadex.login.v1" },
    });
    const result = await verifyAttestationSignature(wrongPurpose, doc.hash, jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.CLAIM_MISMATCH);
  });

  it("rejects a signature whose signer disagrees with the envelope", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const mismatched = await signAttestation({
      privateKey,
      kid,
      subjectHash: doc.hash,
      overrides: { signedBy: "0xsomeoneelse00000000000000000000000000bb" },
    });
    const result = await verifyAttestationSignature(mismatched, doc.hash, jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.CLAIM_MISMATCH);
  });

  it("rejects a credential-shaped attestation before verifying it", async () => {
    const { jwks } = await makeKeys();
    const doc = await sealed();
    const result = await verifyAttestationSignature(
      { method: ATTESTATION_METHOD.PLATFORM, subjectHash: doc.hash, signature: "x", role: "authenticated" },
      doc.hash,
      jwks
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.MALFORMED);
  });

  it("catches an envelope whose subjectHash was edited to match a foreign document", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const attestation = await signAttestation({ privateKey, kid, subjectHash: doc.hash });
    const result = await verifyAttestationSignature(attestation, "a".repeat(64), jwks);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(ATTESTATION_FAILURE.WRONG_SUBJECT);
  });
});

// ─── "Couldn't check" is not "failed" ───────────────────────────────────────

describe("unknown is distinguished from forged", () => {
  it("reports attestationUnverified when no keys are available", async () => {
    // Offline is the normal state for a PWA. Crying forgery on a plane would be as
    // wrong as hiding a real one.
    const { privateKey, kid } = await makeKeys();
    const doc = await sealed();
    const attested = attachAttestation(
      doc,
      await signAttestation({ privateKey, kid, subjectHash: doc.hash })
    );

    const { level, verified, reason } = await resolvePedigreeTrust(attested, { jwks: null });
    expect(verified).toBeNull();
    expect(reason).toBe(ATTESTATION_FAILURE.NO_KEYS);
    expect(level).toBe(PEDIGREE_TRUST.ATTESTATION_UNVERIFIED);
    // And it must not be treated as good enough for a premium.
    expect(isPedigreeTrustworthy(level)).toBe(false);
  });

  it("reports attestationUnverified for a wallet attestation, which needs another path", async () => {
    // Not yet built. It must not read as forged in the meantime.
    const doc = await sealed();
    const { jwks } = await makeKeys();
    const walletAttested = attachAttestation(doc, {
      method: ATTESTATION_METHOD.WALLET,
      purpose: ATTESTATION_PURPOSE,
      subjectHash: doc.hash,
      signature: "0xwalletsig",
      signedBy: MASTER,
    });

    const { level, verified, reason } = await resolvePedigreeTrust(walletAttested, { jwks });
    expect(verified).toBeNull();
    expect(reason).toBe(ATTESTATION_FAILURE.UNSUPPORTED_METHOD);
    expect(level).toBe(PEDIGREE_TRUST.ATTESTATION_UNVERIFIED);
  });

  it("leaves an unattested document unattested rather than inventing a failure", async () => {
    const doc = await sealed();
    const { level, verified } = await resolvePedigreeTrust(doc, { jwks: null });
    expect(level).toBe(PEDIGREE_TRUST.UNATTESTED);
    expect(verified).toBeNull();
  });

  it("still reports a tampered BODY as invalid regardless of the attestation", async () => {
    const { privateKey, jwks, kid } = await makeKeys();
    const doc = await sealed();
    const attested = attachAttestation(
      doc,
      await signAttestation({ privateKey, kid, subjectHash: doc.hash })
    );
    attested.body.subject.breeder = "0xnotthebreeder0000000000000000000000cccc";

    const { level } = await resolvePedigreeTrust(attested, { jwks });
    expect(level).toBe(PEDIGREE_TRUST.INVALID);
  });
});

// ─── Key fetching ───────────────────────────────────────────────────────────

describe("fetchAttestationKeys", () => {
  const okResponse = (body) => ({ ok: true, json: async () => body });

  it("returns the published key set and caches it", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResponse({ keys: [{ kid: "a" }] }); };
    expect((await fetchAttestationKeys({ fetchImpl })).keys).toHaveLength(1);
    await fetchAttestationKeys({ fetchImpl });
    expect(calls).toBe(1);
  });

  it("returns null rather than throwing when the endpoint is unavailable", async () => {
    // The endpoint 503s when unconfigured, so this path means "unknown", and the
    // caller turns that into attestationUnverified rather than a failure.
    for (const fetchImpl of [
      async () => { throw new Error("offline"); },
      async () => ({ ok: false }),
      async () => okResponse({ keys: [] }),
      async () => okResponse(null),
    ]) {
      clearAttestationKeyCache();
      expect(await fetchAttestationKeys({ fetchImpl })).toBeNull();
    }
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      return calls === 1 ? { ok: false } : okResponse({ keys: [{ kid: "a" }] });
    };
    expect(await fetchAttestationKeys({ fetchImpl: flaky })).toBeNull();
    expect(await fetchAttestationKeys({ fetchImpl: flaky })).not.toBeNull();
  });
});

// ─── Endpoint and module contracts ──────────────────────────────────────────

describe("the key endpoint publishes what the verifier needs", () => {
  // Comments stripped — trap 6.3, which this work stream has now tripped twice.
  const ENDPOINT = readFileSync(
    fileURLToPath(new URL("../../api/pedigree-keys.js", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("serves only the PUBLIC key", () => {
    expect(ENDPOINT).toContain("PEDIGREE_ATTESTATION_PUBLIC_KEY");
    expect(ENDPOINT).toContain("importSPKI");
    // The private half must never be readable from here.
    expect(ENDPOINT).not.toContain("PEDIGREE_ATTESTATION_PRIVATE_KEY");
    expect(ENDPOINT).not.toContain("importPKCS8");
  });

  it("is a GET and fails closed rather than serving an empty key set", () => {
    // An empty `keys` array looks like a working endpoint that trusts nothing, and
    // every attestation would silently read as unverified with no reason given.
    expect(ENDPOINT).toMatch(/req\.method !== "GET"/);
    expect(ENDPOINT).toContain("503");
  });

  it("carries kid and alg so rotation is possible without breaking old documents", () => {
    expect(ENDPOINT).toContain("kid");
    expect(ENDPOINT).toContain("ATTESTATION_ALG");
    expect(ENDPOINT).toContain("PEDIGREE_ATTESTATION_PREVIOUS_KEYS");
  });

  it("survives a malformed rotation list instead of going offline with it", () => {
    expect(ENDPOINT).toMatch(/catch[\s\S]{0,200}return \[\]/);
  });
});

describe("the verifier pins what it accepts", () => {
  const SRC = readFileSync(
    fileURLToPath(new URL("../services/pedigreeAttestation.js", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("pins the algorithm, so a document cannot propose a weaker one", () => {
    // Without `algorithms`, a caller could present a token signed with anything,
    // including `none`.
    expect(SRC).toMatch(/algorithms:\s*\[ATTESTATION_ALG\]/);
    expect(SRC).toContain('ATTESTATION_ALG = "ES256"');
  });

  it("checks the signed claims and not just the signature", () => {
    // A valid signature over the wrong statement is not a valid attestation.
    expect(SRC).toContain("payload.purpose");
    expect(SRC).toContain("payload.subject_hash");
    expect(SRC).toContain("payload.method");
  });

  it("requires the expected issuer", () => {
    expect(SRC).toMatch(/issuer:\s*"aquadex"/);
  });
});
