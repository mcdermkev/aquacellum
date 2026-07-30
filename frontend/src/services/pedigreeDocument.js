/**
 * pedigreeDocument.js — the portable, tamper-evident pedigree.
 *
 * docs/BREEDER_STATE_MODEL.md §9.25 / §12, spec in
 * docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md.
 *
 * ── WHY A DOCUMENT AND NOT A FIELD ──────────────────────────────────────────
 *
 * `sireId`/`damId` hold LOCAL SERIALS, assigned as `local max + 1`. They are
 * device-scoped: the seller's cert #7 and the buyer's cert #7 are different fish.
 * Handing a buyer `sireId: 7` produces a certificate that resolves, renders, and
 * is WRONG — the §3 failure across a device boundary instead of an id space. And
 * the buyer cannot repair it, because the specimen pull is
 * `.eq("owner_address", …)` and RLS scopes `aquadex_specimens` to the caller's
 * wallet. There is no read path from a buyer to a seller's ancestors.
 *
 *   Lineage cannot cross an ownership boundary as a REFERENCE.
 *   It has to cross as a DOCUMENT.
 *
 * Two consequences that shape everything below:
 *
 *   - A reference describes a MOVING TARGET. Ancestors get retired, archived, and
 *     renamed after the sale. What a buyer bought is the pedigree as it was at
 *     purchase, so this is a snapshot on purpose, not as a compromise.
 *   - It has to COMPOSE. The buyer breeds the fish and sells the offspring, whose
 *     pedigree must still reach the original breeder. A document that only says
 *     "your parents were X and Y" degrades into a snapshot of a snapshot by the
 *     third generation. So a document references its parents BY HASH, and the
 *     chain is inherited rather than re-derived.
 *
 * ── THE TRUST RULE ──────────────────────────────────────────────────────────
 *
 * A pedigree is a document the buyer OWNS. Its trustworthiness does NOT come from
 * who holds it — a holder who can edit it proves nothing to the next buyer, who is
 * the person actually paying the premium. It comes from being tamper-evident (the
 * hash) and attributable (the attestation).
 *
 * So: `pedigreeTrustLevel` exists, and the UI reads it. Presence of a document is
 * NOT evidence of anything. An unattested document is "unattested", never
 * "verified". This is §7.1's verified-vs-self-reported line applied to provenance,
 * and it is the rule that makes the rest worth building — if a hand-typed pedigree
 * and a hash-chained attested one render the same way, the premium is unearned.
 *
 * ── WHY SHA-256 AND NOT KECCAK ──────────────────────────────────────────────
 *
 * keccak is the chain's native hash and was the first instinct. But the only route
 * to it in this codebase is `utils/ethersCompat.js`, which reads `window.ethers`
 * AT MODULE LOAD — so importing it makes this module unloadable in the node test
 * environment, which is where every guarantee below is actually checked.
 *
 * `globalThis.crypto.subtle` is present in browsers and in Node 18+, so one code
 * path covers the app and the tests with zero new dependencies. Anchoring on-chain
 * later is unaffected: a hash is stored as `bytes32` bytes, not recomputed in
 * Solidity.
 */

/** Bumped when the document's meaning changes. */
export const PEDIGREE_DOC_VERSION = 1;

/**
 * Generations this document claims to cover.
 *
 * Deliberately NOT imported from `services/pedigree.js`, which is where
 * `PEDIGREE_DEPTH` lives. That module imports `db`, so importing it here would drag
 * Dexie into the import graph of a module whose entire value is being pure and
 * loadable anywhere — the same reason `utils/ethersCompat.js` is unusable here (it
 * reads `window.ethers` at load). A hashing primitive that needs a database to load
 * is one refactor away from being untestable.
 *
 * The duplication is covered by a test asserting the two constants agree, so drift
 * fails loudly instead of silently mislabelling a document's depth.
 */
export const PEDIGREE_BODY_DEPTH = 3;

/**
 * Bumped when `canonicalize` changes.
 *
 * ANY change to the serialization invalidates EVERY hash ever issued, so this is a
 * breaking change to live provenance records, not an implementation detail. It is
 * recorded inside the hashed body so a future reader can tell which rules produced
 * a given hash.
 */
export const CANONICAL_FORM_VERSION = 1;

