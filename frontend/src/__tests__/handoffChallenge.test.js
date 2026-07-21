/**
 * Unit tests for the signed handoff challenge system (Task 15, Tier A).
 *
 * The security-critical checks: forged/tampered tokens are rejected, replay is
 * blocked by one-time nonce, the wrong seller can't settle, expiry is enforced,
 * and offline parsing never counts as verification.
 *
 * Run with: npx vitest --run src/__tests__/handoffChallenge.test.js
 */

import { describe, it, expect } from "vitest";
import {
  HANDOFF_TYPES,
  DEFAULT_HANDOFF_TTL_MS,
  issueHandoffChallenge,
  parseChallenge,
  validateStructure,
  verifyHandoffChallenge,
} from "../../api/_lib/handoffChallenge.js";

const SECRET = "test-handoff-secret";
const T0 = 1_000_000_000_000;

function issue(overrides = {}) {
  return issueHandoffChallenge({
    orderId: "ord_1", buyer: "0xBUYER", seller: "0xSELLER",
    listingId: "listing_1", quantity: 2, secret: SECRET, now: T0, ...overrides,
  });
}

describe("issueHandoffChallenge", () => {
  it("issues a signed token with a normalized payload and expiry", () => {
    const { token, payload } = issue();
    expect(token.split(".")).toHaveLength(2);
    expect(payload).toMatchObject({ orderId: "ord_1", buyer: "0xbuyer", seller: "0xseller", quantity: 2, type: HANDOFF_TYPES.CASH });
    expect(payload.exp).toBe(T0 + DEFAULT_HANDOFF_TTL_MS);
    expect(payload.nonce).toBeTruthy();
  });

  it("requires secret and parties", () => {
    expect(() => issueHandoffChallenge({ orderId: "o", buyer: "b", seller: "s" })).toThrow(/secret/);
    expect(() => issueHandoffChallenge({ secret: SECRET, buyer: "b", seller: "s" })).toThrow(/required/);
  });
});

describe("verifyHandoffChallenge — happy path", () => {
  it("verifies a fresh token submitted by the correct seller", async () => {
    const { token } = issue();
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000, expectedSeller: "0xSELLER" });
    expect(res.ok).toBe(true);
    expect(res.payload.orderId).toBe("ord_1");
  });
});

describe("verifyHandoffChallenge — forgery & tampering", () => {
  it("rejects a tampered payload (the old forgeable-JSON hole)", async () => {
    const { token } = issue();
    const [, sig] = token.split(".");
    // Attacker rewrites the payload (e.g. different buyer) but keeps the signature.
    const forgedPayload = Buffer.from(JSON.stringify({ ...parseChallenge(token), buyer: "0xattacker" })).toString("base64url");
    const res = await verifyHandoffChallenge(`${forgedPayload}.${sig}`, { secret: SECRET, now: T0 + 1000 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature/);
  });

  it("rejects a tampered signature", async () => {
    const { token } = issue();
    const [payloadB64] = token.split(".");
    const res = await verifyHandoffChallenge(`${payloadB64}.deadbeef`, { secret: SECRET, now: T0 + 1000 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature/);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = issueHandoffChallenge({ orderId: "o", buyer: "b", seller: "s", secret: "other-secret", now: T0 });
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature/);
  });

  it("rejects malformed tokens without throwing", async () => {
    expect((await verifyHandoffChallenge("garbage", { secret: SECRET })).ok).toBe(false);
    expect((await verifyHandoffChallenge("", { secret: SECRET })).ok).toBe(false);
    expect((await verifyHandoffChallenge(null, { secret: SECRET })).ok).toBe(false);
  });
});

describe("verifyHandoffChallenge — expiry, replay, parties", () => {
  it("rejects an expired challenge", async () => {
    const { token } = issue();
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + DEFAULT_HANDOFF_TTL_MS + 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/expired/);
  });

  it("blocks replay when the nonce was already used", async () => {
    const { token, payload } = issue();
    const used = new Set([payload.nonce]);
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000, isNonceUsed: (n) => used.has(n) });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/replay/);
  });

  it("rejects a submission from the wrong seller", async () => {
    const { token } = issue();
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000, expectedSeller: "0xnottheseller" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/seller mismatch/);
  });

  it("rejects a buyer mismatch when enforced", async () => {
    const { token } = issue();
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000, expectedBuyer: "0xnotbuyer" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/buyer mismatch/);
  });

  it("supports async nonce checks", async () => {
    const { token } = issue();
    const res = await verifyHandoffChallenge(token, { secret: SECRET, now: T0 + 1000, isNonceUsed: async () => false });
    expect(res.ok).toBe(true);
  });
});

describe("offline parsing", () => {
  it("parseChallenge reads the payload without a secret (for QR display)", () => {
    const { token } = issue();
    expect(parseChallenge(token).orderId).toBe("ord_1");
  });

  it("validateStructure passes structure/expiry but is NOT verification", () => {
    const { token } = issue();
    const ok = validateStructure(token, T0 + 1000);
    expect(ok.ok).toBe(true);
    expect(ok.pendingVerification).toBe(true);
    // expired
    expect(validateStructure(token, T0 + DEFAULT_HANDOFF_TTL_MS + 1).ok).toBe(false);
    // a totally unsigned/forged but well-formed structure still "passes structure"
    // — proving structure != verification (must still go through verify online).
    const forged = Buffer.from(JSON.stringify({ orderId: "x", buyer: "b", seller: "s", nonce: "n", exp: T0 + 99999999 })).toString("base64url") + ".fakesig";
    expect(validateStructure(forged, T0 + 1000).ok).toBe(true);
  });
});
