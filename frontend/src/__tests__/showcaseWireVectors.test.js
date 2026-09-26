// Fish Room R1.3B/R1.3C golden wire vectors.
//
// These lock the EXACT bytes and digests the owner API produces so that (a) any drift in the JCS
// canonicalizer, operation-checksum objects, or EIP-191 message is caught here, and (b) tomorrow's
// live route->PostgREST smoke and any client implementation have authoritative expected values to
// compare against. Regenerate deliberately (never casually) if the frozen contract itself changes.

import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { buildWalletLinkMessage, normalizeWallet, recoverEip191Signer } from "../../api/_lib/showcaseAuth.js";
import {
  startRequestSha256, candidateStageRequestSha256, jcsCanonicalize, sha256HexOfCanonical, isSha256Hex,
} from "../../api/_lib/showcaseManifest.js";

// Hardhat account #0 — a well-known deterministic test key. Its address is the message Wallet field.
const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDR_LOWER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const TEST_ADDR_CHECKSUM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const NONCE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"; // 43 base64url chars

const MESSAGE_FIELDS = {
  appOrigin: "https://app.aquadex.fish", privyAppId: "clabc123appid", subject: "did:privy:abc123",
  normalizedWallet: TEST_ADDR_LOWER, chainId: "84532", nonce: NONCE,
  issuedAt: "2026-08-29T00:00:00Z", expirationTime: "2026-08-29T00:05:00Z",
};

// The exact frozen section-9 message: LF-separated, no trailing LF.
const GOLDEN_MESSAGE =
  "Aquadex Fish Room Wallet Link\n" +
  "\n" +
  "Version: 1\n" +
  "Domain: app.aquadex.fish\n" +
  "Origin: https://app.aquadex.fish\n" +
  "Privy App ID: clabc123appid\n" +
  "Privy Subject: did:privy:abc123\n" +
  "Wallet: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\n" +
  "Chain ID: 84532\n" +
  "Purpose: link_showcase_wallet\n" +
  "Nonce: abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ\n" +
  "Issued At: 2026-08-29T00:00:00Z\n" +
  "Expiration Time: 2026-08-29T00:05:00Z";

describe("EIP-191 wallet-link message (freeze section 9)", () => {
  it("is byte-exact, LF-framed, and has no trailing newline", () => {
    const message = buildWalletLinkMessage(MESSAGE_FIELDS);
    expect(message).toBe(GOLDEN_MESSAGE);
    expect(Buffer.byteLength(message, "utf8")).toBe(377);
    expect(message.endsWith("\n")).toBe(false);
    expect(message.split("\n").length).toBe(13); // 13 lines incl. the blank second line
  });

  it("round-trips build -> personal_sign -> recover to the same address", async () => {
    const message = buildWalletLinkMessage(MESSAGE_FIELDS);
    const wallet = new ethers.Wallet(TEST_PK);
    expect(wallet.address.toLowerCase()).toBe(TEST_ADDR_LOWER);
    const signature = await wallet.signMessage(message);
    expect(recoverEip191Signer(message, signature)).toBe(TEST_ADDR_LOWER);
    // A tampered message must not recover to the signer.
    expect(recoverEip191Signer(message + "x", signature)).not.toBe(TEST_ADDR_LOWER);
  });
});

describe("EIP-55 wallet normalization matrix", () => {
  it("accepts lowercase and returns a checksummed display form", () => {
    const r = normalizeWallet(TEST_ADDR_LOWER);
    expect(r).toEqual({ normalized: TEST_ADDR_LOWER, display: TEST_ADDR_CHECKSUM });
  });
  it("accepts correct EIP-55 mixed case", () => {
    expect(normalizeWallet(TEST_ADDR_CHECKSUM).normalized).toBe(TEST_ADDR_LOWER);
  });
  it("rejects incorrect mixed case and malformed input", () => {
    // Flip one checksum letter's case -> invalid EIP-55.
    const wrong = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    expect(normalizeWallet(wrong)).toBeNull();
    expect(normalizeWallet("0x123")).toBeNull();
    expect(normalizeWallet("nope")).toBeNull();
  });
});

describe("operation-checksum golden vectors (freeze section 10.1)", () => {
  it("dataset-import-start checksum is stable and correct", () => {
    const hex = startRequestSha256({
      operationId: "11111111-1111-4111-8111-111111111111", sourceSchemaVersion: 3,
      sourceDatasetId: "22222222-2222-4222-8222-222222222222", enrollmentReference: "enroll:v1:sample",
      declaredBackupSha256: "a".repeat(64), manifestSha256: "b".repeat(64),
      manifest: {
        manifestVersion: 1, schemaVersion: 3, datasetId: "22222222-2222-4222-8222-222222222222",
        enrollmentReference: "enroll:v1:sample", exportedAt: "2026-08-29T00:00:00Z",
        sections: [
          { name: "aliases", count: 0, sha256: "c".repeat(64) },
          { name: "specimens", count: 0, sha256: "d".repeat(64) },
          { name: "tanks", count: 0, sha256: "e".repeat(64) },
        ],
      },
    });
    expect(hex).toBe("e396c13f8e400e46376534978766442119945166c959f66013584ba07d226aaf");
    expect(isSha256Hex(hex)).toBe(true);
  });

  it("identity-candidate-stage checksum is stable and correct", () => {
    const hex = candidateStageRequestSha256({
      operationId: "11111111-1111-4111-8111-111111111111", importId: "33333333-3333-4333-8333-333333333333",
      rowRefs: [{ section: "tanks", chunkIndex: 0, rowIndex: 0 }],
    });
    expect(hex).toBe("6668de70e2107d4837c88dd769311c4a00c8f37b4f9eccded6da99c8c7683b3d");
  });
});

describe("JCS canonical + digest golden vector", () => {
  it("sorts keys, preserves array order, and hashes deterministically", () => {
    const input = { b: 2, a: 1, nested: { z: true, y: [1, 2, 3] } };
    expect(jcsCanonicalize(input)).toBe('{"a":1,"b":2,"nested":{"y":[1,2,3],"z":true}}');
    expect(sha256HexOfCanonical(input)).toBe("0c26d3eaef4b3a6f8485b30f91ada89fe09aa2b91706c8a20f2340dc20a7525e");
  });
});