/** The six ancestor roles a 3-generation pedigree can hold. Order is fixed. */
export const ANCESTOR_ROLES = Object.freeze([
  "sire",
  "dam",
  "sireSire",
  "sireDam",
  "damSire",
  "damDam",
]);

/**
 * Fields that must NEVER enter the hashed body.
 *
 * Each of these changes during the fish's life — move it to another tank, retire
 * it, sell it on — and a body containing one stops verifying the moment it does.
 * That failure arrives months later and breaks every document at once, so it is
 * asserted by a source guard rather than left to review.
 */
export const FORBIDDEN_BODY_FIELDS = Object.freeze([
  "ownerAddress",
  "owner_address",
  "status",
  "archived",
  "currentTankId",
  "arrivalStatus",
]);

/**
 * How an attestation was produced. This is a LADDER, not a flag, because "signed"
 * conflates two claims with very different strength.
 *
 * `PLATFORM` reuses the trust root the app already has: Privy verifies that the
 * user controls the wallet, `/api/attest-pedigree` verifies that Privy token, and
 * the server signs a purpose-bound statement. A reader can verify the signature
 * against the published public key, so they can prove *Aquadex said this* — but
 * they are still trusting that Aquadex only attests authenticated wallets. That is
 * provenance **hosting**, in the same sense §4.3 uses the word.
 *
 * `WALLET` is the breeder's own key over the same hash. That needs no trust in
 * Aquadex at all. It is the target, and it is a separate task because the app is
 * Web2-masked and a signing prompt is a product decision.
 */
export const ATTESTATION_METHOD = Object.freeze({
  PLATFORM: "platform",
  WALLET: "wallet",
});

export const PEDIGREE_TRUST = Object.freeze({
  /** The hash does not match the body. Worse than absent. */
  INVALID: "invalid",
  /** Internally consistent, but nobody has attested it. NOT verified. */
  UNATTESTED: "unattested",
  /**
   * Aquadex attests the issuing wallet was authenticated when the document was
   * sealed. Verifiable against our published key — but it is our word.
   */
  PLATFORM_ATTESTED: "platformAttested",
  /** Signed by the issuing breeder's own key — needs no trust in Aquadex. */
  ATTESTED: "attested",
  /** Breeder-signed and anchored on-chain. */
  ANCHORED: "anchored",
});

/**
 * The only place the words describing trust exist.
 *
 * Deliberately blunt about the unattested case. A soft phrase there ("pedigree on
 * file") would read as reassurance, which is exactly the thing that must not
 * happen — see the trust rule in the header.
 */
export const PEDIGREE_TRUST_COPY = Object.freeze({
  invalid: Object.freeze({
    pro: "This pedigree does not match its own record and cannot be relied on.",
    casual: "Something's wrong with this family tree, so we can't show it as real.",
  }),
  unattested: Object.freeze({
    pro: "Recorded but not attested, so it cannot be independently checked.",
    casual: "Written down, but nobody has confirmed it yet.",
  }),
  platformAttested: Object.freeze({
    // Deliberately says whose word it is. Claiming "verified" here would be the
    // §9.28 mistake with extra steps.
    pro: "Aquadex confirms the breeder was signed in when this was recorded. That is our word, not the breeder's signature.",
    casual: "We checked the breeder was signed in when they recorded this.",
  }),
  attested: Object.freeze({
    pro: "Signed by the breeder who issued it. Anyone can check it without trusting Aquadex.",
    casual: "The breeder confirmed this themselves.",
  }),
  anchored: Object.freeze({
    pro: "Signed by the issuing breeder and permanently anchored.",
    casual: "The breeder confirmed this and it's locked in permanently.",
  }),
  incomplete: Object.freeze({
    pro: "Some ancestors are not recorded. An unrecorded ancestor is unknown, not unrelated.",
    casual: "We don't know all of this fish's family yet.",
  }),
});

