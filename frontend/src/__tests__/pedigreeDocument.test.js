/**
 * The portable pedigree document (docs/BREEDER_STATE_MODEL.md §9.25 / §12,
 * docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md).
 *
 * WHAT THESE TESTS PROTECT: a pedigree is what justifies a premium price, and the
 * buyer who pays it is the NEXT buyer, not the holder. So the document has to be
 * tamper-evident, it has to compose across generations without reading anyone's
 * private registry, and — most importantly — an unsigned one must never read as
 * verified.
 *
 * The four things worth failing a build over:
 *
 *   1. Tamper evidence actually works (edit a sealed body → verification fails).
 *   2. The hashed body holds nothing mutable, or every document breaks at once the
 *      first time a fish is moved.
 *   3. Unattested never reports as verified.
 *   4. Non-finite numbers throw. JSON.stringify(NaN) is "null", which would make a
 *      document unable to verify itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ANCESTOR_ROLES,
  CANONICAL_FORM_VERSION,
  FORBIDDEN_BODY_FIELDS,
  PEDIGREE_BODY_DEPTH,
  PEDIGREE_DOC_VERSION,
  PEDIGREE_TRUST,
  PEDIGREE_TRUST_COPY,
  allPedigreeTrustCopy,
  ancestorCoverage,
  buildPedigreeBody,
  canonicalize,
  hashCanonical,
  pedigreeTrustLevel,
  pedigreeTrustText,
  sealPedigreeDocument,
  traceBreeders,
  verifyPedigreeChain,
  verifyPedigreeDocument,
} from "../services/pedigreeDocument";
import { PEDIGREE_DEPTH } from "../services/pedigree";
import { containsProhibitedTerm } from "../services/orderCopy";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MASTER = "0xMASTERBREEDER000000000000000000000000AAAA";
const BUYER = "0xBUYER00000000000000000000000000000000BBBB";

const node = (id, breeder, overrides = {}) => ({
  id,
  speciesId: 42,
  scientificName: "Paracheirodon innesi",
  birthTimestamp: 1700000000 + id,
  breeder,
  sireId: 0,
  damId: 0,
  onChainId: null,
  ...overrides,
});

/** A full 3-generation tree: subject, both parents, all four grandparents. */
function fullTree() {
  return {
    target: node(10, MASTER),
    parents: { sire: node(7, MASTER), dam: node(8, MASTER) },
    grandparents: {
      sireSire: node(1, MASTER),
      sireDam: node(2, MASTER),
      damSire: node(3, MASTER),
      damDam: node(4, MASTER),
    },
  };
}

/** Parents known, grandparents unknown — the common real-world case. */
function parentsOnlyTree() {
  return {
    target: node(10, MASTER),
    parents: { sire: node(7, MASTER), dam: node(8, MASTER) },
    grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
  };
}

/** A wild-caught fish: nothing above it is recorded. */
function wildCaughtTree() {
  return {
    target: node(10, MASTER),
    parents: { sire: null, dam: null },
    grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
  };
}

const seal = (tree = fullTree(), extra = {}) =>
  sealPedigreeDocument({ tree, issuer: MASTER, issuedAt: 1730000000, ...extra });

// ─── Canonicalization ───────────────────────────────────────────────────────

