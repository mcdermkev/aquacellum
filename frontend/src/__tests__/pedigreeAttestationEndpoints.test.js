/**
 * End-to-end attestation chain, through the real serverless handlers
 * (docs/BREEDER_STATE_MODEL.md §9.29).
 *
 * WHY THIS EXISTS: `pedigreeAttestation.test.js` proves the verifier works against a
 * locally signed token. This proves the two HANDLERS agree with it — that what
 * `/api/attest-pedigree` actually emits is what `/api/pedigree-keys` actually
 * publishes and what the client actually accepts. Those are three separately-written
 * files that have to share a purpose string, a claim vocabulary, an algorithm, and a
 * `kid`, and nothing but a test crossing all three would catch a drift between them.
 *
 * It also documents the diagnostic that matters in production:
 *   503 → deployed but unconfigured (the deliberate fail-closed path)
 *   404 → not deployed at all
 * Both endpoints are exercised in both states here.
 *
 * The env vars are set before the dynamic imports because both handlers read them at
 * module load.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

// Real hex. An earlier draft used "0xmasterbreeder…" as a readable placeholder and
// the endpoint rejected it with 400 — correctly, since `b`,`d`,`e` aside those are
// not hex digits. Worth keeping in mind: a mnemonic fake address passes tests that
// never validate format and fails the moment one does.
const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_WALLET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KID = "pedigree-endpoint-test";

// Privy is the trust root; a real token can't be minted in a test, so the boundary is
// stubbed and everything downstream of it is real.
let privyResult = { verified: true, userId: "did:privy:test", walletAddress: WALLET };
vi.mock("../../api/_lib/verifyPrivyToken.js", () => ({
  verifyPrivyToken: async () => privyResult,
}));

/** Minimal Vercel-shaped res that records what the handler did. */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

const post = (body) => ({ method: "POST", headers: { authorization: "Bearer fake" }, body });
const get = () => ({ method: "GET", headers: {} });

let attestHandler;
let keysHandler;
let unconfiguredAttest;
let unconfiguredKeys;
let client;

beforeAll(async () => {
  // The unconfigured handlers must be imported FIRST, while the env is still empty,
  // because the key material is read at module load.
  delete process.env.PEDIGREE_ATTESTATION_PRIVATE_KEY;
  delete process.env.PEDIGREE_ATTESTATION_PUBLIC_KEY;
  delete process.env.PEDIGREE_ATTESTATION_KEY_ID;
  unconfiguredAttest = (await import("../../api/_lib/attestPedigree.js?unconfigured")).default;
  unconfiguredKeys = (await import("../../api/_lib/pedigreeKeys.js?unconfigured")).default;

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  process.env.PEDIGREE_ATTESTATION_PRIVATE_KEY = await exportPKCS8(privateKey);
  process.env.PEDIGREE_ATTESTATION_PUBLIC_KEY = await exportSPKI(publicKey);
  process.env.PEDIGREE_ATTESTATION_KEY_ID = KID;

  attestHandler = (await import("../../api/_lib/attestPedigree.js?configured")).default;
  keysHandler = (await import("../../api/_lib/pedigreeKeys.js?configured")).default;
  client = await import("../services/pedigreeAttestation");
});

async function sealedDocument() {
  const { sealPedigreeDocument } = await import("../services/pedigreeDocument");
  return sealPedigreeDocument({
    tree: {
      target: { id: 10, speciesId: 42, scientificName: "Paracheirodon innesi", birthTimestamp: 1700000010, breeder: WALLET, onChainId: null },
      parents: { sire: null, dam: null },
      grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
    },
    issuer: WALLET,
    issuedAt: 1730000000,
  });
}

