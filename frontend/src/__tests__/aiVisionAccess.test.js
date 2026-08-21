/**
 * aiVisionAccess.test.js
 *
 * The gate in front of the paid Gemini vision calls, asserted rather than trusted.
 *
 * These are the three things that cost money or credibility if they regress:
 *   1. Which URLs the server is willing to fetch (an allowlist, not a suggestion).
 *   2. That an oversized image is refused before it reaches the model.
 *   3. That a model's species guess cannot pass itself off as a catalog record.
 *
 * The auth gate itself is asserted by mocking `verifyPrivyToken`, because the thing
 * worth pinning is the POLICY — anonymous is 401, a verified token with no wallet
 * claim is still allowed through — not jose's signature checking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { isFetchableImageUrl, resolveImagePart, MAX_IMAGE_BYTES } from "../../api/_lib/imageInput.js";

// ─── URL allowlist (server-side request forgery) ─────────────────────────────

describe("which URLs the server will fetch", () => {
  beforeEach(() => {
    // The allowlist is derived from the configured Supabase host, so the test has
    // to configure one. Set both names the module accepts.
    process.env.SUPABASE_URL = "https://abcdefgh.supabase.co";
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.EXTRA_IMAGE_HOSTS;
  });

  it("allows the project's own storage host, which is the only one a caller needs", () => {
    expect(
      isFetchableImageUrl("https://abcdefgh.supabase.co/storage/v1/object/public/reef-media/x.jpg"),
    ).toBe(true);
  });

  it("refuses hosts that are not on the allowlist", () => {
    // The original handler fetched any URL given to it, which turns the function
    // into a request proxy for whoever calls it.
    expect(isFetchableImageUrl("https://evil.example.com/x.jpg")).toBe(false);
    expect(isFetchableImageUrl("https://abcdefgh.supabase.co.evil.com/x.jpg")).toBe(false);
  });

  it("refuses plaintext http even on an allowed host", () => {
    expect(isFetchableImageUrl("http://abcdefgh.supabase.co/x.jpg")).toBe(false);
  });

  it("refuses address literals, so an allowlist entry cannot be sidestepped", () => {
    // The classic bypasses: talk to the loopback or link-local address directly.
    expect(isFetchableImageUrl("https://127.0.0.1/x.jpg")).toBe(false);
    expect(isFetchableImageUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isFetchableImageUrl("https://[::1]/x.jpg")).toBe(false);
    expect(isFetchableImageUrl("https://localhost/x.jpg")).toBe(false);
  });

  it("refuses nonsense instead of throwing", () => {
    expect(isFetchableImageUrl("not a url")).toBe(false);
    expect(isFetchableImageUrl("")).toBe(false);
    expect(isFetchableImageUrl(null)).toBe(false);
    expect(isFetchableImageUrl("javascript:alert(1)")).toBe(false);
  });

  it("allows nothing at all when no storage host is configured", () => {
    // Fail closed. A missing env var must not mean "fetch anything".
    delete process.env.SUPABASE_URL;
    expect(isFetchableImageUrl("https://abcdefgh.supabase.co/x.jpg")).toBe(false);
  });

  it("honours the explicit extra-hosts escape hatch", () => {
    process.env.EXTRA_IMAGE_HOSTS = "cdn.example.com";
    expect(isFetchableImageUrl("https://cdn.example.com/x.jpg")).toBe(true);
    expect(isFetchableImageUrl("https://other.example.com/x.jpg")).toBe(false);
  });
});

// ─── Image input ─────────────────────────────────────────────────────────────

/** A base64 payload that decodes to exactly `bytes` bytes. */
const base64OfSize = (bytes) => Buffer.alloc(bytes, 0x41).toString("base64");

describe("accepting an image", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://abcdefgh.supabase.co";
  });

  it("reads a data URL and keeps its declared type", async () => {
    const result = await resolveImagePart({
      imageBase64: `data:image/png;base64,${base64OfSize(64)}`,
    });
    expect(result.error).toBeUndefined();
    expect(result.part.inlineData.mimeType).toBe("image/png");
  });

  it("still accepts a bare base64 string as JPEG, which an existing caller sends", async () => {
    const result = await resolveImagePart({ imageBase64: base64OfSize(64) });
    expect(result.error).toBeUndefined();
    expect(result.part.inlineData.mimeType).toBe("image/jpeg");
  });

  it("refuses an image over the cap, before it can be billed", async () => {
    const result = await resolveImagePart({
      imageBase64: `data:image/jpeg;base64,${base64OfSize(MAX_IMAGE_BYTES + 1024)}`,
    });
    expect(result.part).toBeUndefined();
    expect(result.status).toBe(413);
  });

  it("refuses a URL that is not on the allowlist, pointing the caller at base64", async () => {
    const result = await resolveImagePart({ imageUrl: "https://evil.example.com/x.jpg" });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/imageBase64/);
  });

  it("requires one of the two inputs", async () => {
    const result = await resolveImagePart({});
    expect(result.status).toBe(400);
  });
});

// ─── Auth policy ─────────────────────────────────────────────────────────────

vi.mock("../../api/_lib/verifyPrivyToken.js", () => ({
  verifyPrivyToken: vi.fn(),
}));

const { verifyPrivyToken } = await import("../../api/_lib/verifyPrivyToken.js");
const { requireAccount, enforceAccountQuota } = await import("../../api/_lib/aiAccess.js");

