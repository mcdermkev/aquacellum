/**
 * A birth certificate changing hands (docs/BREEDER_STATE_MODEL.md §9.25, T3 §2.5).
 *
 * THE BUG: `relayPurchaseSpecimen` updated ownership "if it exists". On the buyer's
 * device it does not exist — the normal cross-device case — so the transfer silently
 * no-opped and the buyer got an order and no certificate.
 *
 * The three things worth failing a build over, all of which corrupt provenance rather
 * than crash:
 *
 *   1. The breeder must survive the sale. It is what a premium price rests on.
 *   2. The seller's sireId/damId must NOT be copied. They name different fish on the
 *      buyer's device, so copying them manufactures a false pedigree.
 *   3. Receiving must be idempotent. §4.1 means a duplicate certificate could never
 *      be deleted afterwards.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const SELLER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BUYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BREEDER = "0xcccccccccccccccccccccccccccccccccccccccc";

let specimenRows = [];

vi.mock("../db", () => ({
  db: {
    specimens: {
      get: async (id) => specimenRows.find((s) => Number(s.id) === Number(id)),
      toArray: async () => specimenRows,
      put: async (row) => { specimenRows.push(row); return row.id; },
      filter: (fn) => ({ first: async () => specimenRows.find(fn) }),
    },
  },
}));

// The seller's registry, as `fetchPedigreeTree` would resolve it.
vi.mock("../services/pedigree", () => ({
  PEDIGREE_DEPTH: 3,
  fetchPedigreeTree: async (_contract, rootId) => {
    if (Number(rootId) !== 42) return null;
    const node = (id, breeder) => ({
      id, speciesId: 7, scientificName: "Paracheirodon innesi",
      birthTimestamp: 1700000000 + id, breeder, sireId: 0, damId: 0, onChainId: null,
    });
    return {
      target: node(42, BREEDER),
      // Seller's local serials 7 and 8 — meaningless on the buyer's device.
      parents: { sire: node(7, BREEDER), dam: node(8, BREEDER) },
      grandparents: { sireSire: null, sireDam: null, damSire: null, damDam: null },
    };
  },
}));

const {
  TRANSFER_FAILURE,
  issueTransferDocument,
  receiveTransferredCertificate,
  requestPlatformAttestation,
  transferCertificate,
} = await import("../services/certificateTransfer");
const { ATTESTATION_METHOD, ATTESTATION_PURPOSE, PEDIGREE_TRUST, pedigreeTrustLevel, traceBreeders } =
  await import("../services/pedigreeDocument");
const { LIFE_STAGE } = await import("../utils/lifeStage");

beforeEach(() => {
  specimenRows = [
    { id: 42, speciesId: 7, gender: "Female", ownerAddress: SELLER, breeder: BREEDER, sireId: 7, damId: 8 },
    { id: 7, speciesId: 7, ownerAddress: SELLER, breeder: BREEDER },
    { id: 8, speciesId: 7, ownerAddress: SELLER, breeder: BREEDER },
  ];
});

const sellerRowCount = () => specimenRows.length;

describe("issuing the document at fulfillment", () => {
  it("seals the pedigree from the SELLER's registry", async () => {
    // The only moment the full pedigree is readable — which is why it is captured at
    // the sale rather than reconstructed later.
    const result = await issueTransferDocument({ specimenId: 42, issuer: SELLER });
    expect(result.ok).toBe(true);
    expect(result.document.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.document.body.ancestors.sire).not.toBeNull();
    expect(result.document.body.ancestors.dam).not.toBeNull();
  });

  it("records the breeder, not the seller", async () => {
    const { document } = await issueTransferDocument({ specimenId: 42, issuer: SELLER });
    expect(document.body.subject.breeder).toBe(BREEDER);
    expect(document.body.issuer).toBe(SELLER);
    expect(traceBreeders(document)).toContain(BREEDER);
  });

  it("fails on an unknown specimen or a missing issuer, without writing", async () => {
    expect((await issueTransferDocument({ specimenId: 999, issuer: SELLER })).reason)
      .toBe(TRANSFER_FAILURE.NO_SPECIMEN);
    expect((await issueTransferDocument({ specimenId: 42, issuer: "" })).reason)
      .toBe(TRANSFER_FAILURE.NO_ISSUER);
    expect(sellerRowCount()).toBe(3);
  });

  it("carries the fish's inherited parent documents so the chain reaches further back", async () => {
    specimenRows[0].pedigreeParentDocuments = { sire: "f".repeat(64), dam: null };
    const { document } = await issueTransferDocument({ specimenId: 42, issuer: SELLER });
    expect(document.body.parentDocuments.sire).toBe("f".repeat(64));
  });
});

describe("attestation is best-effort, never a blocker", () => {
  const attestation = (hash) => ({
    method: ATTESTATION_METHOD.PLATFORM,
    purpose: ATTESTATION_PURPOSE,
    subjectHash: hash,
    signature: "eyJ.sig",
    signedBy: SELLER,
  });

  it("attaches an attestation when one is returned", async () => {
    let seenBody = null;
    const fetchImpl = async (_url, init) => {
      seenBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ attestation: attestation(seenBody.pedigreeHash) }) };
    };
    const result = await issueTransferDocument({
      specimenId: 42, issuer: SELLER, authToken: "privy-token", fetchImpl,
    });
    expect(result.attested).toBe(true);
    expect(result.document.attestation.signature).toBe("eyJ.sig");
  });

  it("still issues an UNATTESTED document when attestation is unavailable", async () => {
    // Losing the pedigree entirely would be strictly worse than recording one nobody
    // has signed — and the trust ladder reports the difference honestly.
    for (const fetchImpl of [
      async () => { throw new Error("offline"); },
      async () => ({ ok: false }),
      async () => ({ ok: true, json: async () => ({}) }),
    ]) {
      const result = await issueTransferDocument({
        specimenId: 42, issuer: SELLER, authToken: "privy-token", fetchImpl,
      });
      expect(result.ok).toBe(true);
      expect(result.attested).toBe(false);
      expect(await pedigreeTrustLevel(result.document)).toBe(PEDIGREE_TRUST.UNATTESTED);
    }
  });

  it("skips the request entirely with no auth token, rather than sending a doomed one", async () => {
    let called = false;
    await issueTransferDocument({
      specimenId: 42, issuer: SELLER, authToken: null, fetchImpl: async () => { called = true; },
    });
    expect(called).toBe(false);
  });

  it("rejects an attestation for the wrong hash or purpose", async () => {
    const wrongHash = async () => ({ ok: true, json: async () => ({ attestation: attestation("a".repeat(64)) }) });
    const wrongPurpose = async () => ({
      ok: true,
      json: async () => ({ attestation: { ...attestation("x"), purpose: "aquadex.login.v1" } }),
    });
    for (const fetchImpl of [wrongHash, wrongPurpose]) {
      expect(await requestPlatformAttestation("b".repeat(64), { authToken: "t", fetchImpl })).toBeNull();
    }
  });
});

describe("receiving on the buyer's device", () => {
  async function issued() {
    const { document } = await issueTransferDocument({ specimenId: 42, issuer: SELLER });
    return document;
  }

  it("creates a certificate where none existed — the original no-op", async () => {
    const document = await issued();
    const before = sellerRowCount();
    const result = await receiveTransferredCertificate({ document, buyerAddress: BUYER });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(sellerRowCount()).toBe(before + 1);

    const row = specimenRows.find((s) => Number(s.id) === result.specimenId);
    expect(row.ownerAddress).toBe(BUYER);
  });

  it("KEEPS THE BREEDER through the sale", async () => {
    // The provenance fact a premium rests on. A buyer is not the breeder.
    const result = await receiveTransferredCertificate({ document: await issued(), buyerAddress: BUYER });
    const row = specimenRows.find((s) => Number(s.id) === result.specimenId);
    expect(row.breeder).toBe(BREEDER);
    expect(row.breeder).not.toBe(BUYER);
    expect(row.breeder).not.toBe(SELLER);
  });

  it("DROPS the seller's parent serials rather than manufacturing a false pedigree", async () => {
    // Seller's sireId was 7. On the buyer's device #7 is a different fish, so copying
    // it would resolve to a real but wrong ancestor, silently (§3, §12.2).
    const result = await receiveTransferredCertificate({ document: await issued(), buyerAddress: BUYER });
    const row = specimenRows.find((s) => Number(s.id) === result.specimenId);

    expect(row.sireId).toBe(0);
    expect(row.damId).toBe(0);
    // The ancestry is not lost — it moved into the document.
    expect(row.pedigreeDocument.body.ancestors.sire.serialAtIssue).toBe(7);
    expect(row.pedigreeHash).toBe((await issued()).hash);
  });

  it("keeps the original hatch date, not the purchase date", async () => {
    const result = await receiveTransferredCertificate({ document: await issued(), buyerAddress: BUYER });
    const row = specimenRows.find((s) => Number(s.id) === result.specimenId);
    expect(row.birthTimestamp).toBe(1700000042);
    expect(row.receivedAt).toBeGreaterThan(row.birthTimestamp);
  });

  it("does not present a transfer as an unconfirmed mint", async () => {
    // `chainStatus: "pending"` would leave every purchased fish looking like a mint
    // that never settled.
    const result = await receiveTransferredCertificate({ document: await issued(), buyerAddress: BUYER });
    const row = specimenRows.find((s) => Number(s.id) === result.specimenId);
    expect(row.chainStatus).toBe("transferred");
    expect(row.txHash).toBeNull();
  });

  it("is IDEMPOTENT on the document hash", async () => {
    // A webhook firing twice, or a cloud pull racing the local write. §4.1 means a
    // duplicate certificate could never be deleted afterwards.
    const document = await issued();
    const first = await receiveTransferredCertificate({ document, buyerAddress: BUYER });
    const before = sellerRowCount();
    const second = await receiveTransferredCertificate({ document, buyerAddress: BUYER });

    expect(second.duplicate).toBe(true);
    expect(second.specimenId).toBe(first.specimenId);
    expect(sellerRowCount()).toBe(before);
  });

  it("refuses a document that was edited in transit", async () => {
    const document = await issued();
    document.body.subject.breeder = BUYER;
    const before = sellerRowCount();
    const result = await receiveTransferredCertificate({ document, buyerAddress: BUYER });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(TRANSFER_FAILURE.INVALID_DOCUMENT);
    expect(sellerRowCount()).toBe(before);
  });

  it("refuses to certificate a cohort-only stage (§4.2)", async () => {
    const document = await issued();
    for (const lifeStage of [LIFE_STAGE.EGG, LIFE_STAGE.FRY, null, "3 weeks"]) {
      const result = await receiveTransferredCertificate({ document, buyerAddress: BUYER, lifeStage });
      expect(result.reason, String(lifeStage)).toBe(TRANSFER_FAILURE.COHORT_STAGE);
    }
    expect(specimenRows.filter((s) => s.ownerAddress === BUYER)).toHaveLength(0);
  });

  it("refuses without a buyer, and without a document", async () => {
    expect((await receiveTransferredCertificate({ document: await issued(), buyerAddress: "" })).reason)
      .toBe(TRANSFER_FAILURE.NO_BUYER);
    expect((await receiveTransferredCertificate({ document: null, buyerAddress: BUYER })).reason)
      .toBe(TRANSFER_FAILURE.NO_DOCUMENT);
  });

  it("gives the buyer's row a serial from THEIR device, not the seller's", async () => {
    // Seller's serial was 42; the buyer's registry here tops out at 42 too, so the
    // new row must be 43 — assigned locally, never copied.
    const result = await receiveTransferredCertificate({ document: await issued(), buyerAddress: BUYER });
    expect(result.specimenId).toBe(43);
    const row = specimenRows.find((s) => Number(s.id) === 43);
    expect(row.pedigreeDocument.body.subject.serialAtIssue).toBe(42);
  });
});

describe("transferCertificate end to end", () => {
  it("issues and receives in one call", async () => {
    const result = await transferCertificate({ specimenId: 42, seller: SELLER, buyerAddress: BUYER });
    expect(result.ok).toBe(true);
    expect(result.received.duplicate).toBe(false);
    expect(result.document.body.subject.breeder).toBe(BREEDER);
  });

  it("reports the two halves separately when the buyer-side write is refused", async () => {
    // The document is the durable part; a caller needs to know it sealed even when
    // the local write didn't happen.
    const result = await transferCertificate({
      specimenId: 42, seller: SELLER, buyerAddress: BUYER, lifeStage: LIFE_STAGE.EGG,
    });
    expect(result.ok).toBe(false);
    expect(result.document).not.toBeNull();
    expect(result.reason).toBe(TRANSFER_FAILURE.COHORT_STAGE);
  });

  it("does not reach the buyer side at all when the document can't be issued", async () => {
    const result = await transferCertificate({ specimenId: 999, seller: SELLER, buyerAddress: BUYER });
    expect(result.ok).toBe(false);
    expect(result.received).toBeNull();
    expect(result.reason).toBe(TRANSFER_FAILURE.NO_SPECIMEN);
  });
});
