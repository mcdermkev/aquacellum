import { describe, it, expect } from "vitest";
import {
  selectPrivyWallet,
  resolveSessionWallet,
  hasNoLinkedWallet,
  findWalletByAddress,
  isSameAddress,
} from "../utils/privyWallet";

// Steve's two real addresses, the case this module exists for.
const A = "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6"; // lower, has the Stripe account
const B = "0xef0931458159097a62fddd0ca798f269b5ce98f7"; // higher, has the listings + slug

const embedded = (address) => ({ address, walletClientType: "privy" });
const external = (address) => ({ address, walletClientType: "metamask" });

describe("selectPrivyWallet — determinism", () => {
  it("returns null when there are no wallets", () => {
    expect(selectPrivyWallet([], null)).toBeNull();
    expect(selectPrivyWallet(null, null)).toBeNull();
    expect(selectPrivyWallet(undefined, null)).toBeNull();
  });

  it("picks the only embedded wallet", () => {
    expect(selectPrivyWallet([embedded(B)])?.address).toBe(B);
  });

  it("is INDEPENDENT of array order — the whole point of the module", () => {
    const forward = selectPrivyWallet([embedded(A), embedded(B)]);
    const reversed = selectPrivyWallet([embedded(B), embedded(A)]);
    expect(forward.address).toBe(reversed.address);
  });

  it("prefers an embedded wallet over an external one regardless of position", () => {
    expect(selectPrivyWallet([external(A), embedded(B)])?.address).toBe(B);
    expect(selectPrivyWallet([embedded(B), external(A)])?.address).toBe(B);
  });

  it("falls back to an external wallet only when no embedded wallet exists", () => {
    expect(selectPrivyWallet([external(A)])?.address).toBe(A);
  });

  it("honours Privy's own primary pointer when it is among the candidates", () => {
    const user = { wallet: { address: B } };
    // B is the lexically higher address, so without the pointer the tie-break
    // would choose A. The pointer must win.
    expect(selectPrivyWallet([embedded(A), embedded(B)], user)?.address).toBe(B);
  });

  it("ignores a primary pointer that is not in the candidate pool", () => {
    const user = { wallet: { address: "0x1111111111111111111111111111111111111111" } };
    expect(selectPrivyWallet([embedded(A), embedded(B)], user)?.address).toBe(A);
  });

  it("matches the primary pointer case-insensitively", () => {
    const user = { wallet: { address: B.toUpperCase().replace("0X", "0x") } };
    expect(selectPrivyWallet([embedded(A), embedded(B)], user)?.address).toBe(B);
  });

  it("falls back to the lowest address, stably, with no pointer", () => {
    expect(selectPrivyWallet([embedded(B), embedded(A)])?.address).toBe(A);
  });

  it("rejects malformed addresses rather than selecting them", () => {
    expect(selectPrivyWallet([{ address: "nope", walletClientType: "privy" }])).toBeNull();
    expect(selectPrivyWallet([{ walletClientType: "privy" }])).toBeNull();
    expect(selectPrivyWallet([{ address: "0x123", walletClientType: "privy" }])).toBeNull();
    // A malformed entry must not shadow a valid one.
    expect(selectPrivyWallet([{ address: "nope" }, embedded(B)])?.address).toBe(B);
  });
});

describe("resolveSessionWallet — authoritative vs provisional", () => {
  it("reports the hydrated wallets array as authoritative", () => {
    expect(resolveSessionWallet([embedded(B)], null)).toEqual({
      address: B,
      source: "wallets",
    });
  });

  it("falls back to the user object as PROVISIONAL when the array is empty", () => {
    expect(resolveSessionWallet([], { wallet: { address: B } })).toEqual({
      address: B,
      source: "user",
    });
  });

  it("falls back to linkedAccounts, preferring the embedded one", () => {
    const user = {
      linkedAccounts: [
        { type: "email", address: "ggsteve92@example.com" },
        { type: "wallet", address: A, walletClientType: "metamask" },
        { type: "wallet", address: B, walletClientType: "privy" },
      ],
    };
    expect(resolveSessionWallet([], user)).toEqual({ address: B, source: "user" });
  });

  it("prefers the hydrated array over the user object when both are present", () => {
    const result = resolveSessionWallet([embedded(A)], { wallet: { address: B } });
    expect(result).toEqual({ address: A, source: "wallets" });
  });

  it("reports nothing when there is nothing to resolve", () => {
    expect(resolveSessionWallet([], null)).toEqual({ address: null, source: null });
    expect(resolveSessionWallet([], { linkedAccounts: [] })).toEqual({
      address: null,
      source: null,
    });
  });

  it("ignores a non-wallet linked account that happens to carry an address", () => {
    const user = { linkedAccounts: [{ type: "email", address: B }] };
    expect(resolveSessionWallet([], user)).toEqual({ address: null, source: null });
  });
});