/** Minimal res double that records what a handler tried to send. */
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

describe("who may spend money on a vision call", () => {
  beforeEach(() => {
    vi.mocked(verifyPrivyToken).mockReset();
  });

  it("turns an anonymous caller away with a real 401", async () => {
    // Not a 200-with-an-error-field. The handlers in ai.js degrade gracefully on
    // purpose, but a client cannot tell "sign in" from "the model was slow" unless
    // this one keeps its status code.
    vi.mocked(verifyPrivyToken).mockResolvedValue({ verified: false, error: "Missing header" });
    const res = fakeRes();

    expect(await requireAccount({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.needsAuth).toBe(true);
  });

  it("admits a verified account that has no wallet claim", async () => {
    // Privy email/Google logins routinely have a null `wallet_address`. Requiring a
    // wallet here — as speciesCuration.js correctly does for on-chain votes — would
    // lock ordinary signed-in users out of a feature unrelated to wallets.
    vi.mocked(verifyPrivyToken).mockResolvedValue({
      verified: true,
      userId: "did:privy:abc",
      walletAddress: null,
    });
    const res = fakeRes();

    const account = await requireAccount({ headers: {} }, res);
    expect(account).toEqual({ userId: "did:privy:abc", walletAddress: null });
    expect(res.statusCode).toBeNull();
  });

  it("rejects a token that verifies but carries no subject", async () => {
    vi.mocked(verifyPrivyToken).mockResolvedValue({ verified: true, userId: null });
    const res = fakeRes();

    expect(await requireAccount({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

describe("per-account quota", () => {
  it("allows up to the cap, then answers 429", () => {
    const userId = `did:privy:quota-${Math.random()}`;
    const opts = { userId, action: "identify-fish", maxPerDay: 3 };

    for (let i = 0; i < 3; i++) {
      expect(enforceAccountQuota(fakeRes(), opts)).toBe(true);
    }

    const res = fakeRes();
    expect(enforceAccountQuota(res, opts)).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.rateLimited).toBe(true);
  });

  it("counts per account, so one user cannot exhaust another's allowance", () => {
    const shared = { action: "identify-fish", maxPerDay: 1 };
    expect(enforceAccountQuota(fakeRes(), { ...shared, userId: "did:privy:one" })).toBe(true);
    // Keyed on the verified userId rather than on an IP, which is shared across NAT
    // and rotatable through a proxy pool.
    expect(enforceAccountQuota(fakeRes(), { ...shared, userId: "did:privy:two" })).toBe(true);
  });

  it("publishes the remaining allowance so a client can show it", () => {
    const res = fakeRes();
    enforceAccountQuota(res, { userId: `did:privy:h-${Math.random()}`, action: "alt-text", maxPerDay: 10 });
    expect(res.headers["X-RateLimit-Limit"]).toBe("10");
    expect(res.headers["X-RateLimit-Remaining"]).toBe("9");
  });
});

// ─── Grounding ───────────────────────────────────────────────────────────────

// Imported from `_lib` rather than from `api/ai.js`: that file imports `ethers`,
// which the Vite config aliases to a browser shim reading `window`, so pulling it
// into a node-environment test fails at collection.
const { groundCandidates } = await import("../../api/_lib/identifyGrounding.js");

describe("an identification is a suggestion, not a catalog record", () => {
  it("marks a name we do not carry as not in the catalog", () => {
    // The load-bearing distinction. A name the model produced is a guess; a
    // specCode is a row in our data. Presenting the first as the second is how an
    // AI hallucination becomes a database fact.
    const [candidate] = groundCandidates([
      { scientificName: "Fakeus imaginarius", commonName: "Invented Tetra", confidence: 0.9 },
    ]);
    expect(candidate.inCatalog).toBe(false);
    expect(candidate.specCode).toBeNull();
  });

  it("resolves a real species to its catalog entry, so the UI can link to it", () => {
    // The positive case. Without this, `inCatalog` could be permanently false and
    // every other assertion here would still pass.
    const [candidate] = groundCandidates([
      { scientificName: "Betta splendens", commonName: "Betta", confidence: 0.88 },
    ]);
    expect(candidate.inCatalog).toBe(true);
    expect(candidate.specCode).toBe(4768);
    // Our curated name wins, so one fish is called one thing across the app.
    expect(candidate.catalogCommonName).toBe("Betta / Siamese Fighting Fish");
  });

  it("clamps confidence into 0..1 and never emits NaN", () => {
    const out = groundCandidates([
      { scientificName: "A a", commonName: "A", confidence: 1.7 },
      { scientificName: "B b", commonName: "B", confidence: -3 },
      { scientificName: "C c", commonName: "C", confidence: "not a number" },
    ]);
    expect(out.map((c) => c.confidence)).toEqual([1, 0, 0]);
  });

  it("returns at most three candidates", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      scientificName: `Genus sp${i}`,
      commonName: `Fish ${i}`,
      confidence: 0.5,
    }));
    expect(groundCandidates(many)).toHaveLength(3);
  });

  it("drops entries with no name at all rather than rendering a blank row", () => {
    expect(groundCandidates([{ confidence: 0.8 }])).toHaveLength(0);
  });

  it("survives a model that ignores the schema", () => {
    // The response schema makes this unlikely, not impossible.
    expect(groundCandidates(null)).toEqual([]);
    expect(groundCandidates("nope")).toEqual([]);
    expect(groundCandidates(undefined)).toEqual([]);
  });
});