/** Every trust string, flattened — used by the language invariant test. */
export function allPedigreeTrustCopy() {
  const out = [];
  for (const entry of Object.values(PEDIGREE_TRUST_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

/** Describe a trust level in the reader's mode. */
export function pedigreeTrustText(level, { casual = false } = {}) {
  const entry = PEDIGREE_TRUST_COPY[level];
  if (!entry) return PEDIGREE_TRUST_COPY.invalid[casual ? "casual" : "pro"];
  return entry[casual ? "casual" : "pro"];
}

// ─── Canonical serialization ────────────────────────────────────────────────

/**
 * Deterministic JSON. THE SERIALIZATION IS THE IDENTITY.
 *
 * Rules: object keys sorted recursively, array order preserved, `undefined`-valued
 * keys dropped, no whitespace.
 *
 * NON-FINITE NUMBERS THROW. `JSON.stringify(NaN)` is `"null"`, so coercing would
 * produce a document whose hash silently disagrees with its own contents — a
 * provenance record that cannot verify itself, which is the worst failure mode
 * available here. Same for functions and symbols, which `JSON.stringify` drops
 * without a word.
 *
 * @param {*} value
 * @returns {string}
 */
export function canonicalize(value) {
  return serialize(value, []);
}

function serialize(value, path) {
  const where = path.length > 0 ? ` at ${path.join(".")}` : "";

  if (value === null) return "null";

  const type = typeof value;

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonicalize: non-finite number${where}. JSON would write it as null and the ` +
          `hash would no longer describe the document.`
      );
    }
    // JSON's number form is already canonical for finite doubles (-0 → "0").
    return JSON.stringify(value === 0 ? 0 : value);
  }

  if (type === "string" || type === "boolean") return JSON.stringify(value);

  if (type === "bigint") {
    throw new TypeError(`canonicalize: bigint${where} is not serializable — pass a string.`);
  }

  if (type === "function" || type === "symbol" || type === "undefined") {
    throw new TypeError(
      `canonicalize: ${type}${where} cannot be serialized. JSON drops it silently, ` +
        `which would change the hash without changing the visible document.`
    );
  }

  if (Array.isArray(value)) {
    // Order is meaningful and preserved.
    return `[${value.map((item, i) => serialize(item, [...path, i])).join(",")}]`;
  }

  if (type === "object") {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      const entry = value[key];
      // An absent key and a null key are DIFFERENT and must stay different:
      // `null` means "recorded as unknown", missing means "not part of this claim".
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(entry, [...path, key])}`);
    }
    return `{${parts.join(",")}}`;
  }

  throw new TypeError(`canonicalize: unsupported value${where}`);
}

// ─── Hashing ────────────────────────────────────────────────────────────────

function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle?.digest) {
    throw new Error(
      "pedigreeDocument: Web Crypto is unavailable. It ships with every supported " +
        "browser and with Node 18+; there is no fallback on purpose, because a " +
        "weaker hash would silently weaken every pedigree issued."
    );
  }
  return c.subtle;
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * SHA-256 of a canonical string, lowercase hex, no prefix.
 *
 * @param {string} canonicalString
 * @returns {Promise<string>}
 */
export async function hashCanonical(canonicalString) {
  if (typeof canonicalString !== "string") {
    throw new TypeError("hashCanonical: expected a canonical string");
  }
  const bytes = new TextEncoder().encode(canonicalString);
  return toHex(await subtle().digest("SHA-256", bytes));
}

// ─── Building the claim ─────────────────────────────────────────────────────

function normalizeAddress(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function intOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? Math.trunc(n) : null;
}

/**
 * One ancestor, reduced to the parts of the claim that never change.
 *
 * `serialAtIssue` is recorded for human reference on the issuing device ONLY.
 * NOTHING resolves by it — that is the device-scoped-serial trap in the header.
 * `null` for an unresolvable ancestor, never omitted (see `buildPedigreeBody`).
 */
function ancestorEntry(node) {
  if (!node) return null;
  return {
    breeder: normalizeAddress(node.breeder),
    speciesId: intOrNull(node.speciesId),
    scientificName: typeof node.scientificName === "string" ? node.scientificName : "",
    birthTimestamp: intOrNull(node.birthTimestamp),
    serialAtIssue: intOrNull(node.id),
    onChainId: intOrNull(node.onChainId),
  };
}

/**
 * Flatten a `fetchPedigreeTree` result into the fixed six-role ancestor map.
 *
 * EVERY role is present. An unresolvable ancestor is `null`, because an omitted
 * role and a wild-caught parent must not look the same — a reader has to be able to
 * tell "no grandparent recorded" from "grandparent was wild-caught".
 */
