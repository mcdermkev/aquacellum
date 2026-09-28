/**
 * Public auctions v2 (docs/AUCTIONS_SPEC.md) — phase 1: data model + API.
 * The database enforces the rules (dry-run verified on prod before apply); these
 * tests pin the migration's key rules, the pure helpers, and the API boundary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  cleanPhotos,
  mapAuctionDbError,
  minNextBidCents,
  parseLotListQuery,
  validateLotInput,
} from "../../api/_lib/auctionLots.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SQL = read("../../supabase/migrations/20260929_auctions_v2.sql");
const LOCKDOWN = read("../../supabase/migrations/20260929_auction_rpc_lockdown.sql");
const ORDER = JSON.stringify(JSON.parse(read("../../../supabase/migration-order.json")));
const API = strip(read("../../api/storefront-detail.js"));

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}
function sqlFn(name) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
}

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-10-01T12:00:00Z");

describe("migrations", () => {
  it("are registered in order", () => {
    const a = ORDER.indexOf("20260929_auction_rpc_lockdown.sql");
    const b = ORDER.indexOf("20260929_auctions_v2.sql");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it("old settlement RPCs are server-only", () => {
    for (const f of ["mark_auction_settlement_paid", "transfer_auction_lot", "record_auction_payment_failure", "forfeit_auction_settlement"]) {
      expect(LOCKDOWN).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated;`));
    }
  });

  it("every v2 write function is service_role only", () => {
    for (const f of ["create_auction_lot", "place_lot_bid", "cancel_auction_lot", "close_ended_auction_lots"]) {
      expect(SQL).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated;`));
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to service_role;`));
    }
    // Stock movers are internal: no grants at all.
    expect(SQL).not.toMatch(/grant execute on function public\.auction_lot_(take|return)_stock/);
  });

  it("tables are server-only; browsers read the views", () => {
    expect(SQL).toMatch(/revoke all on public\.auctions, public\.auction_lots, public\.auction_lot_bids from anon, authenticated;/);
    expect(SQL).toMatch(/grant select on public\.auction_lots_public, public\.auction_lot_bids_public to anon, authenticated;/);
  });

  it("the public views never expose reserve amounts or bidder wallets", () => {
    const lots = SQL.slice(SQL.indexOf("create or replace view public.auction_lots_public"), SQL.indexOf("create or replace view public.auction_lot_bids_public"));
    const selectList = lots.slice(0, lots.indexOf("from public.auction_lots l"));
    expect(selectList).not.toMatch(/l\.reserve_cents\s*,|l\.reserve_cents\s+as|high_bidder_wallet|winner_wallet/);
    expect(selectList).toMatch(/\(l\.reserve_cents is not null\)\s+as has_reserve/);
    const bids = SQL.slice(SQL.indexOf("create or replace view public.auction_lot_bids_public"), SQL.indexOf("-- ── 9."));
    const bidSelect = bids.slice(0, bids.indexOf("from public.auction_lot_bids b"));
    expect(bidSelect).not.toMatch(/bidder_wallet\s*,|b\.bidder_wallet$/m);
    expect(bidSelect).toMatch(/as bidder_number/);
  });

  it("bid rules: live window, card, no self/seller bids, minimum, cap, anti-snipe", () => {
    const f = sqlFn("place_lot_bid");
    expect(f).toMatch(/for update;/);
    expect(f).toMatch(/now\(\) >= l\.ends_at/);
    expect(f).toMatch(/v_bidder = l\.seller_wallet/);
    expect(f).toMatch(/buyer_payment_methods/);
    expect(f).toMatch(/l\.high_bidder_wallet = v_bidder/);
    expect(f).toMatch(/v_min := public\.auction_min_next_bid\(l\.high_bid_cents, l\.starting_bid_cents\);/);
    expect(f).toMatch(/p_amount > 10000000/);
    expect(f).toMatch(/l\.ends_at - now\(\) < interval '2 minutes'/);
    expect(f).toMatch(/least\(now\(\) \+ interval '2 minutes', l\.original_ends_at \+ interval '60 minutes'\)/);
    expect(f).toMatch(/members_only_bidding/);
  });

  it("minimum next bid: start, then +max($1, 5%)", () => {
    expect(SQL).toMatch(/p_high \+ greatest\(100, ceil\(p_high \* 0\.05\)::integer\)/);
  });

  it("close: reserve decides sold vs unsold; unpaid winners forfeit after 24h; stock returned", () => {
    const f = sqlFn("close_ended_auction_lots");
    expect(f).toMatch(/for update skip locked/);
    expect(f).toMatch(/r\.high_bid_cents is null or \(r\.reserve_cents is not null and r\.high_bid_cents < r\.reserve_cents\)/);
    expect(f).toMatch(/payment_deadline = now\(\) \+ interval '24 hours'/);
    expect(f).toMatch(/status in \('ended', 'payment_failed'\) and payment_deadline < now\(\)/);
    expect(f.match(/perform public\.auction_lot_return_stock\(r\.id\);/g)).toHaveLength(2);
    expect(SQL).toMatch(/cron\.schedule\('auction-close-ended-lots', '\* \* \* \* \*'/);
  });

  it("stock moves through the booth ledger under the listing lock", () => {
    const take = sqlFn("auction_lot_take_stock");
    expect(take).toMatch(/pg_advisory_xact_lock\(hashtextextended\(l\.listing_id, 0\)\)/);
    expect(take).toMatch(/'auction:' \|\| l\.id/);
    expect(take).toMatch(/raise exception 'oversell:/);
    const back = sqlFn("auction_lot_return_stock");
    expect(back).toMatch(/'restock:auction:' \|\| l\.id/);
    expect(back).toMatch(/on conflict \(sale_id\) do nothing/);
  });
});

describe("minNextBidCents mirrors the database", () => {
  it("uses the starting bid first, then +$1 or +5%", () => {
    expect(minNextBidCents(null, 1000)).toBe(1000);
    expect(minNextBidCents(1000, 1000)).toBe(1100);
    expect(minNextBidCents(4000, 1000)).toBe(4200);
    expect(minNextBidCents(1999, 100)).toBe(2099);
    expect(minNextBidCents(2001, 100)).toBe(2102);
  });
});

describe("validateLotInput", () => {
  const good = {
    title: "  Pink Saffire pair ",
    source: "batch_listing",
    listingId: "8000001",
    quantity: 2,
    startingBidCents: 1500,
    reserveCents: 3000,
    endsAt: new Date(NOW + 48 * HOUR).toISOString(),
    pickupLocation: "Edison, NJ",
    photos: ["https://example.com/a.jpg", "/showcase-media/steve/b.jpg"],
  };

  it("accepts a good batch lot and a freeform lot", () => {
    const r = validateLotInput(good, NOW);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ title: "Pink Saffire pair", quantity: 2, reserveCents: 3000, photos: good.photos });
    const f = validateLotInput({ ...good, source: "freeform", listingId: undefined, quantity: 5, reserveCents: "" }, NOW);
    expect(f.ok).toBe(true);
    expect(f.value).toMatchObject({ source: "freeform", listingId: null, quantity: 1, reserveCents: null });
  });

  it("refuses bad input with a code", () => {
    const code = (patch) => validateLotInput({ ...good, ...patch }, NOW).code;
    expect(code({ title: "" })).toBe("LOT_TITLE");
    expect(code({ source: "nft" })).toBe("LOT_SOURCE");
    expect(code({ listingId: "" })).toBe("LOT_LISTING");
    expect(code({ quantity: 0 })).toBe("LOT_QUANTITY");
    expect(code({ startingBidCents: 50 })).toBe("LOT_STARTING_BID");
    expect(code({ startingBidCents: 10.5 })).toBe("LOT_STARTING_BID");
    expect(code({ reserveCents: 1000 })).toBe("LOT_RESERVE");
    expect(code({ endsAt: new Date(NOW + 30 * 60 * 1000).toISOString() })).toBe("LOT_END_TOO_SOON");
    expect(code({ endsAt: new Date(NOW + 15 * 24 * HOUR).toISOString() })).toBe("LOT_END_TOO_LATE");
    expect(code({ pickupLocation: "" })).toBe("LOT_PICKUP");
    expect(code({ photos: ["http://insecure.example/x.jpg"] })).toBe("LOT_PHOTOS");
  });

  it("photos: https or same-origin paths only, at most 8", () => {
    expect(cleanPhotos(["javascript:alert(1)"])).toBeNull();
    expect(cleanPhotos(["//evil.example/x.jpg"])).toBeNull();
    expect(cleanPhotos(Array(9).fill("https://x.example/a.jpg"))).toBeNull();
    expect(cleanPhotos(null)).toEqual([]);
  });
});

describe("mapAuctionDbError", () => {
  it("turns database refusals into plain answers", () => {
    expect(mapAuctionDbError("bid refused: the minimum bid is 1100 cents")).toEqual({ status: 409, code: "BID_TOO_LOW", error: "The minimum bid is $11.00." });
    expect(mapAuctionDbError("bid refused: add a card first — ...").code).toBe("CARD_REQUIRED");
    expect(mapAuctionDbError("bid refused: you already have the high bid").code).toBe("ALREADY_HIGH_BIDDER");
    expect(mapAuctionDbError("bid refused: this lot has ended").code).toBe("LOT_CLOSED");
    expect(mapAuctionDbError("bid refused: this auction is for club members only").status).toBe(403);
    expect(mapAuctionDbError("oversell: 1 remaining, 2 requested for listing 8").code).toBe("NOT_ENOUGH_STOCK");
    expect(mapAuctionDbError("cancel refused: this lot has bids").code).toBe("LOT_HAS_BIDS");
    expect(mapAuctionDbError("weird").status).toBe(500);
  });
});

describe("parseLotListQuery", () => {
  it("defaults and bounds", () => {
    expect(parseLotListQuery({})).toEqual({ status: "live", sort: "ending", q: "", club: null, limit: 30 });
    expect(parseLotListQuery({ status: "ended", sort: "new", limit: "500", club: "bad slug!" })).toMatchObject({ status: "ended", sort: "new", limit: 60, club: null });
  });
});

describe("API boundary", () => {
  it("routes every action", () => {
    for (const [action, handler] of [
      ["auctions", "handleAuctionsPublic"],
      ["auction-lot", "handleAuctionLot"],
      ["auction-bid", "handleAuctionBid"],
      ["auction-create-lot", "handleAuctionCreateLot"],
      ["auction-cancel-lot", "handleAuctionCancelLot"],
      ["my-auctions", "handleMyAuctions"],
    ]) {
      expect(API).toMatch(new RegExp(`case "${action}":\\s*return ${handler}\\(req, res\\);`));
    }
  });

  it("writes use the verified session wallet, never the body", () => {
    expect(fn(API, "handleAuctionBid")).toMatch(/const bidder = await requireWalletFromSession\(req, res\);[\s\S]*p_bidder: bidder,/);
    expect(fn(API, "handleAuctionCreateLot")).toMatch(/const seller = await requireWalletFromSession\(req, res\);[\s\S]*p_seller: seller,/);
    expect(fn(API, "handleAuctionCancelLot")).toMatch(/p_seller: seller/);
    expect(fn(API, "handleMyAuctions")).toMatch(/const wallet = await requireWalletFromSession\(req, res\);/);
    for (const h of ["handleAuctionBid", "handleAuctionCreateLot", "handleAuctionCancelLot"]) {
      expect(fn(API, h)).not.toMatch(/body\.(bidder|seller|wallet)|walletAddress/);
    }
  });

  it("listing a lot requires finished payout setup", () => {
    const f = fn(API, "handleAuctionCreateLot");
    expect(f.indexOf("PAYOUTS_REQUIRED")).toBeLessThan(f.indexOf('rpc("create_auction_lot"'));
  });

  it("public reads come from the views only", () => {
    const list = fn(API, "handleAuctionsPublic");
    expect(list).toMatch(/from\("auction_lots_public"\)/);
    expect(list).not.toMatch(/from\("auction_lots"\)/);
    const lot = fn(API, "handleAuctionLot");
    expect(lot).toMatch(/from\("auction_lot_bids_public"\)/);
    // The private row is read only to tell a signed-in viewer about themselves.
    expect(lot.indexOf('from("auction_lots")')).toBeGreaterThan(lot.indexOf("if (wallet)"));
  });
});
