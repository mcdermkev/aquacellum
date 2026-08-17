/**
 * Guard: Aquadex prices in US dollars, never in crypto units.
 *
 * The product settles in USD. Every real commerce table agrees on integer cents
 * (orders.subtotal_cents, canonical_order_ledger.amount_cents,
 * fiat_settlements.amount_cents_usd). But the codebase grew out of an on-chain
 * protocol, and the wei-era scaffolding kept surfacing as user-visible prices —
 * always via the same tell: a hardcoded `* 1000` standing in for an ETH→USD rate.
 *
 * Sites that shipped with that bug and are now fixed:
 *   LocalBreederMap        — "Price / Fish"          (fixed previously)
 *   OfferModal             — offer amount            (fixed previously)
 *   HatcheryLogs           — "N available @ $X"
 *   HandshakeVerification  — "Your payment of $X", both cash and escrow branches
 *   WantedBoard            — max budget, plus the seller match notification
 *   AuctionPanel           — every bid, formerly quoted in wei and ETH
 *
 * A $25 fish printed as "$25,000.00" on a payment confirmation screen. The number
 * was confident, prominent and wrong.
 *
 * This project's vitest runs in a `node` environment (no jsdom), and these
 * components transitively touch browser-only APIs, so this follows the
 * established source-guard convention and asserts statically over the
 * comment-stripped source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function source(relPath) {
  return stripComments(
    readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), "utf8")
  );
}

/** The fake exchange rate, in the shapes it actually appeared in. */
const FAKE_RATE_PATTERNS = [
  /\*\s*1000\s*\)\s*\.toFixed/,
  /formatEther\([^)]*\)\s*\)\s*\*\s*1000/,
  /parseFloat\([^)]*\)\s*\*\s*1000/,
  /\*\s*quantity\s*\*\s*1000/,
];

const PRICE_DISPLAY_COMPONENTS = [
  "components/LocalBreederMap.jsx",
  "components/OfferModal.jsx",
  "components/HatcheryLogs.jsx",
  "components/HandshakeVerification.jsx",
  "components/WantedBoard.jsx",
  "components/reef/AuctionPanel.jsx",
];

describe("no component fabricates USD from a hardcoded crypto exchange rate", () => {
  for (const rel of PRICE_DISPLAY_COMPONENTS) {
    it(`${rel} has no '* 1000' fake ETH→USD conversion`, () => {
      const src = source(rel);
      for (const pattern of FAKE_RATE_PATTERNS) {
        expect(src, `${rel} matched ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});

describe("the Tides auction is denominated in USD cents, not wei", () => {
  const panel = source("components/reef/AuctionPanel.jsx");
  const api = source("services/tidesApi.js");
  const hooks = source("hooks/useTides.js");

  it("AuctionPanel quotes dollars through the shared money helpers", () => {
    expect(panel).toContain('from "../../utils/money"');
    expect(panel).toContain("formatUsdCents");
    expect(panel).toContain("parseUsdToCents");
  });

  it("AuctionPanel no longer mentions wei, ETH or 1e18", () => {
    expect(panel).not.toMatch(/amount_wei|reserve_wei|formatEth\b|1e18/);
    // Bare "ETH" as a currency label.
    expect(panel).not.toMatch(/\bETH\b/);
  });

  it("the bid write path takes cents and rejects a non-integer amount", () => {
    expect(api).toContain("amount_cents: amountCents");
    expect(api).toContain("Number.isInteger(amountCents)");
    expect(api).not.toContain("amount_wei");
  });

  it("getHighestBid orders by amount, not recency — the lot goes to the highest bid", () => {
    // The original ordered by created_at DESC with nothing ever marking a bid
    // 'outbid', so the most RECENT bid won and $1 could take a $5,000 lot.
    expect(api).toContain('.order("amount_cents", { ascending: false })');
    expect(api).toMatch(/getHighestBid[\s\S]{0,900}maybeSingle\(\)/);
  });

  it("the realtime ticker compares bids numerically in cents", () => {
    expect(hooks).toContain("amount_cents");
    expect(hooks).not.toContain("BigInt(a.amount_wei");
  });
});

describe("the Wanted board budget is stored and shown in USD cents", () => {
  const board = source("components/WantedBoard.jsx");
  const notify = source("services/marketplaceNotifications.js");

  it("writes max_price_cents, never max_price_eth", () => {
    expect(board).toContain("max_price_cents");
    expect(board).not.toContain("max_price_eth");
  });

  it("validates the typed budget instead of inserting free text into an integer column", () => {
    expect(board).toContain("parseUsdToCents(maxPrice)");
  });

  it("the seller match notification formats cents rather than interpolating a raw number", () => {
    expect(notify).toContain("maxBudgetCents");
    expect(notify).toContain("formatUsdCents");
    expect(notify).not.toMatch(/up to \$\$\{maxBudget\}/);
  });
});
