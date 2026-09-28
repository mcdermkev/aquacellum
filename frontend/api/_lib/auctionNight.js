/**
 * auctionNight.js — pure helpers for club auction night (docs/AUCTIONS_SPEC.md §9).
 * No I/O: parsing a pasted lot list, the club card rate, the consignor report,
 * and turning database refusals into plain answers.
 */

import { CLUB_FEE_SHARE_PERCENT } from "./auctionMoney.js";

// The lot-list parser is shared with the organizer console's preview.
export { MAX_IMPORT_LOTS, parseLotImport } from "../../src/services/auctionNightImport.js";

export const CLUB_DESK_PURPOSE = "aquadex_club_desk";

/** Our card fee for a club sale: the normal rate minus the club's 25% share. */
export function clubCardFeePercent(policyPercent) {
  const p = Number(policyPercent);
  if (!Number.isFinite(p) || p < 0) return 3;
  return Math.round(p * (1 - CLUB_FEE_SHARE_PERCENT / 100) * 100) / 100;
}

const SOLD_STATES = new Set(["sold_live", "handed_off", "paid", "ended", "charging", "payment_failed"]);

/**
 * Consignor report: per person who brought lots, what sold, the club's cut, our
 * card fee (card sales only — cash has no fee), and what the club owes them.
 * Our fee for a desk card payment is spread over its lots by price.
 *
 * @param {{ lots: Array<object>, payments: Array<object> }} args
 */
export function buildConsignorReport({ lots = [], payments = [] }) {
  const feeByLot = new Map();
  for (const p of payments) {
    if (p.status !== "paid" || !p.platform_fee_cents) continue;
    const ids = p.lot_ids || [];
    const group = lots.filter((l) => ids.includes(l.id));
    const total = group.reduce((s, l) => s + (l.hammer_cents || 0), 0);
    let left = p.platform_fee_cents;
    group.forEach((l, i) => {
      const share = i === group.length - 1 ? left : Math.round(p.platform_fee_cents * ((l.hammer_cents || 0) / (total || 1)));
      feeByLot.set(l.id, share);
      left -= share;
    });
  }

  const rows = new Map();
  const totals = { soldCents: 0, clubCents: 0, feeCents: 0, owedCents: 0, cashCents: 0, cardCents: 0, unpaidCents: 0, lotsSold: 0 };
  for (const l of lots) {
    if (!SOLD_STATES.has(l.status) || !l.hammer_cents) continue;
    const key = l.consignor_name || "Club (no consignor)";
    if (!rows.has(key)) rows.set(key, { consignor: key, lots: 0, soldCents: 0, clubCents: 0, feeCents: 0, owedCents: 0, unpaidCents: 0 });
    const r = rows.get(key);
    const paid = l.status === "handed_off" || l.status === "paid";
    const fee = l.payment_method === "card" ? (feeByLot.get(l.id) ?? Math.round(l.hammer_cents * 0.03)) : 0;
    const club = Math.round((l.hammer_cents - fee) * ((l.club_split_percent || 0) / 100));
    r.lots += 1;
    r.soldCents += l.hammer_cents;
    r.clubCents += club;
    r.feeCents += fee;
    r.owedCents += l.hammer_cents - fee - club;
    if (!paid) r.unpaidCents += l.hammer_cents;
    totals.lotsSold += 1;
    totals.soldCents += l.hammer_cents;
    totals.clubCents += club;
    totals.feeCents += fee;
    totals.owedCents += l.hammer_cents - fee - club;
    if (!paid) totals.unpaidCents += l.hammer_cents;
    if (paid && l.payment_method === "cash") totals.cashCents += l.hammer_cents;
    if (paid && l.payment_method === "card") totals.cardCents += l.hammer_cents;
  }
  return { rows: [...rows.values()].sort((a, b) => b.soldCents - a.soldCents), totals };
}

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Map a club-auction database refusal. Falls back to 500 for anything unknown. */
export function mapNightDbError(message = "") {
  const msg = String(message);
  const beat = msg.match(/beat the online bid of (\d+) cents/i);
  if (beat) return { status: 409, code: "BEAT_ONLINE_BID", error: `The room has to beat the online bid of ${dollars(Number(beat[1]))}.` };
  const taken = msg.match(/bidder number (\d+) is taken/i);
  if (taken) return { status: 409, code: "NUMBER_TAKEN", error: `Bidder number ${taken[1]} is already taken.` };
  const table = [
    [/only a club organizer/i, 403, "NOT_ORGANIZER", "Only a club organizer can do that."],
    [/online bid is below the reserve/i, 409, "BELOW_RESERVE", "The online bid is below the reserve."],
    [/below the reserve/i, 409, "BELOW_RESERVE", "That's below the reserve."],
    [/no online bid/i, 409, "NO_ONLINE_BID", "There's no online bid on this lot."],
    [/not up for sale in the room/i, 409, "ALREADY_CALLED", "This lot has already been called."],
    [/can't be undone|can''t be undone/i, 409, "CANT_UNDO", "This lot has been paid for, so it can't be undone here."],
    [/nothing to pay/i, 409, "NOTHING_TO_PAY", "This bidder has nothing left to pay."],
    [/unknown bidder number/i, 404, "UNKNOWN_BIDDER", "There's no bidder with that number."],
    [/finish setting up your profile/i, 409, "PROFILE_REQUIRED", "Finish setting up your profile first."],
    [/club name must/i, 400, "CLUB_NAME", "Club names are 2 to 80 characters."],
    [/online bidding must end/i, 400, "ONLINE_CUTOFF", "Online bidding must end between an hour from now and the start of the meeting."],
    [/pick the auction date/i, 400, "EVENT_TIME", "Pick the auction date and time."],
    [/auction is closed/i, 409, "AUCTION_CLOSED", "This auction is closed."],
    [/already been sold or closed/i, 409, "LOT_CLOSED", "This lot has already been sold or closed."],
    [/only a lot with no bids/i, 409, "LOT_HAS_BIDS", "Only a lot with no bids can be removed."],
    [/enter a price/i, 400, "PRICE", "Enter a price between $1 and $100,000."],
    [/not a club auction/i, 400, "NOT_CLUB", "That isn't a club auction."],
    [/not found/i, 404, "NOT_FOUND", "Not found."],
  ];
  for (const [re, status, code, error] of table) if (re.test(msg)) return { status, code, error };
  return { status: 500, code: "NIGHT_ERROR", error: "Something went wrong. Try again." };
}
