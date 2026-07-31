/**
 * Sealing the pedigree at listing time (docs/BREEDER_STATE_MODEL.md §9.30, T3 §2.5).
 *
 * THE TRANSPORT DECISION, MADE. The spec said "seal at fulfillment"; that cannot work,
 * because settlement runs server-side in the Stripe webhook while the pedigree lives in
 * the seller's browser (§3 makes Dexie authoritative for serial → specimen). Listing
 * time is the only moment the seller's device has the spawn, its parents, AND an
 * authenticated wallet.
 *
 * It needs no migration: `aquadex_listings.data` is a jsonb blob of the whole listing
 * object, so a document added to the listing reaches buyers as-is.
 *
 * The case worth thinking hardest about is the COHORT. A batch listing sells fry with
 * no individual records (§4.2 — they are counts), so there is no specimen to be the
 * document's subject. The spawn stands in, and the claim becomes "this cohort came from
 * these parents" — which is exactly what a buyer of eggs pays for, and is true without
 * inventing a certificate for anything unhatched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const SELLER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BREEDER = "0xcccccccccccccccccccccccccccccccccccccccc";

let spawnRows = [];
let specimenRows = [];

vi.mock("../db", () => ({
  db: {
    spawns: { get: async (id) => spawnRows.find((s) => Number(s.spawnId) === Number(id)) },
    specimens: { get: async (id) => specimenRows.find((s) => Number(s.id) === Number(id)) },
  },
}));

// Resolve through the real precedence rule: Dexie first, contract never for serials.
vi.mock("../services/pedigree", () => ({
  PEDIGREE_DEPTH: 3,
  fetchSpecimenNode: async (_contract, id) => {
    const row = specimenRows.find((s) => Number(s.id) === Number(id));
    if (!row) return null;
    return {
      id: row.id, speciesId: row.speciesId ?? 7, scientificName: "Paracheirodon innesi",
      birthTimestamp: 1700000000 + Number(row.id), breeder: row.breeder || BREEDER,
      sireId: row.sireId || 0, damId: row.damId || 0, onChainId: null,
      pedigreeHash: row.pedigreeHash || null,
    };
  },
  fetchPedigreeTree: async () => null,
}));

const {
  LISTING_PEDIGREE_FAILURE,
  attachPedigreeToListing,
  lotStage,
  sealLotPedigree,
  setSessionTokenGetter,
} = await import("../services/listingPedigree");
const { ATTESTATION_METHOD, ATTESTATION_PURPOSE, PEDIGREE_TRUST, pedigreeTrustLevel } =
  await import("../services/pedigreeDocument");
const { ancestorCoverage, traceBreeders, verifyPedigreeDocument } =
  await import("../services/pedigreeDocument");
const { LIFE_STAGE } = await import("../utils/lifeStage");

beforeEach(() => {
  setSessionTokenGetter(null);
  // Grandparents 1,2,3,4 → parents 10,11 → spawn 900.
  specimenRows = [
    { id: 1, breeder: BREEDER }, { id: 2, breeder: BREEDER },
    { id: 3, breeder: BREEDER }, { id: 4, breeder: BREEDER },
    { id: 10, breeder: BREEDER, sireId: 1, damId: 2 },
    { id: 11, breeder: BREEDER, sireId: 3, damId: 4 },
  ];
  spawnRows = [{
    spawnId: 900, sireId: 10, damId: 11, tankId: 3, speciesId: 7,
    ownerAddress: SELLER, timestamp: 1730000000, offspringIds: [],
  }];
});

describe("a cohort's pedigree has the SPAWN as its subject", () => {
  it("seals with the real parents and grandparents resolved", async () => {
    const result = await sealLotPedigree({ spawnId: 900, issuer: SELLER });

    expect(result.ok).toBe(true);
    await expect(verifyPedigreeDocument(result.document)).resolves.toMatchObject({ ok: true });
    // Two parents plus four grandparents — the full tree, from a cohort with no
    // individual records of its own.
    expect(ancestorCoverage(result.document)).toEqual({ recorded: 6, possible: 6, complete: true });
  });

  it("records the spawn id as the subject's serial, not a fake certificate number", async () => {
    const { document } = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    expect(document.body.subject.serialAtIssue).toBe(900);
    expect(document.body.source.spawnId).toBe("900");
  });

  it("carries the breeder through, which is what a buyer is paying for", async () => {
    const { document } = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    expect(traceBreeders(document)).toContain(BREEDER);
  });

  it("REFUSES a cohort with no resolvable parents rather than sealing an empty claim", async () => {
    // A document with six null ancestors is technically valid and commercially
    // misleading: it renders as "pedigree attached" while proving nothing. An honest
    // absence beats an empty claim (§12.1).
    spawnRows = [{ ...spawnRows[0], sireId: 0, damId: 0 }];
    const result = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(LISTING_PEDIGREE_FAILURE.NO_PARENTS);
    expect(result.document).toBeNull();
  });

  it("fails cleanly on an unknown spawn or a missing issuer", async () => {
    expect((await sealLotPedigree({ spawnId: 404, issuer: SELLER })).reason)
      .toBe(LISTING_PEDIGREE_FAILURE.NO_SPAWN);
    expect((await sealLotPedigree({ spawnId: 900, issuer: "" })).reason)
      .toBe(LISTING_PEDIGREE_FAILURE.NO_ISSUER);
  });

  it("chains to the parents' own documents when they have them", async () => {
    // A lot sold by someone who themselves bought a lot still reaches the original
    // breeder, because the chain is inherited rather than re-derived.
    specimenRows.find((s) => s.id === 10).pedigreeHash = "a".repeat(64);
    const { document } = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    expect(document.body.parentDocuments.sire).toBe("a".repeat(64));
    expect(document.body.parentDocuments.dam).toBeNull();
  });

  it("seals with one parent known and one not, without pretending otherwise", async () => {
    spawnRows = [{ ...spawnRows[0], damId: 0 }];
    const result = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    expect(result.ok).toBe(true);
    expect(result.document.body.ancestors.dam).toBeNull();
    expect(ancestorCoverage(result.document).complete).toBe(false);
  });
});

describe("attachPedigreeToListing", () => {
  it("puts both the hash and the document on a copy of the listing", async () => {
    const { document } = await sealLotPedigree({ spawnId: 900, issuer: SELLER });
    const listing = { id: 1, spawnId: 900 };
    const withPedigree = attachPedigreeToListing(listing, document);

    // Hash for indexing and comparison without parsing; document so the pedigree
    // travels even to a client that can't reach our storage.
    expect(withPedigree.pedigreeHash).toBe(document.hash);
    expect(withPedigree.pedigreeDocument).toBe(document);
    // Input untouched.
    expect(listing.pedigreeHash).toBeUndefined();
  });

  it("records absence EXPLICITLY as null, not as a missing key", async () => {
    // So a reader can tell "this seller published no pedigree" from "this listing
    // predates the feature".
    const withNone = attachPedigreeToListing({ id: 1 }, null);
    expect(withNone.pedigreeHash).toBeNull();
    expect(withNone.pedigreeDocument).toBeNull();
    expect("pedigreeHash" in withNone).toBe(true);
  });

  it("tolerates junk rather than throwing inside a listing submit", () => {
    expect(attachPedigreeToListing(null, null)).toBeNull();
  });
});

describe("lotStage", () => {
  it("defaults a legacy batch listing to fry", () => {
    // Batch listings that predate the life-stage field carry no stage, and fry is what
    // this wizard has always sold.
    expect(lotStage({ isBatch: true })).toBe(LIFE_STAGE.FRY);
    expect(lotStage({ lifeStage: "3 weeks" })).toBe(LIFE_STAGE.FRY);
  });

  it("respects a recorded stage", () => {
    expect(lotStage({ lifeStage: LIFE_STAGE.EGG })).toBe(LIFE_STAGE.EGG);
    expect(lotStage({ lifeStage: "eggs" })).toBe(LIFE_STAGE.EGG);
  });
});

/** Comment-stripped source, for the guards below and in the bridge suite (trap 6.3). */
const code = (path) =>
  require("node:fs").readFileSync(require("node:url").fileURLToPath(new URL(path, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the listing wizard seals without blocking the sale", () => {
  it("attaches a pedigree to the listing it actually saves and syncs", () => {
    const src = code("../components/BatchListingWizard.jsx");
    expect(src).toContain("sealLotPedigree");
    expect(src).toContain("attachPedigreeToListing");
    // The sealed copy must be what reaches Dexie and the cloud, not the original.
    expect(src).toContain("db.localListings.put(listingWithPedigree)");
    expect(src).toContain("syncListingToCloud(listingWithPedigree)");
  });

  it("wraps sealing so a failure cannot stop a breeder listing their fish", () => {
    const src = code("../components/BatchListingWizard.jsx");
    expect(src).toMatch(/try \{[\s\S]{0,400}sealLotPedigree[\s\S]{0,400}\} catch/);
    // The fallback still records the absence explicitly.
    expect(src).toMatch(/attachPedigreeToListing\(listing, null\)/);
  });

  it("seals an INDIVIDUAL listing too, in the one place that writes them", () => {
    // §9.25's other half. `relayCreateListing` is the single individual-listing writer
    // (ListSpecimenModal is its only caller), so sealing there covers the path without
    // adding a second write route.
    const src = code("../services/relayer.js");
    expect(src).toContain("sealSpecimenPedigree");
    expect(src).toContain("db.localListings.put(listingWithPedigree)");
    expect(src).toContain("syncListingToCloud(listingWithPedigree)");
    // Same non-blocking bias as the batch wizard.
    expect(src).toMatch(/try \{[\s\S]{0,600}sealSpecimenPedigree[\s\S]{0,600}\} catch/);
  });
});

// ─── Attestation actually gets asked for ───────────────────────────────────

describe("the session-token bridge", () => {
  // THE BUG THIS CLOSES: both seal functions took an optional `authToken` and every
  // caller omitted it, so `requestPlatformAttestation` returned null and EVERY document
  // this app issued was unattested — not because the keypair is unset, but because
  // nothing ever asked. `unattested` is a legitimate state the ladder reports honestly,
  // so it would have stayed invisible after the keypair landed.
  const attestation = (hash) => ({
    method: ATTESTATION_METHOD.PLATFORM,
    purpose: ATTESTATION_PURPOSE,
    subjectHash: hash,
    signature: "eyJ.sig",
    signedBy: SELLER,
  });

  function fetchImplFor() {
    return async (_url, init) => {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ attestation: attestation(body.pedigreeHash) }) };
    };
  }

  it("resolves the token from the registered session when none is passed", async () => {
    setSessionTokenGetter(async () => "privy-token");
    const result = await sealLotPedigree({ spawnId: 900, issuer: SELLER, fetchImpl: fetchImplFor() });
    expect(result.attested).toBe(true);
    expect(await pedigreeTrustLevel(result.document, { attestationVerified: true }))
      .toBe(PEDIGREE_TRUST.PLATFORM_ATTESTED);
  });

  it("seals unattested with no session, rather than failing the listing", async () => {
    let called = false;
    setSessionTokenGetter(null);
    const result = await sealLotPedigree({
      spawnId: 900, issuer: SELLER, fetchImpl: async () => { called = true; },
    });
    expect(result.ok).toBe(true);
    expect(result.attested).toBe(false);
    // No doomed request either — `requestPlatformAttestation` skips without a token.
    expect(called).toBe(false);
    expect(await pedigreeTrustLevel(result.document)).toBe(PEDIGREE_TRUST.UNATTESTED);
  });

  it("still honours an EXPLICIT null as do-not-attest", async () => {
    // `undefined` means "resolve from the session"; `null` keeps the old opt-out, which
    // offline paths and tests rely on.
    setSessionTokenGetter(async () => "privy-token");
    let called = false;
    const result = await sealLotPedigree({
      spawnId: 900, issuer: SELLER, authToken: null, fetchImpl: async () => { called = true; },
    });
    expect(called).toBe(false);
    expect(result.attested).toBe(false);
  });

  it("survives a token getter that throws", async () => {
    setSessionTokenGetter(async () => { throw new Error("session expired"); });
    const result = await sealLotPedigree({ spawnId: 900, issuer: SELLER, fetchImpl: fetchImplFor() });
    expect(result.ok).toBe(true);
    expect(result.attested).toBe(false);
  });

  it("is registered from AuthContext alongside the other bridges", () => {
    const src = code("../contexts/AuthContext.jsx");
    expect(src).toContain('setSessionTokenGetter as setListingPedigreeSessionTokenGetter');
    expect(src).toContain("setListingPedigreeSessionTokenGetter(getAccessToken)");
    // And cleared when the user is not Privy-authenticated, so an unauthenticated
    // seller gets an honestly unattested document rather than a stale token.
    expect(src).toContain("setListingPedigreeSessionTokenGetter(null)");
  });
});