function ancestorsFromTree(tree) {
  const parents = tree?.parents || {};
  const grands = tree?.grandparents || {};
  const source = {
    sire: parents.sire,
    dam: parents.dam,
    sireSire: grands.sireSire,
    sireDam: grands.sireDam,
    damSire: grands.damSire,
    damDam: grands.damDam,
  };
  const out = {};
  for (const role of ANCESTOR_ROLES) out[role] = ancestorEntry(source[role]);
  return out;
}

/**
 * The pedigree claim, ready to hash. No hash and no attestation inside it.
 *
 * @param {object} args
 * @param {object} args.tree - a `fetchPedigreeTree` result
 * @param {string} args.issuer - wallet issuing the document (the seller/breeder)
 * @param {number} [args.issuedAt] - unix seconds
 * @param {string|null} [args.sex]
 * @param {{sire: string|null, dam: string|null}} [args.parentDocuments] - the chain
 * @param {number|string|null} [args.spawnId]
 * @param {string|null} [args.lotDocumentHash] - when promoted out of a purchased lot
 */
export function buildPedigreeBody({
  tree,
  issuer,
  issuedAt = Math.floor(Date.now() / 1000),
  sex = null,
  parentDocuments = {},
  spawnId = null,
  lotDocumentHash = null,
} = {}) {
  const target = tree?.target;
  if (!target) {
    throw new TypeError(
      "buildPedigreeBody: no resolvable subject. A pedigree for an unknown fish is " +
        "not a weaker claim, it is not a claim."
    );
  }
  const issuerAddress = normalizeAddress(issuer);
  if (!issuerAddress) {
    throw new TypeError(
      "buildPedigreeBody: no issuer. An unattributed pedigree cannot be attested, " +
        "so it could never be worth more than a hand-typed one."
    );
  }

  return {
    formVersion: CANONICAL_FORM_VERSION,
    issuedAt: Math.trunc(Number(issuedAt) || 0),
    issuer: issuerAddress,
    depth: PEDIGREE_BODY_DEPTH,
    subject: {
      breeder: normalizeAddress(target.breeder),
      speciesId: intOrNull(target.speciesId),
      scientificName: typeof target.scientificName === "string" ? target.scientificName : "",
      birthTimestamp: intOrNull(target.birthTimestamp),
      sex: typeof sex === "string" && sex ? sex : null,
      serialAtIssue: intOrNull(target.id),
      onChainId: intOrNull(target.onChainId),
    },
    ancestors: ancestorsFromTree(tree),
    // The chain. A child's hash depends on these, which is what lets generation
    // three reach the original breeder without reading anyone's registry.
    parentDocuments: {
      sire: typeof parentDocuments.sire === "string" ? parentDocuments.sire : null,
      dam: typeof parentDocuments.dam === "string" ? parentDocuments.dam : null,
    },
    source: {
      spawnId: spawnId == null ? null : String(spawnId),
      lotDocumentHash: typeof lotDocumentHash === "string" ? lotDocumentHash : null,
    },
  };
}

/**
 * Build and hash in one step.
 *
 * @returns {Promise<{version: number, body: object, hash: string, attestation: null}>}
 */