describe("canonicalize", () => {
  it("is independent of key order, recursively", () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("drops undefined keys but keeps null, which means something different", () => {
    // `null` is "recorded as unknown"; absent is "not part of this claim".
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("THROWS on non-finite numbers rather than writing null", () => {
    // JSON.stringify(NaN) === "null". Coercing would produce a document whose hash
    // no longer describes its contents — a provenance record that fails its own
    // verification.
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalize({ x: bad })).toThrow(/non-finite/);
    }
  });

  it("names the path to the offending value", () => {
    expect(() => canonicalize({ subject: { birthTimestamp: NaN } }))
      .toThrow(/subject\.birthTimestamp/);
  });

  it("throws on functions, symbols, and bigints instead of dropping them", () => {
    expect(() => canonicalize({ f: () => {} })).toThrow(/function/);
    expect(() => canonicalize({ s: Symbol("x") })).toThrow(/symbol/);
    expect(() => canonicalize({ n: 1n })).toThrow(/bigint/);
  });

  it("normalizes -0 so it cannot produce two hashes for one value", () => {
    expect(canonicalize({ x: -0 })).toBe(canonicalize({ x: 0 }));
  });

  it("is byte-stable across repeated calls", () => {
    const body = buildPedigreeBody({ tree: fullTree(), issuer: MASTER, issuedAt: 1 });
    expect(canonicalize(body)).toBe(canonicalize(body));
  });
});

// ─── Hashing ────────────────────────────────────────────────────────────────

describe("hashCanonical", () => {
  it("produces the pinned SHA-256 for a known input", () => {
    // Pinned so an accidental change to `canonicalize` or the digest fails loudly
    // rather than silently reissuing every future document under new rules.
    //
    // This value was confirmed against node:crypto independently of the module's
    // Web Crypto path — the two agree, so it is a real SHA-256 and not merely
    // self-consistent with our own implementation. Verify the same way before ever
    // changing it:
    //   createHash("sha256").update('{"a":1}', "utf8").digest("hex")
    return expect(hashCanonical('{"a":1}')).resolves.toBe(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    );
  });

  it("is deterministic", async () => {
    expect(await hashCanonical("x")).toBe(await hashCanonical("x"));
  });

  it("rejects a non-string, so a raw object can't be hashed unserialized", async () => {
    await expect(hashCanonical({ a: 1 })).rejects.toThrow(/canonical string/);
  });
});

describe("the hash covers every part of the claim", () => {
  it("changes when any top-level body field changes", async () => {
    const sealed = await seal();
    for (const key of Object.keys(sealed.body)) {
      const mutated = structuredClone(sealed.body);
      // Perturb in a type-appropriate way.
      if (typeof mutated[key] === "number") mutated[key] += 1;
      else if (typeof mutated[key] === "string") mutated[key] = `${mutated[key]}x`;
      else mutated[key] = { tampered: true };
      const rehashed = await hashCanonical(canonicalize(mutated));
      expect(rehashed, `field: ${key}`).not.toBe(sealed.hash);
    }
  });

  it("does NOT change when key order changes", async () => {
    const sealed = await seal();
    const reordered = Object.fromEntries(Object.entries(sealed.body).reverse());
    expect(await hashCanonical(canonicalize(reordered))).toBe(sealed.hash);
  });

  it("changes when a single ancestor's breeder changes", async () => {
    // The breeder EOA is the payload the premium rests on (§5), so it must be
    // inside the hash and not alongside it.
    const sealed = await seal();
    const mutated = structuredClone(sealed.body);
    mutated.ancestors.sireSire.breeder = BUYER.toLowerCase();
    expect(await hashCanonical(canonicalize(mutated))).not.toBe(sealed.hash);
  });
});

// ─── Tamper evidence ────────────────────────────────────────────────────────

describe("tamper evidence", () => {
  it("verifies a freshly sealed document", async () => {
    const sealed = await seal();
    await expect(verifyPedigreeDocument(sealed)).resolves.toMatchObject({ ok: true });
  });

  it("FAILS when the body is edited after sealing", async () => {
    // THE POINT OF THE WHOLE MODULE. A holder who can edit their own pedigree and
    // still have it read as valid proves nothing to the next buyer.
    const sealed = await seal();
    sealed.body.subject.breeder = BUYER.toLowerCase();
    const result = await verifyPedigreeDocument(sealed);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/);
  });

  it("fails on a malformed or absent document rather than passing it through", async () => {
    for (const bad of [null, undefined, 42, {}, { body: {} }, { hash: "abc" }]) {
      const result = await verifyPedigreeDocument(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("fails, rather than throws, when the body cannot be serialized", async () => {
    const sealed = await seal();
    sealed.body.issuedAt = NaN;
    const result = await verifyPedigreeDocument(sealed);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not serializable/);
  });
});

// ─── The claim holds nothing mutable ────────────────────────────────────────

describe("the body records only what never changes", () => {
  it("contains no mutable specimen field", async () => {
    const sealed = await seal();
    const serialized = canonicalize(sealed.body);
    for (const field of FORBIDDEN_BODY_FIELDS) {
      expect(serialized, field).not.toContain(`"${field}"`);
    }
  });

  it("still verifies after the fish is retired, archived, renamed, and moved", async () => {
    // The failure this prevents arrives months later and breaks every document at
    // once, so it is asserted rather than reasoned about.
    const tree = fullTree();
    const sealed = await seal(tree);

    tree.target.status = 1;
    tree.target.archived = true;
    tree.target.currentTankId = 99;
    tree.target.ownerAddress = BUYER;
    tree.target.commonName = "Renamed Fish";

    const resealed = await seal(tree);
    expect(resealed.hash).toBe(sealed.hash);
    await expect(verifyPedigreeDocument(sealed)).resolves.toMatchObject({ ok: true });
  });

  it("records the serial for reference but never as identity", async () => {
    const sealed = await seal();
    expect(sealed.body.subject.serialAtIssue).toBe(10);
    // The name is the guardrail: nothing resolves by it, because a serial is
    // device-scoped (§3, §12.2).
    expect(canonicalize(sealed.body)).not.toContain('"sireId"');
    expect(canonicalize(sealed.body)).not.toContain('"damId"');
  });
});

// ─── Unknown ancestry is explicit ───────────────────────────────────────────

describe("unknown ancestry is recorded, not omitted", () => {
  it("keeps all six roles as keys even for a wild-caught fish", async () => {
    const sealed = await seal(wildCaughtTree());
    for (const role of ANCESTOR_ROLES) {
      expect(Object.prototype.hasOwnProperty.call(sealed.body.ancestors, role), role).toBe(true);
      expect(sealed.body.ancestors[role]).toBeNull();
    }
    // A pedigree with no recorded ancestors is still a valid document — it just
    // proves less, which `ancestorCoverage` reports.
    await expect(verifyPedigreeDocument(sealed)).resolves.toMatchObject({ ok: true });
  });

  it("reports coverage honestly", async () => {
    expect(ancestorCoverage(await seal(fullTree()))).toEqual({
      recorded: 6, possible: 6, complete: true,
    });
    expect(ancestorCoverage(await seal(parentsOnlyTree()))).toEqual({
      recorded: 2, possible: 6, complete: false,
    });
    expect(ancestorCoverage(await seal(wildCaughtTree()))).toEqual({
      recorded: 0, possible: 6, complete: false,
    });
  });

  it("treats a missing document as zero coverage rather than throwing", () => {
    expect(ancestorCoverage(null).recorded).toBe(0);
    expect(ancestorCoverage({}).possible).toBe(6);
  });

  it("refuses to build a document for an unresolvable subject", () => {
    // A pedigree for an unknown fish is not a weaker claim, it is not a claim.
    expect(() => buildPedigreeBody({ tree: null, issuer: MASTER })).toThrow(/subject/);
    expect(() => buildPedigreeBody({ tree: { target: null }, issuer: MASTER })).toThrow(/subject/);
  });

  it("refuses to build a document with no issuer", () => {
    // An unattributed pedigree can never be attested, so it could never be worth
    // more than a hand-typed one.
    expect(() => buildPedigreeBody({ tree: fullTree(), issuer: "" })).toThrow(/issuer/);
    expect(() => buildPedigreeBody({ tree: fullTree() })).toThrow(/issuer/);
  });
});

describe("traceBreeders", () => {
  it("returns the subject's breeder first and dedupes", async () => {
    const sealed = await seal();
    expect(traceBreeders(sealed)).toEqual([MASTER.toLowerCase()]);
  });

  it("includes an ancestor breeder the current owner never was", async () => {
    // The scenario: the buyer owns the fish, the master breeder bred its parents.
    // "Descended from that breeder" is the whole premium.
    const tree = parentsOnlyTree();
    tree.target.breeder = BUYER;
    const sealed = await seal(tree, { issuer: BUYER });
    expect(traceBreeders(sealed)).toEqual([BUYER.toLowerCase(), MASTER.toLowerCase()]);
  });

  it("never returns empty for a valid document, so empty always means malformed", async () => {
    expect(traceBreeders(await seal(wildCaughtTree()))).toEqual([MASTER.toLowerCase()]);
    expect(traceBreeders(null)).toEqual([]);
  });
});

// ─── The chain ──────────────────────────────────────────────────────────────

describe("the chain composes across ownership boundaries", () => {
  /**
   * Three generations, each sealed by a different wallet, exactly as the scenario
   * runs: master breeder → buyer → buyer's buyer. No wallet can read another's
   * registry, so the chain is the only thing carrying the claim.
   */
  async function threeGenerations() {
    const grandparent = await sealPedigreeDocument({
      tree: wildCaughtTree(), issuer: MASTER, issuedAt: 1000,
    });
    const parentTree = parentsOnlyTree();
    parentTree.target.breeder = MASTER;
    const parent = await sealPedigreeDocument({
      tree: parentTree,
      issuer: MASTER,
      issuedAt: 2000,
      parentDocuments: { sire: grandparent.hash, dam: null },
    });
    const childTree = parentsOnlyTree();
    childTree.target.breeder = BUYER;
    const child = await sealPedigreeDocument({
      tree: childTree,
      issuer: BUYER,
      issuedAt: 3000,
      parentDocuments: { sire: parent.hash, dam: null },
    });
    return { grandparent, parent, child };
  }

  it("makes a child's hash depend on its parents' hashes", async () => {
    const a = await seal(fullTree(), { parentDocuments: { sire: "aaa", dam: null } });
    const b = await seal(fullTree(), { parentDocuments: { sire: "bbb", dam: null } });
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies a valid three-generation chain", async () => {
    const { grandparent, parent, child } = await threeGenerations();
    const result = await verifyPedigreeChain([child, parent, grandparent], child.hash);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
  });

  it("reaches a breeder that appears in no local record", async () => {
    // The entire point of §9.25: the buyer's own registry contains nothing of the
    // master breeder's, and the claim still resolves.
    const { grandparent, parent, child } = await threeGenerations();
    expect(traceBreeders(child)).toContain(MASTER.toLowerCase());
    const chainBreeders = [child, parent, grandparent].flatMap(traceBreeders);
    expect(chainBreeders).toContain(MASTER.toLowerCase());
  });

  it("identifies the SPECIFIC broken link when a document is tampered with", async () => {
    const { grandparent, parent, child } = await threeGenerations();
    parent.body.subject.breeder = BUYER.toLowerCase();
    const result = await verifyPedigreeChain([child, parent, grandparent], child.hash);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(parent.hash);
    expect(result.reason).toMatch(/does not match/);
  });

  it("distinguishes a missing ancestor document from a forged one", async () => {
    // A gap means "incomplete", not "untrustworthy" — different things to tell a
    // buyer, so they get different reasons.
    const { parent, child } = await threeGenerations();
    const result = await verifyPedigreeChain([child, parent], child.hash);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing document/);
  });

  it("reports no root rather than silently passing an empty chain", async () => {
    const result = await verifyPedigreeChain([], "deadbeef");
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(0);
  });

  it("terminates on a cyclic chain instead of looping forever", async () => {
    const doc = await seal();
    doc.body.parentDocuments.sire = doc.hash;
    const result = await verifyPedigreeChain([doc], doc.hash);
    // The edited body no longer matches its hash, so this reports invalid — the
    // assertion that matters is that it RETURNS.
    expect(result.ok).toBe(false);
  });
});

// ─── Trust level ────────────────────────────────────────────────────────────

describe("nothing reads as verified until it is attested", () => {
  it("reports a sealed but unsigned document as unattested", async () => {
    const sealed = await seal();
    expect(sealed.attestation).toBeNull();
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.UNATTESTED);
  });

  it("reports a tampered document as invalid, not merely unattested", async () => {
    // Worse than absent, so it must not share a bucket with "not signed yet".
    const sealed = await seal();
    sealed.body.issuedAt += 1;
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.INVALID);
  });

  it("reports attested only with a signature, and anchored only with an anchor", async () => {
    const sealed = await seal();
    sealed.attestation = { signature: "0xsig" };
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.ATTESTED);
    sealed.attestation = { signature: "0xsig", anchor: { txHash: "0xtx" } };
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.ANCHORED);
  });

  it("does not accept an attestation object without a signature", async () => {
    const sealed = await seal();
    sealed.attestation = { signedBy: MASTER };
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.UNATTESTED);
  });

  it("does not treat an anchor alone as attested", async () => {
    const sealed = await seal();
    sealed.attestation = { anchor: { txHash: "0xtx" } };
    expect(await pedigreeTrustLevel(sealed)).toBe(PEDIGREE_TRUST.UNATTESTED);
  });
});