describe("unconfigured, both endpoints fail closed with 503", () => {
  it("attest-pedigree returns 503 rather than an unsigned attestation", async () => {
    // A placeholder would surface client-side as a trust level no document earned.
    const res = makeRes();
    await unconfiguredAttest(post({ pedigreeHash: "a".repeat(64) }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.attestation).toBeUndefined();
  });

  it("pedigree-keys returns 503 rather than an empty key set", async () => {
    // An empty `keys` array looks like a working endpoint that trusts nothing, and
    // every attestation would read as unverified with no reason given.
    const res = makeRes();
    await unconfiguredKeys(get(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.keys).toBeUndefined();
  });
});

describe("configured, the full chain agrees across all three files", () => {
  it("publishes a JWKS carrying the signer's kid and alg", async () => {
    const res = makeRes();
    await keysHandler(get(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", kid: KID, alg: "ES256", use: "sig" });
    // The private half must never be exported here.
    expect(res.body.keys[0].d).toBeUndefined();
    expect(res.headers["cache-control"]).toContain("max-age");
  });

  it("issues an attestation the CLIENT verifies against the PUBLISHED key", async () => {
    // The assertion this whole file exists for: three separately-written files
    // agreeing on purpose, claims, algorithm, and kid.
    const doc = await sealedDocument();

    const attestRes = makeRes();
    await attestHandler(post({ pedigreeHash: doc.hash, walletAddress: WALLET }), attestRes);
    expect(attestRes.statusCode).toBe(200);

    const keysRes = makeRes();
    await keysHandler(get(), keysRes);

    const { attachAttestation } = await import("../services/pedigreeDocument");
    const attested = attachAttestation(doc, attestRes.body.attestation);

    client.clearAttestationKeyCache();
    const { level, verified, reason } = await client.resolvePedigreeTrust(attested, {
      jwks: keysRes.body,
    });

    expect(reason).toBeNull();
    expect(verified).toBe(true);
    expect(level).toBe("platformAttested");
    expect(client.isPedigreeTrustworthy(level)).toBe(true);
  });

  it("emits no session-credential claims", async () => {
    // The reason this is a separate endpoint from mint-session: a pedigree document
    // gets PUBLISHED, so an attestation must not double as an access token.
    const doc = await sealedDocument();
    const res = makeRes();
    await attestHandler(post({ pedigreeHash: doc.hash }), res);

    const { assertNotCredential } = await import("../services/pedigreeDocument");
    expect(() => assertNotCredential(res.body.attestation)).not.toThrow();

    const [, payloadB64] = res.body.attestation.signature.split(".");
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    expect(claims.role).toBeUndefined();
    expect(claims.aud).toBeUndefined();
    // No expiry: a provenance record is a claim about a past moment.
    expect(claims.exp).toBeUndefined();
    expect(claims.asserts).toBe("wallet_authenticated_at_signing");
  });
});

describe("the attestation endpoint's gates", () => {
  it("rejects an unauthenticated caller", async () => {
    privyResult = { verified: false, error: "nope" };
    const res = makeRes();
    await attestHandler(post({ pedigreeHash: "a".repeat(64) }), res);
    expect(res.statusCode).toBe(401);
    privyResult = { verified: true, userId: "did:privy:test", walletAddress: WALLET };
  });

  it("rejects anything that is not a 64-char hex hash", async () => {
    for (const pedigreeHash of [undefined, "", "short", "z".repeat(64), "A".repeat(64), 12345]) {
      const res = makeRes();
      await attestHandler(post({ pedigreeHash }), res);
      expect(res.statusCode, String(pedigreeHash)).toBe(400);
    }
  });

  it("refuses to attest on behalf of a different wallet", async () => {
    // Otherwise a caller could attest somebody else's pedigree as them.
    const res = makeRes();
    await attestHandler(post({ pedigreeHash: "a".repeat(64), walletAddress: OTHER_WALLET }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/signed-in account/);
  });

  it("rejects non-POST", async () => {
    const res = makeRes();
    await attestHandler(get(), res);
    expect(res.statusCode).toBe(405);
  });

  it("rejects non-GET on the keys endpoint", async () => {
    const res = makeRes();
    await keysHandler(post({}), res);
    expect(res.statusCode).toBe(405);
  });
});