describe("hasNoLinkedWallet — conservative, because it gates wallet creation", () => {
  it("is false when the user object is not loaded yet (unknown != none)", () => {
    // This is the duplicate-wallet bug: answering true here during hydration
    // is what let a second embedded wallet be minted.
    expect(hasNoLinkedWallet(null, [])).toBe(false);
    expect(hasNoLinkedWallet(undefined, [])).toBe(false);
  });

  it("is true only when a loaded user shows no wallet anywhere", () => {
    expect(hasNoLinkedWallet({ id: "did:privy:x" }, [])).toBe(true);
    expect(hasNoLinkedWallet({ id: "did:privy:x", linkedAccounts: [] }, [])).toBe(true);
    expect(
      hasNoLinkedWallet({ id: "did:privy:x", linkedAccounts: [{ type: "email" }] }, [])
    ).toBe(true);
  });

  it("is false when a wallet exists in the array", () => {
    expect(hasNoLinkedWallet({ id: "did:privy:x" }, [embedded(B)])).toBe(false);
  });

  it("is false when a wallet exists on the user object", () => {
    expect(hasNoLinkedWallet({ id: "did:privy:x", wallet: { address: B } }, [])).toBe(false);
  });

  it("is false when a wallet exists only in linkedAccounts", () => {
    const user = { id: "did:privy:x", linkedAccounts: [{ type: "wallet", address: B }] };
    expect(hasNoLinkedWallet(user, [])).toBe(false);
  });

  it("is true when linkedAccounts holds a malformed wallet (not a usable identity)", () => {
    const user = { id: "did:privy:x", linkedAccounts: [{ type: "wallet", address: "nope" }] };
    expect(hasNoLinkedWallet(user, [])).toBe(true);
  });
});

describe("findWalletByAddress — the signing wallet must equal the owner address", () => {
  it("finds the wallet matching the account, ignoring casing", () => {
    const wallets = [embedded(A), embedded(B)];
    expect(findWalletByAddress(wallets, B)?.address).toBe(B);
    expect(findWalletByAddress(wallets, B.toUpperCase().replace("0X", "0x"))?.address).toBe(B);
  });

  it("returns null for an address that is not present (e.g. a MetaMask login)", () => {
    expect(findWalletByAddress([embedded(A)], B)).toBeNull();
  });

  it("returns null on bad input rather than throwing", () => {
    expect(findWalletByAddress(null, B)).toBeNull();
    expect(findWalletByAddress([embedded(A)], null)).toBeNull();
    expect(findWalletByAddress([embedded(A)], undefined)).toBeNull();
  });

  it("never resolves a two-wallet session to a wallet other than the pinned one", () => {
    // Regression guard for the original defect: selection and signing were two
    // independent evaluations, so they could disagree.
    const wallets = [embedded(A), embedded(B)];
    const chosen = selectPrivyWallet(wallets, { wallet: { address: B } });
    expect(findWalletByAddress(wallets, chosen.address)).toBe(chosen);
  });
});

describe("isSameAddress", () => {
  it("compares case-insensitively", () => {
    expect(isSameAddress(B, B.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("is false for different addresses", () => {
    expect(isSameAddress(A, B)).toBe(false);
  });

  it("is false for nullish input rather than throwing", () => {
    expect(isSameAddress(null, B)).toBe(false);
    expect(isSameAddress(B, null)).toBe(false);
    expect(isSameAddress(undefined, undefined)).toBe(false);
  });
});