describe("PEDIGREE_TRUST_COPY", () => {
  it("is free of PROHIBITED_TERMS in both modes", () => {
    for (const text of allPedigreeTrustCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("covers every trust level", () => {
    for (const level of Object.values(PEDIGREE_TRUST)) {
      expect(PEDIGREE_TRUST_COPY[level], level).toBeTruthy();
      expect(PEDIGREE_TRUST_COPY[level].pro, level).toBeTruthy();
      expect(PEDIGREE_TRUST_COPY[level].casual, level).toBeTruthy();
    }
  });

  it("never describes an unattested pedigree as verified", () => {
    // The word is the whole problem — §9.28 was a badge that said "Verified" over
    // nothing. Both unattested variants must be plainly negative.
    for (const text of [PEDIGREE_TRUST_COPY.unattested.pro, PEDIGREE_TRUST_COPY.unattested.casual]) {
      expect(text.toLowerCase()).not.toMatch(/\bverified\b/);
      // And it has to actively say it isn't established, not merely omit the claim.
      expect(text.toLowerCase()).toMatch(/\bnot\b|\bcannot\b|\bhasn't\b/);
    }
  });

  it("reserves the positive wording for levels that have earned it", () => {
    // "confirmed" may appear in the unattested copy only as a negation
    // ("hasn't confirmed"). Asserted by position rather than by a lookahead regex,
    // which is easy to get backwards.
    const casual = PEDIGREE_TRUST_COPY.unattested.casual.toLowerCase();
    if (casual.includes("confirmed")) {
      expect(casual).toMatch(/(hasn't|has not|not)\s+confirmed/);
    }
    expect(PEDIGREE_TRUST_COPY.attested.casual.toLowerCase()).toContain("confirmed");
  });

  it("says plainly that an unrecorded ancestor is unknown, not unrelated", () => {
    expect(PEDIGREE_TRUST_COPY.incomplete.pro.toLowerCase()).toContain("not unrelated");
  });

  it("falls back rather than rendering a blank", () => {
    expect(pedigreeTrustText("no-such-level")).toBe(PEDIGREE_TRUST_COPY.invalid.pro);
    expect(pedigreeTrustText("attested", { casual: true }))
      .toBe(PEDIGREE_TRUST_COPY.attested.casual);
  });
});

// ─── Module hygiene ─────────────────────────────────────────────────────────

describe("the module stays pure and loadable anywhere", () => {
  const SRC = readFileSync(
    fileURLToPath(new URL("../services/pedigreeDocument.js", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports neither ethersCompat nor the database", () => {
    // ethersCompat reads `window.ethers` at module load, so importing it would make
    // this unloadable in the node test environment. `db` would drag Dexie into the
    // graph of a hashing primitive.
    expect(SRC).not.toContain("ethersCompat");
    expect(SRC).not.toMatch(/from\s+["'][^"']*\/db["']/);
    expect(SRC).not.toMatch(/from\s+["']\.\/pedigree["']/);
  });

  it("uses Web Crypto's SHA-256 with no weaker fallback", () => {
    expect(SRC).toContain("globalThis.crypto");
    expect(SRC).toMatch(/subtle\??\.digest|subtle\(\)\.digest/);
    expect(SRC).toContain('"SHA-256"');
    // A fallback would silently weaken every pedigree issued while it was active.
    expect(SRC).not.toMatch(/md5|sha1\b/i);
  });

  it("keeps its depth constant in step with services/pedigree.js", () => {
    // The constant is duplicated on purpose (see the module header). This is what
    // makes the duplication safe.
    expect(PEDIGREE_BODY_DEPTH).toBe(PEDIGREE_DEPTH);
  });

  it("versions both the document and the serialization rules", async () => {
    expect(PEDIGREE_DOC_VERSION).toBeGreaterThanOrEqual(1);
    expect(CANONICAL_FORM_VERSION).toBeGreaterThanOrEqual(1);
    // The form version is inside the hashed body, so a future reader can tell which
    // rules produced a given hash.
    const sealed = await seal();
    expect(sealed.body.formVersion).toBe(CANONICAL_FORM_VERSION);
    expect(sealed.version).toBe(PEDIGREE_DOC_VERSION);
  });

  it("puts the hash and the attestation outside the hashed body", async () => {
    const sealed = await seal();
    expect(sealed.body.hash).toBeUndefined();
    expect(sealed.body.attestation).toBeUndefined();
  });
});
