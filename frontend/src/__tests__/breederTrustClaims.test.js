/**
 * Trust claims about a breeder must be backed by something
 * (docs/BREEDER_STATE_MODEL.md §9.28, §12.7).
 *
 * WHY THIS FILE EXISTS: the pedigree work in §12 is being built so that "bred by
 * this breeder" is worth paying a premium for. A badge that says "Master Breeder"
 * or "Verified" without anything behind it doesn't just mislead — it makes the
 * verified version worthless, because a buyer can't tell the two apart. This is
 * §9.11's mistake ("Established Seller" earnable by typing 50 into a form) applied
 * to identity instead of sales.
 *
 * Four incompatible definitions of "Master Breeder" existed:
 *
 *   1. MarketplaceBoard  — 10 active listings. Free, self-serve.              REMOVED
 *   2. TankList role chip — 10,000 Companion XP, SELF-SELECTED, "Verified".   RELABELLED
 *   3. checkMasterBreederEligibility — tier 4 + 5 completed sales + 4.0 rating.  KEPT
 *   4. breeder_profiles.is_master_breeder — stored flag, gated by (3).           KEPT
 *
 * (3) and (4) are the same thing and are the defensible definition. These are
 * source guards, because vitest runs in a node environment (no jsdom) — the
 * convention used throughout this project's component contracts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function code(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const BOARD = code("../components/MarketplaceBoard.jsx");
const TANKLIST = code("../components/TankList.jsx");
const REGISTRY = code("../services/breederRegistry.js");

describe("the marketplace board makes no reputation claim it cannot back", () => {
  it("awards no tier from listing count", () => {
    // Posting listings is free and self-serve, so a tier derived from how many you
    // have posted measures inventory, not trustworthiness. All three tiers went:
    // "Master Breeder" at 10, "Established" at 5, "Trusted" at 3.
    expect(BOARD).not.toContain("breederReputation");
    expect(BOARD).not.toMatch(/count >= 10/);
    expect(BOARD).not.toMatch(/tier: ["']master["']/);
  });

  it("does not claim any seller is verified or local", () => {
    // Casual mode replaced the seller's name with a hardcoded
    // "✅ Verified Local Breeder" on EVERY listing — a verification claim and a
    // locality claim, neither checked, shown to the readers least able to question
    // it. Fabricated proximity was already retired once from the Fish Finder
    // (Decision D3); this was the same claim surviving in casual mode.
    expect(BOARD).not.toContain("Verified Local Breeder");
    expect(BOARD).not.toContain("Verified Local Breeders");
  });

  it("keeps the guarantee pills that describe real mechanisms", () => {
    // The point was never to strip the banner. Escrow and the arrival window exist
    // and are enforced; only the unbacked claim about sellers was removed.
    expect(BOARD).toContain("Escrow Health Guarantee");
    expect(BOARD).toContain("3-Day Safe Arrival");
  });

  it("does not reintroduce a Master Breeder badge without reading the real flag", () => {
    // If this badge ever comes back on the board it must read
    // breeder_profiles.is_master_breeder, not a count computed from the listings
    // already in hand.
    const claimsMasterBreeder = /["'`][^"'`]*Master Breeder[^"'`]*["'`]/.test(BOARD);
    if (claimsMasterBreeder) {
      expect(BOARD).toMatch(/isMasterBreeder|is_master_breeder/);
    }
  });
});

describe("the commenter role tag is honest about being self-described", () => {
  it("does not call a self-selected tag verified", () => {
    // The user clicks this chip on their own comment. Nothing checks it, so the
    // word "Verified" is the whole problem.
    expect(TANKLIST).not.toContain("Verified Master Breeder");
  });

  it("does not borrow the Master Breeder title for a Companion XP gate", () => {
    // Companion XP measures app engagement — logged feedings, posts. It is
    // reachable without ever having bred a fish, so it cannot grant the title that
    // completed sales and ratings grant.
    expect(TANKLIST).not.toMatch(/Master Breeder Rank/);
    expect(TANKLIST).toContain("Experienced Breeder");
  });

  it("keeps the stored role key so existing comments are not orphaned", () => {
    // Display label changed; the persisted value did not. Comments already carry
    // role: "master-breeder" in Dexie and the cloud mirror — the same reason
    // "Not Sure" survives as a legacy sex value (§4.4).
    expect(TANKLIST).toContain('"master-breeder"');
  });
});

describe("one defensible definition of Master Breeder survives", () => {
  it("is gated on completed sales and ratings, not on volume or XP", () => {
    expect(REGISTRY).toContain("checkMasterBreederEligibility");
    expect(REGISTRY).toMatch(/SALES_THRESHOLD/);
    expect(REGISTRY).toMatch(/RATING_THRESHOLD/);
    expect(REGISTRY).toContain("is_master_breeder");
  });

  it("reads the stored flag rather than deriving the title client-side", () => {
    expect(REGISTRY).toMatch(/isMasterBreeder:\s*row\.is_master_breeder/);
  });
});
