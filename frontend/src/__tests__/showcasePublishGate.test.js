/**
 * showcasePublishGate.test.js
 *
 * The curated "Steve first" publish rollout. Publishing a Fish Room to a non-private visibility
 * is gated by `ownerMayPublish` (frontend/api/_lib/showcaseAuth.js) against the env allowlist
 * SHOWCASE_PUBLISH_ALLOWLIST. This is the sole rollout control: `showcase-owner.js`'s
 * `publication-set` handler consults it before flipping a Room public/unlisted (and never for
 * taking a Room private).
 *
 * Contract locked here:
 *   - DEFAULT-CLOSED: empty / unset / whitespace-only allowlist => nobody may publish.
 *   - An owner may publish if their Privy subject OR their session wallet is listed.
 *   - Wallet matching is case-insensitive; a malformed session wallet is ignored (never matches).
 *
 * Run: npx vitest --run src/__tests__/showcasePublishGate.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";

import { ownerMayPublish } from "../../api/_lib/showcaseAuth.js";

const STEVE_WALLET = "0x1111111111111111111111111111111111111111";
const STEVE_SUBJECT = "did:privy:steve0001";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const OTHER_SUBJECT = "did:privy:someoneelse";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ownerMayPublish — default-closed curated rollout", () => {
  it("denies everyone when the allowlist is unset", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", "");
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: STEVE_WALLET })).toBe(false);
  });

  it("denies everyone when the allowlist is only whitespace/commas", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", "  , ,  ");
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: STEVE_WALLET })).toBe(false);
  });

  it("allows an owner whose wallet is listed (case-insensitive)", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_WALLET.toUpperCase().replace("0X", "0x"));
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: STEVE_WALLET })).toBe(true);
    // and the reverse: allowlist lowercase, session wallet checksummed/mixed
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_WALLET);
    expect(ownerMayPublish({ subject: null, walletAddress: STEVE_WALLET.toUpperCase().replace("0X", "0x") })).toBe(true);
  });

  it("allows an owner whose Privy subject is listed even without a wallet", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_SUBJECT);
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: null })).toBe(true);
  });

  it("supports multiple entries and ignores surrounding whitespace", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", ` ${OTHER_SUBJECT} , ${STEVE_WALLET} `);
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: STEVE_WALLET })).toBe(true);
    expect(ownerMayPublish({ subject: OTHER_SUBJECT, walletAddress: null })).toBe(true);
  });

  it("denies an owner who is not listed by wallet or subject", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_WALLET);
    expect(ownerMayPublish({ subject: OTHER_SUBJECT, walletAddress: OTHER_WALLET })).toBe(false);
  });

  it("ignores a malformed session wallet (never matches by accident)", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", "not-a-wallet");
    expect(ownerMayPublish({ subject: null, walletAddress: "0xnope" })).toBe(false);
    // a listed subject still works alongside a junk wallet
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_SUBJECT);
    expect(ownerMayPublish({ subject: STEVE_SUBJECT, walletAddress: "0xnope" })).toBe(true);
  });

  it("handles being called with no argument", () => {
    vi.stubEnv("SHOWCASE_PUBLISH_ALLOWLIST", STEVE_WALLET);
    expect(ownerMayPublish()).toBe(false);
  });
});

describe("publication-set wiring (source contract)", () => {
  const route = readFileSync(fileURLToPath(new URL("../../api/showcase-owner.js", import.meta.url)), "utf8");

  it("gates non-private publishing through ownerMayPublish before the RPC", () => {
    expect(route).toContain("ownerMayPublish");
    expect(route).toContain("publication_not_authorized");
    // The gate only fires for non-private transitions (unpublish is never gated).
    expect(route).toMatch(/v\.visibility !== "private"[\s\S]*ownerMayPublish/);
  });

  it("keeps publication_not_authorized in the closed error dictionary", () => {
    expect(route).toMatch(/publication_not_authorized:\s*"/);
  });
});
