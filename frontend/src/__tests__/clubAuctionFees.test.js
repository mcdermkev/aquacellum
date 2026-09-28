/**
 * Club auction fee choices (20260930_club_auction_fees): buyer's premium and
 * who pays card processing. Money math, the database functions, and where the
 * API and UI apply them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buyerPremiumCents, MAX_BUYER_PREMIUM_PERCENT, winChargeText } from "../services/auctionNightPayments.js";
import { absorbedProcessingCents, auctionChargeMetadata, planAuctionCharge } from "../../api/_lib/auctionMoney.js";
import { buildConsignorReport, clubDeskPayoutCents, mapNightDbError } from "../../api/_lib/auctionNight.js";
import { computeCheckoutCharge } from "../services/checkoutPricing.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const STRIPE = strip(read("../../api/stripe.js"));
const DETAIL = strip(read("../../api/storefront-detail.js"));
const SQL = read("../../supabase/migrations/20260930_club_auction_fees.sql");
const RATE = 0.029;
const FIXED = 30;

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`) > -1 ? src.indexOf(`async function ${name}(`) : src.indexOf(`function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}
function sqlFn(name) {
  const start = SQL.indexOf(`function public.${name}(`);
  expect(start, `${name} in migration`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
}

describe("buyer's premium math", () => {
  it("rounds half up in whole cents, like the database's round()", () => {
    expect(buyerPremiumCents(1000, 10)).toBe(100);
    expect(buyerPremiumCents(105, 10)).toBe(11);   // 10.5 → 11
    expect(buyerPremiumCents(104, 10)).toBe(10);   // 10.4 → 10
    expect(buyerPremiumCents(333, 15)).toBe(50);   // 49.95 → 50
    expect(buyerPremiumCents(1000, 0)).toBe(0);
  });
  it("clamps the percent to 0–25", () => {
    expect(MAX_BUYER_PREMIUM_PERCENT).toBe(25);
    expect(buyerPremiumCents(1000, 90)).toBe(250);
    expect(buyerPremiumCents(1000, -5)).toBe(0);
  });
});

describe("planAuctionCharge with club fee choices", () => {
  const base = { hammerCents: 10000, feePercent: 3, stripeRate: RATE, stripeFixedCents: FIXED };

  it("with no choices, it's exactly the original plan", () => {
    const p = planAuctionCharge(base);
    const c = computeCheckoutCharge({ goodsPriceCents: 10000, feePercent: 3, stripeRate: RATE, stripeFixedCents: FIXED });
    expect(p).toMatchObject({
      premiumCents: 0, clubPaysProcessing: false,
      buyerTotalCents: c.buyerTotalCents, processingFeeCents: c.processingFeeCents,
      platformFeeCents: c.platformFeeCents, sellerPayoutCents: c.sellerPayoutCents,
    });
  });

  it("premium: bidder pays bid + premium + processing; our fee is on the bid only; the club gets the premium", () => {
    const p = planAuctionCharge({ ...base, premiumPercent: 10 });
    expect(p.premiumCents).toBe(1000);
    expect(p.platformFeeCents).toBe(300);
    expect(p.buyerTotalCents).toBe(Math.ceil((11000 + FIXED) / (1 - RATE)));
    expect(p.processingFeeCents).toBe(p.buyerTotalCents - 11000);
    expect(p.sellerPayoutCents).toBe(10000 - 300 + 1000);
    // Every cent the buyer pays is accounted for: payout + our fee + processing.
    expect(p.sellerPayoutCents + p.platformFeeCents + p.processingFeeCents).toBe(p.buyerTotalCents);
  });

  it("club pays processing: bidder pays bid + premium; processing comes off the payout", () => {
    const p = planAuctionCharge({ ...base, premiumPercent: 10, clubPaysProcessing: true });
    expect(p.buyerTotalCents).toBe(11000);
    expect(p.processingFeeCents).toBe(absorbedProcessingCents(11000, RATE, FIXED));
    expect(p.processingFeeCents).toBe(Math.ceil(11000 * RATE) + FIXED);
    expect(p.sellerPayoutCents).toBe(11000 - 300 - p.processingFeeCents);
    expect(p.sellerPayoutCents + p.platformFeeCents + p.processingFeeCents).toBe(p.buyerTotalCents);
  });

  it("the absorbed processing always covers Stripe's real fee", () => {
    for (const total of [100, 101, 999, 12345, 1000000]) {
      expect(absorbedProcessingCents(total, RATE, FIXED)).toBeGreaterThanOrEqual(Math.round(total * RATE) + FIXED);
    }
  });

  it("the charge metadata records the choices only when they're used", () => {
    const claim = { lotId: "l1", sellerWallet: "0xS", winnerWallet: "0xW" };
    const feePolicy = { feePercent: 4, reason: "standard" };
    const plain = auctionChargeMetadata({ claim, plan: planAuctionCharge(base), feePolicy, sellerStripeAccountId: "acct", transferGroup: "g" });
    expect(plain).not.toHaveProperty("premiumCents");
    expect(plain).not.toHaveProperty("clubPaysProcessing");
    const plan = planAuctionCharge({ ...base, premiumPercent: 10, clubPaysProcessing: true });
    const md = auctionChargeMetadata({ claim, plan, feePolicy, sellerStripeAccountId: "acct", transferGroup: "g" });
    expect(md).toMatchObject({ premiumCents: "1000", clubPaysProcessing: "true", sellerPayoutCents: String(plan.sellerPayoutCents) });
  });
});

describe("desk payout and report", () => {
  it("the club is sent bids + premium − our fee, minus processing only when it covers it", () => {
    expect(clubDeskPayoutCents({ goodsCents: 10000, premiumCents: 1000, platformFeeCents: 300, processingFeeCents: 360, clubPaysProcessing: false })).toBe(10700);
    expect(clubDeskPayoutCents({ goodsCents: 10000, premiumCents: 1000, platformFeeCents: 300, processingFeeCents: 349, clubPaysProcessing: true })).toBe(10351);
    expect(clubDeskPayoutCents({ goodsCents: 10000, platformFeeCents: 300 })).toBe(9700);
  });
  it("the premium and club-paid processing are the club's lines, never owed to consignors", () => {
    const lots = [{ id: "a", status: "handed_off", hammer_cents: 10000, payment_method: "card", consignor_name: "Ann", club_split_percent: 0 }];
    const plain = buildConsignorReport({ lots, payments: [{ status: "paid", method: "card_checkout", lot_ids: ["a"], platform_fee_cents: 300 }] });
    const withFees = buildConsignorReport({
      lots,
      payments: [{ status: "paid", method: "card_checkout", lot_ids: ["a"], platform_fee_cents: 300, premium_cents: 1000, processing_fee_cents: 349, club_pays_processing: true }],
    });
    expect(withFees.rows[0].owedCents).toBe(plain.rows[0].owedCents);
    expect(withFees.totals).toMatchObject({ premiumCents: 1000, clubProcessingCents: 349 });
  });
  it("refunded and unpaid payments don't count", () => {
    const r = buildConsignorReport({ lots: [], payments: [
      { status: "refunded", premium_cents: 500 }, { status: "pending", premium_cents: 500 }, { status: "paid", method: "cash", premium_cents: 200, club_pays_processing: true, processing_fee_cents: 99 },
    ] });
    expect(r.totals).toMatchObject({ premiumCents: 200, clubProcessingCents: 0 });
  });
  it("a bad premium is a plain answer", () => {
    expect(mapNightDbError("buyer's premium must be 0 to 25 percent")).toMatchObject({ status: 400, code: "PREMIUM" });
  });
});

describe("what bidders are told", () => {
  it("names the premium and who pays processing", () => {
    expect(winChargeText({})).toBe("If you win, your card is charged your bid plus a card processing fee (about 3%).");
    expect(winChargeText({ buyerPremiumPercent: 10 })).toBe("If you win, your card is charged your bid, a 10% buyer's premium for the club, and a card processing fee (about 3%).");
    expect(winChargeText({ buyerPremiumPercent: 10, clubPaysProcessing: true })).toBe("If you win, your card is charged your bid plus a 10% buyer's premium for the club.");
    expect(winChargeText({ clubPaysProcessing: true })).toBe("If you win, your card is charged your bid.");
  });
  it("the lot page, room screen and desk use the terms", () => {
    expect(read("../components/auctions/AuctionsPage.jsx")).toMatch(/\{winChargeText\(lot\)\}/);
    expect(read("../components/auctions/AuctionNightRoom.jsx")).toMatch(/room\.buyerPremiumPercent > 0/);
    const desk = read("../components/auctions/AuctionNightDesk.jsx");
    expect(desk).toMatch(/const owed = bids \+ premium;/);
    expect(desk).toMatch(/buyerPremiumCents\(bids, premiumPercent\)/);
  });
});

describe("the migration", () => {
  it("adds the choices with safe defaults and a 0–25 bound", () => {
    expect(SQL).toMatch(/buyer_premium_percent integer not null default 0\s+check \(buyer_premium_percent between 0 and 25\)/);
    expect(SQL).toMatch(/club_pays_processing boolean not null default false/);
  });
  it("replaces create_club_auction (the old 11-argument version is dropped)", () => {
    expect(SQL).toMatch(/drop function if exists public\.create_club_auction\(text, uuid, text, text, text, timestamptz, timestamptz, text, text, integer, boolean\);/);
    const f = sqlFn("create_club_auction");
    expect(f).toMatch(/p_buyer_premium integer, p_club_pays_processing boolean/);
    expect(f).toMatch(/auction_is_club_organizer\(p_school, v_actor\)/);
    expect(f).toMatch(/coalesce\(p_buyer_premium, 0\), coalesce\(p_club_pays_processing, false\)/);
  });
  it("cash and card compute the premium the same way, still locking the bidder first", () => {
    for (const name of ["desk_record_cash", "desk_begin_card_payment"]) {
      const f = sqlFn(name);
      expect(f).toMatch(/v_premium := round\(v_goods \* coalesce\(a\.buyer_premium_percent, 0\) \/ 100\.0\)::int;/);
      expect(f.search(/where id = p_bidder for update/)).toBeGreaterThan(-1);
      expect(f.search(/desk_payment_id is null\s+for update/)).toBeGreaterThan(f.search(/where id = p_bidder for update/));
    }
    expect(sqlFn("desk_record_cash")).toMatch(/v_goods \+ v_premium, lower\(p_actor\), now\(\)/);
  });
  it("a card total leaves processing out when the club covers it", () => {
    expect(sqlFn("desk_begin_card_payment")).toMatch(/v_goods \+ v_premium \+ case when a\.club_pays_processing then 0 else v_proc end/);
  });
  it("mark-paid returns what the payout needs", () => {
    const f = sqlFn("desk_mark_payment_paid");
    for (const k of ["premiumCents", "processingFeeCents", "clubPaysProcessing", "platformFeeCents", "goodsCents"]) expect(f).toContain(`'${k}'`);
  });
  it("the public views gain the terms at the end (existing columns unchanged)", () => {
    expect(SQL).toMatch(/a\.format as auction_format, a\.event_at,\s+a\.buyer_premium_percent, a\.club_pays_processing\s+from public\.auction_lots l/);
    expect(SQL).toMatch(/as lots_left,\s+a\.buyer_premium_percent\s+from public\.auctions a/);
  });
  it("keeps the functions server-only and is in the migration order", () => {
    expect(SQL).toMatch(/revoke execute on function public\.%s from public, anon, authenticated/);
    expect(SQL).toContain("'create_club_auction(text, uuid, text, text, text, timestamptz, timestamptz, text, text, integer, boolean, integer, boolean)'");
    expect(read("../../../supabase/migration-order.json")).toContain("frontend/supabase/migrations/20260930_club_auction_fees.sql");
  });
});

describe("where the API applies the choices", () => {
  it("create passes both choices, clamped", () => {
    const b = fn(DETAIL, "handleClubAuctionCreate");
    expect(b).toMatch(/p_buyer_premium: Math\.min\(MAX_BUYER_PREMIUM_PERCENT, Math\.max\(0,/);
    expect(b).toMatch(/p_club_pays_processing: b\.clubPaysProcessing === true/);
  });
  it("the desk card plan uses the auction's choices and checks the database priced the same premium", () => {
    expect(fn(STRIPE, "clubDeskFeePlan")).toMatch(/premiumPercent: Number\(auction\.buyer_premium_percent\) \|\| 0,\s*clubPaysProcessing: auction\.club_pays_processing === true/);
    const card = fn(STRIPE, "handleClubDeskCard");
    expect(card).toMatch(/Number\(begun\.premiumCents \|\| 0\) !== plan\.premiumCents/);
    expect(card).toMatch(/\(begun\.clubPaysProcessing === true\) !== plan\.clubPaysProcessing/);
    expect(card).toMatch(/!plan\.clubPaysProcessing && plan\.processingFeeCents > 0/);
    expect(card).toMatch(/plan\.premiumCents > 0 \? \[\{ price_data/);
  });
  it("the club payout uses the shared helper", () => {
    expect(fn(STRIPE, "settleClubDeskPayment")).toMatch(/const payoutCents = clubDeskPayoutCents\(settled\);/);
  });
  it("online winners of a club auction pay on the same terms, and nothing is charged if the terms can't load", () => {
    const charge = fn(STRIPE, "chargeAuctionLotV2");
    expect(charge).toMatch(/claim\.hostType === "club"/);
    expect(charge).toMatch(/select\("auctions\(buyer_premium_percent, club_pays_processing\)"\)/);
    expect(charge.indexOf("could not load club fee terms")).toBeLessThan(charge.indexOf("paymentIntents.create"));
    expect(charge).toMatch(/\.\.\.clubFees,/);
  });
});