export async function sealPedigreeDocument(args) {
  const body = buildPedigreeBody(args);
  const hash = await hashCanonical(canonicalize(body));
  return {
    version: PEDIGREE_DOC_VERSION,
    body,
    hash,
    // Null until a wallet signs it, and `pedigreeTrustLevel` reports that plainly.
    attestation: null,
  };
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Recompute the hash and compare. This is the tamper-evidence check.
 *
 * @returns {Promise<{ok: boolean, computedHash: string|null, reason: string|null}>}
 */
export async function verifyPedigreeDocument(document) {
  if (!document || typeof document !== "object") {
    return { ok: false, computedHash: null, reason: "not a document" };
  }
  if (!document.body || typeof document.body !== "object") {
    return { ok: false, computedHash: null, reason: "no body" };
  }
  if (typeof document.hash !== "string" || !document.hash) {
    return { ok: false, computedHash: null, reason: "no hash" };
  }
  let computedHash;
  try {
    computedHash = await hashCanonical(canonicalize(document.body));
  } catch (err) {
    return { ok: false, computedHash: null, reason: `body not serializable: ${err.message}` };
  }
  if (computedHash !== document.hash) {
    return { ok: false, computedHash, reason: "hash does not match body" };
  }
  return { ok: true, computedHash, reason: null };
}

/**
 * Walk a chain child → parents and report the FIRST break, by hash.
 *
 * @param {Array<object>} documents - any order; indexed by hash internally
 * @param {string} rootHash - the fish whose chain is being checked
 * @returns {Promise<{ok: boolean, checked: number, brokenAt: string|null, reason: string|null}>}
 */
export async function verifyPedigreeChain(documents, rootHash) {
  const byHash = new Map();
  for (const doc of Array.isArray(documents) ? documents : []) {
    if (doc?.hash) byHash.set(doc.hash, doc);
  }

  const queue = [rootHash];
  const seen = new Set();
  let checked = 0;

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);

    const doc = byHash.get(hash);
    if (!doc) {
      // A missing ancestor document is a GAP, not a forgery. Report which one, so a
      // reader can be told the chain is incomplete rather than untrustworthy.
      return { ok: false, checked, brokenAt: hash, reason: "missing document for hash" };
    }

    const result = await verifyPedigreeDocument(doc);
    checked += 1;
    if (!result.ok) {
      return { ok: false, checked, brokenAt: hash, reason: result.reason };
    }

    const parents = doc.body?.parentDocuments || {};
    if (parents.sire) queue.push(parents.sire);
    if (parents.dam) queue.push(parents.dam);
  }

  if (checked === 0) {
    return { ok: false, checked: 0, brokenAt: rootHash || null, reason: "no root document" };
  }
  return { ok: true, checked, brokenAt: null, reason: null };
}

// ─── Reading a document ─────────────────────────────────────────────────────

// ─── Attestation ────────────────────────────────────────────────────────────
//
// ⚠️ WHY AN AUTH TOKEN IS NOT AN ATTESTATION ⚠️
//
// The obvious way to "reuse the existing wallet-proof" is to take the JWT that
// `/api/mint-session` mints and drop it into the document. DO NOT. That token
// carries `role: "authenticated"` and `wallet_address`, signed with
// `SUPABASE_JWT_SECRET` — it IS a live session credential. Anyone holding it can
// act as that wallet against Supabase until it expires.
//
// And pedigree documents are meant to be PUBLISHED — §4.3 puts them in a public
// storage bucket at a deterministic path. So embedding a session token would
// publish a working credential for the breeder's wallet at a guessable URL. That
// is a credential leak, not a design wrinkle.
//
// What IS reused is the trust root, which is the valuable part and needs no new UX:
// Privy proves the user controls the wallet, and the server verifies that Privy
// token. `/api/attest-pedigree` does exactly that and then signs a **purpose-bound
// statement about one pedigree hash** — no `role` claim, asymmetric key so a reader
// can verify it without holding a secret, and long-lived, because a provenance
// record should not expire in an hour.
//
// `assertNotCredential` below enforces the distinction mechanically rather than by
// comment, because the tempting mistake is a one-line one.

/** Claims that mark a token as an authentication credential rather than a statement. */
const CREDENTIAL_CLAIMS = Object.freeze(["role", "aud", "access_token", "token_type"]);

/** The `purpose` a pedigree attestation must declare. */
export const ATTESTATION_PURPOSE = "aquadex.pedigree.attestation.v1";

/**
 * Throw if an attestation looks like an auth credential.
 *
 * @param {object} attestation
 */
export function assertNotCredential(attestation) {
  if (!attestation || typeof attestation !== "object") return;
  for (const claim of CREDENTIAL_CLAIMS) {
    if (Object.prototype.hasOwnProperty.call(attestation, claim)) {
      throw new Error(
        `pedigreeDocument: attestation carries "${claim}", which makes it look like a ` +
          `session credential. Pedigree documents are published publicly — see the ` +
          `attestation notes in this module.`
      );
    }
  }
  if (attestation.purpose && attestation.purpose !== ATTESTATION_PURPOSE) {
    throw new Error(
      `pedigreeDocument: attestation purpose "${attestation.purpose}" is not ` +
        `"${ATTESTATION_PURPOSE}". A signature reused across purposes proves the wrong thing.`
    );
  }
}

/**
 * Attach an attestation to a sealed document.
 *
 * Refuses when the attestation does not cover **this** document's hash: a signature
 * over some other pedigree would otherwise upgrade this one's trust level for free,
 * which is the cheapest possible forgery.
 *
 * @param {object} document - a sealed document
 * @param {object} attestation - `{ method, purpose, subjectHash, signature, signedBy, signedAt, anchor? }`
 * @returns {object} a new document; the input is not mutated
 */
