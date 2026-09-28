/**
 * auctionNightPayments.js — what an organizer needs to know about the night's
 * card payments: a payout that didn't reach the club, refunds, disputes.
 * Pure: reads the console's `payments` and `bidders`.
 */

const dollars = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export const MAX_BUYER_PREMIUM_PERCENT = 25;

/**
 * A club's buyer's premium on a total of winning bids, in cents. Integer math,
 * rounded half up — the same as the database's round(goods × percent / 100),
 * so the desk screen, the API and the database always agree.
 */
export function buyerPremiumCents(goodsCents, percent) {
  const goods = Math.max(0, Math.round(Number(goodsCents) || 0));
  const p = Math.min(MAX_BUYER_PREMIUM_PERCENT, Math.max(0, Math.round(Number(percent) || 0)));
  return Math.floor((goods * p + 50) / 100);
}

/**
 * @param {Array<object>} payments - auction_desk_payments rows from the console
 * @param {Array<{id:string, bidder_number:number}>} bidders
 * @returns {Array<{ id:string, tone:"err"|"info", text:string }>}
 */
export function cardPaymentIssues(payments = [], bidders = []) {
  const num = new Map(bidders.map((b) => [b.id, b.bidder_number]));
  const out = [];
  for (const p of payments) {
    if (p.method === "cash" || (p.status !== "paid" && p.status !== "refunded")) continue;
    const who = `#${num.get(p.bidder_id) ?? "?"}`;
    if (p.transfer_error) {
      out.push({ id: `${p.id}-t`, tone: "err", text: `${who}: ${dollars(p.payout_cents)} didn't reach the club's payout account. We'll resend it; contact support if it isn't there within a day.` });
    }
    if (p.disputed_at) {
      out.push({ id: `${p.id}-d`, tone: "err", text: `${who}: the bidder disputed ${dollars(p.total_cents)} with their bank. The club's ${dollars(p.payout_cents)} was taken back while it's decided.` });
    } else if (p.refunded_cents > 0) {
      const full = p.status === "refunded" ? " in full, so those lots are off the report" : "";
      out.push({ id: `${p.id}-r`, tone: "info", text: `${who}: ${dollars(p.refunded_cents)} refunded${full}. ${dollars(p.reversed_cents)} came back from the club's payout.` });
    }
    if (p.reversal_error) {
      out.push({ id: `${p.id}-v`, tone: "err", text: `${who}: we couldn't take the refunded amount back from the club's payout yet. We'll sort it out with the club.` });
    }
  }
  return out;
}

/** What a winner's card is charged, in the lot's own terms (a club can add a premium or cover processing). */
export function winChargeText(lot) {
  const premium = Number(lot?.buyerPremiumPercent) || 0;
  const parts = ["your bid"];
  if (premium > 0) parts.push(`a ${premium}% buyer's premium for the club`);
  if (!lot?.clubPaysProcessing) parts.push("a card processing fee (about 3%)");
  const list = parts.length === 3 ? `${parts[0]}, ${parts[1]}, and ${parts[2]}` : parts.join(" plus ");
  return `If you win, your card is charged ${list}.`;
}
