/**
 * Club auction night (docs/AUCTIONS_SPEC.md §9): the pure helpers, and the
 * safety properties of the API handlers (organizer checks, totals from the
 * database, webhook settlement).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CLUB_DESK_PURPOSE,
  MAX_IMPORT_LOTS,
  buildConsignorReport,
  clubCardFeePercent,
  mapNightDbError,
  parseLotImport,
} from "../../api/_lib/auctionNight.js";
import { resolveCommerceRoute } from "../services/commerceRoute.js";
import { cardPaymentIssues } from "../services/auctionNightPayments.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const STRIPE = strip(read("../../api/stripe.js"));
const DETAIL = strip(read("../../api/storefront-detail.js"));
const SQL = read("../../supabase/migrations/20260929_club_auction_night.sql");
const SERIALIZE_SQL = read("../../supabase/migrations/20260930_club_desk_serialize.sql");

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`) > -1 ? src.indexOf(`async function ${name}(`) : src.indexOf(`function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

describe("clubCardFeePercent", () => {
  it("takes the club's 25% share off our rate", () => {
    expect(clubCardFeePercent(4)).toBe(3);
    expect(clubCardFeePercent(2)).toBe(1.5);
  });
  it("falls back to 3% on nonsense", () => {
    expect(clubCardFeePercent("x")).toBe(3);
    expect(clubCardFeePercent(-1)).toBe(3);
  });
});

describe("parseLotImport", () => {
  it("reads tab- and pipe-separated lines and skips a header", () => {
    const { lots, errors } = parseLotImport("Title\tStart\tBrought by\tClub %\nBlue guppy trio\t$5\tSteve\t20\nRed cherry shrimp x10 | 12.50 | Ann");
    expect(errors).toEqual([]);
    expect(lots).toEqual([
      { title: "Blue guppy trio", startingBidCents: 500, consignorName: "Steve", splitPercent: 20 },
      { title: "Red cherry shrimp x10", startingBidCents: 1250, consignorName: "Ann", splitPercent: null },
    ]);
  });
  it("only the title is required; the default start applies", () => {
    expect(parseLotImport("Java fern").lots).toEqual([{ title: "Java fern", startingBidCents: 100, consignorName: null, splitPercent: null }]);
  });
  it("reports bad prices and splits by line, keeping the good lines", () => {
    const { lots, errors } = parseLotImport("A\t$0.50\nB\tfive\nC\t5\tX\t150\nD\t2");
    expect(lots.map((l) => l.title)).toEqual(["D"]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/Line 1/);
  });
  it("caps a paste at the import limit", () => {
    const text = Array.from({ length: MAX_IMPORT_LOTS + 5 }, (_, i) => `Lot ${i}`).join("\n");
    const { lots, errors } = parseLotImport(text);
    expect(lots).toHaveLength(MAX_IMPORT_LOTS);
    expect(errors[0]).toMatch(/up to 300/);
  });
});

describe("buildConsignorReport", () => {
  const lots = [
    { id: "a", status: "handed_off", hammer_cents: 1000, consignor_name: "Steve", club_split_percent: 20, payment_method: "cash" },
    { id: "b", status: "handed_off", hammer_cents: 3000, consignor_name: "Ann", club_split_percent: 0, payment_method: "card" },
    { id: "c", status: "handed_off", hammer_cents: 1000, consignor_name: "Steve", club_split_percent: 20, payment_method: "card" },
    { id: "d", status: "sold_live", hammer_cents: 500, consignor_name: null, club_split_percent: 100, payment_method: null },
    { id: "e", status: "unsold", hammer_cents: null, consignor_name: "Ann" },
  ];
  const payments = [
    { status: "paid", method: "cash", lot_ids: ["a"], platform_fee_cents: 0 },
    { status: "paid", method: "card_checkout", lot_ids: ["b", "c"], platform_fee_cents: 120 },
    { status: "failed", method: "card_checkout", lot_ids: ["d"], platform_fee_cents: 15 },
  ];
  const { rows, totals } = buildConsignorReport({ lots, payments });
  const by = Object.fromEntries(rows.map((r) => [r.consignor, r]));

  it("cash carries no fee; card fee is spread by price", () => {
    expect(by.Ann.feeCents).toBe(90);
    expect(by.Steve.feeCents).toBe(30);
    expect(totals.feeCents).toBe(120);
  });
  it("club cut is taken after our fee, and the rest is owed to the consignor", () => {
    // Steve: cash 1000 → club 200; card 1000 − 30 = 970 → club 194.
    expect(by.Steve.clubCents).toBe(394);
    expect(by.Steve.owedCents).toBe(2000 - 30 - 394);
    expect(by.Ann.owedCents).toBe(3000 - 90);
  });
  it("unpaid wins are counted but flagged; unsold lots are left out", () => {
    expect(by["Club (no consignor)"].unpaidCents).toBe(500);
    expect(totals.lotsSold).toBe(4);
    expect(totals.soldCents).toBe(5500);
    expect(totals.cashCents).toBe(1000);
    expect(totals.cardCents).toBe(4000);
    expect(totals.unpaidCents).toBe(500);
  });
  it("every cent of sales is accounted for", () => {
    expect(totals.owedCents + totals.clubCents + totals.feeCents).toBe(totals.soldCents);
  });
});

describe("mapNightDbError", () => {
  it("turns database refusals into plain answers", () => {
    expect(mapNightDbError("the room must beat the online bid of 2500 cents")).toMatchObject({ status: 409, error: expect.stringContaining("$25.00") });
    expect(mapNightDbError("bidder number 7 is taken")).toMatchObject({ status: 409, code: "NUMBER_TAKEN" });
    expect(mapNightDbError("only a club organizer can do that")).toMatchObject({ status: 403 });
    expect(mapNightDbError("this lot has been paid for or charged, so it can't be undone here")).toMatchObject({ code: "CANT_UNDO" });
  });
  it("hides anything unknown behind a 500", () => {
    expect(mapNightDbError("relation x does not exist")).toMatchObject({ status: 500, code: "NIGHT_ERROR" });
  });
});

describe("club night API handlers", () => {
  const CASES = [
    ["club-auction-home", "handleClubAuctionHome"], ["club-create", "handleClubCreate"],
    ["club-auction-create", "handleClubAuctionCreate"], ["club-auction", "handleClubAuctionConsole"],
    ["club-lot-add", "handleClubLotAdd"], ["club-lot-update", "handleClubLotUpdate"],
    ["club-lot-remove", "handleClubLotRemove"], ["club-bidder-add", "handleClubBidderAdd"],
    ["club-current-lot", "handleClubCurrentLot"], ["club-lot-result", "handleClubLotResult"],
    ["club-lot-undo", "handleClubLotUndo"], ["club-desk-cash", "handleClubDeskCash"],
    ["auction-room", "handleAuctionRoom"],
  ];
  it.each(CASES)("routes %s", (action, handler) => {
    expect(DETAIL).toMatch(new RegExp(`case "${action}":\\s*return ${handler}\\(req, res\\);`));
  });
  it.each(CASES.filter(([a]) => a !== "auction-room"))("%s requires a session and passes it as the actor", (_a, handler) => {
    const body = fn(DETAIL, handler);
    expect(body).toMatch(/requireWalletFromSession\(req, res\)/);
    expect(body).not.toMatch(/req\.(body|query)[^;]*wallet/i);
  });
  it("the console checks the organizer before returning bidders and reserves", () => {
    const body = fn(DETAIL, "handleClubAuctionConsole");
    expect(body.indexOf("auction_is_club_organizer")).toBeGreaterThan(-1);
    expect(body.indexOf("auction_is_club_organizer")).toBeLessThan(body.indexOf('from("auction_bidders")'));
  });
  it("the room screen reads only the public view", () => {
    const body = fn(DETAIL, "handleAuctionRoom");
    expect(body).toMatch(/from\("auction_room_public"\)/);
    expect(body).not.toMatch(/auction_bidders|reserve_cents|phone|email/);
  });
});

describe("club desk card payments", () => {
  it("routes the desk actions", () => {
    expect(STRIPE).toMatch(/case "club-desk-card":\s*return handleClubDeskCard\(req, res\);/);
    expect(STRIPE).toMatch(/case "club-desk-cancel":\s*return handleClubDeskCancel\(req, res\);/);
  });
  it("uses the same purpose tag as the helper module", () => {
    expect(STRIPE).toContain(`const CLUB_DESK_PURPOSE = "${CLUB_DESK_PURPOSE}"`);
  });
  it("is organizer-only and computes the total from the database", () => {
    const body = fn(STRIPE, "handleClubDeskCard");
    expect(body).toMatch(/requireWalletFromSession\(req, res\)/);
    expect(body).toMatch(/auction_is_club_organizer/);
    expect(body).toMatch(/from\("auction_lots"\)\.select\("hammer_cents"\)\.eq\("sold_to_bidder_id", bidder\.id\)\.eq\("status", "sold_live"\)/);
    expect(body).not.toMatch(/req\.body[^;]*(amount|total|cents)/i);
    // The reservation must match what we priced, or we start over.
    expect(body).toMatch(/Number\(begun\.goodsCents\) !== goods/);
  });
  it("closes an old QR before starting a new payment", () => {
    const body = fn(STRIPE, "handleClubDeskCard");
    expect(body.indexOf("closePendingDeskCheckouts")).toBeLessThan(body.indexOf("desk_begin_card_payment"));
  });
  it("cancel is organizer-only", () => {
    const body = fn(STRIPE, "handleClubDeskCancel");
    expect(body).toMatch(/requireWalletFromSession\(req, res\)/);
    expect(body).toMatch(/auction_is_club_organizer/);
  });
  it("uses the club rate and pays the club's account", () => {
    expect(fn(STRIPE, "clubDeskFeePlan")).toMatch(/clubCardFeePercent\(policy\.feePercent\)/);
    const settle = fn(STRIPE, "settleClubDeskPayment");
    expect(settle).toMatch(/desk_mark_payment_paid/);
    expect(settle.indexOf("replay")).toBeLessThan(settle.indexOf("createSellerTransfer"));
    // bids + premium − our fee (− processing when the club covers it): clubAuctionFees.test.js
    expect(settle).toMatch(/const payoutCents = clubDeskPayoutCents\(settled\);/);
  });
  it("refunds a paid QR that the desk had already replaced", () => {
    const settle = fn(STRIPE, "settleClubDeskPayment");
    expect(settle).toMatch(/payment is \(void\|failed\)/);
    expect(settle).toMatch(/refunds\.create/);
  });
  it("the webhook settles desk payments and lets Stripe retry on failure", () => {
    expect(STRIPE).toMatch(/metadata\?\.purpose === CLUB_DESK_PURPOSE[\s\S]{0,200}settleClubDeskPayment\(metadata\.deskPaymentId, paymentIntent\)/);
    expect(STRIPE).toContain('status(500).json({ error: "club desk settle failed" })');
    expect(STRIPE).toMatch(/metadata\.purpose === CLUB_DESK_PURPOSE[\s\S]{0,200}desk_fail_payment/);
  });
});

describe("auction night routes", () => {
  const ID = "0b8f2c1e-1234-4abc-9def-0123456789ab";
  it("home, console and room render full screen", () => {
    expect(resolveCommerceRoute("/app/auction-night")).toMatchObject({ kind: "auction-night-home", fullScreen: true });
    expect(resolveCommerceRoute(`/app/auction-night/${ID}`)).toMatchObject({ kind: "auction-night-console", auctionId: ID, fullScreen: true });
    expect(resolveCommerceRoute(`/app/auction-night/${ID}/room`)).toMatchObject({ kind: "auction-night-room", auctionId: ID, fullScreen: true });
  });
  it("anything else is not found", () => {
    expect(resolveCommerceRoute("/app/auction-night/nope").kind).toBe("not-found");
    expect(resolveCommerceRoute(`/app/auction-night/${ID}/desk`).kind).toBe("not-found");
    expect(resolveCommerceRoute(`/app/auction-night/${ID}/room/x`).kind).toBe("not-found");
  });
  it("the room screen never needs a session; the console never sends amounts", () => {
    const api = read("../services/auctionNightApi.js");
    expect(api).toMatch(/getRoom = \(auctionId\) =>[\s\S]{0,160}auth: "none"/);
    expect(api).toMatch(/deskCard = \(bidderId, mode\) =>[\s\S]{0,120}body: \{ bidderId, mode \}/);
  });
});

describe("club night migration", () => {
  it("keeps every function server-only", () => {
    expect(SQL).toMatch(/revoke execute on function public\.%s from public, anon, authenticated/);
    for (const f of ["desk_record_cash", "desk_begin_card_payment", "desk_mark_payment_paid", "record_live_lot_result", "undo_live_lot_result"]) {
      expect(SQL).toContain(`'${f}(`);
    }
  });
  it("undo refuses once money has moved", () => {
    expect(SQL).toMatch(/l\.status = 'sold_live' and l\.desk_payment_id is null/);
  });
});

describe("desk serialization (20260930)", () => {
  const body = (name) => {
    const start = SERIALIZE_SQL.indexOf(`function public.${name}(`);
    expect(start, `${name} redefined`).toBeGreaterThan(-1);
    return SERIALIZE_SQL.slice(start, SERIALIZE_SQL.indexOf("$$;", start));
  };
  for (const name of ["desk_record_cash", "desk_begin_card_payment"]) {
    it(`${name} locks the bidder, then the lots, before reserving`, () => {
      const b = body(name);
      const bidderLock = b.search(/from public\.auction_bidders where id = p_bidder for update/);
      const lotLock = b.search(/desk_payment_id is null\s+for update/);
      const reserve = b.indexOf("select array_agg(id)");
      expect(bidderLock).toBeGreaterThan(-1);
      expect(lotLock).toBeGreaterThan(bidderLock);
      expect(reserve).toBeGreaterThan(lotLock);
    });
  }
  it("is listed in the migration order", () => {
    expect(read("../../../supabase/migration-order.json")).toContain("frontend/supabase/migrations/20260930_club_desk_serialize.sql");
  });
});

describe("desk payouts, refunds and disputes (20260930)", () => {
  const REFUND_SQL = read("../../supabase/migrations/20260930_club_desk_refunds.sql");
  it("records the club transfer, or why it failed", () => {
    const settle = fn(STRIPE, "settleClubDeskPayment");
    expect(settle).toMatch(/const transfer = await createSellerTransfer/);
    expect(settle).toMatch(/stripe_transfer_id: transfer\?\.id/);
    expect(settle).toMatch(/transfer_error: String\(/);
  });
  it("only a paid desk payment is refunded, and a full refund takes its lots off the report", () => {
    expect(REFUND_SQL).toMatch(/stripe_payment_intent = p_payment_intent and status in \('paid', 'refunded'\)\s+for update/);
    expect(REFUND_SQL).toMatch(/update public\.auction_lots set status = 'refunded'\s+where desk_payment_id = d\.id and status = 'handed_off'/);
    expect(REFUND_SQL).toMatch(/least\(total_cents,/);
    expect(buildConsignorReport({ lots: [{ id: "a", status: "refunded", hammer_cents: 1000 }], payments: [] }).totals.lotsSold).toBe(0);
  });
  it("keeps the new functions server-only", () => {
    expect(REFUND_SQL).toMatch(/revoke execute on function public\.%s from public, anon, authenticated/);
    expect(REFUND_SQL).toContain("'desk_record_refund(text, integer, boolean)'");
    expect(REFUND_SQL).toContain("'desk_record_dispute(text)'");
    expect(read("../../../supabase/migration-order.json")).toContain("frontend/supabase/migrations/20260930_club_desk_refunds.sql");
  });
  it("the refund and dispute webhooks take the club's share back", () => {
    expect(STRIPE).toMatch(/desk_record_refund[\s\S]{0,400}reverseClubDeskPayout\(deskPay, clubDeskRefundTarget\(deskPay, charge\.amount_refunded, charge\.amount\), "refund"\)/);
    expect(STRIPE).toMatch(/desk_record_dispute[\s\S]{0,600}reverseClubDeskPayout\(deskPay, Number\(deskPay\.payoutCents \|\| 0\), "dispute"\)/);
  });
  it("reversal is idempotent and trusts Stripe's own count", () => {
    const rev = fn(STRIPE, "reverseClubDeskPayout");
    expect(rev).toMatch(/stripe\.transfers\.retrieve\(pay\.transferId\)/);
    expect(rev).toMatch(/const already = Number\(transfer\?\.amount_reversed \|\| 0\);\s*const amount = target - already;/);
    expect(rev).toMatch(/idempotencyKey: `club-desk-reversal-\$\{pay\.id\}-\$\{already\}-\$\{target\}`/);
    expect(rev).toMatch(/reversal_error/);
  });
  it("the club's share of a refund scales with the refund, capped at the payout", () => {
    const src = fn(STRIPE, "clubDeskRefundTarget");
    const target = new Function(`${src}; return clubDeskRefundTarget;`)();
    const pay = { payoutCents: 9700, totalCents: 10330 };
    expect(target(pay, 10330, 10330)).toBe(9700);
    expect(target(pay, 5165, 10330)).toBe(4850);
    expect(target(pay, 99999, 10330)).toBe(9700);
    expect(target({ payoutCents: null, totalCents: 100 }, 100, 100)).toBe(0);
  });
});

describe("card payment issues for the report", () => {
  const bidders = [{ id: "b1", bidder_number: 7 }];
  it("flags failed payouts, disputes, refunds and failed reversals; ignores cash and unpaid", () => {
    const out = cardPaymentIssues([
      { id: "p1", bidder_id: "b1", method: "card_checkout", status: "paid", payout_cents: 970, transfer_error: "no funds" },
      { id: "p2", bidder_id: "b1", method: "card_saved", status: "refunded", total_cents: 1033, refunded_cents: 1033, reversed_cents: 970 },
      { id: "p3", bidder_id: "b1", method: "card_checkout", status: "paid", total_cents: 1033, payout_cents: 970, disputed_at: "x", refunded_cents: 0 },
      { id: "p4", bidder_id: "b1", method: "card_checkout", status: "paid", refunded_cents: 500, reversed_cents: 0, reversal_error: "x" },
      { id: "p5", bidder_id: "b1", method: "cash", status: "paid", transfer_error: "n/a" },
      { id: "p6", bidder_id: "b1", method: "card_checkout", status: "void", transfer_error: "n/a" },
    ], bidders);
    expect(out.map((i) => i.id)).toEqual(["p1-t", "p2-r", "p3-d", "p4-r", "p4-v"]);
    expect(out[0]).toMatchObject({ tone: "err" });
    expect(out[0].text).toContain("#7: $9.70");
    expect(out[1].text).toContain("in full");
  });
  it("the report panel shows them", () => {
    const desk = read("../components/auctions/AuctionNightDesk.jsx");
    expect(desk).toMatch(/cardPaymentIssues\(data\.payments, data\.bidders\)/);
  });
});

describe("desk card failure handling", () => {
  it("a charged saved card is never reported as failed", () => {
    const b = fn(STRIPE, "handleClubDeskCard");
    expect(b).toMatch(/try \{\s*await settleClubDeskPayment\(begun\.paymentId, intent\);\s*\} catch/);
  });
  it("a failed checkout create frees the lots", () => {
    const b = fn(STRIPE, "handleClubDeskCard");
    expect(b).toMatch(/checkout\.sessions\.create[\s\S]*\} catch \(err\) \{[\s\S]{0,200}desk_fail_payment/);
  });
  it("the QR expiry clears Stripe's 30-minute floor", () => {
    const b = fn(STRIPE, "handleClubDeskCard");
    const m = b.match(/expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ (\d+) \* 60/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(30);
  });
});