export function attachAttestation(document, attestation) {
  if (!document?.hash) {
    throw new TypeError("attachAttestation: document is not sealed");
  }
  if (!attestation || typeof attestation !== "object") {
    throw new TypeError("attachAttestation: no attestation");
  }
  assertNotCredential(attestation);

  if (attestation.subjectHash !== document.hash) {
    throw new Error(
      "attachAttestation: the attestation does not cover this document's hash. An " +
        "attestation of a different pedigree must never raise this one's trust level."
    );
  }
  const method = attestation.method;
  if (method !== ATTESTATION_METHOD.PLATFORM && method !== ATTESTATION_METHOD.WALLET) {
    throw new Error(
      `attachAttestation: unknown method "${method}". An unrecognized method must not ` +
        `default to the stronger reading.`
    );
  }
  if (!attestation.signature) {
    throw new Error("attachAttestation: attestation carries no signature");
  }

  return { ...document, attestation: { ...attestation } };
}

/**
 * How much trust this document earns. THE UI READS THIS, never the mere presence
 * of a document, and never `attestation` directly.
 *
 * Async because it verifies the hash — a document whose hash doesn't match its body
 * is worse than absent, so it can't be reported as merely unattested.
 *
 * Fails DOWNWARD at every ambiguity. An attestation that is malformed, covers a
 * different hash, or declares a method we don't recognize reads as `unattested`,
 * never as the stronger level. The whole point of this ladder is that a buyer paying
 * a premium is told the truth, so the failure direction has to be conservative.
 *
 * @returns {Promise<string>} one of PEDIGREE_TRUST
 */
export async function pedigreeTrustLevel(document) {
  const { ok } = await verifyPedigreeDocument(document);
  if (!ok) return PEDIGREE_TRUST.INVALID;

  const attestation = document.attestation;
  if (!attestation || typeof attestation !== "object" || !attestation.signature) {
    return PEDIGREE_TRUST.UNATTESTED;
  }

  // An auth credential masquerading as an attestation is not a stronger claim.
  try {
    assertNotCredential(attestation);
  } catch {
    return PEDIGREE_TRUST.UNATTESTED;
  }

  // A signature over a different document proves nothing about this one.
  if (attestation.subjectHash !== document.hash) return PEDIGREE_TRUST.UNATTESTED;

  if (attestation.method === ATTESTATION_METHOD.WALLET) {
    if (attestation.anchor && typeof attestation.anchor === "object" && attestation.anchor.txHash) {
      return PEDIGREE_TRUST.ANCHORED;
    }
    return PEDIGREE_TRUST.ATTESTED;
  }

  if (attestation.method === ATTESTATION_METHOD.PLATFORM) {
    // An anchor does NOT promote a platform attestation to `anchored`. Anchoring our
    // own statement on-chain makes it permanent, not independent — the thing being
    // made permanent is still our word.
    return PEDIGREE_TRUST.PLATFORM_ATTESTED;
  }

  return PEDIGREE_TRUST.UNATTESTED;
}

/**
 * How much of the pedigree is actually recorded.
 *
 * This is what makes a premium honest: a buyer can see 2-of-6 rather than trusting
 * a badge. An unrecorded ancestor is unknown, NOT unrelated.
 */
export function ancestorCoverage(document) {
  const ancestors = document?.body?.ancestors || {};
  let recorded = 0;
  for (const role of ANCESTOR_ROLES) if (ancestors[role]) recorded += 1;
  return {
    recorded,
    possible: ANCESTOR_ROLES.length,
    complete: recorded === ANCESTOR_ROLES.length,
  };
}

/**
 * Every breeder in the claim, subject first, deduped, order stable.
 *
 * This is the payload the premium rests on — "descended from this breeder" (§5).
 * Returns the subject's breeder even when no ancestor resolves, so an empty result
 * always means a malformed document rather than an unknown pedigree.
 */
export function traceBreeders(document) {
  const body = document?.body;
  if (!body) return [];
  const out = [];
  const push = (address) => {
    const normalized = normalizeAddress(address);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  };
  push(body.subject?.breeder);
  for (const role of ANCESTOR_ROLES) push(body.ancestors?.[role]?.breeder);
  return out;
}
